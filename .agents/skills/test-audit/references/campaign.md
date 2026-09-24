# Subsystem audit campaigns

Use this only for a requested broad subsystem review or cleanup. Account for
contracts across test files and layers explicitly.

## Define the surface

Pin the starting revision. Inventory the subsystem's test files, shared tests,
fixtures, support modules and CI routes. Separate static declarations from expanded
parameter cases and active tests from skipped cases. Record existing failure and
runtime evidence when available; missing execution history is not a clean baseline.
Do not launch a full suite solely to establish campaign statistics.

Divide work by the code responsible for each behavior. Assign each file or shared
helper one editing owner. Read-only review can overlap, but shared edits must be
coordinated. If parallel delegation is authorized, use existing task-note IDs and
keep assignments visible in the spec; otherwise follow the same boundaries locally.

## Inventory every decision

Give every in-scope test declaration a decision and evidence line using the parent
skill. Parameter rows may share a decision only when they protect the same kind of
contract; name rows needing different treatment. Include useful tests as well as
suspect ones. Unresolved evidence remains a visible item instead of being counted
as completed cleanup.

Then review overlap across the inventory. Name the retained test for each useful
contract, any distinct risks at other layers, and assertions that must move before
another file can be removed. Do not mechanically treat individual low scores as
an edit list. A thin mocked unit suite may duplicate a stronger integration test,
but that integration test may miss a specific error or cancellation boundary.

## Implement and preserve

Apply the plan in coherent batches. Preserve the original source/labels used for
calibration before editing. Update runner lists, scripts and generated-test routing
for moved/deleted tests. Production simplifications need their own authorized scope;
record opportunities outside scope without turning the campaign into a refactor.

Once edits are complete, run focused retained tests and required repository checks.
Review removed coverage against the retained tests, preferably with a separate
reviewer when authorized. For a restored or disputed contract, a small controlled
mutation can establish whether the retained test detects the relevant defect.
Distinguish source inspection from executed mutation evidence in the report.

If a retained test fails, determine whether setup, the proposed assertion, or the
actual implementation is wrong. Do not rewrite the expected value merely to pass.
Keep unrelated defects as explicit follow-ups; fix production behavior only within
the user's scope and prove the repair with an appropriate control when feasible.

## Reconcile and report

Before concluding a long campaign, compare against any changes to the base branch.
For a test deleted locally but changed upstream, inspect the new contract and
preserve its proof before resolving the conflict. Do not automatically choose the
deletion or mandate a merge/rebase strategy. Follow the user's Git workflow.

Report inventory coverage, decision counts, retained contracts, outstanding evidence
gaps, production versus test/support changes, checks actually run, and any mutation
or runtime measurements. Include omitted runner scopes and failed/interrupted checks.
An inventory can be complete while implementation or validation still has open work;
state those separately. Continue into another subsystem only within authorized scope.
