---
name: svelte
description: >-
  Svelte-readable routing index for frontend-facing ag-redux-toolkit work
  only when the touched code path has concrete Svelte/SvelteKit evidence. Use for
  Store component wiring, Svelte readable selector lifecycle, and
  migration touchpoints. Route Node/server/no-Svelte paths to ../streaming/SKILL.md
  by default and shared Redux/redux-saga concepts to ../core/SKILL.md. Never mix this
  concrete Svelte Store family with StreamingStore/Kefir patterns in one app.
triggers:
  - Svelte
  - SvelteKit
  - .svelte component
  - +layout.svelte
  - +page.svelte
  - svelte-store
  - Svelte readable
  - Svelte selector readable
  - Store component wiring
  - selector lifecycle
  - Svelte store migration
  - component integration
---

# Svelte-readable routing index

Use this skill only after the repository root router has classified the target
code path as frontend-facing with concrete Svelte or SvelteKit evidence. Use the
leaf skills below for implementation details; do not copy large API examples into
this Svelte index.

Core Redux and redux-saga guidance lives under `../core/`. Svelte-readable
Store selector/component guidance lives under `./`. StreamingStore
and Kefir/observable selector guidance lives under `../streaming/`.

## Exclusive Svelte Store family rule

- A frontend Svelte/SvelteKit app using this skill has chosen the concrete
  Svelte Store family: `Store`, Svelte readables, component-init
  selector calls, and Svelte lifecycle/setup patterns.
- Do **not** apply `StreamingStore`, Kefir/observable selector, streaming selector
  lifecycle, streaming setup, or streaming teardown patterns inside that same
  app/package/code path.
- In a mixed repository, a separate Node/server/CLI/worker/test-harness app may
  use `../streaming/`, but keep that choice isolated from this Svelte app.

Do not route generic web, Node, server, CLI, worker, test-harness, or no-Svelte
paths here merely because the repository contains a Svelte dependency. In mixed
repositories, route by the files and behavior being changed.

> This package uses a CUSTOM Redux setup — not Redux Toolkit (RTK). Do not use
> `createSlice`, `configureStore`, `createAsyncThunk`, or any RTK API.

## Docs vs skills ownership

- Treat `docs/` as the human-facing source of truth for concepts, API behavior,
  tradeoffs, and longer examples.
- Treat skill files as concise agent-facing execution guidance: routing,
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
- **MUST** record the Svelte/SvelteKit evidence that made this route applicable.
- **MUST** confirm the target app/package/code path is not also applying
  StreamingStore, Kefir/observable selector, streaming setup, or streaming
  lifecycle patterns.
- **MUST** cite the applicable skills and docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.
- **NEVER** use this Svelte route for no-Svelte Node/server code paths; use
  `../streaming/` by default instead.
- **NEVER** mix Svelte readable/component lifecycle patterns with StreamingStore
  or Kefir selector patterns in the same app.

## Always-on policy

- Redux owns shared/domain state; Svelte stores (`*.store.svelte.ts`) are deprecated.
- A Svelte app uses `Store` and Svelte-readable selectors only; it
  must not also use `StreamingStore` or streaming selector lifecycle/setup rules.
- Redux state is canonical only: no derived fields, duplicated entity copies,
  parallel arrays/maps for the same records, or reducer-maintained selector outputs.
- Components render and dispatch; reducers update state; sagas own side effects.
- State must stay serializable; normalized object collections use `Collection<T, K>`.
- Actions, selectors, and sagas each have one canonical owner/implementation; run
  the state/action/selector/saga preflight searches before adding another.
- Run architecture validation before handoff whenever Redux state, actions,
  selectors, sagas, or their governance docs change. Inside this repository use
  `npm run validate:architecture`; in a consuming app use
  `npx ag-redux-toolkit validate-architecture` or
  `npm exec ag-redux-toolkit -- validate-architecture`. Include the exit
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
- For final review of recurring failures, route to `../core/verifier/SKILL.md`.

## Routing workflow

1. Start with `../core/core-policy/SKILL.md` for any shared-state task.
2. Add `../core/state-integrity/SKILL.md` before adding or changing Redux
   state, actions, selectors, or sagas.
3. Add the domain leaf or leaves that match the files and behavior being changed.
4. Add `../core/testing/SKILL.md` for tests or saga/reducer verification.
5. Add `../core/debugging/SKILL.md` for runtime inspection or reducer reference-equality issues.
6. Use `../core/verifier/SKILL.md` before handoff when reviewing reliability risks.

## Examples

### Route shared state changes to policy plus primitives

```ts
const sharedStateRouting = {
  request: "Add editable todos shared across routes",
  requiredSkills: [
    "../core/core-policy/SKILL.md",
    "../core/state-integrity/SKILL.md",
    "../core/actions/SKILL.md",
    "../core/reducers/SKILL.md",
    "./selectors/SKILL.md",
  ],
  evidence: ["canonical owner search", "reducer no-op tests", "selector .select tests"],
};
```

### Route side effects to sagas or persistence leaves

```ts
const sideEffectRouting = {
  request: "Persist user preferences and reload them on startup",
  requiredSkills: [
    "../core/core-policy/SKILL.md",
    "../core/sagas/SKILL.md",
    "../core/local-storage/SKILL.md",
    "../core/testing/SKILL.md",
  ],
  reducerRule: "Reducers receive serializable facts only; sagas perform storage I/O.",
};
```

### Route component wiring to lifecycle-aware skills

```ts
const componentRouting = {
  request: "Render selected todo and dispatch rename from a Svelte component",
  requiredSkills: [
    "./component-integration/SKILL.md",
    "./selector-lifecycle/SKILL.md",
    "../core/import-boundaries/SKILL.md",
  ],
  componentRule: "Create selector readables during component initialization; dispatch through the configured Store.",
};
```

### Store-first dispatch and state reads

```ts
import { Store } from "ag-redux-toolkit/svelte-store";
import { renameTodo } from "./slices/todos/todos-actions";
import { todosReducer } from "./slices/todos/todos-slice";
import { selectTodo } from "./slices/todos/todos-selectors";
import { todosSaga } from "./slices/todos/sagas/todos-saga";

const store = new Store({ todos: todosReducer });
const dispose = store.init();
const cancelTodosSaga = store.runSaga(todosSaga);

store.dispatch(renameTodo("todo-1", "Ship docs"));
const selectedTodo = selectTodo.select(store.state, "todo-1");

cancelTodosSaga();
dispose();
selectedTodo?.id satisfies string | undefined;
```

`Store` is the canonical Svelte-readable class from `ag-redux-toolkit/svelte-store`. Use `StreamingStore` from `ag-redux-toolkit/streaming-store` when selector calls should return Kefir streams.

### Verification handoff evidence payload

```ts
const handoffEvidence = {
  skillsRead: ["./SKILL.md", "../core/actions/SKILL.md", "../core/reducers/SKILL.md"],
  ownerSearches: ['rg "todos/rename" src skills docs', 'rg "selectTodo" src skills docs'],
  checks: ["npm run validate:architecture", "git diff --check"],
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
  requiredSkills: ["./component-integration/SKILL.md"],
};
```

## Core leaf routes

Paths and names intentionally mirror `../_artifacts/skill_tree.yaml`.

### State foundations

| Route | Use when | Path |
| --- | --- | --- |
| `../core/core-policy/SKILL.md` | Applying ownership, serializability, saga-only side effects, Svelte-store deprecation, or utility reuse rules. | `../core/core-policy/SKILL.md` |
| `../core/state-integrity/SKILL.md` | Preventing derived/duplicated Redux state and duplicate action/selector/saga ownership. | `../core/state-integrity/SKILL.md` |
| `../core/import-boundaries/SKILL.md` | Choosing imports for components, sagas, package entry points, and Store-first public subpackages. | `../core/import-boundaries/SKILL.md` |
| `../core/file-structure/SKILL.md` | Creating or moving slice files, type modules, selectors, sagas, or Store registration. | `../core/file-structure/SKILL.md` |
| `../core/state-serialization/SKILL.md` | Modeling serializable, structured-clone-safe state values. | `../core/state-serialization/SKILL.md` |

### API primitives

| Route | Use when | Path |
| --- | --- | --- |
| `../core/actions/SKILL.md` | Creating custom `createAction` or `createAsyncAction` actions. | `../core/actions/SKILL.md` |
| `../core/reducers/SKILL.md` | Building immutable chained reducers and no-op reference equality behavior. | `../core/reducers/SKILL.md` |
| `./selectors/SKILL.md` | Creating Store-bound selectors, collection utility reads, `.select`, or `.effect` usage. | `./selectors/SKILL.md` |
| `../streaming/selectors/SKILL.md` | Creating StreamingStore selectors whose direct calls return Kefir observables. | `../streaming/selectors/SKILL.md` |

### Selector system

| Route | Use when | Path |
| --- | --- | --- |
| `./selector-lifecycle/SKILL.md` | Choosing component-init, handler, or saga selector call modes; using Store-first dispatch. | `./selector-lifecycle/SKILL.md` |
| `../streaming/selector-lifecycle/SKILL.md` | Choosing StreamingStore selector invocation/observation timing and non-readable call modes. | `../streaming/selector-lifecycle/SKILL.md` |
| `../core/selector-channels/SKILL.md` | Reacting to selector value changes from sagas or creating selector-backed channels. | `../core/selector-channels/SKILL.md` |
| `./selector-scheduling/SKILL.md` | Recognizing selector emission scheduling as an internal detail; do not import removed throttled-readable helpers. | `./selector-scheduling/SKILL.md` |
| `../core/wait-for/SKILL.md` | Suspending sagas until selector predicates pass or time out. | `../core/wait-for/SKILL.md` |

### Sagas and side effects

| Route | Use when | Path |
| --- | --- | --- |
| `../core/sagas/SKILL.md` | Writing typed-redux-saga flows, watchers, batching, debounce, retry/timeout, async-generator streams, or side-effect orchestration. | `../core/sagas/SKILL.md` |
| `../core/saga-manager/SKILL.md` | Explaining package-owned saga crash tracking, cleanup, serialized crash storage, Store `runSaga` start/stop/restart behavior, and backoff mechanics. | `../core/saga-manager/SKILL.md` |
| `../core/local-storage/SKILL.md` | Reading, writing, removing, listing by prefix, initializing, or persisting localStorage from sagas. | `../core/local-storage/SKILL.md` |
| `../core/channel-effects/SKILL.md` | Consuming generic EventChannels such as IPC, websocket, or DOM event channels. | `../core/channel-effects/SKILL.md` |

### Data modeling

| Route | Use when | Path |
| --- | --- | --- |
| `../core/collections/SKILL.md` | Modeling normalized entity state with `Collection<T, K>` utilities. | `../core/collections/SKILL.md` |
| `../core/domain-scoped-state/SKILL.md` | Keying state by workspace, project, tenant, or another domain id. | `../core/domain-scoped-state/SKILL.md` |
| `../core/boolean-preference/SKILL.md` | Creating set/toggle preference helpers and registering them with reducers. | `../core/boolean-preference/SKILL.md` |

### Component integration

| Route | Use when | Path |
| --- | --- | --- |
| `./component-integration/SKILL.md` | Wiring Store initialization, component reads, Store dispatch, and template reactivity. | `./component-integration/SKILL.md` |
| `../streaming/store/SKILL.md` | Importing, initializing, and disposing the Kefir/observable StreamingStore variant. | `../streaming/store/SKILL.md` |

### Testing, debugging, and verification

| Route | Use when | Path |
| --- | --- | --- |
| `../core/testing/SKILL.md` | Testing reducers, selectors, sagas, typed-redux-saga mocks, or reference equality. | `../core/testing/SKILL.md` |
| `../core/debugging/SKILL.md` | Inspecting `window.svelteRedux` or diagnosing reducer reference-equality issues. | `../core/debugging/SKILL.md` |
| `../core/verifier/SKILL.md` | Review-only quality gate for instruction drift, pass-through wrappers, duplicated utilities, state integrity, canonical owners, architecture evidence, automated gates, and semantic checks. | `../core/verifier/SKILL.md` |

## Related lifecycle routes

- First-time app setup: `./setup/SKILL.md`.
- Migration playbook: `./migration/SKILL.md`.
- Install/uninstall side effects and maintainer validation: `docs/INSTALLATION.md`.
- Generic plain redux-saga API reference, outside this package's typed-redux-saga conventions: `../core/redux-saga/SKILL.md`.
