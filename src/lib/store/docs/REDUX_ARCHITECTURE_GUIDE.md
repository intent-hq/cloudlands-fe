# Redux Architecture Guide

> **Comprehensive guide to the Redux architecture in the Augment Chat application**

This guide documents the actual patterns, conventions, and implementations used in this codebase. It is based on analyzing all slices in `src/lib/store/slices/`.

---

## Table of Contents

1. [Actions](#actions)
   - [Dispatching Actions from Components](#dispatching-actions-from-components)
2. [Reducers](#reducers)
   - [State Serialization Rules](#state-serialization-rules)
3. [Selectors](#selectors)
4. [Collections](#collections)
5. [Sagas](#sagas)
6. [Channels](#channels)
7. [Slice Management](#slice-management)
   - [Prompt Template for Creating New Slices](#prompt-template-for-creating-new-slices)
   - [Manual Steps for Creating a New Slice](#manual-steps-for-creating-a-new-slice)
8. [Store Types](#store-types)
9. [Performance](#performance)

---

## Actions

### What is an Action?

An **action** is a plain object that describes an event or intent to change state. Actions are the only way to trigger state changes in Redux.

```typescript
type StoreAction<PL> = Action & { payload: PL };
```

### Standard Actions

Use `createAction` from `utils/create-action.ts` to create action creators:

#### Simple Action (No Payload)

```typescript
export const clearSearchResults = createAction("context/clearSearchResults");
```

#### Action with Single Argument

```typescript
export const removeConversation = createAction<[conversationId: string]>(
  "conversations/removeConversation"
);
```

#### Action with Multiple Arguments (Tuple)

```typescript
export const setCurrentConversationId = createAction<
  [string | undefined, SetCurrentConversationOptions]
>("conversations/setCurrentConversationId");
```

#### Action with Payload Modifier

```typescript
export const setItemStatus = createAction(
  "context/setItemStatus",
  (id: string, status: ContextStatus) => ({ id, status })
);
```

**Key Points:**

- Use tuple types `[arg1, arg2]` for multiple arguments
- Arguments are automatically wrapped as payload
- Use payload modifiers to transform arguments into a different payload shape
- Always namespace action types: `"sliceName/actionName"`

### Async Actions

Async actions represent operations that have three stages: request, success, and failure.

#### Creating Async Actions

```typescript
export const fetchMentionalbes = createAsyncAction<
  [string], // Arguments
  { query: string; mentionables: IChatMentionable[] } // Response type
>("context/fetch", "context/fetchMentionables");
```

#### Async Action Structure

An async action creator returns an object with:

- `type`: The action type
- `asyncActionType`: The async operation type
- `payload`: The request payload
- `promise`: A promise that resolves with the response
- `success`: Action creator for success case
- `failure`: Action creator for failure case

#### Using Async Actions in Reducers

```typescript
export const myReducer = createReducer<MyState>(initialState)
  .with(fetchItems, (state) => {
    // Handle request start
    return { ...state, isLoading: true };
  })
  .with(fetchItems.success, (state, action) => {
    // Handle success
    return {
      ...state,
      isLoading: false,
      items: action.payload.response.items,
    };
  })
  .with(fetchItems.failure, (state, action) => {
    // Handle failure
    return {
      ...state,
      isLoading: false,
      error: action.payload.error.message,
    };
  });
```

### Message Actions

For actions that kick off external work handled by sagas:

```typescript
import { createAsyncAction } from "../../utils/create-action";

// Saga performs the actual host/sidecar call
export const postHostMessage = createAsyncAction<[{ type: WebViewMessageType; data: any }]>(
  "host/post",
  "host/postHostMessage"
);

export const getSoundSettings = createAsyncAction(
  "sidecar/getSoundSettings",
  "sidecar/getSoundSettings"
);
```

### Dispatching Actions from Components

#### ✅ CORRECT: Dispatch Actions Directly

Components should dispatch actions directly using `getDispatch()`:

```typescript
// In a Svelte component
import { getDispatch } from "$lib/store/utils/svelte-context";
import {
  openCheatSheet,
  toggleCheatSheet
} from "$lib/store/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";

const dispatch = getDispatch();

// Dispatch actions directly
$effect(() => {
  dispatch(openCheatSheet("panel"));
});

const handleClick = () => {
  dispatch(toggleCheatSheet("global"));
};
```

**Why this is correct:**
- Direct and explicit - easy to understand what's happening
- No unnecessary abstractions
- Easy to trace in Redux DevTools
- Follows standard Redux patterns
- No hidden magic or indirection

#### ❌ WRONG: Never Create Wrapper Functions or Hooks

**DO NOT** create wrapper functions, hooks, or helper utilities that wrap `dispatch()` calls:

```typescript
// ❌ BAD: Don't create hooks that wrap dispatch
export const useShortcutCheatSheet = () => {
  const { store } = getContext<ReduxStoreContext>(STORE_CONTEXT);

  return {
    openPanelShortcuts: () =>
      store.dispatch(openCheatSheet("panel")),
    toggleGlobalShortcuts: () =>
      store.dispatch(toggleCheatSheet("global")),
  };
};

// ❌ BAD: Don't create wrapper functions
export const openPanelShortcuts = () => {
  const dispatch = getDispatch();
  dispatch(openCheatSheet("panel"));
};
```

**Why this is wrong:**
- Adds unnecessary indirection and complexity
- Hides what actions are being dispatched
- Makes it harder to trace actions in Redux DevTools
- Creates maintenance burden (two places to update)
- Violates Redux best practices
- Makes code harder to understand for new developers

#### The Rule

**ALWAYS dispatch actions directly. NEVER create wrappers around dispatch calls.**

If you find yourself creating a wrapper function or hook that just dispatches an action, stop and dispatch the action directly instead.

---

## Reducers

### What is a Reducer?

A **reducer** is a pure function that takes the current state and an action, and returns a new state.

```typescript
type Reducer<S> = (state: S, action: StoreAction<any>) => S;
```

**Key Characteristics:**

- Pure function (same inputs → same outputs)
- Immutable (never modifies existing state)
- Synchronous (no side effects, no async operations)
- Predictable (no non-deterministic functions like `Date.now()` or `Math.random()`)

### Creating a Reducer

Use `createReducer` from `utils/create-reducer.ts`:

```typescript
import { createReducer } from "../../utils/create-reducer";

export const contextReducer = createReducer<ContextState>(initialState)
  .with(addContextItems, (state, action) => {
    const newCollection = action.payload[0].reduce((collection, item) => {
      return addItemAt(collection, 0, item);
    }, state.collection);

    return {
      ...state,
      collection: newCollection,
    };
  })
  .with(removeContextItems, (state, action) => {
    const [conversationId, itemIds] = action.payload;
    const newCollection = itemIds.reduce((collection, itemId) => {
      return decreaseRefsCount(collection, itemId);
    }, state.collection);

    return shakeDownState({
      ...state,
      collection: newCollection,
    });
  });
```

### Reducer Best Practices

#### ✅ DO

1. **Always return a new state object**

   ```typescript
   return { ...state, field: newValue };
   ```

2. **Use collection utilities for normalized data**

   ```typescript
   return {
     ...state,
     items: addItem(state.items, newItem),
   };
   ```

3. **Return the same state reference if nothing changed**

   ```typescript
   if (state.value === action.payload) {
     return state; // Prevents unnecessary re-renders
   }
   return { ...state, value: action.payload };
   ```

4. **Use separate maps for derived state**

   ```typescript
   type State = {
     items: Collection<Item, "id">;
     pinnedItems: Record<string, boolean>; // Separate map
     activeItems: Record<string, boolean>; // Separate map
   };
   ```

5. **Use helper functions for complex logic**

   ```typescript
   const shakeDownState = (state: ContextState) => {
     // Complex cleanup logic
   };

   export const reducer = createReducer(initialState).with(action, (state, action) =>
     shakeDownState(state)
   );
   ```

6. **Keep state serializable**
   ```typescript
   // ✅ GOOD: Plain objects and primitives
   type State = {
     id: string;
     count: number;
     items: Array<{ id: string; name: string }>;
     metadata: Record<string, string>;
   };
   ```

#### ❌ DON'T

1. **Never mutate state directly**

   ```typescript
   // ❌ BAD
   state.field = action.payload;
   return state;
   ```

2. **Don't perform side effects**

   ```typescript
   // ❌ BAD
   fetch("/api/data"); // NO API calls
   localStorage.setItem("key", "value"); // NO side effects
   ```

3. **Don't use async operations**

   ```typescript
   // ❌ BAD
   .with(action, async (state, action) => {  // NO async
     const data = await fetchData();
     return { ...state, data };
   })
   ```

4. **Don't store derived data on items**

   ```typescript
   // ❌ BAD
   type Item = {
     id: string;
     isPinned: boolean; // Don't store derived state here
   };

   // ✅ GOOD
   type State = {
     items: Collection<Item, "id">;
     pins: Record<string, boolean>; // Store in separate map
   };
   ```

5. **Don't store class instances**

   ```typescript
   // ❌ BAD: Class instances break Redux patterns
   class UserModel {
     constructor(public name: string) {}
     updateName(newName: string) {
       this.name = newName; // Mutable state
     }
   }

   type State = {
     user: UserModel; // ❌ NO class instances
   };

   // ✅ GOOD: Plain objects
   type State = {
     user: {
       name: string;
     };
   };
   ```

   **Why?** Class instances:
   - Have their own state and methods to mutate it (breaks unidirectional data flow)
   - Cannot be spread with `{...state, ...updates}` properly
   - Are not serializable
   - Break time-travel debugging and persistence

6. **Don't store non-serializable values**

   ```typescript
   // ❌ BAD: Non-serializable types
   type State = {
     callback: () => void; // NO functions
     generator: Generator; // NO generators
     map: Map<string, any>; // NO Maps
     weakMap: WeakMap<object, any>; // NO WeakMaps
     set: Set<string>; // NO Sets
     weakSet: WeakSet<object>; // NO WeakSets
     date: Date; // NO Date objects
     regex: RegExp; // NO RegExp
     promise: Promise<any>; // NO Promises
     symbol: symbol; // NO Symbols
   };

   // ✅ GOOD: Serializable types only
   type State = {
     callback: undefined; // Don't store callbacks
     items: string[]; // Use arrays
     itemsMap: Record<string, any>; // Use plain objects
     timestamp: number; // Use timestamps (ms since epoch)
     pattern: string; // Store pattern as string
   };
   ```

   **Why?** Redux state must be serializable to:
   - Enable persistence (save/load state)
   - Support time-travel debugging
   - Allow state hydration
   - Enable state inspection in DevTools

7. **Don't store high-frequency changing values**

   ```typescript
   // ❌ BAD: Updates multiple times per second
   type State = {
     mouseX: number;
     mouseY: number;
     scrollPosition: number;
   };

   // ✅ GOOD: Debounce or throttle high-frequency updates
   function* handleMouseMove() {
     yield* takeLatest(mouseMove, function* (action) {
       yield* delay(100); // Debounce to ~10 updates/second
       yield* put(updateMousePosition(action.payload));
     });
   }
   ```

   **Why?** High-frequency updates:
   - Cause excessive re-renders
   - Degrade performance
   - Make debugging difficult
   - Fill up action history

### State Serialization Rules

**Critical:** Redux state must be fully serializable to JSON. This enables persistence, time-travel debugging, and state hydration.

#### Allowed Types

Only use these types in Redux state:

```typescript
type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableValue[]
  | { [key: string]: SerializableValue };

// ✅ GOOD: All serializable types
type GoodState = {
  id: string;
  count: number;
  isEnabled: boolean;
  items: Array<{ id: string; name: string }>;
  metadata: Record<string, string | number>;
  optional?: string;
  nullable: string | null;
};
```

#### Forbidden Types

**Never** use these types in Redux state:

| Type              | Why Forbidden                    | Alternative                                 |
| ----------------- | -------------------------------- | ------------------------------------------- |
| `Function`        | Not serializable                 | Store function name/ID, call from saga      |
| `Class instance`  | Has methods, breaks immutability | Use plain objects                           |
| `Date`            | Not serializable                 | Use `number` (timestamp in ms)              |
| `Map` / `WeakMap` | Not serializable                 | Use `Record<string, T>`                     |
| `Set` / `WeakSet` | Not serializable                 | Use `Array<T>` or `Record<T, true>`         |
| `RegExp`          | Not serializable                 | Store pattern as `string`                   |
| `Promise`         | Not serializable                 | Handle in sagas                             |
| `Symbol`          | Not serializable                 | Use `string` constants                      |
| `Generator`       | Not serializable                 | Use sagas                                   |
| `Error`           | Partially serializable           | Store `{ message: string; stack?: string }` |

#### Examples

```typescript
// ❌ BAD: Non-serializable state
type BadState = {
  user: UserModel; // Class instance
  onClick: () => void; // Function
  createdAt: Date; // Date object
  items: Map<string, Item>; // Map
  tags: Set<string>; // Set
  pattern: RegExp; // RegExp
  loadingPromise: Promise<Data>; // Promise
  uniqueId: symbol; // Symbol
};

// ✅ GOOD: Serializable state
type GoodState = {
  user: {
    // Plain object
    id: string;
    name: string;
  };
  // Don't store callbacks in state
  createdAt: number; // Timestamp (ms)
  items: Record<string, Item>; // Plain object
  tags: string[]; // Array
  pattern: string; // Pattern string
  isLoading: boolean; // Boolean flag
  uniqueId: string; // String ID
};
```

#### Testing Serialization

You can test if your state is serializable:

```typescript
import { describe, it, expect } from "vitest";

describe("mySliceReducer", () => {
  it("should have serializable state", () => {
    const state = mySliceReducer.initialState;

    // This will throw if state is not serializable
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);

    expect(deserialized).toEqual(state);
  });
});
```

---

## Selectors

### What are Selectors?

**Selectors** are pure functions that extract and derive data from the Redux store. They provide a clean API for accessing state and enable powerful performance optimizations.

**Key Characteristics:**

- **Pure functions**: Same input → same output
- **Read-only**: Never modify state
- **Composable**: Can call other selectors
- **Cached**: Automatically optimized with proxy-based tracking

### Creating Selectors

Use `createSelector` from `utils/create-selector.ts`:

```typescript
import { createSelector } from "../../utils/create-selector";

// Simple selector
export const selectIsContextEnabled = createSelector((state) => {
  return state.context.isContextEnabled;
});

// Selector with arguments
export const selectIsPinned = createSelector((state, id: string) => {
  return !!state.context.pinnedItems[id];
});

// Selector calling another selector
export const selectActiveFiles = createSelector((state) => {
  const files = selectFiles.select(state);
  return files.filter((f) => state.context.activeItems[f.id]);
});
```

### Using Selectors

Selectors have multiple usage modes:

#### 1. In Svelte Components (Reactive)

```typescript
// Returns a Svelte readable store
const isPinned = selectIsPinned(itemId);

// Use in template
const pinned = $isPinned;
```

#### 2. In Sagas

```typescript
function* mySaga() {
  // Use .effect() for typed saga select
  const isPinned = yield* selectIsPinned.effect(itemId);

  // Or use select() directly
  const enabled = yield* select(selectIsContextEnabled.select);
}
```

#### 3. With Specific Store

```typescript
// Bind to a specific store instance
const boundSelector = selectIsPinned.withStore(store);
const isPinned = boundSelector(itemId);
```

### Selector Caching

Selectors use **proxy-based state tracking** for intelligent caching:

1. **Tracks accessed paths**: When a selector runs, it tracks which state fields were accessed
2. **Selective re-execution**: Only re-runs when accessed fields change (reference equality)
3. **Argument tracking**: Also re-runs when arguments change (shallow equality)

```typescript
// This selector only re-runs when:
// - state.context.pinnedItems changes (reference)
// - OR the id argument changes
export const selectIsPinned = createSelector((state, id: string) => {
  return !!state.context.pinnedItems[id];
});
```

**Collection Optimization**: Stops proxying at Collection boundaries since Collections are immutable and always change reference when modified.

### Reactive Selector Locking

For batch updates, you can temporarily lock selector emissions to prevent intermediate updates:

```typescript
import { lockUpdates, unlockUpdates } from "./slices/store-utility/store-utility-slice";

yield* put(lockUpdates());
try {
  // Multiple dispatches here won't trigger selector updates
  yield* put(action1());
  yield* put(action2());
  yield* put(action3());
} finally {
  yield* put(unlockUpdates());
}
// Selectors update once updates are unlocked
```

These actions toggle `storeUtility.updatesLocked` in the store-utility slice and let sagas batch multiple dispatches before selector updates resume.

### Selector Best Practices

#### ✅ DO

1. **Keep selectors pure**

   ```typescript
   // ✅ GOOD: Pure function
   export const selectActiveItems = createSelector((state) => {
     return state.items.filter((item) => item.isActive);
   });
   ```

2. **Return new arrays/objects for filtered/mapped data**

   ```typescript
   // ✅ GOOD: Returns new array
   export const selectItemNames = createSelector((state) => {
     return state.items.map((item) => item.name);
   });
   ```

3. **Compose selectors**
   ```typescript
   // ✅ GOOD: Reuse other selectors
   export const selectActiveItemCount = createSelector((state) => {
     const activeItems = selectActiveItems.select(state);
     return activeItems.length;
   });
   ```

#### ❌ DON'T

1. **Never mutate state in selectors**

   ```typescript
   // ❌ BAD: Mutates state
   export const selectSortedItems = createSelector((state) => {
     return state.items.sort((a, b) => a.name.localeCompare(b.name));
     // Array.sort() mutates the original array!
   });

   // ✅ GOOD: Create new array first
   export const selectSortedItems = createSelector((state) => {
     return [...state.items].sort((a, b) => a.name.localeCompare(b.name));
   });
   ```

2. **Never mutate items in selectors**

   ```typescript
   // ❌ BAD: Mutates items
   export const selectItemsWithFlag = createSelector((state) => {
     return state.items.map((item) => {
       item.processed = true; // Mutates item!
       return item;
     });
   });

   // ✅ GOOD: Return new objects
   export const selectItemsWithFlag = createSelector((state) => {
     return state.items.map((item) => ({
       ...item,
       processed: true,
     }));
   });
   ```

3. **Don't perform side effects**

   ```typescript
   // ❌ BAD: Side effects
   export const selectItems = createSelector((state) => {
     console.log("Items:", state.items); // Side effect
     analytics.track("items-accessed"); // Side effect
     return state.items;
   });

   // ✅ GOOD: Pure function
   export const selectItems = createSelector((state) => {
     return state.items;
   });
   ```

**Remember:** Selectors are pure functions that only read data. They should never modify state or perform side effects.

---

## Collections

### What is a Collection?

A **Collection** is a normalized data structure for managing entities by ID. It provides O(1) lookups and maintains insertion order.

```typescript
type Collection<ITEM extends object, K extends string & keyof ITEM> = {
  idField: K;
  ids: Array<ITEM[K]>; // Ordered list of IDs
  map: Record<ITEM[K], ITEM>; // ID → Item lookup
  refsCount: Record<ITEM[K], number>; // Reference counting
};
```

### Creating Collections

```typescript
import { createCollection } from "../../utils/collection-utils";

// Empty collection
const collection = createCollection<Item, "id">("id");

// Collection with initial items
const collection = createCollection<Item, "id">("id", initialItems);
```

### Collection Operations

All operations return a new Collection (immutable):

#### Adding Items

```typescript
import { addItem, addItemAndCountRef } from "../../utils/collection-utils";

// Add item (no-op if already exists)
const newCollection = addItem(collection, item);

// Add item and increment reference count
const newCollection = addItemAndCountRef(collection, item);
```

#### Updating Items

```typescript
import { updateItem, upsertItem } from "../../utils/collection-utils";

// Update existing item (merges with existing)
const newCollection = updateItem(collection, { id: "1", name: "Updated" });

// Update if exists, add if doesn't
const newCollection = upsertItem(collection, item);
```

#### Removing Items

```typescript
import { removeItem, decreaseRefsCount } from "../../utils/collection-utils";

// Remove item completely
const newCollection = removeItem(collection, itemId);

// Decrement ref count (removes when count reaches 0)
const newCollection = decreaseRefsCount(collection, itemId);
```

#### Querying Items

```typescript
import { getItem, getItems, filterItems } from "../../utils/collection-utils";

// Get single item
const item = getItem(collection, itemId);

// Get all items (in order)
const items = getItems(collection);

// Filter items
const filtered = filterItems(collection, (item): item is SpecificType => isSpecificType(item));
```

#### Reference Counting

```typescript
import { increaseRefsCount, getRefsCount } from "../../utils/collection-utils";

// Increment reference count
const newCollection = increaseRefsCount(collection, itemId);

// Get reference count
const count = getRefsCount(collection, itemId);
```

### When to Use Collections

Use Collections when you need:

- **Fast lookups by ID**: O(1) access to items
- **Ordered data**: Maintain insertion/custom order
- **Reference counting**: Track how many places reference an item
- **Normalized state**: Avoid data duplication

**Example from context-slice.ts:**

```typescript
type ContextState = {
  collection: Collection<IChatMentionable, "id">;
  pinnedItems: Record<string, boolean>; // Separate map for pins
  activeItems: Record<string, boolean>; // Separate map for status
};
```

---

## Sagas

### What are Sagas?

**Sagas** are long-running background processes that handle side effects, async operations, and complex business logic. They listen for actions and can dispatch new actions.

This codebase uses `typed-redux-saga` for type-safe saga effects.

### Why Sagas?

Sagas are preferred for:

- **Side effects**: API calls, localStorage, analytics
- **Async operations**: Waiting for responses, delays
- **Complex workflows**: Multi-step processes, coordination
- **Action orchestration**: Listening to actions and dispatching others
- **Separation of concerns**: Keep reducers pure and simple

Sagas should also own shared/domain side-effect orchestration that might otherwise drift into service or lifecycle files. Keep those files as thin adapters that translate IPC, stream, or browser events into typed Redux actions. Redux selectors, reducers, pure utilities, and sagas should own state reads, target lookup policy, refresh/reconcile workflows, retries, debouncing, rate limiting, persistence calls, and follow-up dispatches.

### Creating a Saga

```typescript
import { call, put, select, takeEvery, takeLatest } from "typed-redux-saga";

function* mySaga() {
  // Listen for actions and handle them
  yield* takeEvery(myAction, handleMyAction);
  yield* takeLatest(anotherAction, handleAnotherAction);
}

function* handleMyAction(action: ReturnType<typeof myAction>) {
  // Get data from store
  const data = yield* select(mySelector.select);

  // Call async function
  const result = yield* call(fetchData, action.payload);

  // Dispatch new action
  yield* put(updateData(result));
}
```

### Saga Effects

#### `takeEvery` - Handle Every Action

```typescript
// Spawns a new task for each action
yield *
  takeEvery(fetchItems, function* (action) {
    const items = yield* call(api.fetchItems, action.payload);
    yield* put(setItems(items));
  });
```

**Note:** Action creators can be passed directly to `takeEvery`, `takeLatest`, `takeLeading`, and `take`. You don't need to use `.type`:

```typescript
// ✅ GOOD: Pass action creator directly
yield* takeEvery(myAction, handleMyAction);

// ❌ BAD: Don't use .type
yield* takeEvery(myAction.type, handleMyAction);
```

#### `takeLatest` - Cancel Previous, Handle Latest

```typescript
// Cancels previous task if still running
yield *
  takeLatest(searchQuery, function* (action) {
    yield* delay(300); // Debounce
    const results = yield* call(api.search, action.payload);
    yield* put(setResults(results));
  });
```

#### `takeLeading` - Block Until Complete

```typescript
// Ignores new actions while task is running
yield *
  takeLeading(refreshData, function* () {
    yield* put(fetchData());
    yield* delay(5000); // Minimum 5s between refreshes
  });
```

#### `select` - Read from Store

```typescript
// ✅ PREFERRED: Use selector's .effect() method (typed, cached)
const value = yield* mySelector.effect();

// ✅ Also good: Use selector's .select method
const value = yield* select(mySelector.select);

// ❌ BAD: Never use inline lambdas in sagas
// They bypass caching, lose type safety, and aren't reusable
// const value = yield* select((state) => state.mySlice.value);
```

#### `put` - Dispatch Action

```typescript
// Dispatch action
yield * put(myAction(payload));

// Dispatch async action
const response = yield * put(myAsyncAction(payload));
```

#### `call` - Call Function

```typescript
// Call function with args
const result = yield * call(myFunction, arg1, arg2);

// Call method
const result = yield * call([object, object.method], arg);
```

#### `fork` - Start Non-Blocking Task

```typescript
// Start task in background
const task = yield * fork(backgroundTask);

// Cancel it later
yield * cancel(task);
```

#### `spawn` - Start Detached Task

```typescript
// Start task that won't be cancelled when parent is cancelled
yield * spawn(independentTask);
```

#### `delay` - Wait

```typescript
// Wait 1 second
yield * delay(1000);
```

#### `race` - First to Complete Wins

```typescript
const { response, timeout } =
  yield *
  race({
    response: call(api.fetch),
    timeout: delay(5000),
  });

if (timeout) {
  // Handle timeout
}
```

#### `all` - Wait for All

```typescript
const [result1, result2] = yield * all([call(api.fetch1), call(api.fetch2)]);
```

### Saga Patterns from Codebase

#### Pattern 1: Fetch and Update

```typescript
function* fetchAndUpdate() {
  yield* takeLatest(fetchItems, function* (action) {
    try {
      const items = yield* call(api.fetchItems, action.payload);
      yield* put(fetchItems.success({ items }));
    } catch (error) {
      yield* put(fetchItems.failure({ error }));
    }
  });
}
```

#### Pattern 2: Coordinate Multiple Actions

```typescript
function* coordinateActions() {
  yield* takeEvery(startProcess, function* (action) {
    // Step 1
    yield* put(step1Action());

    // Wait for step 1 to complete
    yield* take(step1Complete);

    // Step 2
    yield* put(step2Action());
  });
}
```

#### Pattern 3: Polling

```typescript
function* polling() {
  while (true) {
    yield* put(fetchData());
    yield* delay(5000); // Poll every 5 seconds
  }
}
```

#### Pattern 4: Debouncing

```typescript
function* debounceSearch() {
  yield* takeLatest(searchQuery, function* (action) {
    yield* delay(300); // Wait 300ms
    const results = yield* call(api.search, action.payload);
    yield* put(setResults(results));
  });
}
```

### Registering Sagas

Add your saga to `sagas.ts`:

```typescript
export const sagas = {
  context: contextSaga,
  mySaga: mySaga,
} as const;
```

### Starting Sagas

Sagas are started using the `<RunSaga>` component:

```svelte
<script>
  import RunSaga from "$lib/store/components/RunSaga.svelte";
</script>

<RunSaga sagaName="context" />
<RunSaga sagaName="mySaga" />
```

### Saga Context

Sagas have access to a special context:

```typescript
type SagaContext = {
  readableStoreState: Readable<StoreState>;
};
```

### Saga Rules
- **Always use selector functions** — Never use `yield* select((state) => ...)` inline lambdas. Create a selector in the selectors file and use `.effect()` or `.select`.

---

## Channels

### What are Channels?

**Channels** are a way to create event streams from selectors. They emit values when the selector result changes.

### Reacting to Selector Changes in Sagas

#### Selector Channel Effects (Recommended)

The preferred way to react to selector changes is using the selector channel effects. These handle channel creation and cleanup automatically, preventing memory leaks:

```typescript
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  takeLeadingFromSelector,
} from "../../utils/selector-channel-effects";

// takeLatestFromSelector - Cancel previous worker when new value arrives (most common)
function* watchCurrentConversation() {
  yield* takeLatestFromSelector(selectCurrentConversationId, function* ({ payload, prevPayload }) {
    if (payload) {
      yield* put(loadConversationData(payload));
    }
  });
}

// takeEveryFromSelector - Spawn new worker for each change
function* watchAllChanges() {
  yield* takeEveryFromSelector(selectSomeValue, function* ({ payload }) {
    yield* call(handleChange, payload);
  });
}

// takeLeadingFromSelector - Ignore new values while worker is running
function* watchWithThrottle() {
  yield* takeLeadingFromSelector(selectSomeValue, function* ({ payload }) {
    yield* call(expensiveOperation, payload);
  });
}

// With selector arguments - pass args as second parameter
function* watchConversation(conversationId: string) {
  yield* takeLatestFromSelector(selectConversation, [conversationId], function* ({ payload }) {
    // Handle conversation changes
  });
}
```

#### createChannelFromSelector (For Complex Patterns)

For patterns that don't fit `takeEvery`/`takeLatest`/`takeLeading` (e.g., conditional loops, races, timeouts), use `createChannelFromSelector`. **Important:** Always close channels in a `finally` block:

```typescript
import { createChannelFromSelector } from "../../utils/selector-channel-effects";
import { take } from "typed-redux-saga";

function* watchSelectorChanges() {
  // Create channel from selector
  const channel = yield* createChannelFromSelector(mySelector);

  // Always use try/finally to ensure channel cleanup
  try {
    while (true) {
      // Wait for selector to emit new value
      const { payload: value } = yield* take(channel);

      // Handle the change
      yield* put(handleChange(value));
    }
  } finally {
    // Close channel when saga exits (completion, cancellation, or error)
    channel.close();
  }
}

// With selector arguments
function* watchWithArgs(conversationId: string, requestId: string) {
  const channel = yield* createChannelFromSelector(selectSomething, conversationId, requestId);
  try {
    // Complex pattern: race with action
    const { channelEvent, cancelled } = yield* race({
      channelEvent: take(channel),
      cancelled: take(cancelAction),
    });
    // ...
  } finally {
    channel.close();
  }
}
```

---

## Slice Management

### Prompt Template for Creating New Slices

Use this prompt template when asking AI to create a new Redux slice. Replace the placeholders with your specific requirements.

---

#### **Prompt Template**

```
Create a new Redux slice for [FEATURE_NAME] in the chat application.

**Slice Name:** [SLICE_NAME] (e.g., "notifications", "userPreferences", "fileExplorer")

**Location:** src/lib/store/slices/[SLICE_NAME]/

**State Structure:**
[Describe the state shape, e.g.:
- items: Collection of [ITEM_TYPE] with ID field "[ID_FIELD]"
- isLoading: boolean
- error: string | null
- [OTHER_STATE_FIELDS]
]

**Actions Needed:**
[List the actions, e.g.:
- [ACTION_NAME_1]: [description] - takes [parameters]
- [ACTION_NAME_2]: [description] - takes [parameters]
- [ASYNC_ACTION_NAME]: async action that [description]
]

**Selectors Needed:**
[List the selectors, e.g.:
- select[SELECTOR_NAME_1]: returns [what it returns]
- select[SELECTOR_NAME_2]: returns [what it returns] - takes [parameters]
]

**Sagas Needed:**
[List the saga behaviors, e.g.:
- Handle [ACTION_NAME] by [what it does]
- Listen for [ACTION_NAME] and [side effect]
- Poll [DATA_SOURCE] every [INTERVAL]
]

**Requirements:**
- Follow the Redux architecture patterns from REDUX_ARCHITECTURE_GUIDE.md
- Use Collections for normalized data if storing entities by ID
- Keep state serializable (no class instances, functions, etc.)
- Use separate maps for derived state (pins, statuses, etc.)
- Create comprehensive tests for reducers and sagas
- Use typed-redux-saga for all saga effects
- Follow the existing naming conventions and file structure

**Additional Context:**
[Any additional requirements, constraints, or context]
```

---

#### **How to Use This Prompt**

1. **Copy the template** above
2. **Replace all placeholders** in [BRACKETS]:
   - `[FEATURE_NAME]`: Human-readable feature name (e.g., "notification management")
   - `[SLICE_NAME]`: Kebab-case slice name (e.g., "notifications")
   - `[ITEM_TYPE]`: Type of items if using Collections (e.g., "Notification")
   - `[ID_FIELD]`: ID field name (usually "id")
   - `[ACTION_NAME]`: Action names in camelCase (e.g., "addNotification")
   - `[SELECTOR_NAME]`: Selector names in PascalCase (e.g., "UnreadCount")
   - `[PARAMETERS]`: Parameter descriptions
   - `[OTHER_STATE_FIELDS]`: Any additional state fields

3. **Fill in each section** with your specific requirements
4. **Provide the prompt** to the AI assistant
5. **Review the generated code** to ensure it follows the patterns in this guide

---

#### **Example: Creating a Notifications Slice**

```
Create a new Redux slice for notification management in the chat application.

**Slice Name:** notifications

**Location:** src/lib/store/slices/notifications/

**State Structure:**
- notifications: Collection of Notification with ID field "id"
- unreadCount: number
- isEnabled: boolean
- mutedChannels: Record<string, boolean>

**Actions Needed:**
- addNotification: Add a new notification - takes (id: string, message: string, type: NotificationType)
- markAsRead: Mark notification as read - takes (id: string)
- clearAll: Clear all notifications - no parameters
- fetchNotifications: async action that fetches notifications from the server
- toggleMuteChannel: Toggle mute status for a channel - takes (channelId: string)

**Selectors Needed:**
- selectNotifications: returns all notifications as array
- selectUnreadCount: returns number of unread notifications
- selectIsChannelMuted: returns whether a channel is muted - takes (channelId: string)
- selectNotificationById: returns a specific notification - takes (id: string)

**Sagas Needed:**
- Handle fetchNotifications by calling the API and dispatching success/failure
- Handle addNotification by playing a sound if notifications are enabled
- Listen for markAsRead and update unread count
- Poll for new notifications every 30 seconds when enabled

**Requirements:**
- Follow the Redux architecture patterns from REDUX_ARCHITECTURE_GUIDE.md
- Use Collections for normalized data if storing entities by ID
- Keep state serializable (no class instances, functions, etc.)
- Use separate maps for derived state (pins, statuses, etc.)
- Create comprehensive tests for reducers and sagas
- Use typed-redux-saga for all saga effects
- Follow the existing naming conventions and file structure

**Additional Context:**
- Notifications should be stored in a Collection for fast lookups
- Use separate map for muted channels instead of storing on notification items
- Sound playing should be handled in saga, not reducer
```

---

### Manual Steps for Creating a New Slice

If you prefer to create the slice manually, follow these steps:

#### 1. Create Slice Directory

```
slices/
  my-slice/
    my-slice.ts          # State, actions, reducer
    my-selectors.ts # Selectors
    my-slice.test.ts     # Reducer tests
    sagas/
      saga.ts         # Saga logic
      saga.test.ts    # Saga tests
```

#### 2. Define State and Actions

```typescript
// my-slice.ts
import { createAction, createAsyncAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// State
export type MySliceState = {
  items: string[];
  isLoading: boolean;
};

const initialState: MySliceState = {
  items: [],
  isLoading: false,
};

// Actions
export const addItem = createAction<[item: string]>("mySlice/addItem");
export const fetchItems = createAsyncAction<[], { items: string[] }>(
  "mySlice/fetch",
  "mySlice/fetchItems"
);

// Reducer
export const mySliceReducer = createReducer(initialState)
  .with(addItem, (state, { payload: [item] }) => ({
    ...state,
    items: [...state.items, item],
  }))
  .with(fetchItems, (state) => ({
    ...state,
    isLoading: true,
  }))
  .with(fetchItems.success, (state, action) => ({
    ...state,
    isLoading: false,
    items: action.payload.response.items,
  }));
```

#### 3. Create Selectors

```typescript
// my-selectors.ts
import { createSelector } from "../../utils/create-selector";

export const selectItems = createSelector((state) => state.mySlice.items);

export const selectIsLoading = createSelector((state) => state.mySlice.isLoading);

export const selectItemCount = createSelector((state) => {
  return selectItems.select(state).length;
});
```

#### 4. Create Saga

```typescript
// sagas/saga.ts
import { call, put, takeEvery } from "typed-redux-saga";
import { fetchItems } from "../my-slice";

function* handleFetchItems() {
  const items = yield* call(api.fetchItems);
  yield* put(fetchItems.success({ items }));
}

export function* mySaga() {
  yield* takeEvery(fetchItems, handleFetchItems);
}
```

#### 5. Register Reducer

```typescript
// reducer.ts
import { mySliceReducer } from "./slices/my-slice/my-slice";

export const reducers = {
  // ... other reducers
  mySlice: mySliceReducer,
} as const;
```

#### 6. Register Saga

```typescript
// sagas.ts
export const sagas = {
  // ... other sagas
  mySaga: mySaga,
} as const;
```

### Testing Slices

#### Testing Reducers

Reducers are pure functions, so tests are straightforward:

```typescript
import { describe, it, expect } from "vitest";
import { mySliceReducer, addItem } from "./my-slice";

describe("mySliceReducer", () => {
  it("should add item to state", () => {
    const initialState = mySliceReducer.initialState;
    const newState = mySliceReducer(initialState, addItem("test"));

    expect(newState.items).toEqual(["test"]);
    expect(newState).not.toBe(initialState); // Immutability check
  });
});
```

#### Testing Sagas

Use `redux-saga-test-plan` for saga tests:

```typescript
import { describe, it, expect } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { mySaga } from "./my-saga";
import { fetchItems } from "../my-slice";

describe("mySaga", () => {
  it("should fetch items and dispatch success", async () => {
    const mockItems = ["item1", "item2"];

    await expectSaga(mySaga)
      .provide([[matchers.call.fn(api.fetchItems), mockItems]])
      .put(fetchItems.success({ items: mockItems }))
      .dispatch(fetchItems())
      .silentRun(100);
  });

  it("should have correct state after action", async () => {
    await expectSaga(mySaga)
      .withState({ mySlice: { items: [], isLoading: false } })
      .put.like({
        action: {
          type: fetchItems.success.type,
          payload: { response: { items: ["test"] } },
        },
      })
      .dispatch(fetchItems.success({ items: ["test"] }))
      .silentRun(100);
  });
});
```

**Key Testing Patterns:**

- Use `.put()` to assert actions are dispatched
- Use `.put.like()` for partial matching
- Use `.provide()` to mock `call` effects
- Use `.withState()` to set initial state
- Use `.dispatch()` to trigger actions
- Use `.silentRun(timeout)` to run saga with timeout

---

## Store Types

### Core Types

#### `StoreState`

The root state type, derived from all reducers:

```typescript
type StoreState = {
  context: ContextState;
  conversations: ConversationsState;
  // ... all other slices
};
```

#### `StoreAction<PL>`

Action with typed payload:

```typescript
type StoreAction<PL> = Action & { payload: PL };
```

#### `StoreActionCreator<ARGS, PL>`

Action creator function:

```typescript
type StoreActionCreator<ARGS extends any[], PL> = {
  (...args: ARGS): StoreAction<PL>;
  type: string;
  toString(): string;
};
```

#### `StoreAsyncAction<PL, R>`

Async action with promise:

```typescript
type StoreAsyncAction<PL, R> = StoreAction<PL> & {
  asyncActionType: string;
  promise: Promise<R>;
};
```

#### `StoreAsyncActionCreator<ARGS, PL, R>`

Async action creator with success/failure:

```typescript
type StoreAsyncActionCreator<ARGS extends any[], PL, R> = {
  (...args: ARGS): StoreAsyncAction<PL, R>;
  success: StoreActionCreator<[response: R], { response: R }>;
  failure: StoreActionCreator<[error: Error], { error: Error }>;
  type: string;
  asyncActionType: string;
};
```

#### `StoreSelector<R, ARGS>`

Selector with multiple usage modes:

```typescript
type StoreSelector<R, ARGS extends any[]> = {
  (...args: ReadableArgs<ARGS>): Readable<R>; // Default: Svelte store
  select: (state: StoreState, ...args: ARGS) => R; // Direct access
  effect: (...args: ARGS) => SagaGenerator<R, SelectEffect>; // For sagas
  withStore: (store: ReduxStore) => (...args: ReadableArgs<ARGS>) => Readable<R>;
};
```

### Context Types

#### `SagaContext`

Context available to sagas:

```typescript
type SagaContext = {
  readableStoreState: Readable<StoreState>;
};
```

#### `ReduxStoreContext`

Context for components:

```typescript
type ReduxStoreContext = {
  store: ReduxStore;
  storeState: Readable<StoreState>;
  runSaga: <S extends Saga>(saga: S, ...args: Parameters<S>) => Task;
  dispose: () => void;
  tasks?: {
    running: SagaName[];
    notRunning: SagaName[];
  };
};
```

---

## Performance

### Overview

Performance in Redux is achieved through:

1. **Selector optimization** (proxy-based caching)
2. **Normalization** (Collections)
3. **Batching** (action batching middleware)
4. **Immutability** (reference equality checks)
5. **Memoization** (selector composition)

### 1. Selector Optimization

#### Proxy-Based State Tracking

Selectors automatically track which state paths are accessed and only re-run when those paths change:

```typescript
// Only re-runs when state.context.pinnedItems reference changes
export const selectPinnedCount = createSelector((state) => {
  return Object.keys(state.context.pinnedItems).length;
});
```

**How it works:**

1. Selector runs with a Proxy-wrapped state
2. Proxy records all property accesses
3. On next state change, checks if any accessed paths changed (reference equality)
4. Only re-runs if accessed paths changed OR arguments changed

**Benefits:**

- No manual dependency tracking
- Automatic optimization
- Works with nested state access

#### Selector Composition

Compose selectors to reuse computations:

```typescript
// Base selector (cached)
export const selectItems = createSelector((state) => state.items);

// Derived selector (only re-runs when selectItems result changes)
export const selectActiveItems = createSelector((state) => {
  const items = selectItems.select(state);
  return items.filter((item) => item.isActive);
});
```

#### Return Same Reference When Possible

```typescript
// ✅ GOOD: Returns same array reference if no changes
export const selectFilteredItems = createSelector((state, filter: string) => {
  const items = selectItems.select(state);

  if (!filter) {
    return items; // Same reference
  }

  return items.filter((item) => item.name.includes(filter));
});
```

### 2. Normalization with Collections

Store data in normalized form to avoid duplication and enable O(1) lookups:

```typescript
// ✅ GOOD: Normalized
type State = {
  items: Collection<Item, "id">;
  selectedIds: string[];
};

// ❌ BAD: Denormalized
type State = {
  items: Item[];
  selectedItems: Item[]; // Duplicated data
};
```

**Benefits:**

- Single source of truth
- Fast lookups by ID
- Efficient updates (only change one place)
- Smaller state size

### 3. Action Batching

**Manual Batching for Selector Updates:**

```typescript
import { lockUpdates, unlockUpdates } from "./slices/store-utility/store-utility-slice";

yield* put(lockUpdates());
try {
  yield* put(action1());
  yield* put(action2());
  yield* put(action3());
} finally {
  yield* put(unlockUpdates());
}
// Reactive selectors update once updates are unlocked
```

### 4. Immutability and Reference Equality

Redux relies on reference equality for change detection:

```typescript
// ✅ GOOD: New reference when changed
if (state.value !== newValue) {
  return { ...state, value: newValue };
}
return state; // Same reference when unchanged

// ❌ BAD: Always new reference
return { ...state }; // Triggers re-renders even if nothing changed
```

**Collection Optimization:**
Collections always return new references when modified, so proxy tracking stops at Collection boundaries:

```typescript
// Proxy stops at collection, doesn't wrap items
const items = state.context.collection; // Tracked
const item = items.map["id"]; // Not tracked (optimization)
```

### 5. Separate Maps Pattern

Store derived state in separate maps instead of modifying items:

```typescript
// ✅ GOOD: Separate maps
type State = {
  items: Collection<Item, "id">;
  pins: Record<string, boolean>;
  statuses: Record<string, Status>;
};

// Updating pin doesn't change items collection
return {
  ...state,
  pins: { ...state.pins, [id]: true },
};

// ❌ BAD: Modifying items
type State = {
  items: Collection<ItemWithStatus, "id">;
};

// Updating status changes entire collection
return {
  ...state,
  items: updateItem(state.items, { id, status: "active" }),
};
```

**Benefits:**

- Smaller state updates
- Fewer selector re-runs
- Better performance for frequent updates

### 6. Avoid Expensive Computations in Selectors

Move expensive computations to sagas or memoize them:

```typescript
// ❌ BAD: Expensive computation on every selector run
export const selectProcessedItems = createSelector((state) => {
  return state.items.map((item) => expensiveTransform(item));
});

// ✅ GOOD: Compute once in saga, store result
function* processItems() {
  const items = yield* select(selectItems.select);
  const processed = items.map(expensiveTransform);
  yield* put(setProcessedItems(processed));
}
```

### 7. Use Filters Instead of Derived Collections

```typescript
// ✅ GOOD: Filter on read
export const selectActiveItems = createSelector((state) => {
  return filterItems(state.items, (item) => item.isActive);
});

// ❌ BAD: Maintain separate collection
type State = {
  allItems: Collection<Item, "id">;
  activeItems: Collection<Item, "id">; // Duplicated data
};
```

### Performance Checklist

- [ ] Use Collections for normalized data
- [ ] Compose selectors to reuse computations
- [ ] Return same reference when state hasn't changed
- [ ] Use separate maps for derived state
- [ ] Avoid expensive computations in selectors
- [ ] Use batching for rapid dispatches
- [ ] Keep reducers simple and fast
- [ ] Move complex logic to sagas
- [ ] Test selector performance with large datasets
- [ ] Use reactive selector locking for batch updates

---

## Additional Resources

- **REDUCERS_GUIDE.md**: Detailed guide on reducer patterns
- **Existing slices**: Study `context-slice.ts`, `conversations-slice.ts` for patterns
- **Saga examples**: Check `slices/*/sagas/` directories for real-world examples
- **Tests**: Look at `*.test.ts` files for testing patterns

---

## Summary

This Redux architecture provides:

- **Type safety**: Full TypeScript support with typed-redux-saga
- **Performance**: Intelligent caching, normalization, batching
- **Maintainability**: Clear patterns, separation of concerns
- **Testability**: Pure functions, saga test utilities
- **Developer experience**: Great IDE support, debugging tools

Follow the patterns in this guide to maintain consistency and quality across the codebase.
