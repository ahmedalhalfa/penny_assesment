# Implementation Notes

## 1. What I changed

- **Task 1 — seeded bugs.** `round2` in `money.util.ts` used `Math.trunc`, which truncates toward
  zero instead of rounding to the nearest cent; switched to `Math.round` (with an epsilon nudge
  for float error). `assertTransition` in `cr-state-machine.ts` only checked that `from` was
  non-terminal and never consulted `canTransition`, so any non-terminal `from` accepted any `to`;
  added the missing check.
- **Task 2 — approval flow.** Filled in the rest of `LEGAL_TRANSITIONS` (only `DRAFT` and
  `SUBMITTED` were declared) and implemented `sendForApproval`, `approve`, `returnToDraft`,
  `reject`, and `apply` in `cr-service.ts`. Also fixed `CrRepo.findOne`, which ignored the caller's
  org entirely and let any user fetch any CR by id — a real cross-tenant read.
- **Task 3 — committee routing.** Implemented `castVote` and a private `resolveCommitteeIfDecided`
  that applies the majority-plus-head rule and resolves through `COMMITTEE_DECISION`.
- **Task 4 — permissions.** Added `narrowByReadScope` to `policy.ts` and wired it into `get`/`list`;
  added policy checks to every remaining action method.
- **Task 5 — tests.** Added `cr-service.spec.ts`, `cr-committee.spec.ts`, `cr-permissions.spec.ts`,
  `cr-repo.spec.ts`, and extended `cr-transitions.spec.ts`; added a small `test-helpers.ts` (see
  §4).

## 2. Domain model

An **Org** has **Users**, each carrying a list of `cr_{action}_{scope}` policy strings. Orgs buy
from vendors under **Purchase Agreements**, each funded by a **Budget**. A **Change Request**
proposes a change (line items and/or end date) to one Agreement and carries computed
`baselineTotal` / `newTotal` / `delta`. It moves through a guarded state machine —
`DRAFT → SUBMITTED → PENDING_APPROVAL`, then either a single approver or, past a configured delta
threshold, `COMMITTEE_VOTING → COMMITTEE_DECISION` — to `APPROVED → APPLIED`, with `RETURNED` and
`REJECTED`/`CANCELLED` off-ramps. Every transition is guarded by `LEGAL_TRANSITIONS` and appends an
immutable `AuditEntry`; terminal states (`APPLIED`, `REJECTED`, `CANCELLED`) accept no further
action.

## 3. Invariants I enforce (and how)

| Invariant | How it's enforced | Where |
|---|---|---|
| Only declared transitions occur | `assertTransition` checks `canTransition` against `LEGAL_TRANSITIONS` before any status write | `cr-state-machine.ts` |
| Terminal states are immutable | `assertTransition` throws `TERMINAL_STATE` before consulting the table at all | `cr-state-machine.ts` |
| Money is rounded consistently to 2dp | `round2` used by every money helper; `sendForApproval`/`apply` recompute via `computeTotals` rather than trusting stale totals | `money.util.ts`, `cr-totals.ts` |
| A CR never overspends its budget | `apply` throws `INSUFFICIENT_BUDGET` when `balance < delta` before mutating anything | `cr-service.ts#apply` |
| Committee resolves only on majority + head confirmation | `resolveCommitteeIfDecided` requires `approveCount >= majorityNeeded` **and** the head's own vote to be `APPROVE`; a head `REJECT` vetoes immediately | `cr-service.ts#resolveCommitteeIfDecided` |
| A user only sees/affects CRs in their org | `CrRepo.scoped()` filters every read; `findOne` now routes through it (previously didn't) | `cr-repo.ts` |
| A user only sees CRs within their read scope (u/w/o) | `narrowByReadScope` filters by `createdBy`/`workspaceId` on top of org scoping | `policy.ts`, `cr-service.ts#get/list` |
| Every action requires the matching policy | Each action method checks `hasPolicy` before touching state | `cr-service.ts` |
| Every state change is audited | `transition()` appends an `AuditEntry` on every status write; `castVote` appends one directly since voting isn't itself a status change | `cr-service.ts` |

## 4. Testing strategy

I tested each action's happy path plus its immediate failure modes (wrong status, wrong policy,
wrong org), the committee resolution algorithm across all its branches (partial vote, both
approve, member reject, head veto), and the full transition table (every declared edge legal,
representative undeclared edges illegal, terminal states reject everything). I deliberately did
**not** test optimistic-concurrency/versioning (see §5) or HTTP/serialization concerns, since
there's no HTTP layer in this exercise.

One gotcha worth calling out: `buildSeed()` returns `Map`s that point at the *same* fixture
objects on every call, and `apply()` mutates budgets in place. A naive "fresh `buildSeed()` per
test" isn't actually isolated for budget mutations. `test/test-helpers.ts` adds a `freshFixtures()`
helper that deep-clones the agreements/budgets/CRs before each test so budget changes in one test
can't leak into another.

## 5. Assumptions

- **`REJECTED` reachability.** Only from `PENDING_APPROVAL` (single-approver) and
  `COMMITTEE_DECISION` (resolved committee outcome) — not directly from `COMMITTEE_VOTING` — so a
  rejection always has a resolved record behind it.
- **`CANCELLED` reachability.** From every state where the CR's *owner* could still withdraw it
  (`DRAFT`/`SUBMITTED`/`PENDING_APPROVAL`/`COMMITTEE_VOTING`/`APPROVED`), not from
  `COMMITTEE_DECISION` or `RETURNED`. This keeps owner withdrawal (CANCELLED) distinct from an
  approver/committee verdict (REJECTED).
- **Committee majority-plus-head.** Read "majority approves and the head confirms" as: the head's
  vote counts toward the majority tally like any member's, but must *additionally* individually be
  `APPROVE`. A head `REJECT` is an immediate veto. Resolution happens as soon as it's mathematically
  settled (not waiting for every member to vote), generalized to N members via
  `floor(members.length / 2) + 1`.
- **`sendForApproval` routing.** Large-delta CRs pass through `PENDING_APPROVAL` momentarily before
  `COMMITTEE_VOTING` (two audit entries) rather than a direct edge, so the transition table doesn't
  need a special-case bypass of the `PENDING_APPROVAL` funnel node.
- **`returnToDraft` reset scope.** "Reset approval progress" clears `cr.approvals`. It doesn't touch
  `cr.committee`, since by the transition table `RETURNED` is only reachable from
  `PENDING_APPROVAL`, before any committee routing occurs.
- **`apply` recomputes totals.** Rather than trusting the totals stored when the CR was approved,
  `apply` recomputes them from the agreement, trading a little extra work for protection against
  staleness between approval and apply.
- **`get`'s out-of-scope response.** An out-of-scope CR (wrong org or outside read scope) returns
  `NOT_FOUND`, not `FORBIDDEN`, so its existence isn't confirmed to a caller who shouldn't see it.
- **`cr.version` / `CONFLICT` left unimplemented.** Nothing in the required tasks calls for
  optimistic concurrency, and there's no concurrent-caller surface in this in-memory exercise. If
  this became a real HTTP service, the extension point is straightforward: increment `version` in
  `transition()`, accept an expected version per action, throw `Errors.conflict()` on mismatch.

## 6. Where I used AI

Used an AI assistant (Claude Code) to read through the scaffold, cross-check my understanding of
the existing files against their exact contents, and think through edge cases in the committee
resolution algorithm and the transition table's ambiguous edges (REJECTED/CANCELLED reachability).
I verified every change by running the actual test suite plus small throwaway smoke scripts against
the seed fixtures (checked budget math, audit ordering, and committee outcomes by hand against the
printed results) before committing, and wrote the final test suite myself against those verified
behaviors.

## 7. What I'd improve with more time

The riskiest part is the committee resolution algorithm — it's only exercised against the seeded
2-member committee; a 3+ member committee where the head isn't required to break every tie would
be worth a dedicated test. I'd also add optimistic-concurrency version checks (§5) before this ever
sat behind concurrent HTTP callers, and consider whether `sendForApproval`'s two-hop transition
through `PENDING_APPROVAL` before `COMMITTEE_VOTING` is worth collapsing into a single audited step
if the extra entry turns out to be noisy in practice.
