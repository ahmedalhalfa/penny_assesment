import { assertTransition, canTransition, LEGAL_TRANSITIONS } from '../src/change-requests/cr-state-machine';
import { CrStatus } from '../src/change-requests/cr.enums';

describe('CR state machine transitions', () => {
	it('allows the declared legal transition DRAFT -> SUBMITTED', () => {
		expect(() => assertTransition(CrStatus.DRAFT, CrStatus.SUBMITTED)).not.toThrow();
		expect(canTransition(CrStatus.DRAFT, CrStatus.SUBMITTED)).toBe(true);
	});

	it('rejects an illegal transition DRAFT -> APPROVED (must go through approval)', () => {
		expect(() => assertTransition(CrStatus.DRAFT, CrStatus.APPROVED)).toThrow(/ILLEGAL_TRANSITION|illegal|not allowed/i);
	});

	it('rejects any transition out of a terminal state', () => {
		expect(() => assertTransition(CrStatus.APPLIED, CrStatus.APPROVED)).toThrow();
		expect(() => assertTransition(CrStatus.REJECTED, CrStatus.DRAFT)).toThrow();
	});

	it('allows every declared edge in LEGAL_TRANSITIONS', () => {
		for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
			for (const to of targets ?? []) {
				expect(canTransition(from as CrStatus, to)).toBe(true);
				expect(() => assertTransition(from as CrStatus, to)).not.toThrow();
			}
		}
	});

	it('rejects edges that skip a required step', () => {
		expect(() => assertTransition(CrStatus.PENDING_APPROVAL, CrStatus.APPLIED)).toThrow();
		expect(() => assertTransition(CrStatus.COMMITTEE_VOTING, CrStatus.APPROVED)).toThrow();
		expect(() => assertTransition(CrStatus.RETURNED, CrStatus.SUBMITTED)).toThrow();
		expect(() => assertTransition(CrStatus.COMMITTEE_DECISION, CrStatus.DRAFT)).toThrow();
		expect(() => assertTransition(CrStatus.SUBMITTED, CrStatus.APPROVED)).toThrow();
	});

	it('every terminal status rejects every outgoing transition', () => {
		for (const from of [CrStatus.APPLIED, CrStatus.REJECTED, CrStatus.CANCELLED]) {
			for (const to of Object.values(CrStatus)) {
				expect(() => assertTransition(from, to)).toThrow();
			}
		}
	});
});
