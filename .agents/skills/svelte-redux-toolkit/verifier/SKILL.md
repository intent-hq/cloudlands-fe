---
name: svelte-redux-toolkit/verifier
description: >-
  Verifier quality gate for svelte-redux-toolkit diffs. Hard-fails recurring
  review failures: instruction drift from required skills/docs, unjustified
  pass-through wrappers after refactors, duplicated utilities created without
  reuse discovery, non-canonical Redux state, and duplicate action/selector/saga
  owners. Use when reviewing or verifying changes to skills, docs, reducers,
  utilities, refactors, or shared-state implementation.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/core-policy
  - svelte-redux-toolkit/state-integrity
  - svelte-redux-toolkit/reducers
  - svelte-redux-toolkit/testing
triggers:
  - verifier quality gate
  - verify redux change
  - review redux diff
  - recurring failure gate
---
# Verifier Quality Gate

## Agent Preflight Compliance Contract

Before verifying implementation or documentation diffs under this skill:

- **MUST** read this skill plus every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the verification report or completion handoff, including the rules checked.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** approve or claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

> This is a review-only skill. Do not change runtime behavior from here; use it to decide whether a diff is safe to accept.

Source rules:

- `svelte-redux-toolkit/core-policy/SKILL.md` — agent preflight compliance, refactor cleanup, and utility reuse rules.
- `docs/ARCHITECTURE.md` — Utility Reuse Discovery Protocol and Refactor Cleanup Guard.
- `svelte-redux-toolkit/state-integrity/SKILL.md` — canonical state, duplicate-owner rejection, preflight searches, and handoff evidence.
- `svelte-redux-toolkit/reducers/SKILL.md` — canonical reducer state and reducer/helper reuse before extracting new helpers.
- `svelte-redux-toolkit/testing/SKILL.md` — verifier evidence requirements for refactor cleanup.

## Required gate sequence

Run these gates on every implementation or documentation diff before acceptance.
Automated gates are blocking when they are required for the diff scope. If
implementor evidence for a required safe gate is missing, stale, incomplete, or
contradicts the current diff, the verifier must run that gate directly when the
workspace can run it safely, then report the command, exit code, and key output.
Do not accept failed gates or “not applicable” claims without a documented,
scope-specific reason.

1. **Instruction compliance gate** — verify the implementor followed the applicable task instructions, skills, and docs, and reported evidence.
2. **Refactor cleanup gate** — verify moved, renamed, or split modules did not leave unjustified pass-through wrappers.
3. **Utility reuse gate** — verify new helpers/utilities were preceded by reuse discovery and are not duplicates.
4. **State integrity gate** — verify Redux state is canonical only and selectors derive computed values.
5. **Canonical owner gate** — verify actions, selectors, and sagas have one owner/implementation.
6. **Automated gate selection** — require and, when evidence is missing or stale,
   run the safe automated gates that match the diff scope.
7. **Verifier-guided semantic gate** — keep noisy migration completeness,
   semantic test adequacy, and lifecycle intent judgments in reviewer evidence
   instead of treating them as brittle CI-only checks.

If any gate fails, request changes. Do not accept “looks good” without evidence for all gates.

## Examples

### 1. Verifier handoff evidence object

```ts
type GateResult = { command: string; exitCode: number; keyOutput: string };
type VerifierEvidence = {
  instructionsRead: string[];
  scopeFiles: string[];
  gateResults: GateResult[];
  blockers: string[];
};

export const evidence: VerifierEvidence = {
  instructionsRead: ["task note", "skills/svelte-redux-toolkit/verifier/SKILL.md", "docs/ARCHITECTURE.md"],
  scopeFiles: ["skills/svelte-redux-toolkit/selectors/SKILL.md"],
  gateResults: [{ command: "npm run validate:skill-examples", exitCode: 0, keyOutput: "no violations found" }],
  blockers: [],
};
```

### 2. Instruction citation checklist

```ts
type Citation = { source: string; rule: string; evidence: string };

export const instructionCitations: Citation[] = [
  { source: "task note", rule: "scope limited to three SKILL.md files", evidence: "git diff --name-only" },
  { source: "docs/ARCHITECTURE.md", rule: "utility reuse discovery", evidence: "rg search terms listed" },
  { source: "state-integrity/SKILL.md", rule: "canonical owners", evidence: "action/selector/saga owner search" },
];

export const instructionCompliancePresent = instructionCitations.every((citation) => citation.evidence.length > 0);
```

### 3. Utility reuse discovery evidence before approving a helper

```ts
type ReuseDiscovery = {
  searched: string[];
  terms: string[];
  existingUtility: string | null;
  decision: "reuse" | "extend" | "new";
};

export const reuseDiscovery: ReuseDiscovery = {
  searched: ["src/utils", "src/slices", "docs", "skills"],
  terms: ["debounce", "selector channel", "waitFor", "safe storage helper"],
  existingUtility: "src/utils/sagas/debounce-saga.ts",
  decision: "reuse",
};
```

### 4. ❌ Bad: shallow approval without runnable evidence

```ts
// BAD: approval is not traceable to instructions, commands, searches, or files.
export const shallowApproval = {
  verdict: "approved",
  checked: ["looks fine"],
  commands: [],
  blockers: [],
};
```

### 5. ❌ Bad: approving derived Redux state as if tests alone were enough

```ts
// BAD: derived fields can pass unit tests while still violating state ownership.
type Todo = { id: string; completed: boolean };
type TodosState = {
  itemsById: Record<string, Todo>;
  completedTodos: Todo[];
  completedCount: number;
};

export const acceptedStateShape = { reason: "tests pass", stateFields: ["completedTodos", "completedCount"] };
```

### 6. Corrected state-integrity evidence pairs canonical state with selectors

```ts
import { getItems, type Collection } from "svelte-redux-toolkit/utils/collections/collection-utils";
import { store } from "$lib/store";

type Todo = { id: string; completed: boolean };
type TodosState = { items: Collection<Todo, "id"> };

export const selectCompletedTodos = store.createSelector((state) => {
  return getItems((state.todos as TodosState).items).filter((todo) => todo.completed);
});
export const selectCompletedCount = store.createSelector((state) => selectCompletedTodos.select(state).length);
```

### 7. Canonical owner search result object

```ts
type OwnerSearch = { terms: string[]; paths: string[]; duplicateHits: string[]; canonicalOwner: string };

export const ownerSearch: OwnerSearch = {
  terms: ["todos/load", "loadTodos", "watchLoadTodos", "selectCompletedTodos"],
  paths: ["src", "docs", "skills"],
  duplicateHits: [],
  canonicalOwner: "src/slices/todos/todos-slice.ts",
};
```

### 8. Final verifier report payload template

```ts
type VerifierReport = {
  verdict: "approved" | "changes-requested";
  confidence: "low" | "medium" | "high";
  evidence: VerifierEvidence;
  semanticChecks: string[];
};

type GateResult = { command: string; exitCode: number; keyOutput: string };
type VerifierEvidence = { instructionsRead: string[]; scopeFiles: string[]; gateResults: GateResult[]; blockers: string[] };
declare const evidence: VerifierEvidence;

export const report: VerifierReport = {
  verdict: evidence.blockers.length === 0 ? "approved" : "changes-requested",
  confidence: "high",
  evidence,
  semanticChecks: ["reviewed selector lifecycle intent", "confirmed tests cover no-op reducer references"],
};
```

### Automated gate selection rules

Use this repository's maintainer `npm run ...` scripts when reviewing package
repo diffs. When verifying a consuming app that has installed the package, use
the package CLI equivalents such as `npx svelte-redux-toolkit validate-architecture`
or `npm exec svelte-redux-toolkit -- validate-architecture`.

- **Always require `git status --short`** before the final decision to identify
  modified, staged, deleted, and untracked files that affect review scope.
- **Always require `git diff --check`** for any local diff before acceptance;
  whitespace errors block acceptance until fixed or explicitly scoped out by the
  user.
- **Require `npm run validate:skill-examples`** for changes under `skills/`,
  skill artifacts, Markdown guidance, fenced examples, or docs that route agents
  through skill examples.
- **Require `npm run validate:architecture`** for Redux state, actions,
  selectors, sagas, reducer/slice behavior, component/store import boundaries,
  localStorage access, collection state, pass-through wrappers, package test
  patterns, or skills/docs that govern those areas.
- **Require `npm test`** for runtime source changes, test changes, behavioral
  fixes, refactors, or anything whose acceptance depends on executable behavior.
  Use focused tests when they cover the change; require the broader test suite
  for final package behavior review when dependencies are available.
- **Require `npm run build`** for public exports, package entrypoints,
  TypeScript/Svelte source, build configuration, or docs claiming build/release
  readiness.
- **Require `npm run validate:release`** for release/package validation,
  package manifests, export surface changes, build-script changes, final release
  smoke checks, or when the task asks for release readiness. Treat it as a
  blocking aggregate gate and still report any nested gate diagnostics.

Missing or stale evidence rules:

- Evidence is stale when the command predates relevant file changes, was run on a
  different diff, omits required output/exit code, or excludes files that the
  task requires reviewing.
- Safe automated gates above should be run by the verifier directly when stale
  or missing, unless dependencies are unavailable or the command would exceed
  the approved task scope. Document that blocker with exact diagnostics.
- Verifier-guided semantic checks are not replacement evidence for required
  automated gates; they supplement them.
- Do not request or invent new CI gates for broad semantic adequacy unless the
  user explicitly approves that scope expansion.

## Gate 1 — instruction compliance

Pass only when the completion report or task note names the instructions that governed the work and provides evidence that they were followed.

Pass/fail checks:

- **PASS** — lists the applicable task requirements, skills, or docs used for the touched files.
- **PASS** — includes concrete evidence: searches run, validation commands, diff checks, or file-specific rationale.
- **FAIL** — implementation contradicts a MUST/NEVER rule from the task, spec, skill, or referenced docs.
- **FAIL** — completion claims success without saying which instructions were checked.
- **FAIL** — verifier cannot trace a changed file back to the relevant guidance.

Verifier output must cite the checked instructions and either say “instruction compliance evidence present” or list the missing/contradicted items.

## Gate 2 — refactor cleanup

Hard-fail a moved, renamed, or split module when the old path remains only as a thin pass-through wrapper.

```typescript
// WRONG unless explicitly documented as a compatibility shim
export { featureReducer, loadFeature } from './features/feature-slice';
```

Pass/fail checks:

- **PASS** — old modules were removed and imports updated to the new path.
- **PASS** — old behavior was intentionally inlined where the old path still owns real logic.
- **PASS** — a remaining compatibility shim has an adjacent comment naming the compatibility reason and sunset/removal condition.
- **FAIL** — old file only `export { ... } from "new/path"` or `export * from "new/path"`.
- **FAIL** — old file imports from the new module and re-exports the same symbols.
- **FAIL** — old functions/classes only delegate to the new implementation.

Verifier output must say either “no pass-through wrappers” or list the justified shims with their removal conditions.

## Gate 3 — utility reuse

Hard-fail a new helper, wrapper, or shared utility when the diff lacks reuse discovery or duplicates an existing utility.

Pass/fail checks:

- **PASS** — report lists searched paths/terms, including relevant `src/utils/`, `src/slices/**`, `docs/`, `skills/`, and app-local utility folders.
- **PASS** — report states one outcome: reused existing utility, extended existing utility, or justified new utility.
- **PASS** — any extension preserves the existing helper contract and has appropriate validation.
- **FAIL** — new helper duplicates behavior already available in package/application utilities.
- **FAIL** — new helper is added without documenting why reuse or extension was insufficient.
- **FAIL** — broad shared utility is created when the behavior is only domain-local.

Verifier output must compare new helpers against existing utility modules and either say “no duplicated utilities” or identify the duplicate/reuse path.

## Gate 4 — state integrity

Hard-fail Redux state that stores derived values or duplicated entity data.

Pass/fail checks:

- **PASS** — entity records have one canonical owner, usually a `Collection<T, K>` for id-keyed records.
- **PASS** — state stores ids/relationships, request status, errors, and other source facts only.
- **PASS** — counts, filtered/sorted lists, joins, `has*` booleans, selected entity objects, and display values are implemented as selectors.
- **FAIL** — state contains both `Item[]` and `itemsById`/`Collection` for the same records.
- **FAIL** — state contains `filtered*`, `visible*`, `sorted*`, `*Count`, `has*`, `selectedItem`, or other selector-derivable fields.
- **FAIL** — one slice copies entity objects owned by another slice instead of storing ids/references.

Verifier output must say either “canonical Redux state only” or list every derived/duplicated field and the selector/canonical owner it should use.

## Gate 5 — canonical action/selector/saga owners

Hard-fail duplicate action type strings, copied selector implementations, parallel saga watchers, or duplicate saga registration names unless the handoff documents an intentional fan-out owner.

Pass/fail checks:

- **PASS** — implementor reported search terms/paths for state, actions, selectors, and sagas before adding new owners.
- **PASS** — new action creators live in one owning slice and other files import them.
- **PASS** — selectors are imported/composed instead of copied.
- **PASS** — each trigger action has one watcher owner, and each Store constructor saga-map name is unique.
- **FAIL** — the same `createAction`/`createAsyncAction` type string appears in multiple owner modules.
- **FAIL** — two selectors expose the same name/body without a documented canonical owner.
- **FAIL** — two saga watchers own the same trigger action or registration name without a documented fan-out reason.

Verifier output must say either “canonical action/selector/saga owners verified” or list each duplicate owner and the canonical file to keep.

## Gate 6 — automated architecture validation

For changes touching Redux state, `createAction`/`createAsyncAction`, selectors,
saga watchers/registrations, component/store imports, localStorage access,
reducers/slices, collection state, RTK/custom API boundaries, pass-through
wrappers, test files that exercise selectors or typed-redux-saga mocks, or the
skills/docs governing those areas, hard-fail the review unless current evidence
shows `npm run validate:architecture` passed or the verifier ran it directly and
reported the result. If the command cannot run or fails for unrelated existing
files, preserve the exact diagnostics and classify whether they are in-scope;
do not claim success.

Wave 3 coverage summary:

- G9 selector call modes: direct selector invocation in unsafe contexts and
  inline `waitFor((state) => ...)` selectors.
- G10 typed-redux-saga effect style: bare `yield` for typed saga effects where
  `yield*` is required.
- G11 channel lifecycle: auto-forking helper misuse and raw channels without
  detectable cleanup.
- G14 file structure/naming: low-noise state type, selector export/file, and
  action type shape rules.
- G15 high-signal test patterns: selector tests using `.select(state)` and typed
  saga `call` mocks preserving the `Array.isArray` tuple guard.

Noisy semantic questions, such as whether a migration is complete or whether a
test suite is behaviorally sufficient, remain verifier-led. Review diffs,
searches, and task context rather than requesting new blocking CI rules unless
the user approved them.

Pass/fail checks:

- **PASS** — command evidence shows exit code 0 and
  `[architecture-validation] no architecture gate violations found`.
- **PASS** — `npm run validate:release` evidence is present when release/package
  validation is part of the task; it runs the architecture gate first.
- **PASS** — any `architecture-gate-ignore-next-line` or
  `architecture-gate-ignore-file` comment names the relevant rule when possible
  and includes a concrete migration, compatibility, or external-data reason.
- **PASS** — known diagnostics are classified by command exit code, for example
  existing `vite-plugin-dts` messages remain non-blocking only when build and
  release validation exit 0.
- **PASS** — unrelated tracked or untracked status is reported separately and not
  staged unless that cleanup or package-manager work was explicitly approved.
- **FAIL** — required architecture evidence is missing or stale and the verifier
  did not run the safe gate or document why it could not run.
- **FAIL** — violations are omitted from the handoff or described only as “looks
  okay” without command output.
- **FAIL** — an ignore comment masks derived/duplicated Redux state or duplicate
  actions/selectors/sagas without a reviewed reason and owner plan.
- **FAIL** — new action types are unnamespaced, Redux state uses non-serializable
  types, components import saga/reducer internals, sagas use
  `takeEvery(action.type, ...)`, sagas read inline selectors, or direct
  `window.localStorage` usage appears outside the safe helper layer without a
  reviewed exception.
- **FAIL** — RTK helpers, shared `*.store.svelte.ts` stores, object arrays in
  collection state, collection-internal mutations, initialState runtime objects,
  reducer side effects/nondeterminism, lifecycle Redux store access, or thin
  pass-through wrappers appear without a reviewed rule-specific exception and a
  migration/compatibility/sunset reason.
- **FAIL** — direct selector call-mode misuse, inline `waitFor` selectors, bare
  typed saga `yield`, channel lifecycle leaks, low-noise file-structure naming
  violations, or high-signal test-pattern violations appear without passing gate
  evidence or a reviewed rule-specific exception.
- **FAIL** — a verifier asks CI to enforce broad semantic adequacy or migration
  completeness without explicit approval for a new gate.

Verifier output must cite the architecture gate result, inspect any ignore
comments, and either say “architecture gate passed with no violations” or list
the violations/exceptions that block approval, including exact diagnostics for
unrelated existing or untracked files.

## Gate 7 — verifier-guided semantic checks

Some rules are intentionally manual because they need task context or behavioral
judgment. Do not fail a diff only because CI lacks a broad semantic rule;
instead record the searches, diff review, and reasoning that prove the outcome
is safe.

Pass/fail checks:

- **PASS** — verifier reviewed migration completeness, lifecycle intent, or test
  adequacy with concrete evidence when those risks apply.
- **PASS** — manual findings are classified as accepted, follow-up, or blocker
  with a reason tied to task scope.
- **PASS** — manual checks supplement, but do not replace, required automated
  gate evidence.
- **FAIL** — verifier approves noisy semantic work based only on the architecture
  command without reviewing the relevant behavior or tests.
- **FAIL** — verifier treats a manual judgment as a reason to skip a required
  safe automated gate without documenting why the gate is out of scope or
  unavailable.
- **FAIL** — verifier requests a new CI gate for a semantic/noisy preference when
  the task only approved verifier-guided review.

Verifier output must state whether any semantic checks were required and, if so,
summarize the evidence or follow-up.

## Completion report requirement

Every verifier completion report must include:

1. Instruction compliance result and evidence.
2. Refactor cleanup result and evidence.
3. Utility reuse result and evidence.
4. State integrity result and evidence.
5. Canonical action/selector/saga owner result and evidence.
6. Automated gate results required by the diff scope, including `git status
   --short`, `git diff --check`, `npm run validate:skill-examples`, `npm run
   validate:architecture`, `npm test`, `npm run build`, and `npm run
   validate:release` when applicable. Include command, exit code, and key output
   for each gate run by the verifier or inspected from implementor evidence.
7. Architecture gate result and any reviewed ignore-comment exceptions.
8. Semantic/verifier-guided checks reviewed, including any intentionally manual
   findings and why they should not become blocking CI for this task.

Acceptance is blocked if any result is missing, failed, or lacks evidence, unless the user explicitly approves the exception.

## Examples retained/added

| # | Example | Kind |
| ---: | --- | --- |
| 1 | Verifier handoff evidence object | Evidence |
| 2 | Instruction citation checklist | Evidence |
| 3 | Utility reuse discovery evidence | Evidence |
| 4 | Shallow approval without runnable evidence | Bad |
| 5 | Approving derived Redux state because tests pass | Bad |
| 6 | Corrected canonical state and selector evidence | Good |
| 7 | Canonical owner search result object | Evidence |
| 8 | Final verifier report payload template | Evidence |
| 9 | Pass-through wrapper after refactor | Bad retained |

## Cases covered

| Case | Examples |
| --- | --- |
| Instruction compliance and citation evidence | 1, 2, 4 |
| Required automated gate reporting | 1, 8 |
| Utility reuse discovery | 3 |
| State integrity and selector-owned derived values | 5, 6 |
| Canonical action/selector/saga owners | 7 |
| Refactor cleanup / pass-through wrappers | 9 |
| Verifier-guided semantic evidence beyond syntax/type checks | 4, 5, 8 |
