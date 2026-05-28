# Debounce Saga Utilities

A flexible debouncing solution for Redux-Saga that allows you to debounce multiple different actions through a single wrapper action.

## Overview

The debounce saga utilities provide a way to debounce actions in Redux-Saga applications. Unlike traditional debouncing that works on a single action type, these utilities allow you to:

1. **Debounce multiple different action types** through a single wrapper action
2. **Maintain independent debounce timers** for each action type
3. **Use custom keys** for fine-grained debounce control (e.g., per user, per conversation)

## Key Features

- ✅ **Multiple action types**: Debounce different actions independently
- ✅ **Type-safe**: Full TypeScript support
- ✅ **Flexible**: Use action type or custom keys for debouncing
- ✅ **Clean API**: Simple wrapper pattern
- ✅ **Saga-native**: Built with redux-saga primitives

## API

### `debounceSaga(wrapperActionCreator, debounceMs)`

Debounces actions based on their action type. Each unique action type gets its own debounce timer.

**Parameters:**
- `wrapperActionCreator`: Action creator that wraps other actions
- `debounceMs`: Debounce delay in milliseconds

**Example:**
```typescript
import { debounceSaga } from "./debounce-saga";
import { createAction } from "./create-action";

const debounceAction = createAction<[action: any]>("debounceAction");

export function* mySaga() {
  yield* debounceSaga(debounceAction, 300);
}

// Usage:
dispatch(debounceAction(searchQuery("hello")));
dispatch(debounceAction(updateSettings({ theme: "dark" })));
```

### `debounceWithKeySaga(wrapperActionCreator, debounceMs, keyExtractor)`

Debounces actions based on a custom key extracted from the action. This allows fine-grained control over what gets debounced together.

**Parameters:**
- `wrapperActionCreator`: Action creator that wraps other actions
- `debounceMs`: Debounce delay in milliseconds
- `keyExtractor`: Function that extracts a unique key from the action

**Example:**
```typescript
import { debounceWithKeySaga } from "./debounce-saga";

const debounceConversationAction = createAction<[action: any]>("debounceConversation");

export function* conversationSaga() {
  yield* debounceWithKeySaga(
    debounceConversationAction,
    500,
    (action) => {
      // Debounce per conversation ID
      const [conversationId] = action.payload;
      return `${action.type}:${conversationId}`;
    }
  );
}

// Usage:
dispatch(debounceConversationAction(updateTitle("conv-1", "Title 1")));
dispatch(debounceConversationAction(updateTitle("conv-2", "Title 2")));
// These are debounced separately because they have different conversation IDs
```

## How It Works

1. **Wrapper Action**: You dispatch a wrapper action that contains the actual action as its payload
2. **Debounce Timer**: The saga maintains a map of debounce timers (keyed by action type or custom key)
3. **Cancellation**: When a new action arrives with the same key, the previous timer is cancelled
4. **Dispatch**: After the debounce delay, the inner action is dispatched to the store

```
dispatch(wrapper(action1)) → [Timer starts for action1]
dispatch(wrapper(action1)) → [Previous timer cancelled, new timer starts]
dispatch(wrapper(action2)) → [Timer starts for action2 (independent)]
... 300ms passes ...
→ action1 and action2 are dispatched
```

## Common Use Cases

### 1. Search Input Debouncing

```typescript
const debounceSearch = createAction<[action: any]>("debounceSearch");
const searchQuery = createAction<[query: string]>("search/query");

function* searchSaga() {
  yield* debounceSaga(debounceSearch, 300);
  yield* takeEvery(searchQuery, handleSearch);
}

// Usage:
dispatch(debounceSearch(searchQuery("hello")));
```

### 2. Auto-save Debouncing

```typescript
const debounceAutoSave = createAction<[action: any]>("debounceAutoSave");
const saveDocument = createAction<[docId: string, content: string]>("doc/save");

function* autoSaveSaga() {
  yield* debounceWithKeySaga(
    debounceAutoSave,
    1000,
    (action) => action.payload[0] // Debounce per document ID
  );
  yield* takeEvery(saveDocument, handleSave);
}
```

### 3. Multiple Debounce Periods

```typescript
const debounceShort = createAction<[action: any]>("debounceShort");
const debounceLong = createAction<[action: any]>("debounceLong");

function* multiPeriodSaga() {
  yield* debounceSaga(debounceShort, 100);
  yield* debounceSaga(debounceLong, 1000);
}

// Fast debounce for search
dispatch(debounceShort(searchQuery("hello")));

// Slow debounce for expensive operations
dispatch(debounceLong(saveSettings({ theme: "dark" })));
```

## Best Practices

1. **Create dedicated wrapper actions** for different debounce periods
2. **Use descriptive names** for wrapper actions (e.g., `debounceSearch`, `debounceAutoSave`)
3. **Consider using `debounceWithKeySaga`** when you need per-entity debouncing
4. **Set up action handlers** with `takeEvery` or `takeLatest` for the inner actions
5. **Test debounce behavior** with integration tests that account for timing

## Comparison with `takeLatest`

| Feature | `debounceSaga` | `takeLatest` |
|---------|----------------|--------------|
| Multiple action types | ✅ Yes | ❌ No (one per saga) |
| Debounce delay | ✅ Yes | ❌ No (immediate) |
| Custom keys | ✅ Yes (with `debounceWithKeySaga`) | ❌ No |
| Cancellation | ✅ Timer-based | ✅ Task-based |

Use `debounceSaga` when you need to delay action dispatch. Use `takeLatest` when you want to cancel in-flight operations.
