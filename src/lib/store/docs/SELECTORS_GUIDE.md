# Redux Selectors Guide

This guide describes how to create and use selectors in the Redux architecture.

## Table of Contents
- [What are Selectors?](#what-are-selectors)
- [Creating Selectors](#creating-selectors)
- [Using Selectors](#using-selectors)
- [Best Practices](#best-practices)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## What are Selectors?

Selectors are functions that extract and derive data from the Redux store state. Our custom `createSelector` utility provides:

1. **Automatic memoization** - Selectors cache results and only recompute when accessed state changes
2. **Fine-grained reactivity** - Tracks which state paths are accessed and only re-runs when those specific paths change
3. **Multiple usage modes** - Can be used in Svelte components, sagas, and tests
4. **Type safety** - Full TypeScript support with proper type inference

## Creating Selectors

### Basic Selector Structure

Selectors are created using the `createSelector` utility and should be placed in a `*-selectors.ts` file within each slice directory.

```typescript
import { createSelector } from "../../utils/create-selector";

// Simple selector - no arguments
export const selectUpdatesLocked = createSelector((state) => {
  return state.storeUtility.updatesLocked;
});

// Selector with arguments
export const selectConversation = createSelector((state, conversationId: string) => {
  return state.conversations.collection.map[conversationId];
});

// Selector with multiple arguments
export const selectConversationExchange = createSelector((state, conversationId: string, requestId) => {
  return getItem(selectHistory.select(state, conversationId), requestId);
});
```

### Composing Selectors

Selectors can call other selectors to build complex derived state:

```typescript
export const selectCurrentConversationId = createSelector((state): string => {
  if (!state.conversations.currentConversationId) {
    throw new Error("Expected conversation id");
  }
  return state.conversations.currentConversationId;
});

export const selectCurrentConversation = createSelector((state): Conversation => {
  const currentId = selectCurrentConversationId.select(state);
  return selectConversation.select(state, currentId);
});

export const selectChatMode = createSelector((state): ChatModeType => {
  if (selectIsRemoteConversationActive.select(state)) {
    return "remoteAgent";
  }
  const currentConversationId = selectCurrentConversationIdMaybe.select(state);
  return isConversationAgentic.select(state, currentConversationId) ? "localAgent" : "chat";
});
```

### Collection Selectors

For working with collections, use the specialized helper functions:

```typescript
import { createCollectionItemSelector, createSelector } from "../../utils/create-selector";
import { getItems, type Collection } from "../../utils/collection-utils";

// Get the entire collection
export const getConversationsCollection = createSelector(
  (state): Collection<Conversation, "id"> => {
    return state.conversations.collection;
  }
);

// Get a single item from a collection
export const selectConversation = createCollectionItemSelector<Conversation, "id">(
  getConversationsCollection.select
);

// Get all items as an array
export const selectConversations = createSelector((state) => {
  const collection = getConversationsCollection.select(state);
  return getItems(collection);
});
```

## Using Selectors

Selectors provide multiple methods for different contexts:

### 1. In Svelte Components (Readable Stores)

Use the selector as a function to get a Svelte readable store:

```typescript
// In a Svelte component
const updatesLocked = selectUpdatesLocked();
const conversation = selectConversation(conversationId);

// Use with $store syntax
{#if $updatesLocked}
  <LockedOverlay />
{/if}
```

### 2. In Sagas (Effect Method)

**✅ CORRECT: Use the `.effect()` method**

```typescript
function* mySaga() {
  // Get value once
  const updatesLocked = yield* selectUpdatesLocked.effect();
  const conversation = yield* selectConversation.effect(conversationId);

  // Use the values
  if (updatesLocked) {
    // ...
  }
}
```

### 3. In Sagas (Watching for Changes)

#### Using Selector Channel Effects (Recommended)

The preferred way to react to selector changes is using the selector channel effects from `selector-channel-effects.ts`. These effects handle channel creation and cleanup automatically, preventing memory leaks:

```typescript
import { takeLatestFromSelector, takeEveryFromSelector, takeLeadingFromSelector } from "../../utils/selector-channel-effects";

// React to every change (spawns new worker for each change)
function* watchScrollPositions() {
  yield* takeEveryFromSelector(selectAllScrollPositions, function* ({ payload, prevPayload }) {
    console.log(`Positions changed from ${JSON.stringify(prevPayload)} to ${JSON.stringify(payload)}`);
    // React to changes
  });
}

// Cancel previous worker when new value arrives (most common pattern)
function* watchConversation() {
  yield* takeLatestFromSelector(selectCurrentConversationId, function* ({ payload: conversationId }) {
    if (conversationId) {
      yield* put(loadConversationData(conversationId));
    }
  });
}

// Ignore new values while worker is running
function* watchWithThrottle() {
  yield* takeLeadingFromSelector(selectSomeValue, function* ({ payload }) {
    yield* call(expensiveOperation, payload);
  });
}
```

**With selector arguments:**
```typescript
// When selector requires arguments, pass them as the second parameter
yield* takeLatestFromSelector(selectConversation, [conversationId], function* ({ payload }) {
  // Handle conversation changes
});
```

#### Using createChannelFromSelector (For Complex Patterns)

For complex patterns that don't fit `takeEvery`/`takeLatest`/`takeLeading` (e.g., conditional loops, races), use `createChannelFromSelector`. **Important:** Always close channels in a `finally` block:

```typescript
import { createChannelFromSelector } from "../../utils/selector-channel-effects";

function* complexWatcher() {
  const channel = yield* createChannelFromSelector(selectAllScrollPositions);

  // Always use try/finally to ensure channel cleanup
  try {
    while (someCondition) {
      const { payload: currentMode, prevPayload } = yield* take(channel);
      // Complex logic here
    }
  } finally {
    channel.close();
  }
}

// With selector arguments
function* watchWithArgs(conversationId: string) {
  const channel = yield* createChannelFromSelector(selectConversation, conversationId);
  try {
    // ...
  } finally {
    channel.close();
  }
}
```

### 4. Direct State Access (`.select()` method)

For non-reactive contexts like tests or when you already have state:

```typescript
// In tests
const state = store.getState();
const value = selectUpdatesLocked.select(state);

// When composing selectors
export const selectDerivedValue = createSelector((state) => {
  const value = selectSomeValue.select(state);
  return value * 2;
});
```

## Best Practices

### 1. Always Create Named Selectors

**✅ DO:** Create a selector in the slice's selectors module
```typescript
// In store-utility-selectors.ts
export const selectUpdatesLocked = createSelector((state) => {
  return state.storeUtility.updatesLocked;
});

// In saga
function* mySaga() {
  const locked = yield* selectUpdatesLocked.effect();
}
```

**❌ DON'T:** Use inline select with anonymous functions
```typescript
// In saga - AVOID THIS!
function* mySaga() {
  const locked = yield* select((state) => state.storeUtility.updatesLocked);
}
```

### 2. Organize Selectors by Slice

Keep selectors in `*-selectors.ts` files alongside their slice:

```
store/
  store-utility/
    store-utility-slice.ts
    store-utility-selectors.ts    ← Selectors here
  tab-scroll/
    tab-scroll-slice.ts
    tab-scroll-selectors.ts    ← Selectors here
```

### 3. Use Descriptive Names

Selector names should clearly indicate what they return:

```typescript
// Good names
export const selectCurrentConversationId = createSelector(...);
export const selectIsConversationEmpty = createSelector(...);
export const selectConversationExchangesCount = createSelector(...);

// Less clear
export const getCurrentId = createSelector(...);
export const isEmpty = createSelector(...);
export const count = createSelector(...);
```

### 4. Leverage Memoization

Selectors automatically memoize based on:
- Arguments (shallow equality)
- Accessed state paths (reference equality)

This means expensive computations only run when necessary:

```typescript
export const selectOrderedConversationIds = createSelector(
  (state, by?: OrderedBy, direction: OrderDirection = "desc") => {
    const conversationIds = selectConversationIds.select(state);
    // This sort only runs when conversationIds or arguments change
    return conversationIds.toSorted((a, b) => {
      const timeA = selectGetTime.select(state, a, by).getTime();
      const timeB = selectGetTime.select(state, b, by).getTime();
      return direction === "asc" ? timeA - timeB : timeB - timeA;
    });
  }
);
```

## Anti-Patterns to Avoid

### ❌ Inline Anonymous Selectors in Sagas

**Problem:** Inline selectors bypass memoization and make code harder to test and maintain.

```typescript
// BAD - Don't do this!
function* mySaga() {
  const locked = yield* select((state) => state.storeUtility.updatesLocked);
  const positions = yield* select((state) => state.tabScroll.positions);
}
```

**Solution:** Always create named selectors:

```typescript
// GOOD - Do this instead!
function* mySaga() {
  const locked = yield* selectUpdatesLocked.effect();
  const positions = yield* selectAllScrollPositions.effect();
}
```

### ❌ Accessing State Directly

```typescript
// BAD
function* mySaga() {
  const state = yield* select((state) => state);
  const locked = state.storeUtility.updatesLocked;
}

// GOOD
function* mySaga() {
  const locked = yield* selectUpdatesLocked.effect();
}
```

### ❌ Creating Selectors Inside Components or Sagas

```typescript
// BAD - Creates a new selector on every render/call
function MyComponent() {
  const selector = createSelector((state) => state.storeUtility.updatesLocked);
  const value = selector();
  // ...
}

// GOOD - Selector defined at module level
export const selectUpdatesLocked = createSelector((state) => {
  return state.storeUtility.updatesLocked;
});

function MyComponent() {
  const value = selectUpdatesLocked();
  // ...
}
```

## Summary

1. **Create selectors** in `*-selectors.ts` files using `createSelector()`
2. **Use `.effect()`** in sagas for one-time reads
3. **Use selector channel effects** (`takeLatestFromSelector`, `takeEveryFromSelector`, `takeLeadingFromSelector`) in sagas to watch for changes
4. **Use `createChannelFromSelector`** for complex patterns that don't fit the standard effects
5. **Use as functions** in Svelte components to get readable stores
6. **Never use inline `yield* select((state) => {...})`** - always create named selectors
7. **Compose selectors** by calling `.select()` on other selectors
8. **Leverage memoization** - selectors only recompute when accessed state changes
