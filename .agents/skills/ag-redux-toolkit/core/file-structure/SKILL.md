---
name: core/file-structure
description: >-
  Per-slice directory layout ({name}-types.ts, {name}-slice.ts,
  {name}-selectors.ts, sagas/{name}-saga.ts plus tests). Saga-only slices skip
  reducer registration. Register reducers in the Store constructor map; store.init()
  wires the Redux store and package saga manager but does NOT auto-start
  app sagas — start each one explicitly via store.runSaga(sagaFn).
  Do not manually register package @internal_ sagas.
  Naming: {Feature}State, {feature}Reducer, verb-phrase actions, select*
  prefix, "sliceName/actionName" action types.
type: sub-skill
requires:
  - core
triggers:
  - slice layout
  - slice directory
  - saga-only slice
  - scaffold slice
---
# File Structure & Registration

> Source: `docs/ARCHITECTURE.md` → Slice File Structure + Store Initialization; `../SKILL.md` §9.

## Setup — slice directory layout

```
src/slices/{slice-name}/
  {slice-name}-types.ts          # Types, interfaces, enums (safe to import from any process)
  {slice-name}-slice.ts          # Actions + reducer (imports types from -types.ts)
  {slice-name}-selectors.ts      # Selectors
  {slice-name}-slice.test.ts     # Reducer tests
  sagas/
    {slice-name}-saga.ts         # Saga logic
    {slice-name}-saga.test.ts    # Saga tests
```

The top-level store lives at `src/store.ts` (or wherever you export your `Store` instance) and registers all slices. `docs/ARCHITECTURE.md` shows the short form: `src/slices/<domain>/` with the same filenames.

## Core Patterns

### Register a normal slice

```typescript
// src/store.ts
import { Store } from 'ag-redux-toolkit/svelte-store';
import type { StoreState } from 'ag-redux-toolkit/types';
import { mySliceReducer } from './slices/my-slice/my-slice-slice';
import { mySliceSaga } from './slices/my-slice/sagas/my-slice-saga';

export const store = new Store({ mySlice: mySliceReducer });
export type AppState = StoreState<typeof store>;
```

Use `StoreState<typeof store>` for app state typing after constructing the store with app reducer maps. Constructor reducer maps preserve reducer-state inference without an explicit `: Store` annotation. Register only app-owned reducers. `Store` manages package-owned internals automatically under reserved `@internal_` names: internal reducers such as `@internal_storeUtility` are always package-managed, and the internal saga manager starts during `Store` initialization. Do not add app reducers/sagas with that prefix or couple selectors/tests to the internal state shape.

Then in the root layout — initialize the store, and start each app saga explicitly by function:

```svelte
<script>
  import { onDestroy, onMount } from 'svelte';
  import { store } from '$lib/store/store';
  import { mySliceSaga } from '$lib/store/slices/my-slice/sagas/my-slice-saga';
  const dispose = store.init();
  onDestroy(dispose);
  onMount(() => store.runSaga(mySliceSaga));
</script>

{@render children()}
```

`store.init()` combines the registered reducers, creates the Redux store with middleware, lets the concrete Store variant create its selector state source, and starts the package saga manager. It does **not** start app sagas — start each one with `store.runSaga(sagaFn)` from `onMount` for mount-scoped cleanup, or imperatively and keep the returned cancel function. It derives the manager name from the saga function and rejects direct `@internal_sagaManager` usage. Register the `store.init()` disposer with `onDestroy`; that disposer delegates to `store.dispose()`, which tears down the initialized Store runtime and stops Store-owned saga tasks when the whole Store lifetime ends.

### Saga-only slice (no state, no reducer)

Some slices exist only to define saga trigger actions with no meaningful state. Keep the action creators and saga but **do not register a reducer**.

```typescript
// src/slices/triggers/triggers-slice.ts
import { createAction } from 'ag-redux-toolkit/utils/store/create-action';

export const rescanWorkspace = createAction('triggers/rescanWorkspace');
```

```typescript
// src/slices/triggers/sagas/triggers-saga.ts
import { takeEvery, call } from 'typed-redux-saga';
import { rescanWorkspace } from '../triggers-slice';

export function* triggersSaga() {
  yield* takeEvery(rescanWorkspace, function* () {
    yield* call(rescan);
  });
}
```

```typescript
// src/store.ts
export const store = new Store({}); // no reducer map entry; start with store.runSaga(triggersSaga)
```

### Naming conventions

- **Type definitions:** `{slice-name}-types.ts` — all types, interfaces, enums
- **State type:** `{Feature}State` (e.g., `NotificationsState`) — defined in `-types.ts`
- **Reducer:** `{feature}Reducer` (e.g., `notificationsReducer`)
- **Actions:** verb phrases (e.g., `addNotification`, `fetchItems`)
- **Selectors:** `select` prefix (e.g., `selectNotifications`, `selectIsLoading`)
- **Action types:** `"sliceName/actionName"` (e.g., `"notifications/addNotification"`)

## Common Mistakes

### ❌ Registering a reducer for a saga-only slice

Empty reducers add state-tree noise and run on every action; saga-only slices define trigger actions without state.

```typescript
// WRONG
export const noopReducer = createReducer({}).build();
export const store = new Store({ triggers: noopReducer });
```

```typescript
// CORRECT — no reducer map entry; start the saga with store.runSaga(triggersSaga)
export const store = new Store({});
```

Source: `../SKILL.md` §9 (Saga-only slices) · **Priority: MEDIUM**

### ❌ Naming selectors without the `select` prefix

Breaks the `.select` / `.effect` lookup convention used across the codebase and tests; reviewers cannot tell a selector from a plain function.

```typescript
// WRONG
export const isLoading = store.createSelector(...);
```

```typescript
// CORRECT
export const selectIsLoading = store.createSelector(...);
```

Source: `../SKILL.md` §9 (Naming) · **Priority: MEDIUM**

### ❌ Defining state types inline in `{slice-name}-slice.ts`

Cross-process imports (e.g. Electron preload) pull in the reducer and action-creator factories just to get types; always put types in `{slice-name}-types.ts`.

```typescript
// WRONG — feature-slice.ts
export type FeatureState = { items: Collection<Item, 'id'> };
export const featureReducer = createReducer<FeatureState>(...);
```

```typescript
// CORRECT — feature-types.ts
export type FeatureState = { items: Collection<Item, 'id'> };

// feature-slice.ts
import type { FeatureState } from './feature-types';
```

Source: `../SKILL.md` §1, §9 · **Priority: MEDIUM**

## See also

- `core/core-policy/SKILL.md` — why types live in `-types.ts`
- `core/actions/SKILL.md` — action naming and namespacing
- `svelte/component-integration/SKILL.md` — Store initialization wiring
