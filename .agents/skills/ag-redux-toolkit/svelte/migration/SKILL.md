---
name: svelte/migration
description: >-
  Migrate an existing Svelte app from Svelte stores (writable, readable,
  derived, $state, $derived) to Redux + Saga architecture using
  ag-redux-toolkit. Root index that routes to assessment, setup, per-primitive
  mapping (writable/derived/side-effects), component migration, and cleanup
  sub-skills. Use when ANY task involves migrating Svelte stores to Redux,
  converting writable/readable/derived stores, replacing Svelte store patterns
  with Redux slices, moving side effects to sagas, or planning a store
  migration strategy.
type: lifecycle
requires:
  - svelte
triggers:
  - migrate stores
  - convert to redux
  - replace svelte stores
  - migration
  - migrate writable
  - migrate derived
  - svelte store to redux
  - store migration plan
---
# Migrate Svelte Stores → Redux + Saga

## Agent Preflight Compliance Contract

Before editing code or docs under this skill:

- **MUST** read this skill plus every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **MUST** keep the migrated Svelte app on the Svelte Store family; do not solve a
  Svelte migration by introducing StreamingStore, Kefir/observable selectors, or
  streaming lifecycle/setup patterns into the same app.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

> Index for the migration playbook. Each step below links to a focusedsub-skill; read them in order for a full slice migration.

## Migration Policy

Migrating from Svelte stores to `ag-redux-toolkit` is driven by two rules:

1. **Redux owns shared, persisted, or async-driven state.** Anything read orwritten by more than one component, anything synced to localStorage / theserver / IPC, and anything involved in async flows (API calls, timers,debouncing) moves into a slice.
2. **Component-local ephemeral state stays local.** Hover, focus, open/closedtoggles, scroll position, and single-form field values do not need aslice. **When in doubt → move to Redux.**

Migrate one store at a time, simplest and most isolated first. Each slicelands in its own branch and PR; never batch multiple store migrations in onecommit. Keep the old `.store.svelte.ts` file in git history until the newslice passes tests and manual UI verification — then delete it and run`grep` to confirm zero residual references. Do not leave the old path as a one-line re-export, proxy, or delegate-only wrapper; remove it, inline it, or document it as a compatibility shim with a sunset/removal condition.

Reducers must stay pure (no `fetch`, no `localStorage`, no `Date.now()`, nomutation) and state must stay structured-cloneable (no `Date` / `Map` /`Set` / `RegExp` / class instances / functions / `Promise`). Side effects —subscriptions, `$effect`, timers, IPC, fetches — go into sagas. Every `selectFoo()` readable call is a component-init API: capture it at the top ofthe `<script>` block, never inside callbacks, or Svelte will throw`lifecycle_outside_component`. Dispatch through the configured app `Store` instance.

Migration chooses the Svelte Store family for that app. A separate Node/server or
worker package in the same repository may choose StreamingStore, but this Svelte
app must not mix in StreamingStore/Kefir selector patterns.

## Recommended Order

Run these sub-skills in order. Steps 3–6 repeat per slice; step 7 closesout each slice.

1. `assessment` — Inventory existing Svelte stores and`$state` / `$derived` runes; classify each as shared (→ Redux) vscomponent-local using the decision framework.
2. `setup` — Install the package and peer deps, wire the `Store` class in `+layout.svelte`, and create empty reducer + saga registrations.
3. `writable-stores` — Convert `writable()` and`$state` into slice initial state + `createAction` + `createReducer` withimmutable updates.
4. `derived-stores` — Convert `derived()` and`$derived` into `store.createSelector` when a configured Store exists, composing with upstream selectors via`.select(state)`.
5. `side-effects` — Move `$effect` blocks,subscriptions, timers, IPC listeners, and fetches into sagas using`takeEvery` / `takeLatest` + `call` / `put` / `delay`.
6. `component-migration` — Swap Sveltestore imports for `selectFoo()` readables and Store-first dispatch; keep templates reactive via `$selectorResult$`.
7. `cleanup` — Delete the old `.store.svelte.ts` file,verify zero residual references, check old paths for pass-through wrappers, and apply the rollback recipe if theslice regresses.

## Quick Reference Card

| Svelte Store | Redux Equivalent |
| --- | --- |
| writable(value) | createAction + createReducer with initial state |
| readable(value, start) | createReducer + saga for start logic |
| derived(store, fn) | store.createSelector(fn) when a configured Store exists |
| $store (reactive read) | selector() at component init, $selectorResult$ in template |
| store.set(value) | dispatch(setAction(value)) |
| store.update(fn) | dispatch(action(...)) — compute new value in reducer |
| $effect(() => { ... }) | Saga with takeEvery / takeLatest |
| fetch in components | Saga with call(fetch, ...) + put(resultAction(...)) |
| localStorage access | Saga using app-local safe-local-storage helpers (`setLocalStorageItem`, `getLocalStorageItem`, etc.) |
| onMount(() => { ... }) | Init saga (runs once on store creation) |
| Event listeners | Saga with channels and take loops |

## Examples in This Skill

- Added: migration orchestration plan object; `writable` before/after slice; `derived` before/after selector; component fetch before/after saga; component readable/dispatch swap; cleanup evidence object.
- Retained: none (this lifecycle index previously had no JS/TS examples).

## Migration Orchestration Examples

### 1. Route assessment findings to the next sub-skill

```typescript
type MigrationVerdict = "redux" | "local";
type MigrationStep = "setup" | "writable-stores" | "derived-stores" | "side-effects" | "component-migration" | "cleanup";

type StoreAssessment = {
  file: string;
  verdict: MigrationVerdict;
  primitives: Array<"writable" | "derived" | "effect">;
  consumers: string[];
};

const cartAssessment: StoreAssessment = {
  file: "src/lib/stores/cart.store.svelte.ts",
  verdict: "redux",
  primitives: ["writable", "derived", "effect"],
  consumers: ["Cart.svelte", "Header.svelte"],
};

const nextSteps: MigrationStep[] = cartAssessment.verdict === "redux"
  ? ["setup", "writable-stores", "derived-stores", "side-effects", "component-migration", "cleanup"]
  : ["cleanup"];
```

### 2. Convert a shared writable store to a slice

```typescript
import { writable } from "svelte/store";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";

export const legacyCount = writable(0);

type CounterState = { count: number };
const initialState: CounterState = { count: 0 };

export const setCount = createAction<[value: number]>("counter/setCount");
export const increment = createAction("counter/increment");

export const counterReducer = createReducer<CounterState>(initialState)
  .with(setCount, (state, { payload: [value] }) => ({ ...state, count: value }))
  .with(increment, (state) => ({ ...state, count: state.count + 1 }));
```

### 3. Convert derived state to Store-bound selectors

```typescript
import { derived } from "svelte/store";
import { legacyCount } from "$lib/stores/counter.store.svelte";
import { store } from "$lib/store/store";

export const legacyDoubled = derived(legacyCount, ($count) => $count * 2);

export const selectCount = store.createSelector((state) => state.counter.count);
export const selectDoubled = store.createSelector((state) => {
  return selectCount.select(state) * 2;
});
```

### 4. Move component fetch work into a saga

```typescript
import { call, put, takeLatest } from "typed-redux-saga";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { setUsername } from "$lib/store/slices/user/user-slice";

type UserResponse = { name: string };

const fetchUser = (userId: string) => {
  return fetch(`/api/users/${userId}`).then((response) => response.json() as Promise<UserResponse>);
};

export const loadUser = createAction<[userId: string]>("user/load");

function* loadUserWorker(action: ReturnType<typeof loadUser>) {
  const user = yield* call(fetchUser, action.payload[0]);
  yield* put(setUsername(user.name));
}

export function* userSaga() {
  yield* takeLatest(loadUser, loadUserWorker);
}
```

### 5. Swap component reads and writes to selectors plus Store dispatch

```typescript
import { store } from "$lib/store/store";
import { increment } from "$lib/store/slices/counter/counter-slice";
import { selectCount, selectIsSaving } from "$lib/store/slices/counter/counter-selectors";

const count$ = selectCount();

function incrementWhenIdle() {
  const isSaving = selectIsSaving.select(store.state);
  if (!isSaving) {
    store.dispatch(increment());
  }
}

export const counterPanelModel = { count$, incrementWhenIdle };
```

### 6. Finish each slice with cleanup evidence

```typescript
type CleanupEvidence = {
  oldStorePath: string;
  remainingImports: string[];
  passThroughWrappers: string[];
  testsRun: string[];
};

export const cartCleanupEvidence: CleanupEvidence = {
  oldStorePath: "src/lib/stores/cart.store.svelte.ts",
  remainingImports: [],
  passThroughWrappers: [],
  testsRun: ["npm run validate:architecture"],
};
```

## Cases Covered

| Case | Example |
| --- | --- |
| Migration ordering and sub-skill routing | Route assessment findings to the next sub-skill |
| Shared mutable state conversion | Convert a shared writable store to a slice |
| Derived value conversion | Convert derived state to Store-bound selectors |
| Side-effect migration | Move component fetch work into a saga |
| Component read/write migration | Swap component reads and writes to selectors plus Store dispatch |
| Cleanup and verifier evidence | Finish each slice with cleanup evidence |
