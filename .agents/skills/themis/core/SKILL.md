---
name: core
description: >-
  Root routing index for framework-independent Redux and redux-saga guidance in
  themis. Use for canonical Redux state policy, action/reducer
  primitives, normalized state helpers, typed-redux-saga patterns, saga manager
  behavior, saga channel/effect helpers, Redux action logging, explicit store
  pruning, serialization, testing, debugging, and verifier handoff. Use the selected Store family skill
  for framework-specific Store selector/component behavior, choosing only one
  concrete Store family per app.
type: core
triggers:
  - redux core
  - core redux
  - shared state
  - canonical state
  - createAction
  - createReducer
  - typed-redux-saga
  - saga manager
  - saga channels
  - store pruning
  - redux action logging
  - logReduxActions
  - state serialization
  - redux testing
  - verifier
---
# Core Redux and saga routing

Use this skill for framework-independent Redux/redux-saga work in the
`themis` package. It routes to the core skills that are not owned
by Store-family-specific taxonomy waves.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not use
> `createSlice`, `configureStore`, `createAsyncThunk`, or any RTK API.

## Preflight

- Read this skill plus every linked core leaf that applies to touched files.
- Cite the applicable skills and docs in implementation plans and handoffs.
- Include verifier-ready evidence: owner searches, focused tests, validation
  scripts, or `git diff --check` depending on the change.
- Stop and ask if a request crosses into Store-family-specific selector,
  component, lifecycle, or observable behavior.
- Pair core with at most one concrete Store family for a given app/code path;
  core is shared Redux/redux-saga guidance and is not permission to integrate
  multiple concrete Store family patterns in one app.

## Core routing workflow

1. Start with `./core-policy/SKILL.md` for shared-state or architecture decisions.
2. Add `./state-integrity/SKILL.md` before adding/changing Redux state, actions,
   selectors, watchers, or saga registration.
3. If and only if the user explicitly asks to prune unused Redux store surface
   area, add `./store-pruning/SKILL.md` before deleting selectors, actions,
   reducers, sagas, exports, tests, or orphaned helpers.
4. Add domain leaves that match the behavior being changed.
5. Add `./testing/SKILL.md` for reducer, saga, or verification changes.
6. Add `./verifier/SKILL.md` before handoff for reliability-sensitive reviews.

## Core leaf routes

| Route | Use when |
| --- | --- |
| `./core-policy/SKILL.md` | Redux ownership, side-effect boundaries, serializability, and utility reuse rules. |
| `./state-integrity/SKILL.md` | Preventing derived/duplicated Redux state and duplicate action/selector/saga ownership. |
| `./store-pruning/SKILL.md` | Explicit-only pruning of unused Redux selectors, actions, handlers, sagas, and orphaned store logic when the user asks for pruning. |
| `./import-boundaries/SKILL.md` | Public package imports, saga import boundaries, and Store-first public subpackages. |
| `./file-structure/SKILL.md` | Slice file layout, type modules, sagas, and Store registration patterns. |
| `./state-serialization/SKILL.md` | Structured-clone-safe Redux state values. |
| `./actions/SKILL.md` | `createAction` and `createAsyncAction` action creators. |
| `./reducers/SKILL.md` | Immutable chained reducers and no-op reference equality behavior. |
| `./sagas/SKILL.md` | typed-redux-saga flows, watchers, debounce, retry/timeout, and side-effect orchestration. |
| `./saga-manager/SKILL.md` | Package-owned saga crash tracking, lifecycle, restart, and backoff mechanics. |
| `./channel-effects/SKILL.md` | Generic EventChannel consumers for IPC, websocket, or DOM channels. |
| `./selector-channels/SKILL.md` | Saga reactions to selector value changes. |
| `./wait-for/SKILL.md` | One-shot saga waits for selector predicates. |
| `./local-storage/SKILL.md` | Safe app-local localStorage persistence from sagas. |
| `./redux-action-logging/SKILL.md` | Construction-time `logReduxActions` diagnostics and grouped action/state diffs across Store families. |
| `./collections/SKILL.md` | Normalized `Collection<T, K>` entity state. |
| `./domain-scoped-state/SKILL.md` | State keyed by workspace, project, tenant, or domain id. |
| `./boolean-preference/SKILL.md` | Boolean set/toggle preference helper registration. |
| `./testing/SKILL.md` | Reducer/saga testing, typed-redux-saga mocks, and reference equality assertions. |
| `./debugging/SKILL.md` | Runtime inspection and reducer reference-equality diagnostics. |
| `./verifier/SKILL.md` | Review quality gates for instruction drift, duplicate owners, and evidence. |
| `./redux-saga/SKILL.md` | Generic upstream redux-saga API reference. |

## Related non-core routes

- Store family selector, component, lifecycle, migration, and observable-output
  guidance is selected by the root router outside core.
- Concrete Store families are mutually exclusive per app. Mixed repositories may
  use different families in separate apps/packages/code paths, but one app must
  not combine multiple Store family patterns.
