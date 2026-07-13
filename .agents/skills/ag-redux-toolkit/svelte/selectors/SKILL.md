---
name: svelte/selectors
description: >-
  store.createSelector((state, ...args) => value) is the public app-local
  selector creation tied to a configured Store. Generic/shared selector helpers
  should accept a configured Store rather than importing standalone creation utilities.
  Use collection utilities such as getItem/getItems inside Store-bound selectors
  for O(1) collection lookups; proxy tracking is internal to Store selectors.
  Selectors are composed via .select(state) — never by calling selectFoo()
  inside another selector. .select (one-shot) and .effect() (saga) are the
  escape hatches from the default readable-store call mode.
type: sub-skill
requires:
  - svelte
  - core/state-integrity
triggers:
  - create selector
  - cached selector
  - collection selector
  - proxy memoization
---
# Selectors — `store.createSelector` / collection utility reads

> Operational guidance for selector work. Full API reference and examples: `docs/SELECTORS.md`. Public facade: `store.createSelector(...)` from `@augmentcode/ag-redux-toolkit/svelte-store`; selector/cache internals are package-private implementation context; related guidance: `../SKILL.md` §3.

## Use when

- Adding derived values, filtered/sorted views, counts, display labels, `has*` booleans, or entity lookups.
- Replacing duplicated reducer state with computed state.
- Reading selector values in components, sagas, tests, or other selectors.

## Choose the factory

- `store.createSelector(...)` for app-local selectors next to a configured Svelte
  Store; it preserves `StoreState<typeof store>` inference after reducer
  registration and returns Svelte readables from direct calls.
- Generic/shared selector helpers should accept a configured Store and create selectors through `store.createSelector(...)`; do not import standalone selector creation utilities from the package.
- Use public collection utilities such as `getItem(collection, id)` and `getItems(collection)` inside `store.createSelector(...)` callbacks for O(1) item lookup and ordered materialization.
- Do not import standalone selector creation utilities from package subpaths or inject selector behavior through Store constructors; selector creation is Store-bound public API.
- Do not use `ReactStore`, React `.useValue(...)`, Preact signal arguments,
  `StreamingStore`, Kefir observable arguments, or streaming selector lifecycle/setup patterns inside the same Svelte app.

## Call mode cues

| Context | Use | Avoid |
| --- | --- | --- |
| Component init | `selectFoo(args)` returns a Svelte readable | Calling inside handlers/callbacks |
| Tests, handlers, callbacks | `selectFoo.select(state, args)` | Readable form without Svelte context |
| Sagas | `yield* selectFoo.effect(args)` | Inline `select((state) => ...)` lambdas |
| Selector composition | `otherSelector.select(state, args)` | Calling `otherSelector(args)` |
| SSR/non-context readable | `selectFoo.withStore(store)(args)` | Global/context assumptions |

For React consumers in a separate React app/package/code path, route to
`react/selectors`. For streaming consumers in a separate Node/server/non-Svelte
app/package/code path, route to `streaming/selectors`. Do not mix those concrete
Store families into the Svelte app using this skill.

## Do

- Search for an existing selector owner by name, entity, operation, and output shape before adding one.
- Keep derived data out of reducer state and expose it through selectors.
- Compose selectors with `.select(state)` so there is one canonical implementation.
- Back entity lookup selectors with `Collection<T, K>` rather than repeated array scans.
- Treat `@internal_` state domains as implementation details even when memoization behavior references them.

## Don't

- Do not call the readable form inside another selector, saga, test, event handler, or async callback.
- Do not duplicate selector bodies in multiple files.
- Do not store selector outputs in reducer state.
- Do not use inline saga selectors for values that should be named, cached, and testable.
- Do not import or apply ReactStore/signal or StreamingStore/Kefir selector patterns in this Svelte app.

## Examples

### 1. Create app-local selectors from the configured Store

```ts
import { store } from "$lib/store";

export const selectTodoCount = store.createSelector((state) => {
  return state.todos.collection.ids.length;
});
```

### 2. Use parameterized selectors for entity lookup

```ts
export const selectTodoById = store.createSelector((state, todoId: string) => {
  return state.todos.collection.map[todoId];
});

const selectedTodo = selectTodoById.select(store.state, activeTodoId);
```

### 3. Compose selectors with .select(state), not readable calls

```ts
export const selectVisibleTodos = store.createSelector((state) => {
  const todos = selectAllTodos.select(state);
  const filter = selectTodoFilter.select(state);
  return todos.filter((todo) => filter.showCompleted || !todo.completed);
});
```

### 4. Back collection reads with public collection utilities

```ts
import { getItem, getItems, type Collection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

export const selectTodosCollection = store.createSelector(
  (state): Collection<Todo, "id"> => state.todos.collection
);
export const selectTodo = store.createSelector((state, id: string) => getItem(selectTodosCollection.select(state), id));
export const selectTodos = store.createSelector((state) => getItems(selectTodosCollection.select(state)));
```

### 5. Pass a configured Store into shared selector helpers

```ts
import type { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";

export function createProjectSelectors(store: Store) {
  const selectProjects = store.createSelector((state) => state.projects.items);
  const selectProject = store.createSelector((state, id: string) => selectProjects.select(state)[id]);
  return { selectProjects, selectProject };
}
```

### 6. Bind readables to an explicit Store with .withStore

```ts
import type { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";

export function createTodoReadable(store: Store, todoId: string) {
  return selectTodoById.withStore(store)(todoId);
}
```

### 7. ❌ Bad: creating selectors in lifecycle code and storing derived state

```ts
// BAD: every call creates a selector owner and duplicates derived state ownership.
function createVisibleTodoReadable(showCompleted: boolean) {
  const selectVisibleTodos = store.createSelector((state) =>
    selectTodos.select(state).filter((todo) => showCompleted || !todo.completed)
  );
  return selectVisibleTodos();
}

export const selectVisibleTodosOnce = store.createSelector((state) => {
  const filter = selectTodoFilter.select(state);
  return selectTodos.select(state).filter((todo) => filter.showCompleted || !todo.completed);
});
```

## Verification cues

- Selector tests use `.select(mockState, ...)` and cover composition if one selector depends on another.
- Reducer tests do not assert stored derived fields for values that belong in selectors.
- Manual overlap check confirms any retained selector examples live in docs; skills only keep call-mode and implementation cues.

## See also

- `docs/SELECTORS.md` — human reference and examples for all call forms.
- `react/selectors/SKILL.md` — React signal and `.useValue(...args)` selector call model.
- `streaming/selectors/SKILL.md` — Kefir/observable selector call model.
- `svelte/selector-lifecycle/SKILL.md` — lifecycle crash prevention.
- `core/selector-channels/SKILL.md` — reacting to selector changes from sagas.
- `core/collections/SKILL.md` — normalized state shape and collection utilities used by selectors.
- `core/state-integrity/SKILL.md` — canonical derived-value ownership.
- `core/testing/SKILL.md` — `.select(state)` testing rule.
