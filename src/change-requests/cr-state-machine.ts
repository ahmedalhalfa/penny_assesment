import { CrStatus, isTerminal } from './cr.enums';
import { Errors } from '../common/errors';

// Legal transitions for the CR state machine. See README diagram.
// REJECTED only comes out of an approval decision (PENDING_APPROVAL or COMMITTEE_DECISION);
// CANCELLED is the owner-withdrawal path and stops being available once a decision is in progress.
export const LEGAL_TRANSITIONS: Partial<Record<CrStatus, CrStatus[]>> = {
	[CrStatus.DRAFT]: [CrStatus.SUBMITTED, CrStatus.CANCELLED],
	[CrStatus.SUBMITTED]: [CrStatus.PENDING_APPROVAL, CrStatus.CANCELLED],
	[CrStatus.PENDING_APPROVAL]: [CrStatus.APPROVED, CrStatus.COMMITTEE_VOTING, CrStatus.RETURNED, CrStatus.REJECTED, CrStatus.CANCELLED],
	[CrStatus.COMMITTEE_VOTING]: [CrStatus.COMMITTEE_DECISION, CrStatus.CANCELLED],
	[CrStatus.COMMITTEE_DECISION]: [CrStatus.APPROVED, CrStatus.REJECTED],
	[CrStatus.APPROVED]: [CrStatus.APPLIED, CrStatus.CANCELLED],
	[CrStatus.RETURNED]: [CrStatus.DRAFT],
};

export function canTransition(from: CrStatus, to: CrStatus): boolean {
	return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Throw a BusinessError if the transition from->to is not allowed. */
export function assertTransition(from: CrStatus, to: CrStatus): void {
	if (isTerminal(from)) {
		throw Errors.terminal(`Cannot move a ${from} change request to ${to}`);
	}
	if (!canTransition(from, to)) {
		throw Errors.illegalTransition(`Illegal transition from ${from} to ${to}`);
	}
}
