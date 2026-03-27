---
name: redux-store
description: >-
  Work with the Redux store, state management, slices, sagas, selectors, reducers,
  actions, side effects, collections, channels, and component integration. Use when
  ANY task involves: creating or modifying Redux slices, creating selectors, writing
  sagas, dispatching actions, reading state, creating UI components that use shared
  state, using $effect with store state, migrating Svelte stores to Redux, handling
  IPC listeners, working with normalized data, creating reducers, managing side effects,
  component state vs Redux decisions, selector lifecycle, getDispatch usage, typed-redux-saga,
  createAction, createReducer, createSelector, createCollectionItemSelector, Collection
  utilities, selector channels, takeLatestFromSelector, createChannelFromSelector,
  waitFor saga utility, or any state management task.
  Trigger phrases include "create a slice", "add state", "dispatch action", "selector",
  "saga", "side effect", "store", "Redux", "shared state", "component state",
  "Svelte store migration", "IPC listener", "$effect", "getDispatch", "reducer",
  "collection", "normalized data", "channel", "async action", "createAction",
  "createSelector", "createReducer".
---
# Redux Store — Agent Skill

> This codebase uses a CUSTOM Redux setup — NOT Redux Toolkit (RTK). Do not use createSlice, configureStore, createAsyncThunk, or any RTK APIs. Use only the custom utilities documented below.

## 1. Core Policy

- **Redux for ALL shared/domain state.** Svelte stores (`*.store.svelte.ts`) are **DEPRECATED** — never create new ones.
- **Components render; Redux owns state.** Components read via selectors, dispatch actions. Business logic goes in reducers + sagas.
- **Side effects in sagas, not components.** API calls, IPC, localStorage, timers, event listeners → sagas. Use `$effect` only for DOM-local work (focus, scroll, measurements).
- **State must be serializable.** No `Date`, `Map`, `Set`, `RegExp`, `Promise`, `Function`, class instances, `Symbol`. Use plain objects, arrays, strings, numbers, booleans, `null`, `undefined`.
- **Arrays hold primitives only.** For entity/object storage, always use `Collection<T, K>`. Never store `Item[]` in state — use Collections for O(1) lookups and normalized data.
- **Svelte store migration on contact.** If you encounter `.store.svelte.ts`, do not expand it — migrate to Redux per the [Migration Guide](src/lib/store/docs/MIGRATION_GUIDE.md).
- **Types in separate modules.** Define all slice types/interfaces in `{slice-name}-types.ts`, not in `-slice.ts`. This allows safe cross-process imports — importing `-slice.ts` for types pulls in renderer-only dependencies and breaks main-process builds.
- **Main-process Redux store coming soon.** Currently Redux is renderer-only.

## 2. Custom API Reference

### Actions — `createAction` / `createAsyncAction`

```typescript
import { createAction, createAsyncAction } from "$lib/store/utils/create-action";

// No payload
export const clearResults = createAction("mySlice/clearResults");

// Single arg (tuple type)
export const removeItem = createAction<[id: string]>("mySlice/removeItem");

// Multiple args
export const setPosition = createAction<[x: number, y: number]>("mySlice/setPosition");

// Payload modifier (transform args → payload shape)
export const setStatus = createAction("mySlice/setStatus",
  (id: string, status: Status) => ({ id, status })
);

// Async action (request/success/failure)
export const fetchItems = createAsyncAction<[query: string], { items: Item[] }>(
  "mySlice/fetch", "mySlice/fetchItems"
);
// fetchItems(query)        → dispatches request
// fetchItems.success(data) → dispatches success
// fetchItems.failure(err)  → dispatches failure

// Action for adding a single item to a collection
export const addNewItem = createAction<[item: Item]>("mySlice/addNewItem");
```

**Rules:** Always namespace: `"sliceName/actionName"`. Use tuple types `[arg1, arg2]` for multiple args.

### Types — `{slice-name}-types.ts`

All types, interfaces, and enums live in a dedicated `-types.ts` file. This keeps them safe to import from any process (renderer, main, shared, preload).

```typescript
// my-slice-types.ts — safe to import from ANY process
import type { Collection } from "$lib/store/utils/collection-utils";

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
// ❌ BAD — pulls in reducer + renderer deps
import type { PermissionRequest } from "$lib/store/slices/permission/permission-slice";

// ✅ GOOD — types-only module, safe from any process
import type { PermissionRequest } from "$lib/store/slices/permission/permission-types";
```

### Reducers — `createReducer`

```typescript
import { createReducer } from "$lib/store/utils/create-reducer";
import { createCollection, addItem as collectionAddItem } from "$lib/store/utils/collection-utils";
import type { Collection } from "$lib/store/utils/collection-utils";
import type { MyState, Item } from "./my-slice-types";

const initialState: MyState = {
  items: createCollection<Item, "id">("id"),
  isLoading: false,
  error: null,
};

export const myReducer = createReducer<MyState>(initialState)
  .with(addNewItem, (state, { payload: [item] }) => ({
    ...state, items: collectionAddItem(state.items, item),
  }))
  .with(fetchItems, (state) => ({ ...state, isLoading: true }))
  .with(fetchItems.success, (state, action) => ({
    ...state, isLoading: false, items: createCollection<Item, "id">("id", action.payload.response.items),
  }))
  .with(fetchItems.failure, (state, action) => ({
    ...state, isLoading: false, error: action.payload.error.message,
  }));
```

**Reducer rules:**

- ✅ Pure functions — no side effects, no async, no `Date.now()` / `Math.random()`
- ✅ Always return new objects: `{ ...state, field: newValue }`
- ✅ Return same reference if nothing changed (prevents re-renders)
- ❌ Never mutate state: `state.field = x` is FORBIDDEN
- See Section 9 for full serialization rules.

### Selectors — `createSelector`

```typescript
import { createSelector, createCollectionItemSelector } from "$lib/store/utils/create-selector";

// Simple
export const selectIsLoading = createSelector((state) => state.mySlice.isLoading);

// Collection item selector (for single-item lookups from a Collection)
export const selectItemById = createCollectionItemSelector<Item, "id">(
  (state) => state.mySlice.items
);

// Composing selectors (use .select() to call another selector)
export const selectActiveItemCount = createSelector((state) => {
  return selectItems.select(state).filter(i => i.isActive).length;
});
```

## 3. Selector Lifecycle Rules ⚠️ CRITICAL

**This is the #1 source of bugs.** Selectors use `getContext()` internally. Using the wrong call mode crashes the app.

| Context | Correct Usage | Why |
| --- | --- | --- |
| Component init (top-level <script>) | const value$ = selectFoo() | Returns Svelte readable store. Uses getContext() — only valid during init. |
| Event handlers / callbacks / async | selectFoo.select(getReduxStore().getState()) | Direct state read. No Svelte context needed. |
| Sagas | yield* selectFoo.effect() | Uses redux-saga select effect. |
| Composing selectors | selectFoo.select(state) | Direct call with state argument. |

### ❌ WRONG — crashes with `lifecycle_outside_component`

```typescript
function handleClick() {
  const value = selectFoo();              // CRASHES — getContext() not available
  const model = get(selectModel(id));     // CRASHES — same reason
}
```

### ✅ CORRECT

```typescript
// At component init (top-level script block)
const dispatch = getDispatch();           // ← MUST be at init time
const foo$ = selectFoo();                 // ← MUST be at init time

// In event handlers — use .select() for one-time reads
function handleClick() {
  const value = selectFoo.select(getReduxStore().getState());
  dispatch(doSomething(value));
}
```

## 4. Sagas — `typed-redux-saga`

All side effects go in sagas. This codebase uses `typed-redux-saga` (use `yield*` not `yield`).

```typescript
import { call, put, select, takeEvery, takeLatest, delay, race, fork, spawn, take } from "typed-redux-saga";

function* mySaga() {
  yield* takeEvery(myAction, handleMyAction);
  yield* takeLatest(searchQuery, handleSearch);
}

function* handleMyAction(action: ReturnType<typeof myAction>) {
  const data = yield* select(mySelector.select);      // Read state
  const result = yield* call(fetchData, action.payload); // Call async fn
  yield* put(updateData(result));                       // Dispatch action
}

// Debounce pattern
function* handleSearch(action: ReturnType<typeof searchQuery>) {
  yield* delay(300);
  const results = yield* call(api.search, action.payload);
  yield* put(setResults(results));
}
```

**Saga rules:**

- ✅ Pass action creators directly: `yield* takeEvery(myAction, handler)`
- ❌ Don't use `.type`: `yield* takeEvery(myAction.type, handler)` — WRONG
- ✅ Use `.effect()` for selectors: `const val = yield* mySelector.effect()`
- ❌ Never inline lambdas: `yield* select((state) => state.x)` — WRONG, create named selectors
- ✅ Always create named selectors in `*-selectors.ts` files

### Selector Channel Effects — reacting to state changes in sagas

```typescript
import {
  takeLatestFromSelector, takeEveryFromSelector, takeLeadingFromSelector
} from "$lib/store/utils/selector-channel-effects";

// Cancel previous handler when value changes (most common)
function* watchCurrentConversation() {
  yield* takeLatestFromSelector(selectCurrentConversationId, function* ({ payload, prevPayload }) {
    if (payload) {
      yield* put(loadConversation(payload));
    }
  });
}

// With selector arguments — pass as second parameter
function* watchConversation(conversationId: string) {
  yield* takeLatestFromSelector(selectConversation, [conversationId], function* ({ payload }) {
    // Handle changes
  });
}
```

For advanced channel patterns, use `createChannelFromSelector` from `$lib/store/utils/selector-channel-effects` — but prefer the `takeEveryFromSelector` / `takeLatestFromSelector` family above.

### Channel Effects — consuming any EventChannel in sagas

```typescript
import { takeEveryFromChannel, takeLatestFromChannel } from "$lib/store/utils/channel-effects";

// takeEveryFromChannel - Fork a new worker for each event (most common for IPC)
yield* takeEveryFromChannel(channel, function* (data) {
  yield* put(handleEvent(data));
});

// takeLatestFromChannel - Cancel previous worker when new event arrives
yield* takeLatestFromChannel(channel, function* (data) {
  yield* call(expensiveOperation, data);
});
```

These auto-fork, auto-close the channel on cancellation, and work with **any** `EventChannel<T>`.

### IPC & Window Listeners in sagas (preferred one-liners)

Use the high-level helpers from `$lib/store/utils/ipc-channel` — they create the channel, loop, and clean up automatically:

```typescript
import { takeEveryFromListenSync, takeEveryFromElectronChannel, takeEveryFromWindowEvent } from "$lib/store/utils/ipc-channel";

// listenSync(...) events — most common for main→renderer IPC
function* watchWorkspaceUpdated() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>("workspace:updated", function* (data) {
    yield* put(setLastUpdate(data.workspaceId, data.timestamp));
  });
}

// window.electronAPI.on(...) events
function* watchZoom() {
  yield* takeEveryFromElectronChannel<{ zoomFactor: number }>("window:zoom-changed", function* (data) {
    yield* put(setZoomFactor(data.zoomFactor));
  });
}

// window CustomEvent flows
function* watchThemeChange() {
  yield* takeEveryFromWindowEvent<{ theme: string }>("app:theme-changed", function* (data) {
    yield* put(setTheme(data.theme));
  });
}
```

For custom channel scenarios, fall back to `createListenSyncChannel` + `takeEveryFromChannel`:

```typescript
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { takeEveryFromChannel } from "$lib/store/utils/channel-effects";

const channel = createListenSyncChannel<MyEvent>('my:event');
yield* takeEveryFromChannel(channel, function* (data) { /* ... */ });
```
```

### `waitFor` — wait for state condition

```typescript
import { waitFor } from "$lib/store/slices/store-utility/sagas/waitFor";

// Wait for a condition, with optional timeout
yield* waitFor(selectIsSummarizing, [conversationId], (val) => val === false);
yield* waitFor(selectIsReady, [], (val) => val === true, 5000); // 5s timeout, returns false if timed out
```

### Batch updates — prevent intermediate selector emissions

```typescript
import { lockUpdates, unlockUpdates } from "$lib/store/slices/store-utility/store-utility-slice";

yield* put(lockUpdates());
try {
  yield* put(action1());
  yield* put(action2());
} finally {
  yield* put(unlockUpdates()); // Selectors update once here
}
```

## 5. Collections — normalized data

```typescript
import {
  createCollection, addItem, updateItem, removeItem, upsertItem,
  getItem, getItems, filterItems, addItemAt,
  increaseRefsCount, decreaseRefsCount, getRefsCount
} from "$lib/store/utils/collection-utils";

// Create
const collection = createCollection<Item, "id">("id");

// All ops return NEW collection (immutable)
const c1 = addItem(collection, item);
const c2 = updateItem(c1, { id: "1", name: "Updated" });
const c3 = removeItem(c2, "1");

// Query
const item = getItem(collection, "1");
const allItems = getItems(collection);     // ordered array
```

**Collection structure:**

```typescript
type Collection<ITEM, K> = {
  idField: K;
  ids: Array<ITEM[K]>;           // Ordered IDs
  map: Record<ITEM[K], ITEM>;    // ID → Item lookup (O(1))
  refsCount: Record<ITEM[K], number>; // Reference counting
};
```

Use **separate maps** for derived state — don't add flags to items:

```typescript
// ✅ GOOD
type State = { items: Collection<Item, "id">; pins: Record<string, boolean> };

// ❌ BAD — updating pin changes entire collection, hurts perf
type State = { items: Collection<ItemWithPinned, "id"> };
```

## 6. Component Integration

```svelte
<script lang="ts">
  import { getDispatch } from "$lib/store/utils/utils";
  import { selectItems, selectIsLoading } from "$lib/store/slices/my-slice/my-slice-selectors";
  import { fetchItems, removeItem } from "$lib/store/slices/my-slice/my-slice-slice";
  import { getReduxStore } from "$lib/store/redux-dispatch-bridge";

  // ✅ At component init — these use getContext() internally
  const dispatch = getDispatch();
  const items$ = selectItems();
  const isLoading$ = selectIsLoading();

  // ✅ Event handler — use .select() for one-time reads
  function handleDelete(id: string) {
    const currentItems = selectItems.select(getReduxStore().getState());
    if (currentItems.length > 1) {
      dispatch(removeItem(id));
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

- ✅ `getDispatch()` and `selectFoo()` at top-level script (component init)
- ✅ Use `$selectorResult$` in templates for reactive updates
- ✅ Use `.select(getReduxStore().getState())` in handlers
- ❌ NEVER call `selectFoo()` or `getDispatch()` inside handlers/callbacks/async
- ❌ NEVER create wrapper hooks around dispatch — dispatch actions directly

## 7. When to Use Redux vs Component-Local State

**Use Redux when:**

- State is shared by multiple components
- State is needed by services or non-Svelte code
- State is persisted, synced over IPC/network, or survives navigation
- State drives business logic, workflows, or cross-feature coordination
- State is derived in multiple places

**Keep in component when:**

- Purely visual and instance-local (hover, focus, open/closed toggles)
- Only matters while this one component is mounted
- Not shared, persisted, or part of business logic

**Use **`$effect`** only when:**

- Effect is directly tied to this component's rendered DOM
- Focus/scroll/measurement work
- Third-party widget lifecycle that can't live elsewhere

**When in doubt → use Redux.**

## 8. File Structure & Registration

### Slice directory layout

```
src/lib/store/slices/{slice-name}/
  {slice-name}-types.ts          # Types, interfaces, enums (safe to import from any process)
  {slice-name}-slice.ts          # Actions, reducer (imports types from -types.ts)
  {slice-name}-selectors.ts      # Selectors
  {slice-name}-slice.test.ts     # Reducer tests
  sagas/
    {slice-name}-saga.ts         # Saga logic
    {slice-name}-saga.test.ts    # Saga tests
```

### Saga-only slices

Some slices exist only to define saga trigger actions with **no meaningful state**. For these, keep the action creators and saga but **do not register a reducer** in `src/lib/store/reducer.ts`. Examples: `auth`, `auto-update`, `ui-notifications`, `app-layout`.

### Registration steps

**1. Register reducer** in `src/lib/store/reducer.ts` (skip for saga-only slices):

```typescript
import { mySliceReducer } from "./slices/my-slice/my-slice-slice";
export const reducers = { /* ...existing */ mySlice: mySliceReducer } as const;
```

**2. Register saga** in `src/lib/store/sagas.ts`:

```typescript
import { mySliceSaga } from "./slices/my-slice/sagas/my-slice-saga";
export const sagas = { /* ...existing */ mySliceSaga } as const;
```

**3. Start saga** via `<RunSaga>` in appropriate layout:

```svelte
<script>
  import RunSaga from "$lib/store/components/RunSaga.svelte";
</script>
<RunSaga sagaName="mySliceSaga" />
```

### Naming conventions

- **Type definitions:** `{slice-name}-types.ts` (e.g., `notifications-types.ts`) — all types, interfaces, enums
- **State type:** `{Feature}State` (e.g., `NotificationsState`) — defined in `-types.ts`
- **Reducer:** `{feature}Reducer` (e.g., `notificationsReducer`)
- **Actions:** verb phrases (e.g., `addNotification`, `fetchItems`)
- **Selectors:** `select` prefix (e.g., `selectNotifications`, `selectIsLoading`)
- **Action types:** `"sliceName/actionName"` (e.g., `"notifications/addNotification"`)

## 9. Workspace-Scoped State

For state keyed by workspace ID, use `createWorkspaceScopedHelpers`:

```typescript
import { createWorkspaceScopedHelpers } from "$lib/store/utils/workspace-scoped";

const emptyState: MyWorkspaceState = { items: createCollection<Item, "id">("id") };
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyState);

// State shape: { byWorkspaceId: Record<string, MyWorkspaceState> }

// In reducer:
.with(setItems, (state, { payload: [wsId, items] }) =>
  setWorkspaceState(state, wsId, { ...getWorkspaceState(state, wsId), items })
)
.with(clearWorkspace, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
```

## 10. Boolean Preference Utility

For boolean preference fields, use `createBooleanPreference` instead of hand-writing `setX` / `toggleX` pairs:

```typescript
import { createBooleanPreference } from "$lib/store/utils/boolean-preference";

const spellcheck = createBooleanPreference<MyState>({
  sliceName: "userPrefs", field: "spellcheckEnabled",
  setActionName: "setSpellcheck", toggleActionName: "toggleSpellcheck",
});
export const setSpellcheck = spellcheck.setAction;
export const toggleSpellcheck = spellcheck.toggleAction;

// Chain register() on the reducer builder:
export const myReducer = spellcheck.register(
  createReducer<MyState>(initialState)
  // ... other .with() handlers
);
```

## 11. State Serialization Rules

### ✅ Allowed types

`string`, `number`, `boolean`, `null`, `undefined`, plain objects `{}`, arrays of primitives `string[]`, `number[]` (for arrays of objects, use `Collection<T, K>` instead)

### ❌ Forbidden types and alternatives

| Forbidden | Alternative |
| --- | --- |
| Function | Store function name/ID, call from saga |
| Class instance | Plain object { ... } |
| Date | number (timestamp in ms) |
| Map / WeakMap | Record<string, T> |
| Set / WeakSet | string[] (primitive sets) or Record<string, true> |
| RegExp | string (pattern) |
| Promise | Handle in sagas |
| Symbol | string constants |
| Error | { message: string; stack?: string } |

## 12. Svelte Store Migration Policy

**Rule:** When encountering `.store.svelte.ts`, NEVER expand it. Migrate to Redux:

| Svelte Store | Redux Equivalent |
| --- | --- |
| $state fields | Slice initial state |
| $derived / getters | createSelector |
| Methods (pure) | createAction + createReducer |
| Side effects | Sagas (typed-redux-saga) |

After migration: **DELETE the old store file** and ensure **zero references** remain.

See [Migration Guide](src/lib/store/docs/MIGRATION_GUIDE.md) for the full checklist.

## 13. Testing

### The `vi.mock("typed-redux-saga")` boilerplate — REQUIRED for all saga tests

Every saga test **must** mock `typed-redux-saga` to map its generator-based `yield*` effects back to plain `redux-saga/effects` so that `expectSaga`/`testSaga` from `redux-saga-test-plan` can interpret them. This is the **#1 testing pitfall** — tests silently hang or fail without it.

The `vi.mock()` call must appear **before** any imports of saga modules (Vitest hoists it, but declaration order matters for readability and correctness):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

// ⚠️ MUST come before importing any saga module
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
}));

// NOW safe to import saga modules
import { myHandler } from "./my-saga";
import { myAction, myOtherAction } from "../my-slice";
```

**Only mock the effects your saga actually uses.** For example, if the saga only uses `fork`, you only need the `fork` entry in the mock.

### `expectSaga` — integration-style testing (most common)

Tests the saga's observable side effects without asserting step order:

```typescript
it("handles the action and dispatches result", async () => {
  await expectSaga(handleMyAction, myAction("input"))
    .withState({
      mySlice: { items: [], isLoading: false },
      providerSettings: { activeProviderId: "codex" },
    })
    .put(setLoading(true))
    .call(fetchData, "input")
    .put(setResults(["item1"]))
    .silentRun(0);
});
```

**Key methods:**

| Method | Purpose |
| --- | --- |
| `.withState(partialState)` | Provide the Redux state the saga will `select` from |
| `.put(action)` | Assert the saga dispatches this exact action |
| `.put.like({ action: { type } })` | Assert a dispatch matching a partial shape |
| `.call(fn, ...args)` | Assert the saga calls this function with these args |
| `.provide([[matchers.call.fn(fn), returnValue]])` | Stub a `call` effect to return a value (use `import * as matchers from "redux-saga-test-plan/matchers"`) |
| `.dispatch(action)` | Dispatch an action mid-test (for sagas that `take`) |
| `.silentRun(0)` | Run without timeout warnings; use `0` for sync sagas, `100` for async |

### `testSaga` — step-by-step testing

Tests exact execution order. Best for orchestration sagas (fork trees):

```typescript
import { testSaga } from "redux-saga-test-plan";

it("forks child sagas in order", () => {
  testSaga(rootSaga)
    .next()
    .fork(childSagaA)
    .next()
    .fork(childSagaB)
    .next()
    .isDone();
});

it("loads cached data from localStorage", () => {
  testSaga(loadCachedEditors)
    .next()
    .call(getLocalStorageItem, STORAGE_KEY)
    .next(JSON.stringify({ editors: [mockEditor], timestamp: 123 }))
    .put(fetchEditorsSuccess([mockEditor], 123))
    .next()
    .isDone();
});
```

### Reducer testing — pure functions, no mocks needed

Reducers are pure functions. Test them by calling `reducer(state, action)` and asserting the result:

```typescript
import { describe, it, expect } from "vitest";
import { myReducer, addItem, removeItem, initialState } from "./my-slice";

describe("myReducer", () => {
  it("returns initial state", () => {
    expect(myReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("adds an item", () => {
    const state = myReducer(initialState, addItem({ id: "1", name: "Test" }));
    expect(getItem(state.items, "1")).toEqual({ id: "1", name: "Test" });
  });

  it("does not mutate previous state", () => {
    const state = myReducer(initialState, addItem({ id: "1", name: "Test" }));
    expect(initialState.items).toEqual(createCollection("id")); // unchanged
    expect(state).not.toBe(initialState);
  });

  it("returns same reference when nothing changes", () => {
    const state = myReducer(initialState, removeItem("nonexistent"));
    expect(state).toBe(initialState); // same reference = no re-render
  });
});
```

### Testing rules

- ✅ Use `expectSaga` for integration tests, `testSaga` for step-by-step order verification
- ✅ Use `vi.clearAllMocks()` and `localStorage.clear()` in `beforeEach`
- ✅ Mock external dependencies with `vi.mock("module", () => ({ ... }))`
- ✅ Use `import * as matchers from "redux-saga-test-plan/matchers"` with `.provide()` for stubbing calls
- ❌ Never import from `typed-redux-saga` in test assertions — use `redux-saga/effects` for matchers
- ❌ Never use real timers — use `.silentRun()` with short timeouts
- ❌ Never forget the `call` mock's `Array.isArray` guard — it handles `[context, method]` tuple calls used by `safe-local-storage-saga`

## 14. localStorage Persistence

### `safe-local-storage-saga` utilities

Always use the saga helpers from `$lib/store/utils/safe-local-storage-saga` — **never** call `window.localStorage` directly in sagas. These helpers wrap localStorage operations in `yield* call()` so they're testable with `expectSaga`/`testSaga`:

```typescript
import {
  getLocalStorageItem,   // yield* call(getLocalStorageItem, key) → string | null
  setLocalStorageItem,   // yield* call(setLocalStorageItem, key, value)
  removeLocalStorageItem // yield* call(removeLocalStorageItem, key)
} from "$lib/store/utils/safe-local-storage-saga";
```

### Init saga pattern — load from localStorage on startup

```typescript
import { getLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, put, type SagaGenerator } from "typed-redux-saga";
import { loadSettings } from "../my-slice";

const STORAGE_KEY = "my-feature-settings";

const defaults = { theme: "dark", fontSize: 14 };

function* loadFromLocalStorage(): SagaGenerator<typeof defaults> {
  try {
    const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors — fall through to defaults
  }
  return defaults;
}

export function* initSaga() {
  const settings = yield* call(loadFromLocalStorage);
  yield* put(loadSettings(settings));
}
```

### Persistence saga pattern — watch and save on change

```typescript
import { setLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { call, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { selectMyValue } from "../my-selectors";
import { setMyValue } from "../my-slice";

const STORAGE_KEY = "my-feature-value";

function* persistValue(): SagaGenerator<void> {
  try {
    const value = yield* selectMyValue.effect();
    yield* call(setLocalStorageItem, STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors — localStorage can throw (quota, private browsing)
  }
}

export function* persistenceSaga() {
  yield* takeEvery([setMyValue.type], persistValue);
}
```

### Orchestration — combining init + persistence

```typescript
import { fork, type SagaGenerator } from "typed-redux-saga";
import { initSaga } from "./init-saga";
import { persistenceSaga } from "./persistence-saga";

export function* myFeatureSaga(): SagaGenerator<void> {
  yield* fork(initSaga);
  yield* fork(persistenceSaga);
}
```

### localStorage rules

- ✅ Always use `getLocalStorageItem` / `setLocalStorageItem` / `removeLocalStorageItem` from `$lib/store/utils/safe-local-storage-saga`
- ✅ Use `typeof window === "undefined"` guard for SSR safety when accessing `window` properties
- ✅ Keep storage keys as constants at the top of the file
- ❌ Never call `window.localStorage` directly in sagas — use the saga helpers
- ❌ Never put localStorage calls in components — use init/persistence sagas
- ❌ Never assume localStorage always succeeds — it can throw on quota, private browsing, or SSR

## 15. Deep-Dive References

For detailed patterns beyond this skill file, see:

- `src/lib/store/docs/REDUX_ARCHITECTURE_GUIDE.md` — Full architecture, actions, sagas, collections, performance
- `src/lib/store/docs/REDUCERS_GUIDE.md` — Reducer patterns and pitfalls
- `src/lib/store/docs/SELECTORS_GUIDE.md` — Selector creation, composition, anti-patterns
- `src/lib/store/docs/WAITFOR_SAGA_GUIDE.md` — `waitFor` utility for saga coordination
- `src/lib/store/docs/MIGRATION_GUIDE.md` — Svelte store → Redux migration checklist
- `src/lib/store/AGENTS.md` — Store-specific agent directives (serialization, collections, saga-only slices, utilities)
- `docs/STATE_MANAGEMENT.md` — Core state management policy