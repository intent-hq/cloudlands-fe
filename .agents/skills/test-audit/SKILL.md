---
name: test-audit
description: >-
  Audit test value, review proposed test removals, or improve weak assertions.
  Use for test-quality reviews, test cleanup, and subsystem audit campaigns,
  including interpreting tools/test-quality results. Also use when asked to
  assess a proposed regression test's value or coverage overlap.
license: MIT
---

# Test audit

Improve confidence in the suite while reducing tests that provide no distinct
protection. Apply local `AGENTS.md` testing and verification
rules. The user’s existing authorization determines whether this is review-only
or includes edits; evidence review is not an extra approval gate.

For a requested subsystem-wide campaign, also read
[references/campaign.md](references/campaign.md). For a focused audit, use the
workflow below without expanding into a whole-suite cleanup.

## Establish the contract

For a candidate or proposed new test, identify:

1. The observable outcome and the code responsible for producing it.
2. A plausible defect that the assertion would detect, and a wrong outcome that
   could still pass. Do not claim a mutation was caught without running it.
3. Existing coverage of the same contract. Another layer can be useful when it
   checks a distinct transport, lifecycle, integration, or accessibility risk.
4. Any helper, mock, export, or injection point needed only by tests. Determine
   its actual consumers before proposing removal; testing infrastructure itself
   can be a legitimate subject.

Read the complete test, applicable setup/teardown, parameter rows, mocks and
helpers on the observed value path. Follow the production entry point, relevant
handlers/callees, and consumers. Inspect neighboring tests and runner/CI routing.
Use focused history and dependency source/types when they clarify the claimed
contract or why a suspicious test exists. Unknown context stays unknown.

For replacement regression tests, prefer evidence that the completed test fails
against the pre-fix implementation for the intended reason and passes with the
fix. Run such controls after authoring is complete, in isolation from concurrent
work. If no control was run, describe the regression claim as source-reviewed,
not experimentally demonstrated. Do not delete a retained failing test to make
the suite green; investigate the owning behavior and respect production scope.

## Investigate these patterns

- Assertions on local constants, self-comparisons, or expected values computed
  by the same implementation under test.
- Mocks/helpers that produce or repair the outcome being asserted, including
  invented callback order, acknowledgements, or writes to a different store.
- Negative cases that never reach the intended guard or reject for another
  reason. Establish the required preconditions and the specific rejection.
- Declared capabilities asserted without exercising their promised behavior.
- Names claiming status, ranking, grouping, counts, or transitions while the
  assertions only check a title, positive score, heading, or generic existence.
- Empty `every()`/`forEach()` checks, optional-chain comparisons, skipped paths,
  missing awaits, and negative assertions that pass because setup failed.
- Repeated contracts across layers, provider copies of shared-helper tests,
  source/class/copy checks, and test-only seams with no remaining purpose.

These patterns are discovery hints, not automatic deletion rules. Keep independent
protocol, persistence, security, migration, configuration, architecture and public
API contracts. Existing architecture guards may legitimately inspect source;
check their independent invariant rather than treating every static test as junk.
Follow repository rules against adding literal source/class/copy assertions.

Existence after a real interaction can be a sufficient oracle. Props and selector
fixtures are inputs; observing production behavior from them is not fixture-only.
A parser preserving supplied fields is real behavior. A harness self-test can
protect infrastructure without proving application behavior. Neither low impact,
slow execution, nor a low model score alone justifies deletion.

## Record a decision before editing

Use a workspace note and, when available, stable target/trace IDs from the audit.
For each candidate record:

- Test name/location, source revision or hash, and active/skipped/conditional status.
- Actual failure detected, assertion weakness, and source/helper evidence.
- Relevant caller, history and CI-routing findings; distinguish unavailable
  evidence from verified absence of a contract or consumer.
- Remaining coverage and its location, or evidence that no useful contract exists.
- Proposed support/production cleanup, scope, risk and focused validation.

Choose **keep**, **strengthen**, **consolidate**, **remove**,
**insufficient evidence**, or **retire skipped**. Consolidation names the test
that will retain the contract. A removal needs a demonstrated lack of useful
behavior or identified replacement coverage; a score is insufficient. A skipped
retirement saves declarations, not executed test time. Incomplete evidence can
support a targeted investigation without supporting deletion.

## Use the local evaluator

Run from the repository root. Read existing reports and exact saved requests
before paying to score the same evidence again:

```bash
node tools/test-quality/src/cli.ts report --db .test-quality/results.sqlite --run <run-id> --kind test --failing-only
node tools/test-quality/src/cli.ts trace --id <trace-id>
node tools/test-quality/src/cli.ts evaluation --id <evaluation-id>
node tools/test-quality/src/cli.ts audit <test-path> --config tools/test-quality/repository.config.json --db .test-quality/review.sqlite
```

Use the same `--db` on trace/evaluation retrieval when the run used a separate
database. The offline audit builds AST findings; it does not execute tests or
produce new model judgments. Preserve original reports and immutable run history.

Quality and criticality are separate. The actual request may contain less than
the saved trace. Check essential handler/helper omissions before accepting a
decision; missing optional neighbors prevents a redundancy claim, not necessarily
every other conclusion. Treat classified rationales as classifications, not
generated explanations or runtime evidence.

For evaluator changes, use the frozen calibration set before considering a broad
rerun:

```bash
node tools/test-quality/src/cli.ts calibrate --config tools/test-quality/repository.config.json --split development --calibration-mode dry-run
```

Preserve original source and keep related families together. Do not send review
labels, reasons or baseline scores to the judge. Report abstention/coverage
alongside agreement and incorrect removal recommendations. Partitioned reviewed
examples are not a blinded benchmark. Paid evaluation uses the user's authorized
scope, an explicit request cap, separate calibration storage and the applicable
pacing/error-stop settings; adopting this skill does not launch a paid run.

## Apply and validate

Edit one coherent set of contracts at a time. Move useful assertions into the
retained coverage before deleting duplicates. Remove obsolete script references
and test support within scope. Production code removal requires an authorized
production scope and consumer checks; never infer that scope from a low score.
Do not create new exports or wrappers solely to preserve a weak testing approach.

Finish edits before running checks. Avoid changing files read by an active test
run; parallel agents need separate file ownership and compatible verification.
Use `pnpm run verify:changed -- <changed-paths...>` and repository-required focused
checks. Use the integration configuration for integration contracts and browser
tests only where the browser owns the behavior. Do not expand lint baselines or
weaken invariants to accommodate cleanup. Report any justified verification-scope
exception and any interrupted run explicitly.

When removing a static check of a script or generated contract, exercise its real
execution/dry-run boundary where practical. For disputed retained coverage,
targeted mutations can test whether the intended defect is detected; use an
isolated copy and restore it exactly. This is a focused diagnostic, not a mandatory
whole-suite mutation campaign.

Hand off the decisions, preserved contracts, unresolved findings, actual commands
and results, and separate test/support/production diff counts. Do not infer runtime
savings from static counts. Follow workspace commit policy; PR creation and merging
require their existing authorization.
