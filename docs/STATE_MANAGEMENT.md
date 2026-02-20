# State Management Guide

## Overview

The Intent app uses a unified state management system built on Svelte 5's new runes system, combined with custom stores and services for complex state logic.

## Core Concepts

### 1. Svelte 5 Runes

The app uses Svelte 5's runes for reactive state:

```typescript
// State rune - creates reactive state
let count = $state(0);

// Derived rune - computed values
let doubled = $derived(count * 2);

// Effect rune - side effects
$effect(() => {
  console.log(`Count is now ${count}`);
});

// Props rune - component properties
let { name, age } = $props<{ name: string; age: number }>();
```

### 2. Unified Workspace State

The central state management system for workspaces:

```typescript
// Get or create state instance
const state = getUnifiedWorkspaceState(workspaceId);

// Access reactive properties
state.selectedFile; // Currently selected file
state.openFiles; // Array of open files
state.activePanel; // Active panel identifier

// Cleanup when done
await state.dispose();
```

**Key Features:**

- Reference counting for memory management
- Automatic persistence to localStorage
- Cache eviction after inactivity
- Shared across components

### 3. Store Pattern

Custom stores for specific domains:

```typescript
// Workspace Store
workspaceStore.items; // All workspaces
workspaceStore.current; // Current workspace
workspaceStore.loading; // Loading state

// Agent Service (store-like)
agentService.getState(); // Get current state
agentService.subscribe(); // Subscribe to changes

// Context Store (Svelte 5 runes)
import { contextStore } from '$lib/stores/context.store.svelte';
contextStore.addItem(item); // Add context item
contextStore.removeItem(id); // Remove context item
getSelectionContext(); // Get current selection (exported function)
getContextItems(); // Get all context items (exported function)
```

**Note:** The context store uses `.svelte.ts` extension to enable Svelte 5 runes. Derived values are exported as functions rather than direct exports due to Svelte 5 restrictions.

## State Architecture

```
┌─────────────────────────────────────┐
│         Component Layer              │
│   (Uses $state, $derived, $effect)  │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│      Unified State Layer            │
│  (workspace-unified-state.svelte)   │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│         Store Layer                 │
│   (workspace.store, git.store)      │
└─────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────┐
│       Persistence Layer             │
│    (localStorage, IPC, disk)        │
└─────────────────────────────────────┘
```

## Best Practices

### 1. Use Runes for Component State

```typescript
// ✅ Good - Use runes for local component state
let isOpen = $state(false);
let items = $state<Item[]>([]);

// ❌ Bad - Don't use writable stores in components
import { writable } from 'svelte/store';
const isOpen = writable(false);
```

### 2. Prevent Effect Loops

Use `untrack()` to prevent circular dependencies:

```typescript
$effect(() => {
  const currentTab = tabs.current;

  // Use untrack to prevent this from triggering more effects
  untrack(() => {
    if (currentTab !== lastTab) {
      updateWorkspace(currentTab);
    }
  });
});
```

### 3. Clean Up Resources

Always dispose of state and subscriptions:

```typescript
onDestroy(() => {
  // Dispose unified state
  state?.dispose();

  // Unsubscribe from stores
  unsubscribe?.();

  // Clear timers
  clearTimeout(timer);
});
```

### 4. Reference Counting

The unified state uses reference counting:

```typescript
// First component creates the state
const state1 = getUnifiedWorkspaceState('workspace-1'); // refCount: 1

// Second component reuses existing state
const state2 = getUnifiedWorkspaceState('workspace-1'); // refCount: 2

// Dispose decrements reference count
await state1.dispose(); // refCount: 1
await state2.dispose(); // refCount: 0, state is cleaned up
```

## Common Patterns

### Optimistic Updates

```typescript
// Update UI immediately
workspace.status = 'creating';

// Then perform async operation
try {
  const result = await createWorkspace(workspace);
  workspace = result;
} catch (error) {
  // Revert on error
  workspace.status = 'error';
}
```

### Debounced Persistence

```typescript
// Changes are automatically debounced
state.selectedFile = 'new-file.ts';
state.openFiles = [...state.openFiles, 'another.ts'];
// Saves after 500ms of no changes
```

### Derived State

```typescript
// Compute derived values efficiently
let filteredItems = $derived(items.filter((item) => item.status === filter));

// Complex derivations
let stats = $derived.by(() => {
  const total = items.length;
  const completed = items.filter((i) => i.done).length;
  return { total, completed, percentage: (completed / total) * 100 };
});
```

## Performance Considerations

### Memory Management

- States are cached with MAX_CACHE_SIZE = 2
- Cleanup runs every 60 seconds
- Auto-disposal after 5 minutes of inactivity
- Proper cleanup of intervals on page unload
- WeakMap for reference counting to prevent memory leaks

### Optimization Tips

1. Use `$derived` for computed values instead of recalculating
2. Debounce user input and search operations
3. Implement virtual scrolling for large lists
4. Use `untrack()` to prevent unnecessary reactivity

## Debugging State

### Chrome DevTools

```javascript
// Access state in console
window.__workspaceState = state;

// Monitor state changes
$effect(() => {
  console.log('State changed:', { ...state });
});
```

### Logger Integration

```typescript
import { Logger } from '$shared/logger';
const logger = new Logger('StateDebug');

$effect(() => {
  logger.debug('File selected', { file: state.selectedFile });
});
```
