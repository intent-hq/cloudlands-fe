# Svelte Store → Redux Slice Migration Guide

> **Comprehensive guide for migrating Svelte 5 rune-based stores to Redux slices**

This guide documents the 1-to-1 mapping strategy for converting existing Svelte stores (`src/lib/stores/*.store.svelte.ts`) into Redux slices. Each Svelte store maps to exactly one Redux slice.

---

## Table of Contents

1. [Migration Strategy](#migration-strategy)
2. [Mapping Rules](#mapping-rules)
3. [Serialization Rules](#serialization-rules)
4. [Step-by-Step Migration Checklist](#step-by-step-migration-checklist)
5. [Converting Getters → Selectors](#converting-getters--selectors)
6. [Converting State Updates → Reducers](#converting-state-updates--reducers)
7. [Converting Side Effects → Sagas](#converting-side-effects--sagas)
8. [Extracting Component-Level Side Effects](#extracting-component-level-side-effects)
9. [File Structure Per Slice](#file-structure-per-slice)
10. [Verifying Migration Completeness](#verifying-migration-completeness)

---

## Migration Strategy

The migration follows a **1-to-1 mapping**: each Svelte store file becomes one Redux slice directory. The goal is to move all state, derived values, state mutations, and side effects into the Redux architecture while preserving identical behavior.

**Guiding principle:** After migration, the old store file is **DELETED** and **zero references** to it remain in the codebase.

---

## Mapping Rules

| Svelte Store Concept | Redux Equivalent | Guide Reference |
|---|---|---|
| `$state` fields | Slice initial state (plain object) | [Reducers Guide](./REDUCERS_GUIDE.md#step-3-define-initial-state) |
| `$derived` / getters | Selector (`createSelector`) | [Selectors Guide](./SELECTORS_GUIDE.md#creating-selectors) |
| Methods that update state (pure logic) | Reducer (`createReducer` + `createAction`) | [Reducers Guide](./REDUCERS_GUIDE.md#step-4-create-the-reducer) |
| Side effects (IPC, localStorage, fetch, timers, event listeners) | Saga (`typed-redux-saga`) | [Architecture Guide](./REDUX_ARCHITECTURE_GUIDE.md#sagas) |
| Component-level side effects that interact with a store | Saga (extract from components) | [Extracting Component-Level Side Effects](#extracting-component-level-side-effects) |

### Detailed Mapping

#### `$state` → Initial State

```typescript
// BEFORE: Svelte store
let sidebarWidth = $state(350);
let isCollapsed = $state(false);

// AFTER: Redux initial state
type SidebarWidthState = {
  width: number;
  isCollapsed: boolean;
  widthBeforeCollapse: number;
};

const initialState: SidebarWidthState = {
  width: 350,
  isCollapsed: false,
  widthBeforeCollapse: 350,
};
```

#### `$derived` / Getters → Selectors

```typescript
// BEFORE: Svelte store
const counterScale = $derived(1 / zoomFactor);
get effectiveWidth() { return isCollapsed ? 0 : sidebarWidth; }

// AFTER: Redux selectors
export const selectCounterScale = createSelector((state) => {
  return 1 / state.zoom.zoomFactor;
});

export const selectEffectiveWidth = createSelector((state) => {
  return state.sidebarWidth.isCollapsed ? 0 : state.sidebarWidth.width;
});
```

#### Pure State Updates → Reducers

```typescript
// BEFORE: Svelte store
startDrag() { this._isDragging = true; }
endDrag() { this._isDragging = false; this._activeHandleDrop = null; }

// AFTER: Redux actions + reducer
export const startDrag = createAction("tabDrag/startDrag");
export const endDrag = createAction("tabDrag/endDrag");

export const tabDragReducer = createReducer<TabDragState>(initialState)
  .with(startDrag, (state) => ({ ...state, isDragging: true }))
  .with(endDrag, (state) => ({
    ...state,
    isDragging: false,
    activeHandleDrop: null,
  }));
```

#### Side Effects → Sagas

```typescript
// BEFORE: Svelte store (IPC + event listener)
window.electronAPI.on('window:zoom-changed', (data) => {
  updateZoom(data.zoomFactor);
});
window.addEventListener('resize', () => { /* debounced fetch */ });

// AFTER: Redux saga using createListenSyncChannel
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";

function* watchZoomChanges() {
  const channel = createListenSyncChannel<{ zoomFactor: number }>('window:zoom-changed');
  try {
    while (true) {
      const data = yield* take(channel);
      yield* put(setZoomFactor(data.zoomFactor));
    }
  } finally {
    // Required cleanup: runs when the saga is cancelled/stopped
    channel.close();
  }
}
```

```typescript
// BEFORE: Svelte store (localStorage)
saveCollapsed(isCollapsed);

// AFTER: Redux saga
function* persistCollapsedState() {
  yield* takeEvery(toggleCollapsed, function* () {
    const isCollapsed = yield* selectIsCollapsed.effect();
    yield* call([localStorage, 'setItem'], COLLAPSED_KEY, String(isCollapsed));
  });
}
```

---

## Serialization Rules

Redux state must be fully serializable to JSON. When migrating Svelte stores, convert non-serializable types:

| Svelte Store Type | Redux State Type | Notes |
|---|---|---|
| `Map<K, V>` | `Record<string, V>` | Keys must be strings |
| `Set<T>` | `T[]` or `Record<T, true>` | Use array for ordered, record for lookup |
| Class instances | Plain objects `{ ... }` | No methods, no prototypes |
| `Date` | `number` (timestamp ms) | Use `Date.now()` in sagas, store as number |
| Functions / callbacks | Do not store | Dispatch actions instead |
| `DOMRect`, `HTMLElement` | Serializable subset | Store only needed numeric values |
| `RegExp` | `string` | Store pattern as string |
| `Promise` | Do not store | Handle in sagas |

### Example: DOMRect in State

```typescript
// BEFORE: Svelte store stores DOMRect directly
private _activeHandleDrop = $state<HandleDropInfo | null>(null);
// HandleDropInfo contains DOMRect (non-serializable)

// AFTER: Redux state uses plain numbers
type SerializableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HandleDropInfo = {
  handleRect: SerializableRect;
  containerRect: SerializableRect;
  zoneType: HandleDropZoneType;
  label: string;
};
```

See the [State Serialization Rules](./REDUX_ARCHITECTURE_GUIDE.md#state-serialization-rules) in the Architecture Guide for the complete list of allowed and forbidden types.

---

## Step-by-Step Migration Checklist

For each Svelte store, follow this checklist:

### 1. Analyze the Store

- [ ] Identify all `$state` fields → these become initial state
- [ ] Identify all `$derived` values and getters → these become selectors
- [ ] Identify all methods that only update state (no side effects) → these become reducer actions
- [ ] Identify all side effects (IPC, localStorage, fetch, timers, event listeners) → these become sagas
- [ ] Identify all component `$effect` blocks that interact with this store → candidates for saga extraction

### 2. Create the Slice Directory

```
src/lib/store/store/{slice-name}/
  {slice-name}-slice.ts          # State type, actions, reducer
  {slice-name}-selectors.ts      # Selectors
  {slice-name}-slice.test.ts     # Reducer tests
  sagas/
    {slice-name}-saga.ts         # Saga logic
    {slice-name}-saga.test.ts    # Saga tests
```

### 3. Define State and Initial Values

- [ ] Create the state type with only serializable fields
- [ ] Convert `Map` → `Record`, `Set` → `Array`, class instances → plain objects
- [ ] Define `initialState` with the same default values as the Svelte store

### 4. Create Actions

- [ ] One action per state-mutating method in the old store
- [ ] Namespace all action types: `"sliceName/actionName"`
- [ ] Use `createAction` for sync actions, `createAsyncAction` for async operations

### 5. Create the Reducer

- [ ] Handle each action with a pure state transformation
- [ ] Return new state objects (never mutate)
- [ ] Return same reference if nothing changed

### 6. Create Selectors

- [ ] One selector per getter / `$derived` value
- [ ] Place in `{slice-name}-selectors.ts`
- [ ] Use `createSelector` from `../../utils/create-selector`
- [ ] Compose selectors using `.select()` for derived values

### 7. Create Sagas

- [ ] One saga per side effect (IPC listener, localStorage persistence, fetch, timer, event listener)
- [ ] Use `typed-redux-saga` effects (`call`, `put`, `takeEvery`, `takeLatest`, etc.)
- [ ] Use channels for event listeners and IPC subscriptions
- [ ] Always clean up channels in `finally` blocks

### 8. Register the Slice

- [ ] Add reducer to `reducers.ts`
- [ ] Add saga to `sagas.ts`
- [ ] Add `<RunSaga>` component where needed

### 9. Update All Consumers

- [ ] Replace all imports of the old store with Redux selectors and `getDispatch()`
- [ ] Replace `store.someGetter` with `$selectSomeValue()` in components
- [ ] Replace `store.someMethod()` with `dispatch(someAction())` in components
- [ ] Replace `$effect` blocks that call store methods with saga-dispatched actions

### 10. Delete and Verify

- [ ] Delete the old store file
- [ ] Run: `grep -rn "{old-store}.store.svelte" src/` — must return nothing
- [ ] Run: `grep -rn "from.*stores/{old-store}" src/` — must return nothing
- [ ] Run all tests to confirm nothing is broken

---

## Converting Getters → Selectors

Svelte store getters and `$derived` values map directly to Redux selectors. See the [Selectors Guide](./SELECTORS_GUIDE.md) for full patterns.

### Simple Getter

```typescript
// BEFORE
get isDragging() { return this._isDragging; }

// AFTER
export const selectIsDragging = createSelector((state) => {
  return state.tabDrag.isDragging;
});
```

### Derived Value

```typescript
// BEFORE
const counterScale = $derived(1 / zoomFactor);

// AFTER
export const selectCounterScale = createSelector((state) => {
  return 1 / state.zoom.zoomFactor;
});
```

### Computed Getter with Logic

```typescript
// BEFORE
get effectiveWidth() { return isCollapsed ? 0 : sidebarWidth; }

// AFTER
export const selectEffectiveWidth = createSelector((state) => {
  const { isCollapsed, width } = state.sidebarWidth;
  return isCollapsed ? 0 : width;
});
```

### Composing Selectors

```typescript
// BEFORE
get displayZoom() { return `${Math.round(zoomFactor * 100)}%`; }

// AFTER
export const selectDisplayZoom = createSelector((state) => {
  const factor = selectZoomFactor.select(state);
  return `${Math.round(factor * 100)}%`;
});
```

### Usage in Components

```typescript
// BEFORE
import { sidebarWidthStore } from '$lib/stores/sidebar-width.store.svelte';
const width = sidebarWidthStore.effectiveWidth;

// AFTER
import { selectEffectiveWidth } from '$lib/store/store/sidebar-width/sidebar-width-selectors';
const effectiveWidth = selectEffectiveWidth();
// Use as: $effectiveWidth
```

### Usage in Sagas

```typescript
// BEFORE (in component $effect)
$effect(() => {
  if (sidebarWidthStore.collapsed) { /* ... */ }
});

// AFTER (in saga)
function* watchCollapsed() {
  yield* takeLatestFromSelector(selectIsCollapsed, function* ({ payload: isCollapsed }) {
    if (isCollapsed) {
      // Handle collapsed state change
    }
  });
}
```

---

## Converting State Updates → Reducers

Methods that update state without side effects map to actions + reducer handlers. See the [Reducers Guide](./REDUCERS_GUIDE.md) for full patterns.

### Simple Setter

```typescript
// BEFORE
startDrag() { this._isDragging = true; }

// AFTER
export const startDrag = createAction("tabDrag/startDrag");

export const tabDragReducer = createReducer<TabDragState>(initialState)
  .with(startDrag, (state) => ({ ...state, isDragging: true }));
```

### Method with Parameters

```typescript
// BEFORE
setWidth(pixels: number) {
  const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
  sidebarWidth = newWidth;
  if (!isCollapsed) { widthBeforeCollapse = newWidth; }
}

// AFTER
export const setWidth = createAction<[pixels: number]>("sidebarWidth/setWidth");

export const sidebarWidthReducer = createReducer<SidebarWidthState>(initialState)
  .with(setWidth, (state, { payload: [pixels] }) => {
    const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
    return {
      ...state,
      width: newWidth,
      widthBeforeCollapse: state.isCollapsed ? state.widthBeforeCollapse : newWidth,
    };
  });
```

### Method that Resets Multiple Fields

```typescript
// BEFORE
endDrag() {
  this._isDragging = false;
  this._activeHandleDrop = null;
}

// AFTER
export const endDrag = createAction("tabDrag/endDrag");

// In reducer:
.with(endDrag, (state) => ({
  ...state,
  isDragging: false,
  activeHandleDrop: null,
}))
```

### Method with Mixed Logic and Side Effects

If a method contains **both** pure state updates **and** side effects, split it:

```typescript
// BEFORE: Mixed concerns
toggle() {
  if (isCollapsed) {
    isCollapsed = false;                    // Pure state update
  } else {
    widthBeforeCollapse = sidebarWidth;     // Pure state update
    isCollapsed = true;                     // Pure state update
  }
  saveCollapsed(isCollapsed);               // Side effect (localStorage)
  window.dispatchEvent(new CustomEvent(...)); // Side effect (DOM event)
}

// AFTER: Split into reducer (pure) + saga (side effects)

// Action
export const toggleCollapsed = createAction("sidebarWidth/toggleCollapsed");

// Reducer (pure state update only)
.with(toggleCollapsed, (state) => {
  if (state.isCollapsed) {
    return { ...state, isCollapsed: false };
  }
  return {
    ...state,
    widthBeforeCollapse: state.width,
    isCollapsed: true,
  };
})

// Saga (side effects)
function* persistCollapsedState() {
  yield* takeEvery(toggleCollapsed, function* () {
    const isCollapsed = yield* selectIsCollapsed.effect();
    yield* call([localStorage, 'setItem'], COLLAPSED_KEY, String(isCollapsed));
  });
}
```

---

## Converting Side Effects → Sagas

All side effects must move to sagas. See the [Architecture Guide — Sagas](./REDUX_ARCHITECTURE_GUIDE.md#sagas) for full patterns.

### localStorage Persistence

```typescript
// BEFORE
function saveCollapsed(collapsed: boolean): void {
  localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
}

// AFTER: Saga that watches for state changes and persists
function* persistSidebarState() {
  yield* takeEvery(toggleCollapsed, function* () {
    const isCollapsed = yield* selectIsCollapsed.effect();
    yield* call(
      [localStorage, localStorage.setItem],
      COLLAPSED_STORAGE_KEY,
      String(isCollapsed)
    );
  });
}
```

### localStorage Initialization

```typescript
// BEFORE
if (typeof window !== 'undefined') {
  sidebarWidth = loadWidth();
  isCollapsed = loadCollapsed();
}

// AFTER: Saga that runs on startup
function* initializeSidebarWidth() {
  const width: number = yield* call(loadWidth);
  const collapsed: boolean = yield* call(loadCollapsed);
  yield* put(hydrateSidebarWidth(width, collapsed));
}
```

### IPC Listeners

Use `createListenSyncChannel` from `$lib/store/utils/ipc-channel` to bridge Electron IPC events into sagas. This wraps `listenSync` (which supports proper cleanup via `offById`) into a redux-saga `eventChannel`, so handlers have full saga context (`put`, `select`, `call`, etc.) without needing a dispatch bridge.

```typescript
// BEFORE: Svelte store or raw dispatch bridge
window.electronAPI.on('window:zoom-changed', (data) => {
  updateZoom(data.zoomFactor);
});

// AFTER: Saga with createListenSyncChannel
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";

function* watchZoomIPC() {
  const channel = createListenSyncChannel<{ zoomFactor: number }>('window:zoom-changed');
  try {
    while (true) {
      const data = yield* take(channel);
      if (typeof data?.zoomFactor === 'number' && data.zoomFactor > 0) {
        yield* put(setZoomFactor(data.zoomFactor));
      }
    }
  } finally {
    // Required cleanup: runs when the saga is cancelled/stopped
    channel.close();
  }
}
```

**Why this is better than `listenSync` + dispatch bridge:**
- Handlers run within the saga lifecycle — full access to `yield* select()`, `yield* call()`, etc.
- Channel cleanup happens in the `finally` block when the saga is cancelled (no manual `ipcCleanup` tracking)
- No dependency on the module-level `dispatch` from `redux-dispatch-bridge`

### Debounced Event Listeners

```typescript
// BEFORE
window.addEventListener('resize', () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    updateZoom(await fetchZoomFactor());
  }, 100);
});

// AFTER: Saga with takeLatest (natural debounce)
export const windowResized = createAction("zoom/windowResized");

function* handleResize() {
  yield* takeLatest(windowResized, function* () {
    yield* delay(100);
    const factor: number = yield* call(fetchZoomFactor);
    yield* put(setZoomFactor(factor));
  });
}
```

### Async Initialization

```typescript
// BEFORE
async function initialize() {
  const initial = await fetchZoomFactor();
  updateZoom(initial);
}
if (browser) { initialize(); }

// AFTER: Saga
function* initializeZoom() {
  const factor: number = yield* call(fetchZoomFactor);
  yield* put(setZoomFactor(factor));
}
```

---

## Extracting Component-Level Side Effects

Components often contain `$effect` blocks that interact with stores. These should be extracted into sagas.

### How to Identify

Look for these patterns in `.svelte` files:

```typescript
// Pattern 1: $effect that reads store and performs side effect
$effect(() => {
  if (someStore.someValue) {
    window.electronAPI.invoke(...);  // Side effect
  }
});

// Pattern 2: $effect that syncs store with external state
$effect(() => {
  document.body.style.zoom = `${zoomStore.zoomFactor}`;
});

// Pattern 3: onMount/onDestroy that sets up listeners updating store
onMount(() => {
  const handler = (e) => someStore.update(e.data);
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
});
```

### How to Extract

1. **Identify the trigger**: What state change or event starts the effect?
2. **Identify the side effect**: What external operation is performed?
3. **Create a saga** that watches for the trigger and performs the side effect

```typescript
// BEFORE: Component $effect
$effect(() => {
  document.body.style.setProperty('--sidebar-width', `${sidebarWidthStore.effectiveWidth}px`);
});

// AFTER: Saga watches selector and applies CSS
function* syncSidebarCSS() {
  yield* takeLatestFromSelector(selectEffectiveWidth, function* ({ payload: width }) {
    yield* call(() => {
      document.body.style.setProperty('--sidebar-width', `${width}px`);
    });
  });
}
```

### When NOT to Extract

Keep effects in components when they:
- Only involve local component state (not store state)
- Are purely presentational (e.g., focus management, scroll position)
- Have no interaction with the store at all

---

## File Structure Per Slice

Each migrated store follows this directory structure:

```
src/lib/store/store/{slice-name}/
  {slice-name}-slice.ts          # State type, actions, reducer
  {slice-name}-selectors.ts      # Selectors
  {slice-name}-slice.test.ts     # Reducer tests
  sagas/
    {slice-name}-saga.ts         # Saga logic
    {slice-name}-saga.test.ts    # Saga tests
```

This matches the convention documented in the [Architecture Guide — Slice Management](./REDUX_ARCHITECTURE_GUIDE.md#manual-steps-for-creating-a-new-slice).

### Registration

After creating the slice:

1. **Register reducer** in `reducers.ts`:
   ```typescript
   import { sidebarWidthReducer } from "./store/sidebar-width/sidebar-width-slice";
   export const reducers = { /* ... */ sidebarWidth: sidebarWidthReducer } as const;
   ```

2. **Register saga** in `sagas.ts`:
   ```typescript
   import { sidebarWidthSaga } from "./store/sidebar-width/sagas/sidebar-width-saga";
   export const sagas = { /* ... */ sidebarWidth: sidebarWidthSaga } as const;
   ```

3. **Add `<RunSaga>`** in the appropriate layout component:
   ```svelte
   <RunSaga sagaName="sidebarWidth" />
   ```

---

## Verifying Migration Completeness

After migrating a store, verify that **zero references** to the old store remain:

### Verification Commands

```bash
# Check for any imports of the old store file
grep -rn "{old-store}.store.svelte" src/

# Check for imports from the stores directory
grep -rn "from.*stores/{old-store}" src/

# Check for the store object name
grep -rn "{storeObjectName}" src/ --include="*.ts" --include="*.svelte"
```

All three commands must return **no results**.

### Example

For migrating `sidebar-width.store.svelte.ts`:

```bash
grep -rn "sidebar-width.store.svelte" src/
grep -rn "from.*stores/sidebar-width" src/
grep -rn "sidebarWidthStore" src/ --include="*.ts" --include="*.svelte"
```

### Final Steps

1. **Delete the old store file**: `rm src/lib/stores/{old-store}.store.svelte.ts`
2. **Run all tests**: Ensure nothing is broken
3. **Run the app**: Verify the feature works identically

**The migration is complete when the old store file is deleted and zero references remain.**

---

## Summary

| Step | Action |
|---|---|
| 1 | Analyze the Svelte store: identify state, getters, methods, side effects |
| 2 | Create slice directory with standard file structure |
| 3 | Define serializable state type and initial values |
| 4 | Create actions for each state mutation |
| 5 | Create reducer with pure state transformations |
| 6 | Create selectors for each getter / derived value |
| 7 | Create sagas for all side effects |
| 8 | Extract component-level side effects into sagas |
| 9 | Register reducer, saga, and RunSaga component |
| 10 | Update all consumers (components, other stores) |
| 11 | Delete old store file and verify zero references |

For detailed patterns, refer to:
- [Redux Architecture Guide](./REDUX_ARCHITECTURE_GUIDE.md)
- [Reducers Guide](./REDUCERS_GUIDE.md)
- [Selectors Guide](./SELECTORS_GUIDE.md)
- [waitFor Saga Utility Guide](./WAITFOR_SAGA_GUIDE.md)
