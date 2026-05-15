# Custom Redux API

## 3. Custom API Reference

### Actions — `createAction` / `createAsyncAction`

```typescript
import { createAction, createAsyncAction } from '$lib/store/utils/create-action';

// No payload
export const clearResults = createAction('mySlice/clearResults');

// Single arg (tuple type)
export const removeItem = createAction<[id: string]>('mySlice/removeItem');

// Multiple args
export const setPosition = createAction<[x: number, y: number]>('mySlice/setPosition');

// Payload modifier (transform args → payload shape)
export const setStatus = createAction('mySlice/setStatus', (id: string, status: Status) => ({
  id,
  status,
}));

// Async action (request/success/failure)
export const fetchItems = createAsyncAction<[query: string], { items: Item[] }>(
  'mySlice/fetch',
  'mySlice/fetchItems',
);
// fetchItems(query)        → dispatches request
// fetchItems.success(data) → dispatches success
// fetchItems.failure(err)  → dispatches failure

// Action for adding a single item to a collection
export const addNewItem = createAction<[item: Item]>('mySlice/addNewItem');
```

**Rules:** Always namespace: `"sliceName/actionName"`. Use tuple types `[arg1, arg2]` for multiple args.

### Types — `{slice-name}-types.ts`

All types, interfaces, and enums live in a dedicated `-types.ts` file. This keeps them safe to import from any process (renderer, main, shared, preload).

```typescript
// my-slice-types.ts — safe to import from ANY process
import type { Collection } from '$lib/store/utils/collection-utils';

export type Item = {
  id: string;
  name: string;
  isActive: boolean;
};

export type MyState = {
  items: Collection<Item, 'id'>;
  isLoading: boolean;
  error: string | null;
};
```

```typescript
// ❌ BAD — pulls in reducer + renderer deps
import type { PermissionRequest } from '$lib/store/slices/permission/permission-slice';

// ✅ GOOD — types-only module, safe from any process
import type { PermissionRequest } from '$lib/store/slices/permission/permission-types';
```

### Reducers — `createReducer`

```typescript
import { createReducer } from '$lib/store/utils/create-reducer';
import { createCollection, addItem as collectionAddItem } from '$lib/store/utils/collection-utils';
import type { Collection } from '$lib/store/utils/collection-utils';
import type { MyState, Item } from './my-slice-types';

const initialState: MyState = {
  items: createCollection<Item, 'id'>('id'),
  isLoading: false,
  error: null,
};

export const myReducer = createReducer<MyState>(initialState)
  .with(addNewItem, (state, { payload: [item] }) => ({
    ...state,
    items: collectionAddItem(state.items, item),
  }))
  .with(fetchItems, (state) => ({ ...state, isLoading: true }))
  .with(fetchItems.success, (state, action) => ({
    ...state,
    isLoading: false,
    items: createCollection<Item, 'id'>('id', action.payload.response.items),
  }))
  .with(fetchItems.failure, (state, action) => ({
    ...state,
    isLoading: false,
    error: action.payload.error.message,
  }));
```

**Reducer rules:**

- ✅ Pure functions — no side effects, no async, no `Date.now()` / `Math.random()`
- ✅ Always return new objects: `{ ...state, field: newValue }`
- ✅ Return same reference if nothing changed (prevents re-renders)
- ❌ Never mutate state: `state.field = x` is FORBIDDEN
- See Section 12 for full serialization rules.

### Selectors — `createSelector`

```typescript
import { createSelector, createCollectionItemSelector } from '$lib/store/utils/create-selector';

// Simple
export const selectIsLoading = createSelector((state) => state.mySlice.isLoading);

// Collection item selector (for single-item lookups from a Collection)
export const selectItemById = createCollectionItemSelector<Item, 'id'>(
  (state) => state.mySlice.items,
);

// Composing selectors (use .select() to call another selector)
export const selectActiveItemCount = createSelector((state) => {
  return selectItems.select(state).filter((i) => i.isActive).length;
});
```
