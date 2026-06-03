---
name: core
description: >-
  Root routing index for framework-independent Redux and redux-saga guidance in
  ag-redux-toolkit. Use for canonical Redux state policy, action/reducer
  primitives, normalized state helpers, typed-redux-saga patterns, saga manager
  behavior, saga channel/effect helpers, serialization, testing, debugging, and
  verifier handoff. Use Svelte or Streaming skills for framework-specific Store
  selector/component behavior, choosing only one concrete Store family per app.
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
  - state serialization
  - redux testing
  - verifier
---
# Core Redux and saga routing

Use this skill for framework-independent Redux/redux-saga work in the
`ag-redux-toolkit` package. It routes to the core skills that are not owned
by the Svelte-specific or Streaming-specific taxonomy waves.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not use
> `createSlice`, `configureStore`, `createAsyncThunk`, or any RTK API.

## Preflight

- Read this skill plus every linked core leaf that applies to touched files.
- Cite the applicable skills and docs in implementation plans and handoffs.
- Include verifier-ready evidence: owner searches, focused tests, validation
  scripts, or `git diff --check` depending on the change.
- Stop and ask if a request crosses into Svelte-specific selector/component
  behavior or Streaming/Kefir-specific behavior.
- Pair core with at most one concrete Store family for a given app/code path;
  core is shared Redux/redux-saga guidance and is not permission to integrate
  both Svelte and Streaming Store patterns in one app.

## Core routing workflow

1. Start with `./core-policy/SKILL.md` for shared-state or architecture decisions.
2. Add `./state-integrity/SKILL.md` before adding/changing Redux state, actions,
   selectors, watchers, or saga registration.
3. Add domain leaves that match the behavior being changed.
4. Add `./testing/SKILL.md` for reducer, saga, or verification changes.
5. Add `./verifier/SKILL.md` before handoff for reliability-sensitive reviews.

## Core leaf routes

| Route | Use when |
| --- | --- |
| `./core-policy/SKILL.md` | Redux ownership, side-effect boundaries, serializability, and utility reuse rules. |
| `./state-integrity/SKILL.md` | Preventing derived/duplicated Redux state and duplicate action/selector/saga ownership. |
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
| `./collections/SKILL.md` | Normalized `Collection<T, K>` entity state. |
| `./domain-scoped-state/SKILL.md` | State keyed by workspace, project, tenant, or domain id. |
| `./boolean-preference/SKILL.md` | Boolean set/toggle preference helper registration. |
| `./testing/SKILL.md` | Reducer/saga testing, typed-redux-saga mocks, and reference equality assertions. |
| `./debugging/SKILL.md` | Runtime inspection and reducer reference-equality diagnostics. |
| `./verifier/SKILL.md` | Review quality gates for instruction drift, duplicate owners, and evidence. |
| `./redux-saga/SKILL.md` | Generic upstream redux-saga API reference. |

## Related non-core routes

- Svelte Store/component/selector lifecycle guidance lives under `../svelte/`.
- StreamingStore and Kefir/observable selector guidance lives under
  `../streaming/`.
- These concrete Store families are mutually exclusive per app. Mixed
  repositories may use different families in separate apps/packages/code paths,
  but one app must not combine both.
- Migration lifecycle skills remain under `../svelte/migration/`.
