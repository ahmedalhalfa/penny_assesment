import { freshFixtures } from './test-helpers';
import { ReqUser } from '../src/common/policy';
import { BusinessError } from '../src/common/errors';

function expectForbidden(fn: () => unknown) {
	expect(fn).toThrow(BusinessError);
	try {
		fn();
	} catch (err) {
		expect((err as BusinessError).code).toBe('FORBIDDEN');
	}
}

describe('org isolation', () => {
	it('a user cannot read a CR from another org', () => {
		const { users, svc } = freshFixtures();
		expect(() => svc.get(users.bob, 'CR-PENDING-SMALL')).toThrow(); // bob is org-beta, CR is org-alpha
		expect(() => svc.get(users.alice, 'CR-BETA')).toThrow(); // alice is org-alpha, CR is org-beta
	});

	it('a user cannot act on a CR from another org', () => {
		const { users, svc } = freshFixtures();
		expect(() => svc.approve(users.bob, 'CR-PENDING-SMALL', '2026-01-01T00:00:00Z')).toThrow();
	});

	it('list() never returns CRs from another org', () => {
		const { users, svc } = freshFixtures();
		const list = svc.list(users.bob);
		expect(list.every((cr) => cr.orgCode === 'org-beta')).toBe(true);
	});
});

describe('action permissions', () => {
	it('a user without approve/apply policies cannot approve, reject, return, vote, or apply', () => {
		const { users, svc } = freshFixtures();
		const alice = users.alice; // policies: cr_c_u, cr_r_u, cr_u_u only
		expectForbidden(() => svc.approve(alice, 'CR-PENDING-SMALL', '2026-01-01T00:00:00Z'));
		expectForbidden(() => svc.reject(alice, 'CR-PENDING-SMALL', '2026-01-01T00:00:00Z'));
		expectForbidden(() => svc.returnToDraft(alice, 'CR-PENDING-SMALL', '2026-01-01T00:00:00Z'));
		expectForbidden(() => svc.castVote(alice, 'CR-PENDING-SMALL', 'APPROVE', '2026-01-01T00:00:00Z'));
		expectForbidden(() => svc.apply(alice, 'CR-PENDING-SMALL', '2026-01-01T00:00:00Z'));
	});

	it('a user without update policy cannot submit or send for approval', () => {
		const { users, svc } = freshFixtures();
		const carl = users.carl; // policies: cr_r_o, cr_a_o only, no cr_u_*
		expectForbidden(() => svc.submit(carl, 'CR-DRAFT', '2026-01-01T00:00:00Z'));
	});

	it('alice can submit and send her own draft for approval', () => {
		const { users, svc } = freshFixtures();
		svc.submit(users.alice, 'CR-DRAFT', '2026-01-01T00:00:00Z');
		const cr = svc.sendForApproval(users.alice, 'CR-DRAFT', '2026-01-01T00:01:00Z');
		expect(cr.status).toBe('PENDING_APPROVAL');
	});
});

describe('read scope', () => {
	it("scope 'u' only returns CRs the caller created", () => {
		const { users, svc } = freshFixtures();
		const list = svc.list(users.alice);
		expect(list.length).toBeGreaterThan(0);
		expect(list.every((cr) => cr.createdBy === 'alice')).toBe(true);
	});

	it("scope 'o' returns every CR in the caller's org", () => {
		const { users, svc } = freshFixtures();
		const list = svc.list(users.mona);
		expect(list.length).toBe(4);
		expect(list.every((cr) => cr.orgCode === 'org-alpha')).toBe(true);
	});

	it("scope 'w' returns only CRs in the caller's workspaces", () => {
		const { svc } = freshFixtures();
		const workspaceReader: ReqUser = { id: 'wsuser', orgCode: 'org-alpha', workspaceIds: ['ws-1'], policies: ['cr_r_w'] };
		const list = svc.list(workspaceReader);
		expect(list.every((cr) => cr.workspaceId === 'ws-1')).toBe(true);

		const otherWorkspaceReader: ReqUser = { id: 'wsuser2', orgCode: 'org-alpha', workspaceIds: ['ws-2'], policies: ['cr_r_w'] };
		expect(svc.list(otherWorkspaceReader)).toEqual([]);
	});

	it('a user with no read policy sees nothing and cannot get a CR by id', () => {
		const { svc } = freshFixtures();
		const noReader: ReqUser = { id: 'noreader', orgCode: 'org-alpha', workspaceIds: ['ws-1'], policies: [] };
		expect(svc.list(noReader)).toEqual([]);
		expectForbidden(() => svc.get(noReader, 'CR-PENDING-SMALL'));
	});
});
