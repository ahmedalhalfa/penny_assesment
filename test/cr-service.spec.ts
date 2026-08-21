import { freshFixtures } from './test-helpers';

describe('CrService approval flow', () => {
	it('sendForApproval routes a small delta to a single approver', () => {
		const { users, svc } = freshFixtures();
		svc.submit(users.alice, 'CR-DRAFT', '2026-01-01T00:00:00Z');
		const cr = svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-02T00:00:00Z');
		expect(cr.status).toBe('PENDING_APPROVAL');
		expect(cr.totals).toEqual({ baselineTotal: 8000, newTotal: 8500, delta: 500 });
		expect(cr.committee).toBeUndefined();
	});

	it('sendForApproval routes a large delta to committee voting', () => {
		const { users, svc, repo } = freshFixtures();
		const cr = repo.findOne(users.alice, 'CR-DRAFT')!;
		cr.draftChanges = {
			lineItems: [
				{ sku: 'A', quantity: 18, unitPrice: 500 },
				{ sku: 'B', quantity: 30, unitPrice: 100 },
			],
		}; // delta 4000
		svc.submit(users.alice, 'CR-DRAFT', '2026-01-01T00:00:00Z');

		const routed = svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-02T00:00:00Z');
		expect(routed.status).toBe('COMMITTEE_VOTING');
		expect(routed.committee).toEqual({ members: ['carl', 'dina'], head: 'dina', votes: [] });
	});

	it('approve moves a single-approver CR to APPROVED and records the approval', () => {
		const { users, svc } = freshFixtures();
		const cr = svc.approve(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z');
		expect(cr.status).toBe('APPROVED');
		expect(cr.approvals).toEqual([{ userId: 'mona', action: 'APPROVE', at: '2026-01-02T00:00:00Z' }]);
	});

	it('approve refuses a CR that is in committee voting', () => {
		const { users, svc, repo } = freshFixtures();
		const cr = repo.findOne(users.alice, 'CR-DRAFT')!;
		cr.draftChanges = {
			lineItems: [
				{ sku: 'A', quantity: 18, unitPrice: 500 },
				{ sku: 'B', quantity: 30, unitPrice: 100 },
			],
		}; // delta 4000
		svc.submit(users.alice, 'CR-DRAFT', '2026-01-01T00:00:00Z');
		svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-02T00:00:00Z');

		expect(() => svc.approve(users.mona, 'CR-DRAFT', '2026-01-02T00:01:00Z')).toThrow(/awaiting single-approver/i);
	});

	it('reject moves a CR to the terminal REJECTED state', () => {
		const { users, svc } = freshFixtures();
		const cr = svc.reject(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z');
		expect(cr.status).toBe('REJECTED');
		expect(() => svc.approve(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:01:00Z')).toThrow();
	});

	it('returnToDraft sends a CR back to DRAFT and clears approval progress', () => {
		const { users, svc, repo } = freshFixtures();
		const cr = repo.findOne(users.alice, 'CR-PENDING-SMALL')!;
		cr.approvals = [{ userId: 'carl', action: 'APPROVE', at: '2025-01-01T00:00:00Z' }];

		const returned = svc.returnToDraft(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z');
		expect(returned.status).toBe('DRAFT');
		expect(returned.approvals).toEqual([]);
	});

	it('apply on an approved CR updates the budget and reaches APPLIED', () => {
		const { users, svc, budgets } = freshFixtures();
		svc.approve(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z');
		const cr = svc.apply(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:01:00Z');

		expect(cr.status).toBe('APPLIED');
		const budget = budgets.get('BUD-1')!;
		expect(budget.balance).toBe(9500);
		expect(budget.booked).toBe(8500);
	});

	it('apply fails with INSUFFICIENT_BUDGET when the budget cannot cover the delta, and leaves it untouched', () => {
		const { users, svc, agreements, budgets } = freshFixtures();
		agreements.get('AGR-1')!.budgetId = 'BUD-LOW'; // BUD-LOW only has a balance of 100
		svc.approve(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z'); // delta 500

		expect(() => svc.apply(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:01:00Z')).toThrow(/budget/i);
		expect(budgets.get('BUD-LOW')!.balance).toBe(100);
	});

	it('apply refuses a CR that is not APPROVED', () => {
		const { users, svc } = freshFixtures();
		expect(() => svc.apply(users.mona, 'CR-PENDING-SMALL', '2026-01-02T00:00:00Z')).toThrow();
	});

	it('terminal states reject every further action', () => {
		const { users, svc } = freshFixtures();
		expect(() => svc.approve(users.mona, 'CR-APPLIED', '2026-01-02T00:00:00Z')).toThrow();
		expect(() => svc.reject(users.mona, 'CR-APPLIED', '2026-01-02T00:00:00Z')).toThrow();
		expect(() => svc.apply(users.mona, 'CR-APPLIED', '2026-01-02T00:00:00Z')).toThrow();
	});

	it('records one audit entry per transition across the full happy path', () => {
		const { users, svc } = freshFixtures();
		svc.submit(users.alice, 'CR-DRAFT', '2026-01-02T00:00:00Z');
		svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-02T00:01:00Z');
		svc.approve(users.mona, 'CR-DRAFT', '2026-01-02T00:02:00Z');
		const cr = svc.apply(users.mona, 'CR-DRAFT', '2026-01-02T00:03:00Z');

		expect(cr.audit.map((a) => a.action)).toEqual(['SUBMIT', 'SEND_FOR_APPROVAL', 'APPROVE', 'APPLY']);
		expect(cr.audit.every((a) => typeof a.byUserId === 'string' && typeof a.at === 'string')).toBe(true);
	});
});
