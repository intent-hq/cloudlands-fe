---
name: core/reducers
description: >-
  createReducer<State>(initialState) returns a reducer whose .with(action, fn)
  chain-registers pure handlers and returns the same reducer (fluent builder —
  no .build() needed). The reducer is a function (state = initialState, action)
  that dispatches to the registered handler by action.type. Reducers must be
  pure and immutable — no side effects, no mutation, no Date.now(). Reducers
  update canonical state only and never maintain selector-derived fields. Return
  the same reference when nothing changes so selector reference-equality
  memoization and test ref-equality assertions pass. `.initialState` is exposed for tests.
type: sub-skill
requires:
  - core
  - core/actions
  - core/state-integrity
triggers:
  - create reducer
  - reducer builder
  - no-op reference
  - chained reducer
---
# Reducers — `createReducer`

> Operational guidance for reducer implementation. Full API walkthrough and examples: `@augmentcode/themis/docs/REDUCERS.md` → Creating Reducers. Public API: `@augmentcode/themis/utils/store/create-reducer`; related guidance: `../SKILL.md` §3, §14.

## Use when

- Adding or changing a slice reducer built with `createReducer<State>(initialState)`.
- Registering action handlers with `.with(actionCreator, handler)`.
- Reviewing reducer purity, canonical state, or no-op reference behavior.

## Do

- Keep handlers pure and immutable; return new objects only for actual state changes.
- Return the incoming state reference when a handler is a no-op.
- Use action creators from the canonical owner; register request/success/failure handlers for async actions as needed.
- Store source facts only: collections, ids, relationships, request status, and plain errors.
- Put expensive work, generated values, persistence, and external calls in actions or sagas, not reducers.
- Register slice reducers with the store owner rather than creating parallel reducer trees.

## Don't

- Do not mutate state or collection internals.
- Do not call `Date.now()`, `Math.random()`, `fetch`, `localStorage`, or other side-effect APIs inside reducer handlers.
- Do not store derived fields such as `filtered*`, `sorted*`, `*Count`, `has*`, or selected entity copies when selectors can compute them.
- Do not add new helper functions before searching existing utilities and documenting why reuse/extension is not enough.

## Examples

### Chain handlers on the reducer function

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type CounterState = { value: number };
const increment = createAction<[amount: number]>("counter/increment");

export const counterReducer = createReducer<CounterState>({ value: 0 }).with(
  increment,
  (state, { payload: [amount] }) => ({ value: state.value + amount })
);
```

### Immutable collection update with parent no-op guard

```ts
import { type Collection, createCollection, updateItem } from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type Todo = { id: string; title: string };
type TodosState = { todos: Collection<Todo, "id"> };
const initialState: TodosState = { todos: createCollection<Todo, "id">("id") };
const renameTodo = createAction("todos/rename", (id: string, title: string) => ({ id, title }));

export const todosReducer = createReducer(initialState).with(renameTodo, (state, { payload }) => {
  const todos = updateItem(state.todos, { id: payload.id, title: payload.title });
  return todos === state.todos ? state : { ...state, todos };
});
```

### Explicit same-reference no-op for nested state

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

const setSearch = createAction<[query: string]>("todos/setSearch");

export const reducer = createReducer({ filters: { query: "" } }).with(
  setSearch,
  (state, { payload: [query] }) =>
    state.filters.query === query ? state : { ...state, filters: { ...state.filters, query } }
);
```

### Async request, success, and failure handlers

```ts
import { createAsyncAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type Todo = { id: string; title: string };
const loadTodo = createAsyncAction<[id: string], { id: string }, Todo>("todos/loadAsync", "todos/load", (id) => ({ id }));

export const reducer = createReducer({ loading: false, todo: undefined as Todo | undefined, error: "" })
  .with(loadTodo, (state) => ({ ...state, loading: true, error: "" }))
  .with(loadTodo.success, (state, { payload }) => ({ ...state, loading: false, todo: payload.response }))
  .with(loadTodo.failure, (state, { payload }) => ({ ...state, loading: false, error: payload.error.message }));
```

### ❌ Bad: mutation and reducer-created nondeterminism

```ts
import { type Collection, createCollection } from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type Todo = { id: string; title: string };
type TodosState = { todos: Collection<Todo, "id">; updatedAtMs: number };
const initialState: TodosState = { todos: createCollection<Todo, "id">("id"), updatedAtMs: 0 };
const renameTodo = createAction("todos/rename", (id: string, title: string) => ({ id, title }));

// BAD: mutation hides changes from reference checks and Date.now() makes replay nondeterministic.
export const reducer = createReducer(initialState).with(renameTodo, (state, { payload }) => {
  state.todos.map[payload.id].title = payload.title;
  state.updatedAtMs = Date.now();
  return state;
});
```

### ❌ Bad: unconditional nested copies lose no-op identity

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

const setSearch = createAction<[query: string]>("todos/setSearch");

// BAD: createReducer only shallow-compares the top-level state object.
export const reducer = createReducer({ filters: { query: "" } }).with(setSearch, (state, { payload: [query] }) => ({
  ...state,
  filters: { ...state.filters, query },
}));
```

## Implementation cues

- `createReducer` returns the reducer function itself; `.with()` mutates the builder registration and returns the same reducer for chaining.
- `reducer.initialState` is available for tests.
- Collection helpers often already preserve reference equality on no-op; wrap parent state updates so the parent also preserves the same reference.
- Helpers like `createBooleanPreference.register(builder)` can compose handlers into an existing reducer builder.

## Verification cues

- Reducer tests call the reducer directly: initial state, each action handler, async success/failure branches, and unknown/no-op action reference equality.
- Serialization tests cover new state shape when fields are added.
- State-integrity handoff lists searches for duplicate state/actions/selectors/sagas and identifies the canonical owner.

## See also

- `@augmentcode/themis/docs/REDUCERS.md` — human reference for reducer and action examples.
- `core/actions/SKILL.md` — action creator contracts consumed by `.with()`.
- `core/collections/SKILL.md` — immutable entity updates.
- Selected Store family selector skill — derived values belong in selectors.
- `core/state-serialization/SKILL.md` — serializable state rules.
- `core/testing/SKILL.md` — reducer test expectations.