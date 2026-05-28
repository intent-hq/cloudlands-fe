# Redux Reducers Guide

## Table of Contents
1. [What is a Reducer?](#what-is-a-reducer)
2. [How to Create a Reducer](#how-to-create-a-reducer)
3. [Reducer Patterns](#reducer-patterns)
4. [Do's and Don'ts](#dos-and-donts)
5. [Best Practices](#best-practices)
6. [Common Pitfalls](#common-pitfalls)
7. [Testing Reducers](#testing-reducers)

---

## What is a Reducer?

A **reducer** is a pure function that takes the current state and an action, and returns a new state. In our Redux architecture:

```typescript
type Reducer<S> = (state: S, action: StoreAction<any>) => S
```

### Key Characteristics:
- **Pure Function**: Same inputs always produce the same output
- **Immutable**: Never modifies the existing state; always returns a new state object
- **Predictable**: No side effects, no async operations, no API calls
- **Synchronous**: All state updates happen immediately

### In Our App:
We use a custom `createReducer` utility that provides a fluent API for registering action handlers:

```typescript
export const myReducer = createReducer<MyState>(initialState)
  .with(actionOne, (state, { payload: [value] }) => {
    return { ...state, field: value };
  })
  .with(actionTwo, (state, { payload: [value] }) => {
    return { ...state, anotherField: value };
  });
```

---

## How to Create a Reducer

### Step 1: Define Your State Type

```typescript
export type MyFeatureState = {
  items: Collection<Item, "id">;
  isLoading: boolean;
  error: string | undefined;
};
```

### Step 2: Create Actions

```typescript
import { createAction, createAsyncAction } from "../../utils/create-action";

export const addItem = createAction<[item: Item]>("myFeature/addItem");
export const removeItem = createAction<[id: string]>("myFeature/removeItem");

// fetchItems is an 'async' action
export const fetchItems = createAsyncAction<void, FetchResponse>(
  "myFeature/fetch",
  "myFeature/fetchItems"
);
```

### Step 3: Define Initial State

```typescript
const initialState: MyFeatureState = {
  items: createCollection<Item, "id">("id"),
  isLoading: false,
  error: undefined,
};
```

### Step 4: Create the Reducer

```typescript
import { createReducer } from "../../utils/create-reducer";

export const myFeatureReducer = createReducer<MyFeatureState>(initialState)
  .with(addItem, (state, { payload: [item] }) => {
    return {
      ...state,
      items: addItem(state.items, item),
    };
  })
  .with(removeItem, (state, { payload: [id] }) => {
    return {
      ...state,
      items: removeItem(state.items, id),
    };
  })
  .with(fetchItems, (state) => {
    return {
      ...state,
      isLoading: true,
      error: undefined,
    };
  })
  .with(fetchItems.success, (state, action) => {
    return {
      ...state,
      isLoading: false,
      items: action.payload.response.items,
    };
  })
  .with(fetchItems.failure, (state, action) => {
    return {
      ...state,
      isLoading: false,
      error: action.payload.error.message,
    };
  });
```

### Step 5: Register in Root Reducer

Add your reducer to `src/lib/store/reducer.ts`:

```typescript
import { myFeatureReducer } from "./slices/my-feature/my-feature-slice";

export const reducers = {
  // ... existing reducers
  myFeature: myFeatureReducer,
} as const;
```

### Step 6: Create Selectors (Optional but Recommended)

Create a separate file `my-feature-selectors.ts`:

```typescript
import { createSelector } from "../../utils/create-selector";

export const selectMyFeatureItems = createSelector((state) => {
  return state.myFeature.items.ids.map((id) => state.myFeature.items.map[id]);
});

export const selectIsLoading = createSelector((state) => {
  return state.myFeature.isLoading;
});

export const selectItemById = createSelector((state, id: string) => {
  return getItem(state.myFeature.items, id);
});
```

---

## Reducer Patterns

### Pattern 1: Simple State Update

```typescript
export const setVisibleApp = createAction<[MainPanelApp | undefined]>("setVisibleApp");

export const mainPanelReducer = createReducer<MainPanelAppState>(initialState)
  .with(setVisibleApp, (state, action) => {
    return { ...state, visibleApp: action.payload[0] };
  });
```

### Pattern 2: Collection Management

Use the `collection-utils` for managing normalized data:

```typescript
import {
  createCollection,
  addItem,
  updateItem,
  removeItem,
  getItem,
} from "../../utils/collection-utils";

export const conversationsReducer = createReducer<ConversationsState>(initialState)
  .with(addConversation, (state, { payload: [conversation] }) => {
    return {
      ...state,
      collection: addItem(state.collection, conversation),
    };
  })
  .with(updateConversation, (state, { payload: [conversation] }) => {
    return {
      ...state,
      collection: updateItem(state.collection, conversation),
    };
  })
  .with(removeConversation, (state, { payload: [conversationId] }) => {
    return {
      ...state,
      collection: removeItem(state.collection, conversationId),
    };
  });
```

### Pattern 3: Reference Counting

For items that can be added/removed multiple times:

```typescript
import { addItemAndCountRef, decreaseRefsCount } from "../../utils/collection-utils";

export const contextReducer = createReducer<ContextState>(initialState)
  .with(addContextItems, (state, action) => {
    const newCollection = action.payload[0].reduce((collection, item) => {
      return addItemAt(collection, 0, item);
    }, state.collection);

    return { ...state, collection: newCollection };
  })
  .with(removeContextItems, (state, action) => {
    const [conversationId, itemIds] = action.payload;
    const newCollection = itemIds.reduce((collection, itemId) => {
      return decreaseRefsCount(collection, itemId);
    }, state.collection);

    return { ...state, collection: newCollection };
  });
```

### Pattern 4: Async Action Handling

```typescript
export const fetchMemories = createSidecarAsyncMessageAction<
  [state: MemoryState],
  GetMemoriesByStateMessage,
  GetMemoriesByStateResponse
>("memory/fetch-memories", (state) => { /* ... */ });

export const memoryReducer = createReducer<MemoriesState>(initialState)
  .with(fetchMemories, (state) => {
    return { ...state, isLoading: true };
  })
  .with(fetchMemories.success, (state, action) => {
    const newMemories = action.payload.response.data.memories;
    return {
      ...state,
      isLoading: false,
      memories: newMemories.reduce((col, memory) => addItem(col, memory), state.memories),
    };
  })
  .with(fetchMemories.failure, (state) => {
    return { ...state, isLoading: false };
  });
```

### Pattern 5: Separate Maps for Derived State

Separate maps allow to provide additional properties to
objects that would benefit from staying unmodified. For example: a list of mentionables returned from sidecar, it is better not to modify them to avoid typing issues and more robust caching.

```typescript
export type ContextState = {
  collection: Collection<IChatMentionable, "id">;
  pinnedItems: Record<string, boolean>;    // Separate map for pinned status
  activeItems: Record<string, boolean>;    // Separate map for active status
  warnings: Record<string, boolean>;       // Separate map for warnings
};

export const contextReducer = createReducer<ContextState>(initialState)
  .with(pinItem, (state, { payload: [conversationId, id] }) => {
    return {
      ...state,
      collection: increaseRefsCount(state.collection, id),
      pinnedItems: {
        ...state.pinnedItems,
        [id]: true,
      },
    };
  });
```

### Pattern 6: Helper Reducer Functions

Extract complex logic into helper functions:

```typescript
const cleanUpMap = <T extends Record<string, any>>(
  map: T,
  collection: Collection<any, any>
): T => {
  const newMap = collection.ids.reduce((acc, id) => {
    if (map[id]) {
      acc[id] = map[id];
    }
    return acc;
  }, {});

  return shallowEqual(map, newMap) ? map : newMap;
};

const shakeDownState = (state: ContextState) => {
  const newPinnedItems = cleanUpMap(state.pinnedItems, state.collection);
  const newActiveItems = cleanUpMap(state.activeItems, state.collection);

  return {
    ...state,
    pinnedItems: newPinnedItems,
    activeItems: newActiveItems,
  };
};

export const contextReducer = createReducer<ContextState>(initialState)
  .with(removeContextItems, (state, action) => {
    const [conversationId, itemIds] = action.payload;
    const newCollection = itemIds.reduce((coll, id) => {
      return decreaseRefsCount(coll, id);
    }, state.collection);

    return shakeDownState({ ...state, collection: newCollection });
  });
```

---

## Do's and Don'ts

### ✅ DO

1. **Always return a new state object**
   ```typescript
   return { ...state, field: newValue };
   ```

2. **Use immutable update patterns**
   ```typescript
   return {
     ...state,
     nested: {
       ...state.nested,
       field: newValue,
     },
   };
   ```

3. **Use collection utilities for normalized data**
   ```typescript
   return {
     ...state,
     items: addItem(state.items, newItem),
   };
   ```

4. **Keep reducers pure and synchronous**
   ```typescript
   .with(action, (state, { payload: [value] }) => {
     // Only synchronous state transformations
     return { ...state, value };
   })
   ```

5. **Use separate maps for derived/computed state**
   ```typescript
   type State = {
     items: Collection<Item, "id">;
     selectedIds: Record<string, boolean>;  // Separate map
   };
   ```

6. **Return the same state reference if nothing changed**
   ```typescript
   .with(updateItem, (state, { payload: [value] }) => {
     if (state.value === value) {
       return state;  // No change, return same reference
     }
     return { ...state, value };
   })
   ```

7. **Use helper functions for complex logic**
   ```typescript
   const updateItemsReducer = (state: State, items: Item[]) => {
     // Complex logic here
   };

   export const reducer = createReducer(initialState)
     .with(updateItems, (state, { payload: [items] }) => updateItemsReducer(state, items));
   ```

### ❌ DON'T

1. **Never mutate state directly**
   ```typescript
   // ❌ BAD
   .with(action, (state, { payload: [value] }) => {
     state.field = value;  // NEVER DO THIS
     return state;
   })
   ```

2. **Don't modify items in collections directly**
   ```typescript
   // ❌ BAD
   .with(action, (state, { payload: [id] }) => {
     const item = getItem(state.collection, id);
     item.status = "active";  // NEVER mutate items
     return state;
   })

   // ✅ GOOD
   .with(action, (state, { payload: [id] }) => {
     return {
       ...state,
       statusMap: updateItems(state.collection, {
        id,
        status: 'active',
       }),
     };
   })
   ```

3. **Don't perform side effects**
   ```typescript
   // ❌ BAD
   .with(action, (state, action) => {
     fetch("/api/data");  // NO API calls
     localStorage.setItem("key", "value");  // NO side effects
     console.log("Action received");  // Avoid logging (use middleware)
     return state;
   })
   ```

4. **Don't use async operations**
   ```typescript
   // ❌ BAD
   .with(action, async (state, action) => {  // NO async
     const data = await fetchData();
     return { ...state, data };
   })
   ```

5. **Don't store derived data on items**
   ```typescript
   // ❌ BAD
   type Item = {
     id: string;
     isPinned: boolean;  // Don't store derived state here
   };

   // ✅ GOOD
   type State = {
     items: Collection<Item, "id">;
     pins: Record<string, boolean>;  // Store in separate map
   };
   ```

6. **Don't create new objects unnecessarily**
   ```typescript
   // ❌ BAD - Always creates new state even if nothing changed
   .with(action, (state) => {
     return { ...state };  // Unnecessary spread
   })

   // ✅ GOOD - Only create new state if something changed
   .with(action, (state, { payload: [value] }) => {
     if (state.value === value) {
       return state;
     }
     return { ...state, value };
   })
   ```

7. **Don't use non-deterministic functions**
  A function that can produce different outputs even when given the exact same inputs on different calls.

   ```typescript
   // ❌ BAD
   .with(action, (state) => {
     return {
       ...state,
       timestamp: Date.now(),  // Non-deterministic
       random: Math.random(),  // Non-deterministic
     };
   })
   ```

---

## Best Practices

### 1. File Organization

```
slices/
  my-feature/
    my-feature-slice.ts       # State, actions, and reducer
    my-feature-slice.test.ts
    my-feature-selectors.ts   # Selectors (if needed)
    sagas/                    # Sagas for side effects (if needed)
      my-feature-sagas.ts
      my-feature-sagas.test.ts

```

### 2. Naming Conventions

- **State Type**: `{Feature}State` (e.g., `MemoriesState`, `ContextState`)
- **Reducer**: `{feature}Reducer` (e.g., `memoryReducer`, `contextReducer`)
- **Actions**: Use verb phrases (e.g., `addItem`, `removeItem`, `fetchMemories`)
- **Selectors**: Prefix with `select` (e.g., `selectItems`, `selectIsLoading`)

### 3. Action Naming

Use namespaced action types to avoid collisions:

```typescript
export const addItem = createAction<[item: Item]>("myFeature/addItem");
export const removeItem = createAction<[id: string]>("myFeature/removeItem");
```

### 4. State Shape

Keep state flat and normalized:

```typescript
// ✅ GOOD - Normalized
type State = {
  items: Collection<Item, "id">;
  selectedId: string | undefined;
};

// ❌ BAD - Nested and denormalized
type State = {
  items: Array<{
    id: string;
    data: {
      nested: {
        deeply: {
          value: string;
        };
      };
    };
  }>;
};
```

### 5. Use TypeScript Strictly

```typescript
// Define explicit types
export type MyState = {
  field: string;
  count: number;
};

// Type your reducer
export const myReducer = createReducer<MyState>(initialState);

// Type your actions
export const updateField = createAction<[value: string]>("updateField");
```

### 6. Optimize Performance

```typescript
import { shallowEqual } from "fast-equals";

// Return same reference if nothing changed
.with(updateItems, (state, { payload: [items] }) => {
  const newItems = computeNewItems(items);

  if (shallowEqual(state.items, newItems)) {
    return state;  // Prevents unnecessary re-renders
  }

  return { ...state, items: newItems };
})
```

---

## Common Pitfalls

### 1. Mutating State

```typescript
// ❌ WRONG
.with(addItem, (state, action) => {
  state.items.push(action.payload);  // Mutation!
  return state;
})

// ✅ CORRECT
.with(addItem, (state, action) => {
  return {
    ...state,
    items: [...state.items, action.payload],
  };
})
```

### 2. Forgetting to Spread State

```typescript
// ❌ WRONG - Loses other state fields
.with(updateField, (state, action) => {
  return { field: action.payload };
})

// ✅ CORRECT
.with(updateField, (state, action) => {
  return { ...state, field: action.payload };
})
```

### 3. Modifying Collection Items

```typescript
// ❌ WRONG
.with(toggleActive, (state, action) => {
  const item = getItem(state.collection, action.payload);
  item.isActive = !item.isActive;  // Mutation!
  return state;
})

// ✅ CORRECT - Use separate map
.with(toggleActive, (state, action) => {
  const id = action.payload;
  const item = getItem(state.collection, id)
  return {
    ...state,
    collection: updateItem(state.collection, {
      id,
      isActive: !item.isActive
    }),
  };
})
```

### 4. Not Cleaning Up Derived State

```typescript
// When removing items, clean up related maps
.with(removeItem, (state, action) => {
  const id = action.payload;
  const newPinnedItems = { ...state.pinnedItems };
  delete newPinnedItems[id];  // Clean up

  return {
    ...state,
    collection: removeItem(state.collection, id),
    pinnedItems: newPinnedItems,
  };
})
```

---

## Testing Reducers

Reducers are pure functions, making them easy to test:

```typescript
import { myReducer } from "./my-feature-slice";
import { addItem, removeItem } from "./my-feature-slice";

describe("myReducer", () => {
  it("should add an item", () => {
    const initialState = myReducer.initialState;
    const item = { id: "1", name: "Test" };

    const newState = myReducer(initialState, addItem(item));

    expect(getItem(newState.items, "1")).toEqual(item);
  });

  it("should remove an item", () => {
    const stateWithItem = {
      ...myReducer.initialState,
      items: addItem(myReducer.initialState.items, { id: "1", name: "Test" }),
    };

    const newState = myReducer(stateWithItem, removeItem("1"));

    expect(getItem(newState.items, "1")).toBeUndefined();
  });

  it("should not mutate state", () => {
    const initialState = myReducer.initialState;
    const item = { id: "1", name: "Test" };

    const newState = myReducer(initialState, addItem(item));

    expect(newState).not.toBe(initialState);
    expect(initialState.items.ids).toHaveLength(0);
  });
});
```

---

## Summary

- **Reducers are pure functions** that transform state based on actions
- **Always return new state objects** - never mutate
- **Use collection utilities** for normalized data management
- **Keep derived state in separate maps** - don't modify items directly
- **Use helper functions** for complex logic
- **Test reducers thoroughly** - they're easy to test!
- **Register reducers** in `reducer.ts` to add them to the store

For more information, see:
- [collection-utils.ts](./utils/collection-utils.ts) - Collection management utilities
