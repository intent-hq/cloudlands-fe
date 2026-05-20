---
name: svelte-redux-toolkit/component-integration
description: >-
  Wire the Store class into a Svelte 5 app. Create a Store instance with
  constructor reducer/saga maps plus optional addMiddleware, call
  store.init() + onDestroy in the root layout, dispatch through the configured
  Store instance, and use selectFoo() at component init with $selectorResult$
  in templates. Start app sagas through store.runSaga(name). Source:
  src/store.ts and skills/svelte-redux-toolkit/SKILL.md §7.
type: sub-skill
library: svelte-redux-toolkit
library_version: 0.1.1
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/selector-lifecycle
sources:
  - augmentcode/svelte-redux-toolkit:src/store.ts
  - augmentcode/svelte-redux-toolkit:skills/svelte-redux-toolkit/SKILL.md
triggers:
  - store init layout
  - Store dispatch
  - component wiring
  - $selector$ template
---
# Component Integration — Store-first setup and dispatch

> Wire the Store class into a Svelte 5 app. Bootstrap in the root layout with `store.init()` + `onDestroy`, bind selector readables in templates as `$selectorResult$`, and dispatch/read one-shot state through the initialized app `Store` instance.

## 1. `Store` class

From `src/store.ts`:

```typescript
export class Store<TReducers extends ReducersMap = {}, TSagas extends SagasMap = {}> {
  constructor(reducersMap?: TReducers, sagasMap?: TSagas);
  addMiddleware(middleware: StoreMiddleware | StoreMiddleware[]): void;
  getReducers(): StoreReducersMap<TReducers>;
  getSagas(): TSagas;
  getSagaNames(): SagaName<TSagas>[];
  get state(): StoreState<this>;
  get dispatch(): Store["dispatch"];
  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<this>>
  ): StoreSelector<R, ARGS, StoreState<this>>;

  // Initialize Store-owned Redux/readable state, bind the saga manager orchestrator,
  // and return a disposer equivalent to store.dispose(). Does NOT start any registered sagas.
  // If a store context already exists, returns a noop.
  init(initialState?: PreloadedStoreState): () => void;

  // Explicitly register the initialized Store on the devtools hook.
  initDevTool(): () => void;

  // Tear down the initialized Store runtime and stop Store-owned saga tasks.
  // Safe to call before init(); equivalent to the init() returned disposer.
  dispose(): void;

  // Start a registered saga by name. Returns a cancel function that stops it.
  // Throws if init() has not been called or the name is not registered.
  runSaga(name: string): () => void;
}
```

Key rules:

- Pass app-owned reducers in the first constructor map and app-owned sagas in the second constructor map: `new Store(reducersMap?, sagasMap?)`.
- For typed state, infer `StoreState<typeof store>` from the configured Store instance. Constructor maps preserve reducer-state inference without an explicit `: Store` annotation or mutating registration calls.
- Use `store.createSelector(...)` for app-local selectors that should infer that configured store's `StoreState<typeof store>`; generic/shared selector helpers should accept a configured `Store` instead of importing a standalone selector factory.
- Register only app-owned reducers/sagas in constructor maps. `Store` manages package-owned internals under reserved `@internal_` names: reducers such as `@internal_storeUtility` are package-managed, and the internal saga manager starts during `Store` initialization without being added to the Store saga registry. Internal reducer domains can appear in `StoreState<typeof store>`, but `getSagas()` and `getSagaNames()` expose only app-owned sagas. Consumers should not add `@internal_` reducers/sagas or depend on internal state paths directly.
- Custom middlewares are **prepended** before the base store middleware chain.
- `init()` snapshots the app-owned saga registry, builds the Redux store/readable state, and starts the package-owned manager. Registered app sagas are **not** started automatically — start each one explicitly via `store.runSaga(name)`, usually from `onMount` in a component/layout. It accepts an app saga name string only — no function-form variant and no direct `@internal_sagaManager` usage.
- `initDevTool()` is a separate, explicit devtools registration step after `init()` when inspection hooks are needed; `dispose()` cleans up that registration along with Store-owned tasks.

## 2. Setup — root layout bootstrap

Create a single `Store` instance with app-owned reducer/saga maps at module scope:

```typescript
// src/lib/store/store.ts
import { Store } from "svelte-redux-toolkit/store";
import type { StoreState } from "svelte-redux-toolkit/types";
import { counterReducer } from "./slices/counter/counter-slice";
import { counterSaga }    from "./slices/counter/sagas/counter-saga";

export const store = new Store(
  { counter: counterReducer },
  { counterSaga }
);
export type AppState = StoreState<typeof store>;
```

Bootstrap in `+layout.svelte` by initializing the configured Store instance and registering its disposer:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { store } from "$lib/store/store";

  const dispose = store.init();
  onDestroy(dispose);
</script>

{@render children()}
```

Pass `store.init(initialState)` when the app needs preloaded state. `store.init()` should run during root component initialization so the Store-owned runtime is ready before children use selectors or dispatch through the Store; `onDestroy(dispose)` handles teardown. The returned disposer calls `store.dispose()`, so the existing `const dispose = store.init(); onDestroy(dispose);` pattern remains valid and preferred in Svelte roots. Use direct `store.dispose()` only when non-component code or tests own the whole Store lifetime.

## 3. Starting registered sagas — `store.runSaga`

`store.init()` starts the package-owned saga manager but does **not** auto-start constructor-registered app sagas. Every app saga provided in the Store constructor saga map must be started explicitly by name. The manager is not in the Store saga registry, and consumers should not start or register `@internal_sagaManager` directly. `store.runSaga(name)` accepts a **registered app saga name string only** — there is no function-form variant.

### Mount-scoped — `onMount(() => store.runSaga(name))`

Call from `onMount` to tie the saga's lifetime to that mount (most app-wide sagas run in the root layout, next to `store.init()`):

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "$lib/store/store";

  onMount(() => store.runSaga("editorSaga"));
</script>
```

Svelte calls the returned cancel function when the component unmounts.

### Imperative — `store.runSaga(name)`

For non-component code (services, tests, IPC handlers), start a saga directly and keep the returned cancel function:

```ts
const cancel = store.runSaga("editorSaga");
// later:
cancel();
```

`store.runSaga(name)` throws if `init()` has not been called or the saga name is not in the registry.

Full Store teardown is separate from per-saga cancellation: `store.dispose()` and the disposer returned by `store.init()` tear down the initialized Store runtime and stop saga tasks owned by that Store. Continue to use the cancel function returned by `store.runSaga(name)` for normal mount-scoped or operation-scoped saga cleanup.

## 4. Using state in components

At the top of a component script block (component init), create selector readables and import the configured Store for event-handler dispatch/state reads:

```svelte
<script lang="ts">
  import { store } from "$lib/store";
  import { selectItems, selectIsLoading } from "./slices/my-slice/my-slice-selectors";
  import { fetchItems, removeItem } from "./slices/my-slice/my-slice-slice";

  // ✅ At component init — selector readable calls use getContext() internally.
  const items$     = selectItems();
  const isLoading$ = selectIsLoading();

  // ✅ Event handler — use .select() with the imported app Store instance.
  function handleDelete(id: string) {
    const currentItems = selectItems.select(store.state);
    if (currentItems.length > 1) {
      store.dispatch(removeItem(id));
    }
  }
</script>

{#if $isLoading$}
  <Loading />
{:else}
  {#each $items$ as item}
    <ItemRow {item} onDelete={() => handleDelete(item.id)} />
  {/each}
{/if}
```

**Component rules:**

- ✅ `selectFoo()` at top-level script (component init)
- ✅ `store.dispatch(action)` in handlers through the imported initialized Store instance
- ✅ Use `$selectorResult$` in templates for reactive updates
- ✅ Use `selectFoo.select(store.state)` in handlers with an existing initialized `Store` instance imported/captured outside the handler
- ❌ NEVER call `selectFoo()` inside handlers / callbacks / async functions — it uses `getContext()` which is only valid at init
- ❌ NEVER create wrapper hooks around `dispatch` — dispatch action creators directly so tests and action traces stay explicit

For non-component code that already imports the initialized app `Store` instance, use its getters directly:

```ts
import { store } from "$lib/store";

export function submitFromShortcut(id: string) {
  const item = selectItem.select(store.state, id);
  if (item) store.dispatch(submitItem(id));
}
```

Do not import removed standalone dispatch helpers. The configured `Store` instance is the public per-store dispatch entry point.

The three selector call modes (`selectFoo()`, `.select(state)`,`yield* selectFoo.effect()`) are covered in detail in`svelte-redux-toolkit/selector-lifecycle/SKILL.md`.

## 5. Common Mistakes

### Calling `store.init()` without cleanup

**Mechanism:** `store.init()` returns a disposer backed by `store.dispose()`; skipping `onDestroy(dispose)` leaks Store-owned saga tasks and runtime subscriptions on hot reload and in tests.

```typescript
// ❌ WRONG
store.init();

// ✅ CORRECT
const dispose = store.init();
onDestroy(dispose);
```

*Source: *`skills/svelte-redux-toolkit/SKILL.md §7`*.*

### Creating a wrapper hook around `dispatch`

**Mechanism:** the package convention is to dispatch action creators directly. Wrappers obscure the action flow and break test plans that assert `put(action)`.

```typescript
// ❌ WRONG
export function useAddItem() {
  return (i: Item) => store.dispatch(addItem(i));
}

// ✅ CORRECT
// in the component:
store.dispatch(addItem(i));
```

*Source: *`skills/svelte-redux-toolkit/SKILL.md §7, §17`*.*

### Reading state with `selector()` in a template

**Mechanism:** templates bind Svelte readables via `$readable$` syntax.Calling `selectFoo()` in the template body creates a fresh readable everyrender and loses memoization (and throws outside init).

```svelte
<!-- ❌ WRONG -->
<p>{selectCount()}</p>

<!-- ✅ CORRECT -->
<script>
  const count$ = selectCount();
</script>
<p>{$count$}</p>
```

*Source: *`skills/svelte-redux-toolkit/SKILL.md §7`*.*

### Importing standalone package dispatch helpers

**Mechanism:** per-store dispatch belongs to the configured `Store` instance. Do not import package-level dispatch helpers from public entrypoints.

```svelte
<!-- ✅ CORRECT -->
<script>
  import { store } from "$lib/store";
  function onClick() { store.dispatch(addItem(i)); }
</script>
```

*Source: *`skills/svelte-redux-toolkit/SKILL.md §2, §7`*.*

### Double-initializing the store

**Mechanism:** `store.init()` returns a noop disposer when an initialized Store runtime already exists — so calling it a second time does nothing. Agents sometimes "fix" missing state by adding a second `store.init()` call in a child layout; the fix is silent and the child layout's middlewares/sagas never register.

```svelte
<!-- ❌ WRONG — duplicate bootstrap -->
<!-- +layout.svelte -->
<script>const dispose = store.init();</script>
<!-- admin/+layout.svelte -->
<script>const dispose = adminStore.init();</script>  <!-- noop, adminStore never runs -->

<!-- ✅ CORRECT — register reducers/sagas on the single shared store -->
<script>const dispose = singleStore.init();</script>
```

*Source: *`src/store.ts`* (*`Store.init`* early-return on existing context).*

## 6. See also

- `svelte-redux-toolkit/selector-lifecycle` — the three selector call modes(`selectFoo()` / `.select(state)` / `.effect()`).
- `svelte-redux-toolkit/file-structure` — slice layout and registration order.
- `init-svelte-redux-toolkit` — first-time greenfield setup.