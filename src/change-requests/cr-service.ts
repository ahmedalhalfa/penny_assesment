import { CrRepo } from './cr-repo';
import { ChangeRequest, Budget, PurchaseAgreement, COMMITTEE_DELTA_THRESHOLD } from './cr.types';
import { CrStatus, CrAction } from './cr.enums';
import { assertTransition } from './cr-state-machine';
import { computeTotals } from './cr-totals';
import { round2 } from '../common/money.util';
import { Errors } from '../common/errors';
import { ReqUser, hasPolicy } from '../common/policy';

/** Orchestrates CR actions: state transitions, budget checks, permissions, and the audit trail. */
export class CrService {
	constructor(
		private readonly repo: CrRepo,
		private readonly agreements: Map<string, PurchaseAgreement>,
		private readonly budgets: Map<string, Budget>,
		// Committee membership used when routing large changes to a vote (Task 3).
		private readonly committeeConfig?: { members: string[]; head: string },
	) {}

	/** Load a CR for this user or throw NOT_FOUND. */
	private getOrThrow(user: ReqUser, id: string): ChangeRequest {
		const cr = this.repo.findOne(user, id);
		if (!cr) throw Errors.notFound(`CR ${id} not found`);
		return cr;
	}

	/** Apply a legal transition and append an immutable audit entry. Provided helper. */
	private transition(cr: ChangeRequest, to: CrStatus, action: CrAction, byUserId: string, at: string, note?: string): void {
		assertTransition(cr.status, to);
		cr.status = to;
		cr.audit = [...cr.audit, { action, byUserId, at, note }];
	}

	submit(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_u_u') && !hasPolicy(user, 'cr_u_o')) throw Errors.forbidden('Cannot submit');
		this.transition(cr, CrStatus.SUBMITTED, CrAction.SUBMIT, user.id, at);
		return this.repo.save(cr);
	}

	sendForApproval(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_u_u') && !hasPolicy(user, 'cr_u_o')) throw Errors.forbidden('Cannot send for approval');

		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		cr.totals = computeTotals(agreement, cr);

		this.transition(cr, CrStatus.PENDING_APPROVAL, CrAction.SEND_FOR_APPROVAL, user.id, at);

		if (Math.abs(cr.totals.delta) > COMMITTEE_DELTA_THRESHOLD) {
			if (!this.committeeConfig) throw Errors.validation('No committee configured for this delta');
			cr.committee = { members: this.committeeConfig.members, head: this.committeeConfig.head, votes: [] };
			this.transition(
				cr,
				CrStatus.COMMITTEE_VOTING,
				CrAction.SEND_FOR_APPROVAL,
				user.id,
				at,
				'delta exceeds threshold, routed to committee',
			);
		}

		return this.repo.save(cr);
	}

	approve(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_a_u') && !hasPolicy(user, 'cr_a_o')) throw Errors.forbidden('Cannot approve');
		if (cr.status !== CrStatus.PENDING_APPROVAL) {
			throw Errors.illegalTransition('Only a CR awaiting single-approver decision can be approved this way');
		}
		cr.approvals = [...cr.approvals, { userId: user.id, action: 'APPROVE', at }];
		this.transition(cr, CrStatus.APPROVED, CrAction.APPROVE, user.id, at);
		return this.repo.save(cr);
	}

	castVote(user: ReqUser, id: string, decision: 'APPROVE' | 'REJECT', at: string): ChangeRequest {
		// TODO: only committee members may vote; resolve on majority + head decision.
		throw Errors.validation('castVote not implemented');
	}

	returnToDraft(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_a_u') && !hasPolicy(user, 'cr_a_o')) throw Errors.forbidden('Cannot return');
		if (cr.status !== CrStatus.PENDING_APPROVAL) {
			throw Errors.illegalTransition('Only a CR awaiting approval can be returned to draft');
		}
		this.transition(cr, CrStatus.RETURNED, CrAction.RETURN, user.id, at);
		cr.approvals = [];
		this.transition(cr, CrStatus.DRAFT, CrAction.RETURN, user.id, at, 'returned for edits');
		return this.repo.save(cr);
	}

	reject(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_a_u') && !hasPolicy(user, 'cr_a_o')) throw Errors.forbidden('Cannot reject');
		if (cr.status !== CrStatus.PENDING_APPROVAL) {
			throw Errors.illegalTransition('Only a CR awaiting single-approver decision can be rejected this way');
		}
		cr.approvals = [...cr.approvals, { userId: user.id, action: 'REJECT', at }];
		this.transition(cr, CrStatus.REJECTED, CrAction.REJECT, user.id, at);
		return this.repo.save(cr);
	}

	apply(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_x_u') && !hasPolicy(user, 'cr_x_o')) throw Errors.forbidden('Cannot apply');
		if (cr.status !== CrStatus.APPROVED) {
			throw Errors.illegalTransition('Only an approved CR can be applied');
		}

		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		cr.totals = computeTotals(agreement, cr);

		if (cr.totals.delta > 0) {
			const budget = this.budgets.get(agreement.budgetId);
			if (!budget) throw Errors.notFound('Budget not found');
			if (budget.balance < cr.totals.delta) throw Errors.insufficientBudget();
			budget.balance = round2(budget.balance - cr.totals.delta);
			budget.booked = round2(budget.booked + cr.totals.delta);
		}

		this.transition(cr, CrStatus.APPLIED, CrAction.APPLY, user.id, at);
		return this.repo.save(cr);
	}

	/** Read a single CR. */
	get(user: ReqUser, id: string): ChangeRequest {
		return this.getOrThrow(user, id);
	}

	/** List the CRs this user is allowed to see. Honor the user's read scope (u/w/o). */
	list(user: ReqUser): ChangeRequest[] {
		// TODO: org scoping happens in the repo; narrow further by the caller's read scope.
		return this.repo.list(user);
	}

	/** Recompute and persist totals for a CR (used by tests and before routing). Provided. */
	recomputeTotals(user: ReqUser, id: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		cr.totals = computeTotals(agreement, cr);
		return this.repo.save(cr);
	}
}
