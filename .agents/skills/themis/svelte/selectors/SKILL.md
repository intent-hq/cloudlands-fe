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

> Operational guidance for selector work. Full API reference and examples: `docs/SELECTORS.md`. Public facade: `store.createSelector(...)` from `@augmentcode/themis/svelte-store`; selector/cache internals are package-private implementation context; related guidance: `../SKILL.md` §3.

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

Selector-channel helpers can consume Svelte `Store` selectors through the same
`.select`/`.effect`-compatible read shape used by `ReactStore` and
`StreamingStore` selectors. Pass plain stable selector arguments as the helper
args tuple in sagas; selector-channel effects read the Redux store from saga context
and do not call or subscribe to direct Svelte readable, React signal, or Kefir
observable selector outputs.

## Selector caching

- Store-created selectors have internal selector-result caching/memoization.
- Direct readable outputs are cached per Store instance + selector + arguments; repeated `selectFoo(args)` calls for the same store reuse the same Svelte readable.
- Do not wrap selector callbacks or selector calls in extra `memoize`, `cache`, manual cache maps, debounce, or throttle layers solely for performance.
- Prefer the same Store-bound selector + same arguments over props drilling when the receiving consumer can reasonably call the selector in valid Svelte init context; otherwise use `.select`, `.effect`, or `.withStore` as the context requires.

## Stable selector arguments

- Prefer primitive scalar selector arguments: ids, booleans, enum strings,
  numbers, `null`, or `undefined`.
- Do not pass freshly constructed object, array, or function arguments to
  `selectFoo(...)`, `.select(state, ...)`, `.effect(...)`, `.withStore(store)(...)`,
  selector-channel args tuples, or `waitFor` args tuples.
- Object/function args are valid only when the identity is stable and intentional,
  such as a module constant, memoized config, existing source object, or other
  stable reference supported by the selected Store family.
- Prefer selector definitions like `(state, id, includeArchived)` over
  `(state, { id, includeArchived })`; destructure an object arg only when the
  selector contract documents that callers pass a stable object identity.

## Do

- Search for an existing selector owner by name, entity, operation, and output shape before adding one.
- Keep derived data out of reducer state and expose it through selectors.
- Compose selectors with `.select(state)` so there is one canonical implementation.
- Back entity lookup selectors with `Collection<T, K>` rather than repeated array scans.
- Treat `@internal_` state domains as implementation details even when memoization behavior references them.
- Prefer direct Store-bound selector reuse over drilling derived props when the consumer is in valid readable context and can call the same selector with the same args.
- Split selector options objects into scalar selector parameters when possible so
  repeated calls share stable cache keys.

## Don't

- Do not call the readable form inside another selector, saga, test, event handler, or async callback.
- Do not duplicate selector bodies in multiple files.
- Do not store selector outputs in reducer state.
- Do not use inline saga selectors for values that should be named, cached, and testable.
- Do not add manual memoization/cache/debounce/throttle wrappers inside selector callbacks or around selector calls just to improve selector performance.
- Do not import or apply ReactStore/signal or StreamingStore/Kefir selector patterns in this Svelte app.
- Do not hide fresh selector object/array/function args behind helper functions;
  pass stable scalar args or a stable intentional reference instead.

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

Prefer scalar parameters like `activeTodoId`. Avoid inline object arguments such
as `{ id: activeTodoId }` unless that object reference is stable and
intentionally part of the selector contract.

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
import { getItem, getItems, type Collection } from "@augmentcode/themis/utils/collections/collection-utils";

export const selectTodosCollection = store.createSelector(
  (state): Collection<Todo, "id"> => state.todos.collection
);
export const selectTodo = store.createSelector((state, id: string) => getItem(selectTodosCollection.select(state), id));
export const selectTodos = store.createSelector((state) => getItems(selectTodosCollection.select(state)));
```

### 5. Pass a configured Store into shared selector helpers

```ts
import type { Store } from "@augmentcode/themis/svelte-store";

export function createProjectSelectors(store: Store) {
  const selectProjects = store.createSelector((state) => state.projects.items);
  const selectProject = store.createSelector((state, id: string) => selectProjects.select(state)[id]);
  return { selectProjects, selectProject };
}
```

### 6. Bind readables to an explicit Store with .withStore

```ts
import type { Store } from "@augmentcode/themis/svelte-store";

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
