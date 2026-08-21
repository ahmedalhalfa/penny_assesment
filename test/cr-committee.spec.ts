import { freshFixtures } from './test-helpers';

function routeToCommittee(
	svc: ReturnType<typeof freshFixtures>['svc'],
	repo: ReturnType<typeof freshFixtures>['repo'],
	users: ReturnType<typeof freshFixtures>['users'],
) {
	const cr = repo.findOne(users.alice, 'CR-DRAFT');
	if (!cr) throw new Error('fixture missing CR-DRAFT');
	cr.draftChanges = {
		lineItems: [
			{ sku: 'A', quantity: 18, unitPrice: 500 },
			{ sku: 'B', quantity: 30, unitPrice: 100 },
		],
	}; // delta 4000, above the committee threshold
	svc.submit(users.alice, 'CR-DRAFT', '2026-01-01T00:00:00Z');
	return svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-01T00:01:00Z');
}

describe('committee voting and resolution', () => {
	it('stays in COMMITTEE_VOTING until a decision is mathematically settled', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		const afterCarl = svc.castVote(users.carl, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:02:00Z');
		expect(afterCarl.status).toBe('COMMITTEE_VOTING');
	});

	it('resolves APPROVED when both members approve, including the head', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		svc.castVote(users.carl, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:02:00Z');
		const resolved = svc.castVote(users.dina, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:03:00Z');

		expect(resolved.status).toBe('APPROVED');
		expect(resolved.committee?.resolvedAt).toBe('2026-01-01T00:03:00Z');
		expect(resolved.audit.slice(-2).map((a) => a.action)).toEqual(['RESOLVE_COMMITTEE', 'RESOLVE_COMMITTEE']);
	});

	it('a member REJECT resolves REJECTED immediately without waiting on the head', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		const resolved = svc.castVote(users.carl, 'CR-DRAFT', 'REJECT', '2026-01-01T00:02:00Z');
		expect(resolved.status).toBe('REJECTED');
	});

	it('a head REJECT vetoes even if the other member already approved', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		svc.castVote(users.carl, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:02:00Z');
		const resolved = svc.castVote(users.dina, 'CR-DRAFT', 'REJECT', '2026-01-01T00:03:00Z');
		expect(resolved.status).toBe('REJECTED');
	});

	it('rejects a vote from a non-committee-member', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		expect(() => svc.castVote(users.mona, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:02:00Z')).toThrow(/committee member/i);
	});

	it('rejects a duplicate vote from the same member', () => {
		const { users, svc, repo } = freshFixtures();
		routeToCommittee(svc, repo, users);

		svc.castVote(users.carl, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:02:00Z');
		expect(() => svc.castVote(users.carl, 'CR-DRAFT', 'APPROVE', '2026-01-01T00:03:00Z')).toThrow(/already voted/i);
	});

	it('rejects a vote on a CR that is not in committee voting', () => {
		const { users, svc } = freshFixtures();
		expect(() => svc.castVote(users.carl, 'CR-PENDING-SMALL', 'APPROVE', '2026-01-01T00:00:00Z')).toThrow();
	});
});
