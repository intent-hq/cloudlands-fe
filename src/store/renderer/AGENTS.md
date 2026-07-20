# Redux Store — Agent Directives

> **Architecture update — Redux and the saga runtime have been removed.**
> The `redux`, `redux-saga`, `typed-redux-saga`, and `redux-saga-test-plan`
> packages are no longer installed. The in-use store surface is a local,
> redux/saga-free shim at `src/lib/store-shim/`, imported directly via
> `$lib/store-shim/...` (`scripts/fix-esm-imports.ts` rewrites `$lib/...`
> specifiers to relative paths in the emitted main/preload output).
> The app is mock-driven via `AppClient`. There is no
> saga runtime: `store.runSaga(sagaFn)` is a no-op, `startAllAppSagas` no longer
> starts anything, and `selector.effect(...)` throws. Use
> `selector.select(state, ...args)` for reads and `store.dispatch(action)` for
> writes. Saga-specific guidance below (sections referencing `selector.effect`,
> saga files, and `redux-saga-test-plan`) is historical context only.

Use these rules when creating or editing code in `src/store/renderer/` so Redux state stays serializable and normalized.

## Source of Truth

- The shim modules under `src/lib/store-shim/` are the source of truth for the store API surface.
- This file is a repository-local companion checklist for `src/store/renderer/`. Keep it concise.
- If this file appears to conflict with the shim's actual behavior, follow the shim and report the instruction drift instead of extending local guidance.

## 1. Import Boundaries

- Components (`*.svelte`, component-level `*.ts`) may only import actions from `*-slice.ts`, selectors from `*-selectors.ts`, types from `*-types.ts`, and the configured `store` from `$store/renderer/store` as `appStore` for dispatch and one-time reads in event handlers.
- Components must never import saga files (`sagas/*.ts`), operation files, reducer internals, store init/setup modules, or collection utils directly.
- Access collection data through selectors, not by importing `collection-utils` in components.
- Services and non-component code may import actions, selectors, and the configured app `store` when they need explicit dispatch or one-time reads.
- Sagas may import anything within the store directory.

## 2. State Must Be Serializable

- Store only JSON-serializable values in Redux state.
- Do not store `Date` objects; convert them before dispatch and store ISO strings.
- Do not store functions, class instances, Promises, generators, DOM nodes, or other runtime objects.
- Do not use `unknown` in slice state; narrow data at the boundary and dispatch a specific serializable type.
- Do not use `Map` or `Set`; use `Record<string, T>`, `Collection<T, K>`, or arrays.
- Do not generate timestamps, random IDs, or other non-deterministic values inside reducers.

## 3. Use Collection, Not Arrays

- If entities need ID-based lookup, store them as `Collection<T, K>`, not `T[]`.
- Do not use `.find()`, `.findIndex()`, or `.some()` over entity arrays in reducers/selectors when `getItem()` can do O(1) lookup.
- Use `getItem(collection, id)` for lookup and `getItems(collection)` when you need the ordered list.
- In slice files, import shim collection helpers from `$lib/store-shim/utils/collections/collection-utils`.

```ts
import { createCollection, getItem, getItems } from "$lib/store-shim/utils/collections/collection-utils";
```

- Reference: shim export `$lib/store-shim/utils/collections/collection-utils`.

## 4. Use Existing Utilities (Don't Reinvent)

- `createWorkspaceScopedHelpers(emptyState)` from `../../utils/workspace-scoped` — standard `byWorkspaceId` get/set/clear helpers.
- `createBooleanPreference({ sliceName, field, ... })` from `$lib/store-shim/utils/store/boolean-preference` — generates consistent boolean set/toggle actions and reducer wiring.
- `takeEveryFromElectronChannel` / `takeEveryFromWindowEvent` from `../../../utils/ipc-channel` in saga files — standard IPC and window listener loops with cleanup.
- `getLocalStorageJSON` / `setLocalStorageJSON` from `../../../utils/safe-local-storage-saga` in saga files — safe persistence helpers for sagas.
- `createCollection` / `addItem` / `removeItem` / `updateItem` / `getItem` / `getItems` from `$lib/store-shim/utils/collections/collection-utils` — immutable collection CRUD and lookup.
- If a prompt says `getAllItems`, use `getItems` here; `getItems` is the real helper in this codebase.

## 5. Selector Lifecycle Rules

- `selector()` is only for component init time, at the top level of a Svelte `<script>` block.
- `selector.select(state, ...args)` is for event handlers, callbacks, async functions, tests, and any one-time read when you already have state.
- `selector.effect(...args)` is for sagas.
- To react to selector changes, use saga selector-channel helpers such as `takeLatestFromSelector`, `takeEveryFromSelector`, or `takeLeadingFromSelector`.
- Never call `selector()` inside event handlers or callbacks; use `selector.select(appStore.state, ...args)` for reads and `appStore.dispatch(action)` for dispatch.

```ts
import { store as appStore } from "$store/renderer/store";
const value = selectWorkspaceThing.select(appStore.state, workspaceId);
```

## 6. Side Effects Belong in Sagas

- Do not put business logic in component `$effect` blocks.
- Do not use `listenSync` or `window.electronAPI.on` directly in components.
- Do not read or write `localStorage` in components or reducers.
- Put IPC listeners, window listeners, API calls, persistence, retries, timers, polling, and debouncing in sagas.
- Keep component effects limited to component-local DOM concerns such as focus, scroll, or measurement.

## 7. Action Naming

- Always namespace action types as `"sliceName/actionName"`.
- Use `createAction` from `$lib/store-shim/utils/store/create-action` in renderer slice files.
- For multiple arguments, use tuple types instead of untyped arrays or object payloads by default.

```ts
import { createAction } from "$lib/store-shim/utils/store/create-action";
export const setEnabled = createAction<[wsId: string, value: boolean]>("example/setEnabled");
```

## 8. Saga-Only Slices

- If a slice exists only to define saga trigger actions and has no meaningful state, do not register a reducer for it in `src/store/renderer/reducer.ts`.
- A saga can exist without a reducer entry in the state tree.
- Keep the action creators and saga registration, but omit the empty reducer.
- Current examples: `auth`, `auto-update`, `ui-notifications`.

## 9. Workspace-Scoped State Pattern

- For state keyed by workspace ID, use `createWorkspaceScopedHelpers(emptyState)`.
- Use the shape `{ byWorkspaceId: Record<string, WorkspaceState> }`.
- Always define a well-typed `emptyState` value and reuse it through the helper.
- Use `clearWorkspaceState` when workspace-scoped state must be removed on workspace unmount/cleanup.

```ts
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyState);
```

## 10. Testing Requirements

- Every slice must have a colocated reducer test file named `*-slice.test.ts`.
- Test the initial state, every reducer case, and important edge cases.
- Test saga behavior with `expectSaga` from `redux-saga-test-plan` or with explicit generator stepping when that is clearer.
- Keep test files next to the code they cover.
- When you change store structure, update or add tests in the same task.

## 11. File Organization

```text
src/store/renderer/slices/<domain>/
├── <domain>-slice.ts          # State, actions, reducer
├── <domain>-slice.test.ts     # Reducer tests
├── <domain>-selectors.ts      # Selectors
└── sagas/
    ├── <domain>-saga.ts       # Root saga for this domain
    └── <domain>-saga.test.ts  # Saga tests
```