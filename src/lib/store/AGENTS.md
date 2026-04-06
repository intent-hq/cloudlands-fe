# Redux Store — Agent Directives

Use these rules when creating or editing code in `src/lib/store/` so Redux state stays serializable, normalized, and saga-driven.

## 1. Import Boundaries

- Components (`*.svelte`, component-level `*.ts`) may only import actions from `*-slice.ts`, selectors from `*-selectors.ts`, types from `*-types.ts`, `getDispatch` from `$lib/store/utils/svelte-context`, and `getReduxStore` from `$lib/store/redux-dispatch-bridge` (for one-time reads in event handlers only).
- Components must never import saga files (`sagas/*.ts`), operation files, reducer internals, store init/setup modules, or collection utils directly.
- Access collection data through selectors, not by importing `collection-utils` in components.
- Services and non-component code may import actions and selectors.
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
- In slice files, import collection helpers from `../../utils/collection-utils`.

```ts
import { createCollection, getItem, getItems } from "../../utils/collection-utils";
```

- Reference: `src/lib/store/utils/collection-utils.ts`

## 4. Use Existing Utilities (Don't Reinvent)

- `createWorkspaceScopedHelpers(emptyState)` from `../../utils/workspace-scoped` — standard `byWorkspaceId` get/set/clear helpers.
- `createBooleanPreference({ sliceName, field, ... })` from `../../utils/boolean-preference` — generates consistent boolean set/toggle actions and reducer wiring.
- `takeEveryFromElectronChannel` / `takeEveryFromWindowEvent` from `../../../utils/ipc-channel` in saga files — standard IPC and window listener loops with cleanup.
- `getLocalStorageJSON` / `setLocalStorageJSON` from `../../../utils/safe-local-storage-saga` in saga files — safe persistence helpers for sagas.
- `createCollection` / `addItem` / `removeItem` / `updateItem` / `getItem` / `getItems` from `../../utils/collection-utils` — immutable collection CRUD and lookup.
- `debounceSaga` from `../../../utils/debounce-saga` in saga files — debounce wrapper actions instead of hand-rolled timers.
- If a prompt says `getAllItems`, use `getItems` here; `getItems` is the real helper in this codebase.

## 5. Selector Lifecycle Rules

- `selector()` is only for component init time, at the top level of a Svelte `<script>` block.
- `selector.select(state, ...args)` is for event handlers, callbacks, async functions, tests, and any one-time read when you already have state.
- `selector.effect(...args)` is for sagas.
- To react to selector changes, use saga selector-channel helpers such as `takeLatestFromSelector`, `takeEveryFromSelector`, or `takeLeadingFromSelector`.
- Never call `selector()` or `getDispatch()` inside event handlers or callbacks.

```ts
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
const value = selectWorkspaceThing.select(getReduxStore().getState(), workspaceId);
```

## 6. Side Effects Belong in Sagas

- Do not put business logic in component `$effect` blocks.
- Do not use `listenSync` or `window.electronAPI.on` directly in components.
- Do not read or write `localStorage` in components or reducers.
- Put IPC listeners, window listeners, API calls, persistence, retries, timers, polling, and debouncing in sagas.
- Keep component effects limited to component-local DOM concerns such as focus, scroll, or measurement.

## 7. Action Naming

- Always namespace action types as `"sliceName/actionName"`.
- Use `createAction` from `../../utils/create-action` in slice files.
- For multiple arguments, use tuple types instead of untyped arrays or object payloads by default.

```ts
import { createAction } from "../../utils/create-action";
export const setEnabled = createAction<[wsId: string, value: boolean]>("example/setEnabled");
```

## 8. Saga-Only Slices

- If a slice exists only to define saga trigger actions and has no meaningful state, do not register a reducer for it in `src/lib/store/reducer.ts`.
- A saga can exist without a reducer entry in the state tree.
- Keep the action creators and saga registration, but omit the empty reducer.
- Current examples: `auth`, `auto-update`, `ui-notifications`, `app-layout`.

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
src/lib/store/slices/<domain>/
├── <domain>-slice.ts          # State, actions, reducer
├── <domain>-slice.test.ts     # Reducer tests
├── <domain>-selectors.ts      # Selectors
└── sagas/
    ├── <domain>-saga.ts       # Root saga for this domain
    └── <domain>-saga.test.ts  # Saga tests
```