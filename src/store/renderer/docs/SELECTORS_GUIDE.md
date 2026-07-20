# Redux Selectors Guide

This project guide is a concise companion to the local store shim
(`src/lib/store-shim/`). Use the shim source for selector API details. This file only records the Intent-app conventions that are easy to forget.

## Create selectors from the configured Store

App-local selectors should be created from the configured app Store so state inference follows `src/store/renderer/reducer.ts`.

```typescript
import { store } from "$store/renderer/store";
import { getItem, getItems } from "$lib/store-shim/utils/collections/collection-utils";

export const selectTodosCollection = store.createSelector((state) => state.todos.collection);
export const selectTodo = store.createSelector((state, id: string) => getItem(selectTodosCollection.select(state), id));
export const selectTodos = store.createSelector((state) => getItems(selectTodosCollection.select(state)));
```

Do not add new standalone selector factories in app code. Generic selector helpers should accept a configured Store and call `store.createSelector(...)` on that Store.

## Call-mode rules

| Context | Use |
| --- | --- |
| Svelte component initialization | `const value$ = selectValue(args)` |
| Templates | the captured readable as `$value$` |
| Event handlers, callbacks, async functions, tests | `selectValue.select(appStore.state, args)` |
| Sagas | `yield* selectValue.effect(args)` |
| Selector composition | `otherSelector.select(state, args)` |

Components may capture selector readables at top-level initialization. Inside handlers and callbacks, read state from the configured Store and dispatch through that Store.

```typescript
import { store as appStore } from "$store/renderer/store";

const activeTodo$ = selectTodo(activeTodoId);

function archiveActiveTodo() {
  const todo = selectTodo.select(appStore.state, activeTodoId);
  if (todo) appStore.dispatch(archiveTodo(todo.id));
}
```

Never call the readable form after `await`, inside handlers, inside callbacks, inside tests, or inside another selector.

## See also

- [Reducers Guide](./REDUCERS_GUIDE.md) for canonical state ownership.
- [Migration Guide](./MIGRATION_GUIDE.md) for converting Svelte derived values.
- `src/store/renderer/AGENTS.md` for selector lifecycle and component boundary rules.
