---
name: init-svelte-redux-toolkit
description: >-
  Bootstrap a new SvelteKit project with the full Redux + Saga state management
  architecture from the svelte-redux-toolkit package. Covers dependency installation,
  creating Store constructor maps, wiring the provider component,
  building a first example slice, and verifying the setup.
triggers:
  - init redux
  - setup store
  - new project
  - bootstrap redux
  - setup redux saga
  - add redux to svelte
  - initialize state management
---
# Init svelte-redux-toolkit — Greenfield Setup

## Agent Preflight Compliance Contract

Before editing code or docs under this skill:

- **MUST** read this skill plus every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

> Complete guide for bootstrapping a SvelteKit project with the svelte-redux-toolkit package.Follow each step in order. Every step includes the code to create or run.

## Step 1 — Install Dependencies

```bash
npm install svelte-redux-toolkit redux redux-saga typed-redux-saga fast-equals
```

Svelte 5 is also a required peer dependency and is assumed to already be installed in your Svelte project.

For testing sagas (optional, recommended):

```bash
npm add -D redux-saga-test-plan
```

The package `postinstall` copies packaged AI skills into the consuming project root at `.agents/skills/`. It removes stale package-owned files before copying current packaged skills, preserves unrelated project or third-party skills, and excludes generated artifacts such as `skills/_artifacts`. In consumer apps, use the installed package CLI if skills need to be refreshed, validated, cleaned up, or if you need help text:

```bash
npx svelte-redux-toolkit install-skills
npx svelte-redux-toolkit validate-architecture
npx svelte-redux-toolkit help
```

The equivalent npm exec form is `npm exec -- svelte-redux-toolkit <command>`. Use this repository's maintainer `npm run validate:*` scripts only when working inside the package repository. npm 7+ does not run dependency uninstall lifecycle scripts, so run the package cleanup command before uninstalling when copied `.agents/skills/` files should be removed:

```bash
npx svelte-redux-toolkit cleanup-skills
```

Then uninstall packages that are no longer needed:

```bash
npm uninstall svelte-redux-toolkit
npm uninstall redux redux-saga typed-redux-saga fast-equals # only if your app no longer uses them
```

See `docs/INSTALLATION.md` for full install, cleanup, and maintainer validation guidance.

## Step 2 — Create the Store with Constructor Maps

Create `src/lib/store/store.ts`:

```typescript
/**
 * Store Instance
 *
 * Create a Store with app-owned reducer and saga maps here.
 * Each reducer-map key becomes an app state domain name (e.g., state.counter).
 * Export AppState from StoreState<typeof store> after constructing the store.
 */
import { Store } from 'svelte-redux-toolkit/store';
import type { StoreState } from 'svelte-redux-toolkit/types';

// Import your slice reducers and sagas here:
// import { counterReducer } from './slices/counter/counter-slice';
// import { counterSaga } from './slices/counter/sagas/counter-saga';

export const store = new Store(
  {
    // counter: counterReducer,
  },
  {
    // counterSaga,
  }
);
export type AppState = StoreState<typeof store>;
```

The `Store` class manages reducer and saga registries internally from constructor maps — no separate registry files or mutating registration calls are needed. Constructor maps preserve `StoreState<typeof store>` inference without an explicit `: Store` annotation. Package-owned slices are mounted by default under reserved `@internal_` domains such as `@internal_storeUtility`; those domains can appear in the inferred type, but application code should not register reducers with that prefix or depend on those internal state shapes directly.

## Step 3 — Wire the Store into Root Layout

Edit your root layout (e.g., `src/routes/+layout.svelte`):

```svelte
<script lang="ts">
  import { store } from '$lib/store/store';
  import { onDestroy } from 'svelte';

  const { children } = $props();

  const dispose = store.init();
  onDestroy(dispose);
</script>

{@render children()}
```

Call `store.init()` during root component initialization and register the returned disposer with `onDestroy`. Under the hood, `store.init()`:

- Combines all registered reducers into the root reducer
- Applies the base store middleware chain and saga middleware
- Starts the package saga manager orchestrator with the registered app-owned saga registry; `@internal_sagaManager` is not added to `getSagas()` or `getSagaNames()`
- Creates the Store-owned readable runtime state used by selector and saga integrations
- Returns a cleanup function that delegates to `store.dispose()` (registered with `onDestroy`)

`store.init()` starts the internal saga manager but does **not** start any registered app sagas. Each app saga must be started explicitly by name — call `store.runSaga('mySaga')` from `onMount` in the layout for mount-scoped cleanup, or keep `const cancel = store.runSaga('mySaga')` for imperative control. It takes a registered app saga name string only — there is no function-form variant. Do not call it with `@internal_sagaManager`. For whole-store teardown outside the root-layout `onDestroy(dispose)` pattern, call `store.dispose()` to tear down the initialized Store runtime and stop saga tasks owned by that Store.

## Step 4 — Create Your First Slice (Verification)

### 4a. Define the slice

Create `src/lib/store/slices/counter/counter-slice.ts`:

```typescript
import { createAction } from 'svelte-redux-toolkit/utils/store/create-action';
import { createReducer } from 'svelte-redux-toolkit/utils/store/create-reducer';

// --- State ---
export type CounterState = {
  count: number;
};

const initialState: CounterState = {
  count: 0,
};

// --- Actions ---
export const increment = createAction('counter/increment');
export const decrement = createAction('counter/decrement');
export const reset = createAction('counter/reset');
export const incrementBy = createAction<[amount: number]>('counter/incrementBy');

// --- Reducer ---
export const counterReducer = createReducer<CounterState>(initialState)
  .with(increment, (state) => ({ ...state, count: state.count + 1 }))
  .with(decrement, (state) => ({ ...state, count: state.count - 1 }))
  .with(reset, () => initialState)
  .with(incrementBy, (state, action) => ({
    ...state,
    count: state.count + action.payload[0],
  }));
```

### 4b. Define selectors

Create `src/lib/store/slices/counter/counter-selectors.ts`:

```typescript
import { store } from '$lib/store/store';

/** Read the count value from state */
export const selectCount = store.createSelector((state) => {
  return state.counter.count;
});

/** Derived selector — checks if count is positive */
export const selectIsPositive = store.createSelector((state) => {
  return selectCount.select(state) > 0;
});
```

### 4c. Define a saga

Create `src/lib/store/slices/counter/sagas/counter-saga.ts`:

```typescript
import { takeEvery, put, delay } from 'typed-redux-saga';
import { createAction } from 'svelte-redux-toolkit/utils/store/create-action';
import { increment } from '../counter-slice';
import { selectCount } from '../counter-selectors';

export const logCount = createAction('counter/logCount');

function* handleLogCount() {
  const count = yield* selectCount.effect();
  console.log(`[Counter] Current count: ${count}`);
}

export function* counterSaga() {
  yield* takeEvery(logCount, handleLogCount);
}
```

### 4d. Add the slice to constructor maps and start its saga

Update `src/lib/store/store.ts`:

```typescript
import { counterReducer } from './slices/counter/counter-slice';
import { counterSaga } from './slices/counter/sagas/counter-saga';

export const store = new Store(
  { counter: counterReducer },
  { counterSaga }
);
```

Registration alone does **not** run the saga. Start it explicitly by name in your root layout after `store.init()`:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { store } from '$lib/store/store';
  import { onDestroy, onMount } from 'svelte';

  const { children } = $props();

  const dispose = store.init();
  onDestroy(dispose);
  onMount(() => store.runSaga('counterSaga'));
</script>

{@render children()}
```

For non-component code (services, tests, IPC handlers), use `store.runSaga('counterSaga')` instead — it returns a cancel function that stops the saga. Both APIs take a registered saga **name string only**; there is no function-form variant. When the whole Store lifetime ends, call `store.dispose()` or the disposer returned by `store.init()` to tear down the initialized Store runtime and stop Store-owned running saga tasks.

### 4e. Use in a component

Create or edit a page component (e.g., `src/routes/+page.svelte`):

```svelte
<script lang="ts">
  import { store } from '$lib/store/store';
  import { increment, decrement, reset } from '$lib/store/slices/counter/counter-slice';
  import { logCount } from '$lib/store/slices/counter/sagas/counter-saga';
  import { selectCount, selectIsPositive } from '$lib/store/slices/counter/counter-selectors';

  // Call selectors at component init (top-level script) — returns Svelte readables
  const count = selectCount();
  const isPositive = selectIsPositive();

</script>

<h1>Count: {$count}</h1>
<p>Is positive: {$isPositive}</p>

<button onclick={() => store.dispatch(increment())}>+1</button>
<button onclick={() => store.dispatch(decrement())}>-1</button>
<button onclick={() => store.dispatch(reset())}>Reset</button>
<button onclick={() => store.dispatch(logCount())}>Log Count</button>
```

## Step 5 — Verify the Setup

1. **Start the dev server:**`npm run dev`
2. **Open the app** in a browser and interact with the counter buttons.
3. **Check the browser console.** Click "Log Count" — you should see:`[Counter] Current count: 1`
4. **Inspect Redux state** from the browser console with `window.svelteRedux.reduxContext.state` if you call `store.initDevTool()` after initialization.

## Step 6 — Debugging Tools (`window.svelteRedux`)

If you register devtools with `store.initDevTool()` after `store.init()`, the initialized Store instance is exposed on `window.svelteRedux`:

| Console Command | Effect |
| --- | --- |
| window.svelteRedux.reduxContext | Access the initialized Store instance (`state`, `dispatch`, `getReadableState()`) |

### Inspecting state from the console:

```javascript
// Get current state
window.svelteRedux.reduxContext.state

// Dispatch an action manually
window.svelteRedux.reduxContext.dispatch({ type: 'counter/increment', payload: undefined })

// Subscribe to readable state
window.svelteRedux.reduxContext.getReadableState().subscribe(console.log)
```

## Quick Reference

### Key Patterns

| Pattern | Import From | Usage |
| --- | --- | --- |
| Create action (no payload) | svelte-redux-toolkit/utils/store/create-action | createAction('slice/name') |
| Create action (with payload) | svelte-redux-toolkit/utils/store/create-action | createAction<[string, number]>('slice/name') |
| Create reducer | svelte-redux-toolkit/utils/store/create-reducer | createReducer<State>(init).with(action, handler) |
| Create app selector | configured Store instance | store.createSelector((state) => state.slice.field) |
| Selector in component | — | const val = selectFoo() → {$val} |
| Selector in event handler | imported/captured initialized Store instance | selectFoo.select(store.state) |
| Selector in saga | — | yield* selectFoo.effect() |
| Dispatch in component | configured Store instance | store.dispatch(action) |
| Dispatch outside Svelte | existing initialized Store instance | store.dispatch(action) |

### Slice File Conventions

The user creates their own slice files under `src/lib/store/slices/<name>/` — these are your application code, not package source. Import builder APIs such as `createAction` and `createReducer` from their explicit utility leaf subpaths (`svelte-redux-toolkit/utils/store/create-action` and `svelte-redux-toolkit/utils/store/create-reducer`); import the configured app `store` and use `store.createSelector(...)` for app-local selectors and `store.dispatch(...)` for dispatch.

```
src/lib/store/slices/<name>/
├── <name>-slice.ts           # State type, actions, reducer
├── <name>-selectors.ts       # Selectors
├── <name>-types.ts           # Shared types (optional, for cross-process use)
└── sagas/
    └── <name>-saga.ts        # Side effects
```

### Rules

- **Reducers must be pure** — no side effects, no mutations, return new objects.
- **State must be serializable** — no `Date`, `Map`, `Set`, `RegExp`, `Promise`, `Function`.
- **Actions use **`sliceName/actionName` naming convention.
- **Call selector readables at component init** (top-level `<script>`) — they use Svelte context. Dispatch through the configured Store instance.
- **Side effects go in sagas**, not components.
- **Use **`Collection<T, K>` for entity storage, never plain arrays of objects.