---
name: setup
description: >-
  Canonical first-time themis setup entry. Start here for greenfield app
  setup, choose exactly one concrete Store family before creating files, and adapt
  imports, selector call modes, lifecycle, saga startup, and verification to that
  family.
triggers:
  - init redux
  - setup store
  - new project
  - bootstrap redux
  - setup redux saga
  - add redux to svelte
  - add redux to react
  - setup ReactStore
  - setup StreamingStore
  - setup redux in node
  - initialize state management
---
# Init themis — Canonical Greenfield Setup

## Agent Preflight Compliance Contract

Before editing code or docs under this skill:

- **MUST** read this skill plus `../SKILL.md` and every linked skill/doc that applies to the touched files.
- **MUST** cite the applicable skills/docs in the implementation plan or completion handoff, including the rules used.
- **MUST** include verifier-ready evidence: searches, tests, or diff checks proving the cited rules were followed.
- **MUST** decide and record exactly one concrete Store family for the app/package/code path before creating or editing setup files.
- **MUST** collect concrete routing evidence first: Svelte/SvelteKit evidence chooses `Store`; React evidence chooses `ReactStore`; Node/server/worker/CLI/test/no-UI or observable evidence chooses `StreamingStore` by default.
- **MUST** keep `Store`, `ReactStore`, and `StreamingStore` mutually exclusive inside one app/package/code path. Separate apps in a mixed repository may choose different families only when their files and runtime lifecycles are isolated.
- **MUST** keep active greenfield setup routing on this root setup skill, not under a family-specific setup path.
- **SHOULD** stop and ask when rules conflict or scope is unclear.
- **NEVER** claim completion when a required skill/doc was skipped or the handoff lacks compliance evidence.

> Canonical setup guide for bootstrapping a new app with the themis package. Follow the branch that matches the one concrete Store family chosen for the app.

## Store-family decision gate

Make this decision before creating `store.ts`, selectors, root lifecycle wiring, sagas, or tests. Record the evidence in the handoff.

| Evidence in the target app/package/code path | Choose | Import | Read next |
| --- | --- | --- | --- |
| Concrete Svelte/SvelteKit evidence: svelte.config.*, .svelte files, SvelteKit +layout/+page, imports from svelte, $selector template reads, Svelte readable expectations | Svelte Store family | Store from @augmentcode/themis/svelte-store | ../svelte/SKILL.md, ../svelte/component-integration/SKILL.md, ../svelte/selectors/SKILL.md |
| Concrete React evidence: React dependencies in the app path, JSX/TSX React components/hooks, imports from react, ReactStore, Preact React signal selectors, direct signal reads, or necessary .useValue(...args) fallback reads | React Store family | ReactStore from @augmentcode/themis/react-store | ../react/SKILL.md, ../react/store/SKILL.md, ../react/selectors/SKILL.md |
| Node services, server routes, background workers, CLIs, scripts, test harnesses, no-UI paths, Kefir/observable selector arguments, or no concrete Svelte/React evidence | Streaming Store family by default | StreamingStore from @augmentcode/themis/streaming-store | ../streaming/SKILL.md, ../streaming/store/SKILL.md, ../streaming/selectors/SKILL.md, ../streaming/selector-lifecycle/SKILL.md |

**Mutual exclusivity rule:** one app/package/code path must not mix concrete Store families. Do not import more than one of `Store`, `ReactStore`, and `StreamingStore` into the same setup path, do not mix Svelte readable `$selector` patterns with React `.useValue(...)` or Kefir observables, and do not reuse lifecycle examples across families except as explicit contrast notes.

## Branch setup adapters

Use the shared slice/action/reducer/saga examples below for all families, but adapt the Store-specific seams with this matrix before writing files:

| Setup seam | Svelte Store | React Store | Streaming Store |
| --- | --- | --- | --- |
| Store import and instance | import { Store } from '@augmentcode/themis/svelte-store'; export const store = new Store({ counter: counterReducer }) | import { ReactStore } from '@augmentcode/themis/react-store'; export const reactStore = new ReactStore({ counter: counterReducer }) | import { StreamingStore } from '@augmentcode/themis/streaming-store'; export const streamStore = new StreamingStore({ counter: counterReducer }) |
| State bridge expectation | store.init() creates the Store-owned state stream; direct selector calls return Svelte readables and window.svelteRedux.reduxContext exposes state/dispatch for devtool inspection | reactStore.init() creates the Store-owned state stream; direct selector calls return Preact React signals | streamStore.init() creates the Store-owned Kefir state stream; direct selector calls return Kefir observables |
| Selector direct call mode | selectFoo() returns a Svelte readable and belongs at Svelte component init; templates use $foo | selectFoo() returns a ReadonlySignal<R> and is the preferred React consumer path; use selectFoo.useValue(...args) only for necessary plain-value boundaries | selectFoo() returns a Kefir Observable<R, any>; consumers own observation/subscription teardown |
| Non-render selector reads | .select(state, ...args) for tests, handlers, and selector composition; yield* selectFoo.effect(...args) in sagas | Same .select(...) and saga .effect(...); .useValue(...) is not a saga/test helper | Same .select(...) and saga .effect(...); observable calls are not Svelte readables or React hooks |
| Initialization owner | Svelte root layout calls const dispose = store.init(); onDestroy(dispose) before children use selectors | App bootstrap initializes reactStore before React selector reads; dispose when the root/test owner unmounts or exits | Process/server/test owner initializes streamStore before observing selector streams; dispose when that owner exits |
| App saga startup | store.init() starts package internals only; call store.runSaga(counterSaga) after init, often from Svelte onMount | reactStore.init() starts package internals only; call reactStore.runSaga(counterSaga) after init and retain/call the cancel function in the bootstrap owner | streamStore.init() starts package internals only; call streamStore.runSaga(counterSaga) after init and cancel it before/with store disposal |
| Optional Store options | Pass selector scheduling or diagnostics as the third constructor argument: new Store(reducers, middleware, { throttledSelectorFrequency, sagaMonitor: true, traceSelectors: true }) | Same third-argument options shape on ReactStore; omit sagaMonitor/traceSelectors to keep diagnostics disabled | Same third-argument options shape on StreamingStore; omit sagaMonitor/traceSelectors to keep diagnostics disabled |
| Verification | Svelte component renders $count, dispatch buttons work, optional window.svelteRedux inspection after initDevTool() | React component/custom hook prefers selectCount() as a signal and reads .value where supported; .useValue() appears only for necessary plain-value fallback reads and no Svelte $ syntax appears | Kefir observer receives selector values after init, stream subscriptions are stopped, no Svelte/React render lifecycle appears |

### Svelte Store branch minimum setup

Choose this branch only for a Svelte/SvelteKit app path with concrete Svelte evidence. Do not add `ReactStore`, `StreamingStore`, React `.useValue(...)`, Preact signals, Kefir/observable selector, React setup, or streaming lifecycle patterns to the same app.

```ts
import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreState } from '@augmentcode/themis/types';

export const store = new Store({ counter: counterReducer });
export type AppState = StoreState<typeof store>;
```

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { store } from '$lib/store/store';
  import { counterSaga } from '$lib/store/slices/counter/sagas/counter-saga';

  const dispose = store.init();
  onDestroy(dispose);
  onMount(() => store.runSaga(counterSaga));
</script>
```

### React Store branch minimum setup

Choose this branch only for a React UI app path with concrete React evidence. Do not copy Svelte readable component-init or StreamingStore/Kefir examples into the same app.

```ts
import { ReactStore } from '@augmentcode/themis/react-store';
import type { StoreState } from '@augmentcode/themis/types';

export const reactStore = new ReactStore({ counter: counterReducer });
export type AppState = StoreState<typeof reactStore>;
```

```tsx
const dispose = reactStore.init();
const cancelCounterSaga = reactStore.runSaga(counterSaga);

function Counter() {
  const count = selectCount();
  return <button onClick={() => reactStore.dispatch(increment())}>{count.value}</button>;
}

// root/test teardown owner:
cancelCounterSaga();
dispose();
```

### Streaming Store branch minimum setup

Choose this branch by default for Node/server/worker/CLI/test/no-UI paths, or whenever the app wants Kefir/observable selector calls. Do not copy Svelte component lifecycle or React `.useValue(...)` examples into the same app.

```ts
import { StreamingStore } from '@augmentcode/themis/streaming-store';
import type { StoreState } from '@augmentcode/themis/types';

export const streamStore = new StreamingStore({ counter: counterReducer });
export type AppState = StoreState<typeof streamStore>;
```

```ts
const dispose = streamStore.init();
const cancelCounterSaga = streamStore.runSaga(counterSaga);
const countSubscription = selectCount().observe((count) => {
  console.log(`[Counter] Current count: ${count}`);
});

// process/test teardown owner:
countSubscription.unsubscribe();
cancelCounterSaga();
dispose();
```

## Svelte Store branch working example

The detailed walkthrough below is the Svelte/SvelteKit branch. For React or Streaming apps, keep the shared slice/reducer/saga structure but swap every Store-specific seam using the branch setup adapters above.

## Step 1 — Install Dependencies

```bash
npm install @augmentcode/themis redux redux-saga typed-redux-saga fast-equals
```

Svelte 5 is also a required peer dependency and is assumed to already be installed in your Svelte project.

For testing sagas (optional, recommended):

```bash
npm add -D redux-saga-test-plan
```

Package installation does not copy AI skills automatically. In a consumer app, choose the smallest explicit bundle from the decision gate above and use the installed CLI:

```bash
npx themis install-skills:react
npx themis install-skills:svelte
npx themis install-skills:streaming
npx themis install-skills:core
npx themis install-skills
npx themis help
```

The selected files are copied to canonical `.agents/skills/themis/`; a `.claude/skills/themis` compatibility link is created or reused. Repeating the command refreshes package-owned files; collisions and user-authored files are preserved. For the canonical destination, verification, cleanup-before-uninstall, and separate source-checkout maintainer workflow, read [@augmentcode/themis/docs/INSTALLATION.md](@augmentcode/themis/docs/INSTALLATION.md):

```bash
npm exec -- themis install-skills:svelte
npx themis cleanup-skills
```

Then uninstall packages that are no longer needed:

```bash
npm uninstall @augmentcode/themis
npm uninstall redux redux-saga typed-redux-saga fast-equals # only if your app no longer uses them
```

Do not replace consumer commands with the repository's maintainer validation scripts; those are documented separately in `@augmentcode/themis/docs/INSTALLATION.md`.

## Step 2 — Create the Store and Register App Sagas

Create `src/lib/store/store.ts`:

```typescript
/**
 * Store Instance
 *
 * Create a Store with app-owned reducers and register app sagas here.
 * Each reducer-map key becomes an app state domain name (e.g., state.counter).
 * Export AppState from StoreState<typeof store> after constructing the store.
 */
import { Store } from '@augmentcode/themis/svelte-store';
import type { StoreState } from '@augmentcode/themis/types';

// Import your slice reducers and sagas here:
// import { counterReducer } from './slices/counter/counter-slice';
// import { counterSaga } from './slices/counter/sagas/counter-saga';

export const store = new Store({
  // counter: counterReducer,
});
export type AppState = StoreState<typeof store>;
```

The `Store` class accepts app reducer maps in the constructor. Start app sagas explicitly with `store.runSaga(sagaFn)` after `store.init()` — no separate saga registry files are needed. Constructor reducer maps preserve `StoreState<typeof store>` without an explicit `: Store` annotation. Optional selector scheduling and diagnostics configuration belongs in the third constructor argument, for example `new Store(reducers, undefined, { throttledSelectorFrequency: 64, sagaMonitor: true, traceSelectors: true })`; omit `sagaMonitor` and `traceSelectors` (or pass `false`) to keep both diagnostics disabled, and do not replace Store-owned saga middleware for monitoring. Package-owned slices are mounted by default under reserved `@internal_` domains such as `@internal_storeUtility`; those domains can appear in the inferred type, but application code should not register reducers with that prefix or depend on those internal state shapes directly.

This setup chooses `Store` readable selector behavior for the app.Do not switch examples or app wiring to `StreamingStore` or Kefir selectors here.

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
- Starts the package saga manager orchestrator
- Creates the Store-owned selector state resources used by Svelte selectors
- Returns a cleanup function that delegates to `store.dispose()` (registered with `onDestroy`)

`store.init()` starts the internal saga manager but does **not** start app sagas. Each app saga must be started explicitly by function — call `store.runSaga(counterSaga)` from `onMount` in the layout for mount-scoped cleanup, or keep `const cancel = store.runSaga(counterSaga)` for imperative control. Store derives the manager name from the saga function. Do not call it with `@internal_sagaManager`. For whole-store teardown outside the root-layout `onDestroy(dispose)` pattern, call `store.dispose()` to tear down the initialized Store runtime and stop saga tasks owned by that Store.

## Step 4 — Create Your First Slice (Verification)

### 4a. Define the slice

Create `src/lib/store/slices/counter/counter-slice.ts`:

```typescript
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

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
import { createAction } from '@augmentcode/themis/utils/store/create-action';
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

### 4d. Add the reducer and start the saga

Update `src/lib/store/store.ts`:

```typescript
import { counterReducer } from './slices/counter/counter-slice';
import { counterSaga } from './slices/counter/sagas/counter-saga';

export const store = new Store({ counter: counterReducer });
```

`store.init()` does **not** run the saga. Start it explicitly by function in your root layout after `store.init()`:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { store } from '$lib/store/store';
  import { counterSaga } from '$lib/store/slices/counter/sagas/counter-saga';
  import { onDestroy, onMount } from 'svelte';

  const { children } = $props();

  const dispose = store.init();
  onDestroy(dispose);
  onMount(() => store.runSaga(counterSaga));
</script>

{@render children()}
```

For non-component code (services, tests, IPC handlers), use `store.runSaga(counterSaga)` instead — it returns a cancel function that stops the saga. When the whole Store lifetime ends, call `store.dispose()` or the disposer returned by `store.init()` to tear down the initialized Store runtime and stop Store-owned running saga tasks.

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

## Step 5 — Verify the Chosen Family Setup

1. **Run the app or target owner** (`npm run dev`, the server/worker/CLI entry, or the focused test harness) and confirm initialization happens before selector reads.
2. **Dispatch through the chosen Store instance** and confirm the counter changes.
3. **Start app sagas explicitly after init.** Click or invoke the `logCount` action and confirm `[Counter] Current count: 1` appears.
4. **Check family-specific selector behavior:**
  - Svelte: component-init `selectCount()` returns a readable used as `$count`; optional browser inspection uses `window.svelteRedux.reduxContext.state` after `store.initDevTool()`.
  - React: direct `selectCount()` returns a signal value for React components/custom hooks to read where supported; `selectCount.useValue()` is only a plain-value fallback, not a Svelte readable or Kefir observable.
  - Streaming: `selectCount()` returns a Kefir observable after `streamStore.init()`; observers receive updates and unsubscribe during teardown.
5. **Search for family mixing before handoff.** The same app/package/code path should not import or demonstrate multiple concrete Store families.

## Step 6 — Svelte Debugging Tools (`window.svelteRedux`)

If you register devtools with `store.initDevTool()` after `store.init()`, the initialized Store instance is exposed on `window.svelteRedux`:

| Console Command | Effect |
| --- | --- |
| window.svelteRedux.reduxContext | Access the initialized Store instance (state, dispatch) |

### Inspecting state from the console:

```javascript
// Get current state
window.svelteRedux.reduxContext.state

// Dispatch an action manually
window.svelteRedux.reduxContext.dispatch({ type: 'counter/increment', payload: undefined })

// Read the current Store state snapshot
window.svelteRedux.reduxContext.state
```

## Quick Reference

### Key Patterns

| Pattern | Import From | Usage |
| --- | --- | --- |
| Create action (no payload) | @augmentcode/themis/utils/store/create-action | createAction('slice/name') |
| Create action (with payload) | @augmentcode/themis/utils/store/create-action | createAction<[string, number]>('slice/name') |
| Create reducer | @augmentcode/themis/utils/store/create-reducer | createReducer<State>(init).with(action, handler) |
| Create app selector | configured chosen Store instance | store.createSelector((state) => state.slice.field) |
| Selector in Svelte component | Svelte Store branch only | const val = selectFoo() → {$val} |
| Selector in React component/custom hook | React Store branch only | const val = selectFoo() → ReadonlySignal<R>; use selectFoo.useValue() only when a plain value is necessary |
| Selector in streaming consumer | Streaming Store branch only | const val$ = selectFoo() → Kefir observable |
| Selector in event handler | imported/captured initialized Store instance | selectFoo.select(store.state) |
| Selector in saga | — | yield* selectFoo.effect() |
| Dispatch in component/consumer | configured chosen Store instance | store.dispatch(action) |
| Dispatch outside UI | existing initialized chosen Store instance | store.dispatch(action) |

### Slice File Conventions

The user creates their own slice files under `src/lib/store/slices/<name>/` — these are your application code, not package source. Import builder APIs such as `createAction` and `createReducer` from their explicit utility leaf subpaths (`@augmentcode/themis/utils/store/create-action` and `@augmentcode/themis/utils/store/create-reducer`); import the configured app Store instance (`store`, `reactStore`, or `streamStore`) and use that instance for `createSelector(...)` and `dispatch(...)`.

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
- **Use the chosen family call mode only**: Svelte selector readables at component init, React direct selector signals in components/custom hooks with `.useValue(...args)` only as a necessary plain-value fallback, or Streaming Kefir observables in non-UI/observable consumers. Dispatch through the configured Store instance.
- **Do not mix Store families** inside one app/package/code path.
- **Side effects go in sagas**, not components.
- **Use **`Collection<T, K>` for entity storage, never plain arrays of objects.