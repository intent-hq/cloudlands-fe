---
name: core/core-policy
description: >-
  Top-level architectural rules for themis. Redux owns all shared
  state and stores canonical facts only; components render and dispatch; side
  effects live in sagas; state must be structured-cloneable; arrays hold
  primitives only (use Collection<T,K> for entities); legacy family-local shared
  stores are deprecated — migrate to Redux on contact; slice types go in
  {slice-name}-types.ts so cross-process imports do not pull in reducers or saga
  code.
type: sub-skill
requires:
  - core
  - core/state-integrity
triggers:
  - redux policy
  - shared state rule
  - legacy store deprecated
  - core rules
---
# Core Policy

## Agent Preflight Compliance Contract

Before editing code or docs under this skill:

- **MUST** read this skill plus every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

> These rules are the load-bearing contract for every slice, saga, and component in the package. Quoted verbatim from `../SKILL.md` §1 and `@augmentcode/themis/docs/ARCHITECTURE.md` → Core Principles.

## Setup — core rules

1. **Redux for ALL shared/domain state.** Legacy family-local shared stores are **DEPRECATED** — never create new ones.
2. **Components render; Redux owns state.** Components read via selectors, dispatch actions. Business logic goes in reducers + sagas.
3. **Side effects in sagas, not components.** API calls, localStorage, timers, event listeners, subscriptions, IPC/websocket, async workflows → sagas. Do NOT create component lifecycle hooks or effects that carry business logic or side effects. Use component lifecycle/effect APIs only for DOM-local work (focus, scroll, measurements, third-party widget lifecycle that cannot live elsewhere).
4. **State must be serializable.** No `Date`, `Map`, `Set`, `RegExp`, `Promise`, `Function`, class instances, `Symbol`. Use plain objects, arrays, strings, numbers, booleans, `null`, `undefined`. See `core/state-serialization/SKILL.md`.
5. **State is canonical only.** Never store derived fields, duplicated entity copies, parallel arrays/maps for the same records, or values a selector can compute. See `core/state-integrity/SKILL.md`.
6. **Arrays hold primitives only.** For entity/object storage, always use `Collection<T, K>`. Never store `Item[]` in state — use Collections for O(1) lookups and normalized data. See `core/collections/SKILL.md`.
7. **Actions/selectors/sagas have one owner.** Before adding any action, selector, watcher, or saga registration, search for an existing owner and import/compose/extend it instead of duplicating it. See `core/state-integrity/SKILL.md`.
8. **Legacy shared-store migration on contact.** If you encounter family-local shared store files, do not expand them — migrate shared/domain state to Redux. Use the selected Store family skill only for framework lifecycle details.
9. **Refactor cleanup is mandatory.** After moving, renaming, or splitting modules, inspect every old path and remove thin pass-through wrappers. Keep one only as a documented compatibility shim with a reason and sunset/removal condition.
10. **Types in separate modules.** Define all slice types/interfaces in `{slice-name}-types.ts`, not in `-slice.ts`. Enables safe cross-process imports.
11. **Utility reuse discovery before helpers.** Before adding a helper, search existing utilities and document why the final choice is reuse, extension, or new code.

> This package uses a CUSTOM Redux setup — NOT Redux Toolkit (RTK). Do not use createSlice, configureStore, createAsyncThunk, or any RTK APIs. Use only the custom utilities documented in the leaves.

## Core Principles (from `@augmentcode/themis/docs/ARCHITECTURE.md`)

- **Single source of truth** — All shared application state lives in a single Redux store.
- **State is read-only** — State is never mutated directly; changes happen only through dispatching actions.
- **Reducers are pure functions** — Given the same state and action, a reducer always produces the same result. No side effects, no async.
- **Side effects live in sagas** — API calls, persistence, timers, event listeners, and async workflows are handled by redux-saga generators.
- **Selectors derive data** — Components read state through selectors, which provide automatic memoization via proxy-based tracking.
- **Canonical state only** — Redux stores facts, ids, and relationships; selectors derive counts, filters, sorted lists, joins, and display values.

## Core Patterns

### Utility reuse discovery protocol

Before adding any helper, wrapper, or shared utility:

1. Search `src/utils/`, `src/slices/**`, relevant `docs/`, `skills/`, and app-local utility folders for existing behavior. Search by name and by behavior (`collection`, `selector`, `channel`, `waitFor`, `localStorage`, `debounce`, action type, etc.).
2. Prefer reuse of a documented package utility. Extend an existing helper only if the extension preserves its current contract and tests.
3. Add a new helper only when no existing utility covers the behavior; keep it domain-local unless multiple domains already need it.
4. Document the decision in the change summary: reused utility, extended utility, or new helper, including the searched paths/terms and why reuse was not sufficient.

### State integrity preflight protocol

Before adding Redux state, actions, selectors, or sagas, load `core/state-integrity` and search for existing canonical owners. The handoff must list the searched paths/terms and say whether the change reused, extended, or created the canonical owner.

### When to use Redux vs component-local state (monolith §8)

**Use Redux when:**

- State is shared by multiple components
- State is needed by services or non-component code
- State is persisted, synced over IPC/network, or survives navigation
- State drives business logic, workflows, or cross-feature coordination
- State is derived in multiple places

**Keep in component when:**

- Purely visual and instance-local (hover, focus, open/closed toggles)
- Only matters while this one component is mounted
- Not shared, persisted, or part of business logic

**Use component lifecycle/effect APIs only when:**

- Effect is directly tied to this component's rendered DOM
- Focus/scroll/measurement work
- Third-party widget lifecycle that can't live elsewhere

**When in doubt → use Redux.**

### Types live in `{slice-name}-types.ts`

```typescript
// my-slice-types.ts — safe to import from any process
import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

export type Item = {
  id: string;
  name: string;
  isActive: boolean;
};

export type MyState = {
  items: Collection<Item, "id">;
  isLoading: boolean;
  error: string | null;
};
```

```typescript
// my-slice.ts
import type { MyState } from "./my-slice-types";
// reducer + action creators here
```

## Common Mistakes

### ❌ Storing derived or duplicated Redux state

Reducers become responsible for keeping copies in sync, which eventually creates stale UI and race-prone updates. Store canonical records and ids; derive views in selectors.

```typescript
// WRONG — duplicated records plus selector outputs in state
type TodosState = { items: Todo[]; itemsById: Record<string, Todo>; activeCount: number };
```

```typescript
// CORRECT — canonical collection; selector derives the count
import { store } from "$lib/store/store";

type TodosState = { items: Collection<Todo, 'id'> };
export const selectActiveCount = store.createSelector((state) =>
  getItems(state.todos.items).filter((todo) => todo.active).length,
);
```

Source: `core/state-integrity/SKILL.md` · **Priority: CRITICAL**

### ❌ Putting shared state in a family-local store

State becomes invisible to Redux state inspection and unreachable from sagas or non-component code.

```typescript
// feature-local-store.ts — new family-local shared store file (WRONG)
let items = $state<Item[]>([]);
export const itemsStore = {
  get items() { return items; },
  add(i) { items = [...items, i]; }
};
```

```typescript
// feature-slice.ts (CORRECT)
export const addItem = createAction<[Item]>('feature/addItem');
export const featureReducer = createReducer<FeatureState>(initialState)
  .with(addItem, (state, { payload: [item] }) => ({
    ...state, items: collectionAddItem(state.items, item)
  }));
```

Source: `../SKILL.md` §1, `@augmentcode/themis/README.md` · **Priority: CRITICAL**

### ❌ Using `$effect` for cross-component side effects

`$effect` runs only while the component is mounted; business logic dies with the component and cannot be inspected or tested like a saga.

```typescript
// WRONG — effect dies on unmount, invisible to devtools/tests
$effect(() => {
  fetch(`/api/items/${$id$}`).then(r => r.json()).then(setItems);
});
```

```typescript
// CORRECT — saga survives component lifetime and is observable
yield* takeLatest(selectItemId, function* ({ payload }) {
  const res = yield* call(fetch, `/api/items/${payload}`);
  yield* put(itemsLoaded(yield* call([res, 'json'])));
});
```

Source: `../SKILL.md` §1, §8 · **Priority: HIGH**

### ❌ Defining slice types inline in `-slice.ts`

Cross-process imports (e.g. Electron preload) pull in the reducer and action-creator factories just to get types; breaks bundling boundaries.

```typescript
// feature-slice.ts (WRONG)
export type FeatureState = { items: Collection<Item, 'id'> };
export const featureReducer = createReducer<FeatureState>(...);
```

```typescript
// feature-types.ts (CORRECT — safe to import from any process)
export type FeatureState = { items: Collection<Item, 'id'> };

// feature-slice.ts
import type { FeatureState } from './feature-types';
```

Source: `../SKILL.md` §1, §9 · **Priority: MEDIUM**

### ❌ Leaving a pass-through wrapper after a refactor

Old modules that only re-export, proxy, or delegate to the new location hide dead paths and make future agents edit the wrong file. Remove the old module and update imports, or document it as a temporary compatibility shim.

```typescript
// old-feature.ts (WRONG unless documented as a compatibility shim)
export { featureReducer, loadFeature } from './features/feature-slice';
```

If a shim is required for external compatibility, add an adjacent comment that names the consumer or compatibility window and the planned removal condition. Verifiers must inspect old paths in the diff and report either “no pass-through wrappers” or the justified shim list.

Source: `@augmentcode/themis/docs/ARCHITECTURE.md` → Refactor Cleanup Guard · **Priority: HIGH**

## See also

- `core/import-boundaries/SKILL.md` — structural enforcement of the policy
- `core/state-integrity/SKILL.md` — canonical state and owner deduplication rules
- `core/file-structure/SKILL.md` — where each file lives
- `core/state-serialization/SKILL.md` — allowed/forbidden state types
- Selected Store family skill — lifecycle details for migration after shared state moves to Redux