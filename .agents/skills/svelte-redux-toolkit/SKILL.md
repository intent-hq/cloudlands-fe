---
name: svelte-redux-toolkit
description: >-
  Root routing index for the svelte-redux-toolkit custom Redux package. Use
  for shared/domain state, state integrity, custom actions/reducers/selectors,
  sagas, saga-manager crash/restart behavior, selector lifecycle, Collections, Svelte component wiring, migration touchpoints,
  testing, debugging, and verifier review. This package is not Redux Toolkit.
triggers:
  - svelte-redux-toolkit
  - Redux
  - shared state
  - canonical state
  - derived state
  - duplicate actions
  - duplicate selectors
  - duplicate sagas
  - createAction
  - createReducer
  - createSelector
  - saga
  - saga manager
  - saga crash
  - typed-redux-saga
  - retryWithTimeout
  - addCrash
  - clearCrashes
  - localStorage keys
  - selector lifecycle
  - Store dispatch
  - Collection
  - Svelte store migration
  - waitFor
  - verifier
---

# svelte-redux-toolkit — root routing index

This is the concise router for the custom `svelte-redux-toolkit` package. Use
the leaf skills below for implementation details; do not copy large API examples
into this root index.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not use
> `createSlice`, `configureStore`, `createAsyncThunk`, or any RTK API.

## Docs vs skills ownership

- Treat `docs/` as the human-facing source of truth for concepts, API behavior,
  tradeoffs, and longer examples.
- Treat `skills/` as concise agent-facing execution guidance: routing,
  must-follow rules, pitfalls, verification cues, and citations to docs/source.
- Do not duplicate long explanatory doc sections in skills. Link to the relevant
  doc/source, then state only the operational rule an agent must follow.
- If docs and skills conflict, stop and report instruction drift instead of
  choosing silently.

Detailed docs to consult when a task needs conceptual background:
`docs/ARCHITECTURE.md`, `docs/SELECTORS.md`, `docs/SAGAS.md`,
`docs/WAITFOR.md`, `docs/REDUCERS.md`, `docs/COLLECTIONS.md`,
`docs/TESTING.md`, and `docs/INSTALLATION.md`.

## Agent Preflight Compliance Contract

Before editing code or docs under this skill:

- **MUST** read this skill plus every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

## Always-on policy

- Redux owns shared/domain state; Svelte stores (`*.store.svelte.ts`) are deprecated.
- Redux state is canonical only: no derived fields, duplicated entity copies,
  parallel arrays/maps for the same records, or reducer-maintained selector outputs.
- Components render and dispatch; reducers update state; sagas own side effects.
- State must stay serializable; normalized object collections use `Collection<T, K>`.
- Actions, selectors, and sagas each have one canonical owner/implementation; run
  the state/action/selector/saga preflight searches before adding another.
- Run architecture validation before handoff whenever Redux state, actions,
  selectors, sagas, or their governance docs change. Inside this repository use
  `npm run validate:architecture`; in a consuming app use
  `npx svelte-redux-toolkit validate-architecture` or
  `npm exec svelte-redux-toolkit -- validate-architecture`. Include the exit
  code/output and canonical-owner evidence in the handoff.
- The architecture gate also checks RTK/shared Svelte-store boundaries,
  collection state shape/internal mutations, runtime state serialization,
  reducer purity, conservative component lifecycle/store access, and
  pass-through wrapper cleanup; Wave 3 adds selector call modes, typed saga
  `yield*` style, channel lifecycle cleanup, file-structure naming, and
  high-signal test-pattern hygiene. Report any rule-specific ignore reasons.
- Keep semantic or noisy adequacy questions verifier-guided; do not add or claim
  new CI gates beyond the documented modular gate set without explicit approval.
- Types belong in dedicated `{slice-name}-types.ts` modules.
- Before adding helpers or wrappers, search existing utilities and document reuse.
- For final review of recurring failures, route to `svelte-redux-toolkit/verifier`.

## Routing workflow

1. Start with `svelte-redux-toolkit/core-policy` for any shared-state task.
2. Add `svelte-redux-toolkit/state-integrity` before adding or changing Redux
   state, actions, selectors, or sagas.
3. Add the domain leaf or leaves that match the files and behavior being changed.
4. Add `svelte-redux-toolkit/testing` for tests or saga/reducer verification.
5. Add `svelte-redux-toolkit/debugging` for runtime inspection or reducer reference-equality issues.
6. Use `svelte-redux-toolkit/verifier` before handoff when reviewing reliability risks.

## Examples

### Route shared state changes to policy plus primitives

```ts
const sharedStateRouting = {
  request: "Add editable todos shared across routes",
  requiredSkills: [
    "svelte-redux-toolkit/core-policy",
    "svelte-redux-toolkit/state-integrity",
    "svelte-redux-toolkit/actions",
    "svelte-redux-toolkit/reducers",
    "svelte-redux-toolkit/selectors",
  ],
  evidence: ["canonical owner search", "reducer no-op tests", "selector .select tests"],
};
```

### Route side effects to sagas or persistence leaves

```ts
const sideEffectRouting = {
  request: "Persist user preferences and reload them on startup",
  requiredSkills: [
    "svelte-redux-toolkit/core-policy",
    "svelte-redux-toolkit/sagas",
    "svelte-redux-toolkit/local-storage",
    "svelte-redux-toolkit/testing",
  ],
  reducerRule: "Reducers receive serializable facts only; sagas perform storage I/O.",
};
```

### Route component wiring to lifecycle-aware skills

```ts
const componentRouting = {
  request: "Render selected todo and dispatch rename from a Svelte component",
  requiredSkills: [
    "svelte-redux-toolkit/component-integration",
    "svelte-redux-toolkit/selector-lifecycle",
    "svelte-redux-toolkit/import-boundaries",
  ],
  componentRule: "Create selector readables during component initialization; dispatch through the configured Store.",
};
```

### Store-first dispatch and state reads

```ts
import { Store } from "svelte-redux-toolkit/store";
import { renameTodo } from "./slices/todos/todos-actions";
import { todosReducer } from "./slices/todos/todos-slice";
import { selectTodo } from "./slices/todos/todos-selectors";
import { todosSaga } from "./slices/todos/sagas/todos-saga";

const store = new Store({ todos: todosReducer }, { todosSaga });
const dispose = store.init();

store.dispatch(renameTodo("todo-1", "Ship docs"));
const selectedTodo = selectTodo.select(store.state, "todo-1");

dispose();
selectedTodo?.id satisfies string | undefined;
```

### Verification handoff evidence payload

```ts
const handoffEvidence = {
  skillsRead: ["svelte-redux-toolkit", "svelte-redux-toolkit/actions", "svelte-redux-toolkit/reducers"],
  ownerSearches: ['rg "todos/rename" src skills docs', 'rg "selectTodo" src skills docs'],
  checks: ["npm run validate:architecture", "npm run validate:skill-examples", "git diff --check"],
  canonicalOwners: { action: "src/slices/todos/todos-actions.ts", reducer: "src/slices/todos/todos-slice.ts" },
};
```

### ❌ Bad: root request bypasses shared-state routing

```ts
import { writable } from "svelte/store";

// BAD: shared route data is hidden in a Svelte store and skips ownership, reducer, selector, and saga review.
export const todos = writable([{ id: "todo-1", title: "Ship docs" }]);

const incompleteRouting = {
  request: "Share todos across routes",
  requiredSkills: ["svelte-redux-toolkit/component-integration"],
};
```

## Core leaf routes

Paths and names intentionally mirror `skills/_artifacts/skill_tree.yaml`.

### State foundations

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/core-policy` | Applying ownership, serializability, saga-only side effects, Svelte-store deprecation, or utility reuse rules. | `skills/svelte-redux-toolkit/core-policy/SKILL.md` |
| `svelte-redux-toolkit/state-integrity` | Preventing derived/duplicated Redux state and duplicate action/selector/saga ownership. | `skills/svelte-redux-toolkit/state-integrity/SKILL.md` |
| `svelte-redux-toolkit/import-boundaries` | Choosing imports for components, sagas, package entry points, and Store-first public subpackages. | `skills/svelte-redux-toolkit/import-boundaries/SKILL.md` |
| `svelte-redux-toolkit/file-structure` | Creating or moving slice files, type modules, selectors, sagas, or Store registration. | `skills/svelte-redux-toolkit/file-structure/SKILL.md` |
| `svelte-redux-toolkit/state-serialization` | Modeling serializable, structured-clone-safe state values. | `skills/svelte-redux-toolkit/state-serialization/SKILL.md` |

### API primitives

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/actions` | Creating custom `createAction` or `createAsyncAction` actions. | `skills/svelte-redux-toolkit/actions/SKILL.md` |
| `svelte-redux-toolkit/reducers` | Building immutable chained reducers and no-op reference equality behavior. | `skills/svelte-redux-toolkit/reducers/SKILL.md` |
| `svelte-redux-toolkit/selectors` | Creating Store-bound selectors, collection utility reads, `.select`, or `.effect` usage. | `skills/svelte-redux-toolkit/selectors/SKILL.md` |

### Selector system

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/selector-lifecycle` | Choosing component-init, handler, or saga selector call modes; using Store-first dispatch. | `skills/svelte-redux-toolkit/selector-lifecycle/SKILL.md` |
| `svelte-redux-toolkit/selector-channels` | Reacting to selector value changes from sagas or creating selector-backed channels. | `skills/svelte-redux-toolkit/selector-channels/SKILL.md` |
| `svelte-redux-toolkit/throttled-readable` | Recognizing selector emission scheduling as an internal detail; do not import removed throttled-readable helpers. | `skills/svelte-redux-toolkit/throttled-readable/SKILL.md` |
| `svelte-redux-toolkit/waitFor` | Suspending sagas until selector predicates pass or time out. | `skills/svelte-redux-toolkit/waitFor/SKILL.md` |

### Sagas and side effects

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/sagas` | Writing typed-redux-saga flows, watchers, batching, debounce, retry/timeout, async-generator streams, or side-effect orchestration. | `skills/svelte-redux-toolkit/sagas/SKILL.md` |
| `svelte-redux-toolkit/saga-manager` | Explaining package-owned saga crash tracking, cleanup, serialized crash storage, Store `runSaga` start/stop/restart behavior, and backoff mechanics. | `skills/svelte-redux-toolkit/saga-manager/SKILL.md` |
| `svelte-redux-toolkit/local-storage` | Reading, writing, removing, listing by prefix, initializing, or persisting localStorage from sagas. | `skills/svelte-redux-toolkit/local-storage/SKILL.md` |
| `svelte-redux-toolkit/channel-effects` | Consuming generic EventChannels such as IPC, websocket, or DOM event channels. | `skills/svelte-redux-toolkit/channel-effects/SKILL.md` |

### Data modeling

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/collections` | Modeling normalized entity state with `Collection<T, K>` utilities. | `skills/svelte-redux-toolkit/collections/SKILL.md` |
| `svelte-redux-toolkit/domain-scoped-state` | Keying state by workspace, project, tenant, or another domain id. | `skills/svelte-redux-toolkit/domain-scoped-state/SKILL.md` |
| `svelte-redux-toolkit/boolean-preference` | Creating set/toggle preference helpers and registering them with reducers. | `skills/svelte-redux-toolkit/boolean-preference/SKILL.md` |

### Component integration

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/component-integration` | Wiring Store initialization, component reads, Store dispatch, and template reactivity. | `skills/svelte-redux-toolkit/component-integration/SKILL.md` |

### Testing, debugging, and verification

| Route | Use when | Path |
| --- | --- | --- |
| `svelte-redux-toolkit/testing` | Testing reducers, selectors, sagas, typed-redux-saga mocks, or reference equality. | `skills/svelte-redux-toolkit/testing/SKILL.md` |
| `svelte-redux-toolkit/debugging` | Inspecting `window.svelteRedux` or diagnosing reducer reference-equality issues. | `skills/svelte-redux-toolkit/debugging/SKILL.md` |
| `svelte-redux-toolkit/verifier` | Review-only quality gate for instruction drift, pass-through wrappers, duplicated utilities, state integrity, canonical owners, architecture/skill-example evidence, automated gates, and semantic checks. | `skills/svelte-redux-toolkit/verifier/SKILL.md` |

## Related lifecycle routes

- First-time app setup: `skills/init-svelte-redux-toolkit/SKILL.md`.
- Migration playbook: `skills/migrate-to-svelte-redux-toolkit/SKILL.md`.
- Install/uninstall side effects and maintainer validation: `docs/INSTALLATION.md`.
- Generic plain redux-saga API reference, outside this package's typed-redux-saga conventions: `skills/redux-saga/SKILL.md`.
