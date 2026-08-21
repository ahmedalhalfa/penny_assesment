import { buildSeed } from '../src/seed';
import { CrRepo } from '../src/change-requests/cr-repo';
import { CrService } from '../src/change-requests/cr-service';
import { ChangeRequest, Budget, PurchaseAgreement } from '../src/change-requests/cr.types';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

// buildSeed() shares fixture objects across calls and apply() mutates budgets in place, so clone first.
export function freshFixtures() {
	const seed = buildSeed();

	const agreements = new Map<string, PurchaseAgreement>();
	for (const [id, agreement] of seed.agreements) agreements.set(id, clone(agreement));

	const budgets = new Map<string, Budget>();
	for (const [id, budget] of seed.budgets) budgets.set(id, clone(budget));

	const changeRequests: ChangeRequest[] = seed.changeRequests.map(clone);

	const repo = new CrRepo();
	repo.seed(changeRequests);
	const svc = new CrService(repo, agreements, budgets, seed.committeeConfig);

	return { users: seed.users, agreements, budgets, repo, svc };
}
