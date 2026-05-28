# State Management Guide

> ⚠️ **POLICY**: Svelte stores (`*.store.svelte.ts`) are DEPRECATED. All new shared/domain state MUST use Redux slices (ephemeral component-local UI state is fine without Redux). If refactoring encounters `.store.svelte.ts` usage, do not expand or entrench it — follow the [Migration Guide](../src/lib/store/docs/MIGRATION_GUIDE.md) to move toward complete store removal.

## Overview

State should be kept out of Svelte components as much as possible. The canonical home for shared or durable application state in this codebase is Redux under `src/lib/store/`.

Components should primarily render UI, read selector-backed state, and dispatch actions. Business logic, shared state, derived state, persistence, async workflows, and cross-component coordination should live in Redux slices, selectors, and sagas. Service and lifecycle files should also stay as thin as possible: translate external events into typed actions, but move shared/domain state decisions and side-effect orchestration to Redux and Redux sagas.

## Core Policy

### 1. Prefer Redux for all non-trivial state

Use Redux whenever state is:

- Shared by more than one component
- Needed by services or non-Svelte code
- Persisted to storage or synchronized over IPC/network
- The basis for business logic or workflows
- Derived in multiple places

If state needs to be shared with other components, it should be in the Redux store in `src/lib/store/`.

### 2. Keep components focused on rendering

Components should represent rendering logic, event wiring, and small amounts of ephemeral UI state that are directly tied to a single rendered instance.

Good component-local state examples:

- Temporary open/closed UI state for one component
- Focus state, hover state, draft input text not shared elsewhere
- DOM measurement or instance-specific widget state

If a component starts accumulating business rules, coordinating multiple concerns, or maintaining state that other components care about, move that state and logic into Redux.

### 3. Put side effects in sagas

Side effects should be implemented in Redux sagas.

That includes:

- API and IPC calls
- `localStorage` / persistence
- timers, polling, retries, debouncing
- event listeners and subscriptions
- multi-step workflows and orchestration
- reacting to state changes that matter outside a single component

Use `$effect` only when it is absolutely necessary and the effect is directly related to the component instance itself.

Acceptable `$effect` usage is narrow:

- Imperative DOM synchronization for the mounted component
- Focus/scroll/measurement work tied to that component
- Third-party widget lifecycle code that cannot reasonably live elsewhere

Do **not** use component `$effect` for application workflows, persistence, shared-state coordination, or async business logic when saga-based handling is possible.

### 4. Keep service and lifecycle files thin

Service files, stream lifecycle modules, IPC adapters, and other non-component integration code should be thin adapters whenever they touch shared/domain behavior.

They may:

- subscribe to external events or IPC channels,
- construct raw serializable payloads,
- dispatch typed Redux actions, and
- bridge temporary legacy events while consumers migrate.

They should not own Redux-state-dependent domain decisions, target lookup policy, refresh/reconcile flows, retries, debouncing, rate limiting, persistence orchestration, or duplicate merge policy. Those responsibilities belong in Redux selectors, reducers, pure utilities, and sagas.

For an agent-stream example, see [Agent Message Deduplication and Stream Saga Architecture](./agent-message-dedup-and-stream-sagas.md).

### 5. Svelte stores are DEPRECATED — migrate to Redux

Svelte store classes (`*.store.svelte.ts`) are **DEPRECATED** and MUST NOT be used for new code. No new `$state`-based store classes may be created under any circumstances.

Any refactoring or feature work that encounters `.store.svelte.ts` usage MUST NOT expand or entrench it. Follow the [Migration Guide](../src/lib/store/docs/MIGRATION_GUIDE.md) to move toward complete store removal (update all consumers and delete the old store). Partial split-ownership — where some consumers use Redux and others still use the Svelte store — is not acceptable as a final state.

The migration path is:

- `$state` → Redux slice state
- `$derived` → selectors
- methods → actions + reducers
- side effects → sagas

See [Migration Guide](../src/lib/store/docs/MIGRATION_GUIDE.md) for the step-by-step process.

## Recommended Architecture

### Components

Components should:

- read state through selectors
- dispatch Redux actions
- keep only minimal instance-local UI state
- avoid embedding business rules

### Redux slices

Redux slices should own:

- serializable state
- pure state transitions
- action definitions
- domain boundaries for shared state

### Selectors

Selectors should own:

- derived state
- view-ready transformations
- memoized, reusable reads from store state

### Selector Lifecycle Rules

**⚠️ CRITICAL**: Selectors created with `createSelector` have different call modes for different contexts. Using the wrong mode causes runtime crashes.

| Context | Correct Usage | Why |
|---------|--------------|-----|
| Component init (top-level `<script>`) | `const value$ = selectFoo()` | Returns a Svelte readable store. Calls `getContext()` internally — only valid during component initialization. |
| Event handlers, callbacks, async functions | `selectFoo.select(getReduxStore().getState(), ...args)` | Direct state read. No Svelte context needed. |
| Sagas | `yield* selectFoo.effect(...args)` | Uses redux-saga's `select`. |

**❌ NEVER do this:**

```typescript
function handleClick() {
  // CRASHES — getContext() is not available in event handlers
  const value = get(selectFoo());
  const model = selectWorkspaceDefaultModel(workspaceId);
}
```

**✅ Do this instead:**

```typescript
// At component init (top-level script)
const dispatch = getDispatch();
const foo$ = selectFoo();

// In event handlers — use .select() for one-time reads
function handleClick() {
  const value = selectFoo.select(getReduxStore().getState());
}
```

**The same rule applies to `getDispatch()`** — it also calls `getContext()` internally and must be called at component init time, not inside event handlers.

### Sagas

Sagas should own:

- side effects
- async work
- coordination across actions/domains
- response to store changes when that response is broader than a single component

## Why Redux is preferred over component state

Redux is the better default for shared application state in this codebase because it provides:

### Single source of truth

Shared state in Redux avoids duplicating the same state across multiple components or custom stores.

### Better separation of concerns

Reducers stay pure, sagas handle effects, selectors derive values, and components render. This makes each layer easier to understand and change.

### Better testability

Pure reducers and selector functions are straightforward to test, and saga workflows have established testing patterns. Business logic inside components is much harder to test in isolation.

### Better performance characteristics

The existing Redux architecture already documents selector optimization, memoization, batching, and normalized state patterns. Reusing that system is better than scattering ad hoc state across components.

### Better debugging and tooling

Redux state is designed to be serializable and observable. The store is initialized centrally and exposed with debugging support in development, which is not true for arbitrary component-owned state.

### Better integration beyond Svelte components

This codebase already includes a Redux dispatch bridge for non-Svelte code and central saga startup. Shared state in Redux can be accessed and coordinated consistently across components, services, and background workflows.

## Practical Rules

### Put it in Redux when...

- Another component needs it
- A saga needs to react to it
- It must survive navigation, persistence, or reload
- It represents domain/application state rather than temporary UI state
- It drives workflows, orchestration, or cross-feature coordination

### Keep it in the component when...

- It is purely visual and instance-local
- It only matters while this one component is mounted
- It is not shared, persisted, or part of business logic

### Reach for `$effect` only when...

- The effect is directly tied to this component's rendered DOM
- The lifecycle is inherently component-local
- Moving it to a saga would add complexity without improving ownership

If you are unsure, prefer Redux.

## Existing Redux References

The Redux documentation already living in `src/lib/store/docs/` should be treated as the primary reference set:

- `src/lib/store/docs/readme.md` — index of all Redux docs
- `src/lib/store/docs/REDUX_ARCHITECTURE_GUIDE.md` — overall architecture, actions, sagas, performance
- `src/lib/store/docs/REDUCERS_GUIDE.md` — reducer patterns and state rules
- `src/lib/store/docs/SELECTORS_GUIDE.md` — selector design and usage
- `src/lib/store/docs/WAITFOR_SAGA_GUIDE.md` — waiting on store conditions in sagas
- `src/lib/store/docs/MIGRATION_GUIDE.md` — how existing Svelte stores migrate to Redux slices

## Codebase Alignment

This guidance matches the current store architecture in the repository:

- `src/lib/store/components/Store.svelte` exports `initStore()`, which creates the store context by calling `src/lib/store/init.ts`, and the component mounts the registered `RunSaga` instances
- `src/lib/store/init.ts` creates the Redux store, initializes the dispatch/store bridges, and starts the saga manager runtime
- `src/lib/store/utils/svelte-context.ts` exposes `getDispatch()` for components to dispatch actions
- `src/lib/store/sagas.ts` is the registry for saga-based side effects
- `src/lib/store/utils/ipc-channel.ts` provides channel helpers so Electron IPC and window events are handled in sagas instead of component lifecycle hooks
- workspace-scoped slices use `createWorkspaceScopedHelpers()` from `src/lib/store/utils/workspace-scoped.ts` to manage per-workspace state under `byWorkspaceId`

## Migration Direction

All state management MUST consolidate around Redux. This is mandatory, not aspirational.

- All new shared state MUST be implemented as Redux slices
- All new side effects that matter beyond a single component MUST be implemented as sagas (narrow instance-local DOM/focus/widget effects may use component `$effect`)
- Existing Svelte store classes MUST be migrated, not expanded
- Components MUST get thinner over time, with business logic moving out of the view layer

### Mandatory Refactoring Rule

When refactoring encounters `.store.svelte.ts` usage, do not expand or entrench it. Follow the [Migration Guide](../src/lib/store/docs/MIGRATION_GUIDE.md) to move the work toward complete store removal (update all consumers and delete the old store). Partial split-ownership — where some consumers use Redux and others still use the Svelte store — is not acceptable as a final state.

In short: keep state and business logic out of components, use Redux for shared state, use sagas for side effects, and migrate all remaining Svelte stores on contact.
- New shared state should be implemented as Redux slices
- New side effects should be implemented as sagas
- Existing Svelte store classes should be migrated rather than expanded
- Components should get thinner over time, with business logic moving out of the view layer
- `font-settings` and `notification-settings` have been merged into `user-preferences`
- `listenSync(...)` and `window.electronAPI.on(...)` listeners should move out of components and into sagas via the IPC channel helpers

In short: keep state and business logic out of components whenever possible, use Redux for shared state, use sagas for side effects, and treat remaining Svelte stores as temporary migration candidates.

## IPC Event Handling in Sagas

Electron IPC listeners and application window event listeners belong in sagas, not in component `onMount` or `$effect` blocks.

Use the channel helpers from `src/lib/store/utils/ipc-channel.ts`:

- `takeEveryFromElectronChannel(eventName, handler)` for `window.electronAPI.on(...)` events
- `takeEveryFromListenSync(eventName, handler)` for `listenSync(...)` events
- `takeEveryFromWindowEvent(eventName, handler, options?)` for `window.dispatchEvent(...)` / `CustomEvent` flows

This keeps subscription setup, cancellation, and action dispatching inside saga ownership, where handlers can safely `put`, `select`, and `call`.

### Before: listener owned by a component

```typescript
import { onMount } from "svelte";

onMount(() => {
  return listenSync<WorkspaceUpdatedEvent>("workspace:updated", ({ payload }) => {
    dispatch(setLastWorkspaceUpdate(payload.workspaceId, payload.timestamp));
  });
});
```

### After: listener owned by a saga

```typescript
import { put } from "typed-redux-saga";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";

export function* watchWorkspaceUpdatedSaga() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>("workspace:updated", function* (data) {
    yield* put(setLastWorkspaceUpdate(data.workspaceId, data.timestamp));
  });
}
```

For `window.electronAPI.on(...)`, use `takeEveryFromElectronChannel(...)` instead of wiring listeners inside components. For app-level `CustomEvent` flows dispatched on `window`, use `takeEveryFromWindowEvent(...)` so the saga owns the listener lifecycle too.

## Workspace-Scoped State

When state belongs to a workspace, model it as a `byWorkspaceId` map instead of a single shared object:

```typescript
type WorkspaceScopedState<T> = {
  byWorkspaceId: Record<string, T>;
};
```

Use `createWorkspaceScopedHelpers()` from `src/lib/store/utils/workspace-scoped.ts` to generate the standard helpers:

- `getWorkspaceState(state, wsId)`
- `setWorkspaceState(state, wsId, workspaceState)`
- `clearWorkspaceState(state, wsId)`

This is the standard pattern for slices that need isolated state per workspace. It prevents cross-workspace leakage, keeps reducers consistent, and makes workspace cleanup explicit.

### Example: `workspace-terminals-slice.ts`

```typescript
export interface WorkspaceTerminalsState {
  byWorkspaceId: Record<string, WorkspaceTerminalState>;
}

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceTerminalState);
```

Reducers then read-modify-write one workspace entry at a time:

```typescript
.with(setTerminals, (state, { payload: [wsId, terminals] }) =>
  setWorkspaceState(state, wsId, {
    ...getWorkspaceState(state, wsId),
    terminals: createCollection<WorkspaceTerminal, "id">("id", terminals),
  })
)
```

## Collection Data Structure

Entity lists in Redux state should use `Collection<T, K>` from `src/lib/store/utils/collection-utils.ts`, not raw arrays.

`Collection<T, K>` stores:

- `ids` for stable ordering
- `map` for O(1) lookup by ID
- `refsCount` for reference-counted workflows
- `idField` so utilities know which property is the entity key

Create and update collections with the collection helpers:

- `createCollection(idField, items?)`
- `addItem(collection, item)`
- `removeItem(collection, itemId)`
- `updateItem(collection, partialItem)`
- `getItem(collection, itemId)`
- `getItems(collection)` for ordered list reads

Prefer collections over arrays because arrays force O(n) lookups for ID-based access and make it too easy to rely on index position or whole-array reference changes for entity updates. Collections normalize entity storage while preserving order for rendering.

### Example

```typescript
const terminals = createCollection<WorkspaceTerminal, "id">("id", initialTerminals);
const next = addItem(terminals, terminal);
const current = getItem(next, terminal.id);
```

If a selector or component needs an ordered array, derive it from the collection at the edge instead of storing the array as the canonical source of truth.

## Boolean Preference Utility

For boolean preference fields, use `createBooleanPreference()` from `src/lib/store/utils/boolean-preference.ts` instead of hand-writing repetitive `setX` / `toggleX` pairs.

The utility takes:

- `sliceName`
- `field`
- `setActionName`
- `toggleActionName`

It returns:

- `setAction` — a typed setter action accepting `[value: boolean]`
- `toggleAction` — a typed toggle action with no payload
- `register(builder)` — a helper that adds both reducer handlers to an existing reducer builder

### Example

```typescript
const spellcheckPreference = createBooleanPreference<UserPreferencesState>({
  sliceName: "userPreferences",
  field: "spellcheckEnabled",
  setActionName: "setSpellcheckEnabled",
  toggleActionName: "toggleSpellcheck",
});

export const setSpellcheckEnabled = spellcheckPreference.setAction;
export const toggleSpellcheck = spellcheckPreference.toggleAction;
```

Register the reducer handlers by chaining `register(...)` on the reducer builder:

```typescript
export const userPreferencesReducer = spellcheckPreference.register(
  createReducer<UserPreferencesState>(initialState)
);
```

## Safe localStorage in Sagas

Never access `localStorage` directly inside sagas. Use the helpers from `src/lib/store/utils/safe-local-storage-saga.ts` instead:

- `getLocalStorageJSON<T>(key)`
- `setLocalStorageJSON(key, value)`
- `getLocalStorageItem(key)`
- `setLocalStorageItem(key, value)`
- `removeLocalStorageItem(key)`

These helpers keep storage access testable and consistent by routing reads/writes through saga effects and centralizing error handling.

- `getLocalStorageItem()` returns `string | null`
- `getLocalStorageJSON<T>()` returns `T | undefined`
- write/remove helpers swallow storage failures so sagas stay resilient

### Example

```typescript
import { call } from "typed-redux-saga";
import { getLocalStorageJSON, setLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";

const stored = yield* call(getLocalStorageJSON<Record<string, string>>, WORKSPACE_MODELS_KEY);
yield* call(setLocalStorageJSON, WORKSPACE_MODELS_KEY, nextWorkspaceModels);
```

Mocking these helpers in saga tests is much easier than mocking direct `localStorage` access scattered across multiple sagas.
