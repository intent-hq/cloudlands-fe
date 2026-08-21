---
name: react/selector-lifecycle
description: >-
  React selector lifecycle and call-mode guidance. Maps direct calls that return
  Preact React signals as the preferred React consumer path, .useValue(...args) for
  necessary hook/plain-value fallback paths, Babel transform/useSignals tracking,
  .select(state, ...args) for handlers/tests/composition, .effect(...args) for
  sagas, and .withStore(...) for explicit ReactStore binding.
type: sub-skill
requires:
  - react
  - react/selectors
sources:
  - "@augmentcode/themis/react-store"
  - ../signals/SKILL.md
  - ../selectors/SKILL.md
triggers:
  - React selector lifecycle
  - selector .useValue lifecycle
  - direct signal read
  - useSignals selector
  - select in React handler
---
# React selector lifecycle — call-mode guardrails

Use this skill when choosing how a `ReactStore` selector should be called from
React components, custom hooks, event handlers, tests, sagas, or other selectors.
The direct call form returns a Preact React signal and is the preferred React
consumer integration path when callers can pass, read, or render signals. Use
`.useValue(...args)` only when a hook/plain value is necessary and adapting the
consumer to accept signals is impractical.

Use this lifecycle for apps that chose the React Store family.

## Call-mode map

| Context | Correct React call | Result | Why |
| --- | --- | --- | --- |
| Preferred React/signal-aware consumer | const valueSignal = selectFoo(...argsOrSignals) | Preact React ReadonlySignal<R> | Creates a signal-backed selector result for components, helpers, or hooks that can accept/read signals. |
| Hook/plain-value fallback | const value = selectFoo.useValue(...argsOrSignals) | Plain value R | Use only for third-party APIs, legacy component boundaries, or custom-hook contracts that require plain values. |
| Event handler/callback/test | selectFoo.select(state, ...args) | Plain value R | Performs a synchronous one-shot read without React hook/runtime requirements. |
| Selector composition | otherSelector.select(state, ...args) | Plain value R | Keeps selector callbacks pure and synchronous with state already in scope. |
| Saga | yield* selectFoo.effect(...args) | typed-redux-saga select effect | Reads via redux-saga state selection, not React signals or hooks. |
| Explicit binding | selectFoo.withStore(reactStore)(...args) | Preact React ReadonlySignal<R> | Binds to an explicit ReactStore instead of the selector's original store. |

## Do

- Prefer direct selector calls in React components, custom hooks, and helper
  components that can pass/read `ReadonlySignal<R>` values through the Preact React
  signal integration.
- Ensure React component `.value` reads are tracked by the Preact Signals Babel
  transform or by an explicit `useSignals()` fallback in the reading component.
- Use `.useValue(...args)` in React components or custom hooks only when a plain value
  or hook-shaped API is required and a signal-aware rewrite is impractical.
- Use `.select(reactStore.state, ...args)` in handlers and tests when a plain
  snapshot value is needed.
- Use `.select(state, ...args)` inside selector callbacks to compose selectors.
- Use `.effect(...args)` in sagas, and pass ReactStore selectors with plain args to selector-channel helpers when a saga needs to react to selector value changes.
- Use `.withStore(...)` only when you intentionally need to bind the selector to an
  explicit `ReactStore`.

## React signal consumption guardrails

- Direct selector calls create `ReadonlySignal<R>` values; pass them to
  signal-aware children or read `.value` in tracked React components.
- Direct JSX signal rendering is valid when the JSX text position intentionally
  accepts a signal. For props, conditions, arrays, and objects, read `.value` or
  use a plain-value fallback boundary.
- `.useValue(...args)` calls React signal runtime hooks and returns plain `R`; it
  is not a replacement for `.select(state, ...args)` in handlers/tests/sagas.
- `.select(state, ...args)` and `.effect(...args)` take plain selector arguments,
  not signal wrappers.
- Selector-channel helpers use the Redux store from saga context; they do not
  subscribe to direct `ReadonlySignal` selector outputs.

## Don't

- Do not call `.useValue(...args)` outside React components or custom hooks.
- Do not call direct signal form inside pure selector composition; use
  `.select(state, ...args)` instead.
- Do not create direct signals just to perform one-shot handler/test reads.
- Do not apply non-React selector lifecycle rules to a React app.

## Examples

### 1. React component read with direct signals

```tsx
import { selectTodoById } from "../store/todos/todos-selectors";
import type { ReadonlySignal } from "@preact/signals-react";

type Todo = { title: string } | undefined;

function TodoTitleView({ todo }: { todo: ReadonlySignal<Todo> }) {
  return <span>{todo.value?.title ?? "Untitled"}</span>;
}

export function TodoTitle({ id }: { id: string }) {
  const todo = selectTodoById(id);
  return <TodoTitleView todo={todo} />;
}
```

### 2. Fallback hook/plain-value read with `.useValue(...args)`

```tsx
export function useCanEditTodo(id: string) {
  const todo = selectTodoById.useValue(id);
  const currentUser = selectCurrentUser.useValue();
  return Boolean(todo && currentUser && todo.ownerId === currentUser.id);
}
```

Use this fallback only when the hook contract must return a plain boolean and
rewriting callers to accept the underlying signals would be too invasive.

### 3. Direct signal call for signal-aware code

```ts
const todoSignal = selectTodoById("todo-1");
console.log(todoSignal.value?.title);
```

Use the direct form when the caller can accept a `ReadonlySignal<R>`; for pure
selector composition, prefer `.select(state, ...args)`.

### 4. Handler/test one-shot read with `.select(state, ...args)`

```tsx
import { reactStore } from "../store/react-store";
import { deleteTodo } from "../store/todos/todos-slice";

function onDelete(id: string) {
  const todo = selectTodoById.select(reactStore.state, id);
  if (todo && !todo.completed) reactStore.dispatch(deleteTodo(id));
}
```

### 5. Compose selectors with `.select(state, ...args)`

```ts
export const selectVisibleTodos = reactStore.createSelector((state) => {
  const todos = selectTodos.select(state);
  const filter = selectTodoFilter.select(state);
  return todos.filter((todo) => todo.status === filter.status);
});
```

### 6. Saga read with `.effect(...args)`

```ts
import { put } from "typed-redux-saga";

export function* saveCurrentTodoWorker() {
  const todoId = yield* selectCurrentTodoId.effect();
  if (todoId) yield* put(saveTodo(todoId));
}
```

Do not pass the selector object itself to saga `select`; use `.effect(...args)` or
`.select(state, ...args)` intentionally.

### 7. Explicit binding with `.withStore(...)`

```ts
import type { ReactStore } from "@augmentcode/themis/react-store";

export function bindTodoSelector(store: ReactStore) {
  return selectTodoById.withStore(store);
}

const selectTodoFromPreviewStore = bindTodoSelector(previewStore);
const previewTodoSignal = selectTodoFromPreviewStore("todo-1");
```

`.withStore(...)` returns the direct-call family result for the explicit binding;
for `ReactStore`, that result is a Preact React `ReadonlySignal<R>`.

## Pitfalls

- `.useValue(...args)` calls React signal runtime hooks; calling it in handlers, sagas,
  tests, module initialization, or ordinary utility functions violates the React
  component/custom-hook boundary.
- Direct calls return signal objects, not plain values. Passing a direct signal
  result into pure reducers/selectors or comparing it as a plain value creates
  wrong-shape bugs.
- React components that read `signal.value` without the Babel transform or an
  explicit `useSignals()` fallback may fail to re-render when the signal changes.
- `.select(state, ...args)` is pure and synchronous but not reactive. Components
  that need updates should prefer direct selector signals, falling back to
  `.useValue(...args)` only for necessary plain-value boundaries.
- React selector lifecycle is driven by component/custom-hook boundaries and the
  explicit `.select`, `.effect`, and `.withStore` call modes above.

## Verification cues

- Component/custom-hook examples prefer direct selector signals and only use
  `.useValue(...args)` for documented plain-value fallbacks.
- Handler, callback, test, and selector-composition code uses
  `.select(state, ...args)` rather than `.useValue(...args)` or direct signals.
- Saga code uses `.effect(...args)`.
- Explicit alternate-store examples use `.withStore(...)` and treat the result as a
  signal-producing binding.
- Direct `.value` reads mention React signal tracking, and direct JSX signal
  rendering is limited to intentional signal-aware JSX positions.

## See also

- `react/component-integration/SKILL.md` — app bootstrap, Store lifecycle, saga
  startup, component dispatch, and handler examples.
- `react/selectors/SKILL.md` — authoring ReactStore selectors.
- `react/store/SKILL.md` — `ReactStore` import and initialization rules.
- `@augmentcode/themis/docs/SELECTORS.md` — human reference for selector call forms.