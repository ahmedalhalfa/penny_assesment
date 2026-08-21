import { ChangeRequest } from '../change-requests/cr.types';

/**
 * Policy-string RBAC + request-user model. Policies are `cr_{action}_{scope}` (see README).
 *
 * The request user carries the org code used for tenant scoping. Read scope (u/w/o) determines
 * which CRs the user may list/see; action policies gate create/update/approve/apply.
 */
export type ReadScope = 'u' | 'w' | 'o';

export interface ReqUser {
	id: string;
	orgCode: string;
	workspaceIds: string[];
	policies: string[]; // e.g. ['cr_c_u', 'cr_r_o', 'cr_a_o']
}

/** True if the user holds the exact policy string. */
export function hasPolicy(user: ReqUser, policy: string): boolean {
	return user.policies.includes(policy);
}

/** The user's highest read scope for CRs, or null if they cannot read CRs at all. */
export function crReadScope(user: ReqUser): ReadScope | null {
	if (hasPolicy(user, 'cr_r_o')) return 'o';
	if (hasPolicy(user, 'cr_r_w')) return 'w';
	if (hasPolicy(user, 'cr_r_u')) return 'u';
	return null;
}

/** Narrow an already org-scoped list of CRs down to what the user's read scope allows. */
export function narrowByReadScope(user: ReqUser, crs: ChangeRequest[]): ChangeRequest[] {
	const scope = crReadScope(user);
	if (!scope) return [];
	if (scope === 'o') return crs;
	if (scope === 'w') return crs.filter((cr) => user.workspaceIds.includes(cr.workspaceId));
	return crs.filter((cr) => cr.createdBy === user.id);
}
