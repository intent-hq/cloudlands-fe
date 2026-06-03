---
name: core/domain-scoped-state
description: >-
  State keyed by a domain id (workspace, project, tenant). State shape is
  { byDomainId: Record<string, T> }. createDomainScopedHelpers(emptyState)
  returns getDomainState, setDomainState, and clearDomainState — immutable
  helpers that read with an emptyState fallback, write per-domain entries, and
  drop domains (returning the same reference when the id was absent). Public API:
  ag-redux-toolkit/utils/store/domain-scoped; related guidance: ../SKILL.md §10.
type: sub-skill
library: ag-redux-toolkit
requires:
  - core
  - core/reducers
sources:
  - ag-redux-toolkit/utils/store/domain-scoped
  - ../SKILL.md
triggers:
  - domain-scoped state
  - scoped helpers
  - byDomainId shape
  - workspace state
---
# Domain-Scoped State — `createDomainScopedHelpers`

> State keyed by a domain id (e.g. workspace id, project id, tenant id). All
> three returned helpers are immutable: reads fall through to `emptyState`,
> writes produce a new state with a new `byDomainId`, and `clearDomainState`
> returns the same reference when the id was already absent.

## 1. Shape

From `ag-redux-toolkit/utils/store/domain-scoped`:

```typescript
type DomainScopedState<T> = {
  byDomainId: Record<string, T>;
};

export function createDomainScopedHelpers<T>(emptyState: T) {
  const getDomainState = <S extends DomainScopedState<T>>(
    state: S,
    domainId: string
  ): T => state.byDomainId[domainId] ?? emptyState;

  const setDomainState = <S extends DomainScopedState<T>>(
    state: S,
    domainId: string,
    domainState: T
  ): S => ({
    ...state,
    byDomainId: { ...state.byDomainId, [domainId]: domainState },
  });

  const clearDomainState = <S extends DomainScopedState<T>>(
    state: S,
    domainId: string
  ): S => {
    if (!(domainId in state.byDomainId)) return state;
    const { [domainId]: _removed, ...byDomainId } = state.byDomainId;
    return { ...state, byDomainId };
  };

  return { getDomainState, setDomainState, clearDomainState };
}
```

Key guarantees:

- `getDomainState` returns `emptyState` (not `undefined`) for unknown ids.
- `setDomainState` always produces a new `state` and a new `byDomainId`.
- `clearDomainState` returns the **same** `state` reference when the id was
  absent, so selectors do not re-emit on no-op clears.
- The state type is constrained so `state.byDomainId` is typed as
  `Record<string, T>`.

## 2. Setup — minimum working slice

```typescript
// workspace-items-types.ts
import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";

export type WorkspaceItemsState = {
  items: Collection<Item, "id">;
  loadedAt: number;
};

export type State = {
  byDomainId: Record<string, WorkspaceItemsState>;
};
```

```typescript
// workspace-items-slice.ts
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import { createCollection } from "ag-redux-toolkit/utils/collections/collection-utils";
import { createDomainScopedHelpers } from "ag-redux-toolkit/utils/store/domain-scoped";
import type { State, WorkspaceItemsState, Item } from "./workspace-items-types";

const emptyState: WorkspaceItemsState = {
  items: createCollection<Item, "id">("id"),
  loadedAt: 0,
};

const { getDomainState, setDomainState, clearDomainState } =
  createDomainScopedHelpers(emptyState);

const initialState: State = { byDomainId: {} };

export const setItems    = createAction<[id: string, items: Item[]]>("workspaceItems/setItems");
export const clearDomain = createAction<[id: string]>("workspaceItems/clearDomain");

export const workspaceItemsReducer = createReducer<State>(initialState)
  .with(setItems, (state, { payload: [id, items] }) =>
    setDomainState(state, id, {
      ...getDomainState(state, id),
      items: createCollection<Item, "id">("id", items),
      loadedAt: Date.now ? 0 : 0, // (store a timestamp you dispatch in, not Date.now here)
    })
  )
  .with(clearDomain, (state, { payload: [id] }) => clearDomainState(state, id))
  .build();
```

Notes:

- Pass the domain id as the **first** tuple element so saga code can key
  subscriptions by it.
- Use `getDomainState(state, id)` inside reducer handlers to read the current
  per-domain slice safely (falls back to `emptyState` for unknown ids).
- `clearDomainState` is the right tool for logout / workspace-change cleanup.

## 3. Core patterns

### 3.1 Reading the current-domain slice in a selector

```typescript
// workspace-items-selectors.ts
import { store } from "$lib/store/store";
import { getItems } from "ag-redux-toolkit/utils/collections/collection-utils";
import { selectCurrentWorkspaceId } from "../workspaces/workspaces-selectors";

export const selectWorkspaceItems = store.createSelector((state) => {
  const id = selectCurrentWorkspaceId.select(state);
  return id ? state.workspaceItems.byDomainId[id]?.items : undefined;
});

// Array form for templates
export const selectWorkspaceItemList = store.createSelector((state) => {
  const items = selectWorkspaceItems.select(state);
  return items ? getItems(items) : [];
});
```

### 3.2 Updating inside an existing per-domain slice

Combine `getDomainState` + spread + `setDomainState`:

```typescript
.with(addItem, (state, { payload: [id, item] }) => {
  const current = getDomainState(state, id);
  return setDomainState(state, id, {
    ...current,
    items: addItemCollection(current.items, item),
  });
})
```

### 3.3 Clearing a domain on logout / workspace-change

```typescript
.with(leftWorkspace, (state, { payload: [id] }) =>
  clearDomainState(state, id)
);
```

Because `clearDomainState` returns the same reference if the id was absent,
selectors keyed on unrelated domains won't re-emit.

## 4. Common Mistakes

### Hand-rolling domain-keyed state with nested setters

**Mechanism:** custom nested updates forget the `emptyState` fallback;
reading an unknown domain id returns `undefined` instead of the empty state
and downstream code crashes on property access.

```typescript
// ❌ WRONG
.with(setItems, (state, { payload: [id, items] }) => ({
  ...state,
  byId: { ...state.byId, [id]: { ...state.byId[id], items } },
}))

// ✅ CORRECT
.with(setItems, (state, { payload: [id, items] }) =>
  setDomainState(state, id, { ...getDomainState(state, id), items })
)
```

*Source: `../SKILL.md §10`.*

### Storing a non-serializable `emptyState`

**Mechanism:** `emptyState` is read for every new domain id; any `Date`,
`Map`, `Set`, or class instance inside will break the serializable state
contract once it's written back into the state tree.

```typescript
// ❌ WRONG
const emptyState = { items: new Map(), createdAt: new Date() };

// ✅ CORRECT
const emptyState = {
  items: createCollection<Item, "id">("id"),
  createdAt: 0,
};
```

*Source: `../SKILL.md §10, §12`. See also
`core/state-serialization`.*

### Using a different key than `byDomainId`

**Mechanism:** the helpers are typed against `DomainScopedState<T>`, i.e.
`{ byDomainId: Record<string, T> }`. Renaming to `byId` or `byWorkspaceId`
type-errors on the helpers and forces consumers back to hand-rolled setters.

```typescript
// ❌ WRONG
type State = { byWorkspaceId: Record<string, WorkspaceItemsState> };

// ✅ CORRECT
type State = { byDomainId: Record<string, WorkspaceItemsState> };
```

*Public API: `ag-redux-toolkit/utils/store/domain-scoped` (`DomainScopedState<T>` shape).*

## 5. When to use

- State must be partitioned by a stable id (workspace / project / tenant /
  session).
- You want automatic cleanup on domain removal (`clearDomainState`).
- You want reads to gracefully fall back to a known empty shape.

If every consumer shares a single domain (no multi-tenant / multi-workspace
concept), a plain slice is simpler — reach for `createDomainScopedHelpers`
only when the domain id is part of the key.

## 6. See also

- `core/reducers` — pure-update rules, `createReducer` builder.
- `core/state-serialization` — why `emptyState` must be
  structured-cloneable.
- `core/collections` — the usual shape of per-domain data.
