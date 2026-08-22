---
name: react/selectors
description: >-
  Author ReactStore selectors whose direct calls return Preact React
  ReadonlySignal values and are the preferred React consumer integration path.
  Covers signal selector arguments, .value tracking via Babel transform or
  useSignals(), Store-bound creation, .useValue(...args) as a fallback for
  hook/plain-value boundaries, .withStore(reactStore), pure .select(state)
  composition/testing, and saga-only .effect() usage without
  importing React selector internals.
type: sub-skill
requires:
  - react
  - core/state-integrity
sources:
  - "@augmentcode/themis/react-store"
  - "@preact/signals-react"
  - "@preact/signals-react/runtime"
  - "@augmentcode/themis/docs/SELECTORS.md"
  - ../signals/SKILL.md
triggers:
  - React selector
  - direct selector signal
  - selector .useValue
  - selector .withStore
  - selector .select
  - selector .effect
  - signal selector
  - ReadonlySignal selector
  - ReactStore selector
---
# React selectors — signal-first call model

Use this skill when `store.createSelector(...)` belongs to a `ReactStore` and
direct selector calls should produce Preact React `ReadonlySignal<R>` results.
Direct selector calls are the preferred React consumer integration path when
callers can pass, read, or render signals through the Preact React signal
integration. Components that read `.value` must be tracked by the Preact Signals
Babel transform or an explicit `useSignals()` fallback. Use `.useValue(...args)`
only when a hook/plain value is required and adapting the consumer to accept a
signal is impractical.

## Authoring rules

- Create selectors through the configured `ReactStore` instance.
- Keep selector callbacks pure and derived-only; reducers must not store selector
  outputs.
- Compose selectors with `.select(state, ...args)` inside another selector.
- Trust Store-owned selector-result caching and signal scheduling; do not wrap Store-created selectors in extra `memoize`, `cache`, debounce/throttle, manual cache maps, or scheduler helpers.
- Prefer primitive scalar selector arguments over freshly constructed object,
  array, or function arguments; object/function args are valid only when their
  identity is stable and intentional.
- Do not import from `themis` React selector internal deep paths.

```tsx
import { ReactStore } from "@augmentcode/themis/react-store";
import type { ReadonlySignal } from "@preact/signals-react";

export const reactStore = new ReactStore({ todos: todosReducer });
export const selectTodo = reactStore.createSelector((state, id: string) => {
  return state.todos.collection.map[id];
});

type Todo = { title: string } | undefined;

function TodoTitle({ todo }: { todo: ReadonlySignal<Todo> }) {
  return <span>{todo.value?.title}</span>;
}

function TodoRow({ id }: { id: string }) {
  const todo = selectTodo(id);
  return <TodoTitle todo={todo} />;
}
```

## Call forms

| Context | Use | Result |
| --- | --- | --- |
| Preferred React/signal-aware consumer | `selectFoo(...argsOrSignals)` | `ReadonlySignal<R>` |
| Hook/plain-value fallback | `selectFoo.useValue(...argsOrSignals)` | Plain value `R` |
| Explicit ReactStore binding | `selectFoo.withStore(reactStore)(...argsOrSignals)` | `ReadonlySignal<R>` |
| Tests/handlers/composition | `selectFoo.select(state, ...args)` | Plain value `R` |
| Sagas | `yield* selectFoo.effect(...args)` | typed-redux-saga select effect |

Selector arguments may be plain values or Preact React `ReadonlySignal` values
for direct calls, `.useValue(...args)`, and `.withStore(...)(...args)`. Signal
arguments are unwrapped by reading `.value` inside the computed selector, so the
derived selector signal updates when either Store state or signal arguments
change. `.select(state, ...args)` and `.effect(...args)` are plain synchronous or
saga paths; pass plain argument values there instead of signal wrappers.

Prefer direct signal outputs for React consumers that can accept signals; they
and `.useValue(...args)` are throttled by the owning `ReactStore`'s
`throttledSelectorFrequency` option, defaulting to `64` FPS. `.useValue(...args)`
remains valid only for third-party APIs, legacy component boundaries, or custom
hooks that must return a plain value. Selector trace output is disabled by
default; pass `{ traceSelectors: true }` in the final Store options object only
for temporary diagnostics. `.effect(...args)` is saga-only; it is not a React
hook, signal subscription, or throttled render path.

Selector-channel helpers that consume `.select`/`.effect`-compatible selectors
run in sagas and support `ReactStore` selectors through the same shared selector
  read shape used by ReactStore selectors. Pass plain stable selector arguments as
  the helper args tuple; selector-channel effects subscribe through the Redux store
  object's `getState()` / `subscribe()` context path, not through React signals.

## Selector caching

- Store-created selectors have internal selector-result caching/memoization.
- Direct React `ReadonlySignal` outputs are cached per ReactStore instance + selector + arguments; repeated `selectFoo(args)` calls for the same store reuse the same `ReadonlySignal`.
- Do not wrap selector callbacks, direct signal calls, or `.useValue(...args)` calls in extra `memoize`, `cache`, manual cache maps, debounce, or throttle layers solely for performance.
- Prefer the same Store-bound selector + same arguments over props drilling when the receiving consumer can reasonably call the selector in valid React/signal context; otherwise use `.select`, `.effect`, `.withStore`, or `.useValue` as the boundary requires.

## Stable selector arguments

- Prefer primitive scalar selector arguments: ids, booleans, enum strings,
  numbers, `null`, or `undefined`.
- Do not pass freshly constructed object, array, or function arguments to direct
  `selectFoo(...)`, `.useValue(...)`, `.select(state, ...)`, `.effect(...)`,
  `.withStore(store)(...)`, selector-channel args tuples, or `waitFor` args
  tuples.
- Object/function args are valid only when the identity is stable and intentional,
  such as a module constant, memoized config, existing source object, or Preact
  signal. Signal arguments are valid direct-call inputs because the selector
  tracks their `.value`; do not recreate the signal solely for a selector call.
- Prefer selector definitions like `(state, id, includeDone)` over
  `(state, { id, includeDone })`; destructure an object arg only when callers pass
  a documented stable reference.

## Call-mode examples

### 1. React component direct signal use

```tsx
import type { ReadonlySignal } from "@preact/signals-react";
import { selectTodo } from "./todos-selectors";

type Todo = { title: string; completed: boolean } | undefined;

function TodoLabel({ todo }: { todo: ReadonlySignal<Todo> }) {
  return <span>{todo.value?.title ?? "Untitled"}</span>;
}

export function TodoRow({ id }: { id: string }) {
  const todo = selectTodo(id);
  return <TodoLabel todo={todo} />;
}
```

The `.value` read must be covered by the Preact Signals Babel transform or by an
explicit `useSignals()` call in the reading component. Passing the
`ReadonlySignal<Todo>` through props is preferred over converting it to a plain
value when the child can be signal-aware.

### 2. Signal arguments update derived selectors

```tsx
import { useSignal } from "@preact/signals-react";
import { selectVisibleTodos } from "./todos-selectors";

export function FilteredTodos() {
  const filter = useSignal("open");
  const todos = selectVisibleTodos(filter);
  return <TodoList todos={todos} onFilterChange={(next) => filter.value = next} />;
}
```

The selector receives a signal argument and internally tracks `filter.value`.
Consumers still receive a `ReadonlySignal<R>` result.

### 3. Plain-value fallback with `.useValue(...args)`

```tsx
export function LegacyTodoBadge({ id }: { id: string }) {
  const todo = selectTodo.useValue(id);
  return <LegacyBadge label={todo?.title ?? "Untitled"} />;
}
```

Use this only when `LegacyBadge` or the surrounding hook contract requires a
plain value and cannot reasonably accept `ReadonlySignal<Todo>`.

### 4. Pure composition and tests with `.select(state, ...args)`

```ts
export const selectOpenTodoTitles = reactStore.createSelector((state) => {
  return selectTodos.select(state)
    .filter((todo) => !todo.completed)
    .map((todo) => todo.title);
});

expect(selectOpenTodoTitles.select(mockState)).toEqual(["Write docs"]);
```

`.select(...)` is pure and synchronous. Use it inside selector callbacks, tests,
and one-shot handlers when an explicit state snapshot is already available.

### 5. Explicit alternate binding with `.withStore(reactStore)`

```ts
const selectPreviewTodo = selectTodo.withStore(previewReactStore);
const previewTodo = selectPreviewTodo("todo-1");
```

For React selectors, `.withStore(...)` accepts another `ReactStore` and returns a
direct-call binding whose calls produce `ReadonlySignal<R>`.

### 6. Saga read with `.effect(...args)`

```ts
import { call } from "typed-redux-saga";
import { selectTodo } from "./todos-selectors";

export function* persistTodo(todoId: string) {
  const todo = yield* selectTodo.effect(todoId);
  if (todo) yield* call(api.saveTodo, todo);
}
```

`.effect(...args)` is saga-only. It does not create a React signal or call React
hooks.

### 7. ❌ Bad: treating a signal as a plain value

```tsx
export function TodoTitle({ id }: { id: string }) {
  const todo = selectTodo(id);
  return <span>{todo.title}</span>;
}
```

React selector direct calls return Preact React signals, not plain values. Use
`todo.value`, pass/render the signal intentionally, or choose
`.useValue(...args)` only at a real plain-value fallback boundary.

## Don't

- Do not call `.useValue(...args)` outside React components or custom hooks.
- Do not choose `.useValue(...args)` as the default React render path when a component
  or helper can be adapted to accept a `ReadonlySignal<R>`.
- Do not treat a direct selector result as a plain array/object/string/boolean;
  read `.value` in a tracked component, pass/render the signal intentionally, or
  use `.useValue(...args)` at a documented fallback boundary.
- Do not use selector lifecycle rules outside the ReactStore call modes described
  above.
- Do not call another selector's direct signal form inside a selector callback; use
  `.select(state)` to keep composition pure and synchronous.
- Do not add manual memoization or throttling wrappers around selector calls, direct signals, or `.useValue(...)`; configure selector coalescing through the owning `ReactStore` options instead.
- Do not props-drill derived values solely to avoid selector calls when the consumer can call the same Store-bound selector with the same args in a valid React/signal context.
- Do not use standalone React selector utilities as public package imports.
- Do not construct `{ ... }`, `[ ... ]`, or `() => ...` selector arguments inline
  during render or hook execution; use scalar args or a stable intentional
  reference.

## Verification cues

- React component examples prefer direct selector calls and pass/read
  `ReadonlySignal` values when signal integration supports it, with `.value`
  reads covered by the Babel transform or explicit `useSignals()` fallback.
- `.useValue(...args)` examples are framed as hook/plain-value fallback reads, not the
  default consumer path.
- Unit tests for pure selector logic use `.select(mockState, ...args)`.
- Sagas use `.effect(...args)` and never treat direct selector signals as saga
  subscriptions.

## See also

- `react/store/SKILL.md` — Store class and import choice.
- `@augmentcode/themis/docs/SELECTORS.md` — human reference and examples for all call forms.
- `core/state-integrity/SKILL.md` — canonical derived-value ownership.