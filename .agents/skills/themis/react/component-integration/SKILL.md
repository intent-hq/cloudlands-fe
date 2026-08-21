---
name: react/component-integration
description: >-
  ReactStore component integration guidance for React app/root wiring. Covers
  where to create/configure ReactStore, init/dispose ownership, app saga startup
  with reactStore.runSaga(sagaFn), direct selector signal reads in JSX/TSX,
  Babel transform/useSignals tracking, selector .useValue(...args) fallbacks for hook/plain-value boundaries, and
  Store-first dispatch and React lifecycle ownership.
type: sub-skill
requires:
  - react
  - react/store
  - react/selector-lifecycle
sources:
  - "@augmentcode/themis/react-store"
  - ../signals/SKILL.md
  - ../selector-lifecycle/SKILL.md
  - ../store/SKILL.md
triggers:
  - React component integration
  - ReactStore component wiring
  - TSX Store dispatch
  - React signal component
  - selector .useValue component
---
# React component integration — ReactStore app wiring

Use this skill when a React/TSX app has chosen the `ReactStore` family. Create
one configured `ReactStore`, initialize it before React renders selector-using
components, start app sagas after initialization, and dispatch through that same
configured store instance from components and handlers.

This is React Store family guidance for JSX/TSX components, custom hooks, and
the app bootstrap boundary.

## 1. Create and configure the app `ReactStore`

Create the store in an app-owned module, not inside a component render or custom
hook. Pass app-owned reducers in the constructor map, optional middleware as the
second argument, and options such as `throttledSelectorFrequency` as the third
argument when needed.

```ts
// src/store/react-store.ts
import { ReactStore } from "@augmentcode/themis/react-store";
import type { StoreState } from "@augmentcode/themis/types";
import { todosReducer } from "./todos/todos-slice";

export const reactStore = new ReactStore({ todos: todosReducer });
export type AppState = StoreState<typeof reactStore>;
```

Key rules:

- Use `ReactStore` only from `@augmentcode/themis/react-store` for this React app
  path.
- Use `reactStore.createSelector(...)` for app-local selectors so state inferencefollows the configured store.
- Do not add package-owned `@internal_` reducers or internal sagas.
- Do not create a new `ReactStore` per component, route, hook call, or render.

## 2. Initialize before React renders selector users

Call `reactStore.init(initialState?)` once at the app bootstrap/root ownership
boundary before rendering components that call direct signal selectors or
`.useValue(...args)` fallbacks. The returned disposer is equivalent to
`reactStore.dispose()`.

```tsx
// src/main.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { reactStore } from "./store/react-store";

const root = createRoot(document.getElementById("root")!);
const disposeStore = reactStore.init();

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
    disposeStore();
  });
}
```

Pass preloaded state to `reactStore.init(preloadedState)` when the app needs
hydration. Initialize before selector reads because direct selector calls need the
active Store-owned state stream and throw before `init()` and after `dispose()`.

## 3. Dispose at the same owner boundary

The owner that calls `reactStore.init()` owns teardown. In browser apps this isusually the bootstrap file or test harness; in embedded/micro-frontend apps it maybe the host's mount/unmount adapter.

```tsx
export function mountReactApp(container: HTMLElement) {
  const root = createRoot(container);
  const disposeStore = reactStore.init();

  root.render(<App />);

  return () => {
    root.unmount();
    disposeStore();
  };
}
```

Do not hide `init()` in a child component `useEffect` if descendants render
selectors immediately; effects run after render, too late for direct signal
selectors or `.useValue(...args)` fallbacks that need the initialized store.

## 4. Start app sagas with `reactStore.runSaga(sagaFn)`

`reactStore.init()` starts package-owned runtime work but does not auto-start app
sagas. Start each app saga explicitly after initialization and keep the returned
cancel function when the saga has a shorter lifetime than the whole store.

```ts
// src/main.tsx
import { reactStore } from "./store/react-store";
import { todosSaga } from "./store/todos/sagas/todos-saga";

const disposeStore = reactStore.init();
const cancelTodosSaga = reactStore.runSaga(todosSaga);

export function disposeAppRuntime() {
  cancelTodosSaga();
  disposeStore();
}
```

`reactStore.runSaga(sagaFn)` throws if `init()` has not been called or the saganame is reserved for package internals. Do not start `@internal_sagaManager`directly.

## 5. Read state in components with direct selector signals

React components and custom hooks should prefer direct selector calls and pass/read
the returned `ReadonlySignal<R>` where the Preact React signal integration
supports it. Use `.useValue(...args)` only for third-party components, existing
boundaries, or hook contracts that require a plain value and are impractical to
adapt.

When a component reads `signal.value`, make sure the file is covered by the
`@preact/signals-react` Babel transform or call `useSignals()` from
`@preact/signals-react/runtime` in the reading component/custom hook. Passing a
`ReadonlySignal<T>` to a signal-aware child, or rendering a signal directly in a
JSX text position, is valid when intentional; do not treat the signal object as a
plain value for props, conditions, array operations, or serialization.

```tsx
import { reactStore } from "../store/react-store";
import { selectTodoById } from "../store/todos/todos-selectors";
import { toggleTodo } from "../store/todos/todos-slice";

export function TodoRow({ id }: { id: string }) {
  const todo = selectTodoById(id);

  if (!todo.value) return null;

  return (
    <button onClick={() => reactStore.dispatch(toggleTodo(id))}>
      {todo.value.completed ? "✓" : "○"} {todo.value.title}
    </button>
  );
}
```

Component rules:

- Prefer direct selector calls for signal-aware components and custom hooks.
- Ensure `.value` reads are tracked by the Babel transform or `useSignals()`.
- Use `.useValue(...args)` only in React components or custom hooks that truly need a
  plain value.
- Import or otherwise receive the configured `ReactStore` instance and dispatch
  with `reactStore.dispatch(action)` in event handlers.
- Use `.select(reactStore.state, ...args)` for one-shot reads inside handlers,
  callbacks, tests, or pure composition.
- Do not use `.useValue(...args)` as the default just to avoid adapting a consumer to
  accept a Preact React signal object.
- Do not create `useEffect` or custom hooks that carry business logic or side effects
  (API calls, persistence, timers, subscriptions, event listeners, async workflows);
  dispatch an action and handle the work in a saga instead. DOM-local effects (focus,
  scroll, measurement) remain allowed. See `../../core/core-policy/SKILL.md` §3 and
  `../migration/side-effects/SKILL.md`.

## 6. Event-handler one-shot reads

Handlers should not call `.useValue(...args)` and should not create direct signals just
to read once. Use `.select(state, ...args)` with the initialized app store state
already in scope, then dispatch through the configured store.

```tsx
function DeleteTodoButton({ id }: { id: string }) {
  function onDelete() {
    const todo = selectTodoById.select(reactStore.state, id);
    if (todo && !todo.completed) {
      reactStore.dispatch(deleteTodo(id));
    }
  }

  return <button onClick={onDelete}>Delete</button>;
}
```

## 7. Common mistakes

### Initializing in an effect after children render

```tsx
// ❌ WRONG: children can call selectors before init has run.
function AppRoot() {
  React.useEffect(() => reactStore.init(), []);
  return <App />;
}
```

Initialize at the bootstrap/root owner before rendering selector users, or render
no selector-using children until after explicit initialization has completed.

### Creating stores in components or hooks

```tsx
// ❌ WRONG: a new runtime can be created every render/mount.
function TodoScreen() {
  const localStore = new ReactStore({ todos: todosReducer });
  const todos = localStore.createSelector((state) => state.todos.ids)();
  return <TodoList ids={todos.value} />;
}
```

Create/configure the store once in an app module or explicit mount adapter.

### Treating direct selector signals as plain values

```tsx
// ❌ WRONG: todos is a ReadonlySignal<Todo[]>, not Todo[].
function TodoCount() {
  const todos = selectTodos();
  return <span>{todos.length}</span>;
}
```

Read `todos.value.length` in a tracked component, pass the signal to a
signal-aware child, or use `.useValue(...args)` only at a documented plain-value
fallback boundary.

## 8. See also

- `react/store/SKILL.md` — `ReactStore` import, lifecycle, and Store runtime behavior.
- `react/signals/SKILL.md` — Preact Signals `.value`, tracking, direct JSX signal
  rendering, and component-local signal hooks.
- `react/selector-lifecycle/SKILL.md` — selector call modes across components,handlers, tests, composition, explicit binding, and sagas.
- `react/selectors/SKILL.md` — selector authoring for Preact React signals.
- `../../setup/SKILL.md` — first-time Store-family selection and setup.