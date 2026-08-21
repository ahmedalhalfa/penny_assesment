import { buildSeed } from '../src/seed';
import { CrRepo } from '../src/change-requests/cr-repo';

function makeRepo() {
	const { users, changeRequests } = buildSeed();
	const repo = new CrRepo();
	repo.seed(changeRequests);
	return { users, repo };
}

describe('CrRepo org scoping', () => {
	it("findOne returns the CR when it belongs to the caller's org", () => {
		const { users, repo } = makeRepo();
		expect(repo.findOne(users.mona, 'CR-PENDING-SMALL')?.id).toBe('CR-PENDING-SMALL');
	});

	it('findOne returns undefined for a CR in another org', () => {
		const { users, repo } = makeRepo();
		expect(repo.findOne(users.mona, 'CR-BETA')).toBeUndefined();
		expect(repo.findOne(users.bob, 'CR-PENDING-SMALL')).toBeUndefined();
	});

	it('findOne returns undefined for an unknown id', () => {
		const { users, repo } = makeRepo();
		expect(repo.findOne(users.mona, 'CR-DOES-NOT-EXIST')).toBeUndefined();
	});

	it("list only returns CRs in the caller's org", () => {
		const { users, repo } = makeRepo();
		const betaList = repo.list(users.bob);
		expect(betaList.map((cr) => cr.id)).toEqual(['CR-BETA']);

		const alphaList = repo.list(users.mona);
		expect(alphaList.every((cr) => cr.orgCode === 'org-alpha')).toBe(true);
		expect(alphaList.length).toBe(4);
	});

	it('save persists the given CR by id', () => {
		const { users, repo } = makeRepo();
		const cr = repo.findOne(users.mona, 'CR-PENDING-SMALL')!;
		cr.approvals = [{ userId: 'mona', action: 'APPROVE', at: '2026-01-01T00:00:00Z' }];
		repo.save(cr);

		const reloaded = repo.findOne(users.mona, 'CR-PENDING-SMALL');
		expect(reloaded?.approvals).toEqual([{ userId: 'mona', action: 'APPROVE', at: '2026-01-01T00:00:00Z' }]);
	});
});
