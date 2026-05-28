# Collections and Normalized Data

## 6. Collections — normalized data

```typescript
import {
  createCollection,
  addItem,
  updateItem,
  removeItem,
  upsertItem,
  getItem,
  getItems,
  filterItems,
  addItemAt,
  increaseRefsCount,
  decreaseRefsCount,
  getRefsCount,
} from '$lib/store/utils/collection-utils';

// Create
const collection = createCollection<Item, 'id'>('id');

// All ops return NEW collection (immutable)
const c1 = addItem(collection, item);
const c2 = updateItem(c1, { id: '1', name: 'Updated' });
const c3 = removeItem(c2, '1');

// Query
const item = getItem(collection, '1');
const allItems = getItems(collection); // ordered array
```

**Collection structure:**

```typescript
type Collection<ITEM, K> = {
  idField: K;
  ids: Array<ITEM[K]>; // Ordered IDs
  map: Record<ITEM[K], ITEM>; // ID → Item lookup (O(1))
  refsCount: Record<ITEM[K], number>; // Reference counting
};
```

Use **separate maps** for derived state — don't add flags to items:

```typescript
// ✅ GOOD
type State = { items: Collection<Item, 'id'>; pins: Record<string, boolean> };

// ❌ BAD — updating pin changes entire collection, hurts perf
type State = { items: Collection<ItemWithPinned, 'id'> };
```
