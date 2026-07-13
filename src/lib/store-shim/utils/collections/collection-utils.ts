import { shallowEqual } from 'fast-equals';

export type Collection<ITEM extends object, K extends string & keyof ITEM> = ITEM[K] extends string
  ? {
      idField: K & string;
      ids: Array<ITEM[K]>;
      map: Record<ITEM[K] & string, ITEM>;
      refsCount: Record<ITEM[K], number>;
    }
  : never;

export type RefsCounter<
  ITEM extends object,
  K extends ITEM[K] extends string ? keyof ITEM : never,
> = ITEM[K] extends string ? Record<ITEM[K], ITEM> : never;

type AnyCollection = {
  idField: string;
  ids: any[];
  map: Record<string, any>;
  refsCount: Record<string, number>;
};

const asAny = <ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
): AnyCollection => collection as unknown as AnyCollection;

function isString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return true;
}

export function createCollection<ITEM extends object, K extends keyof ITEM & string>(
  idFieldName: K,
  items?: ITEM[],
): Collection<ITEM, K> {
  if (!items)
    return {
      idField: idFieldName,
      ids: [],
      map: {},
      refsCount: {},
    } as unknown as Collection<ITEM, K>;
  return {
    idField: idFieldName,
    ids: Array.from(new Set(items.map((item) => item[idFieldName]))),
    map: items.reduce((acc, item) => {
      const id = item[idFieldName];
      return {
        ...acc,
        [id as unknown as string]: item,
      };
    }, {}),
    refsCount: {},
  } as unknown as Collection<ITEM, K>;
}

export const collectionFieldsSet: Set<string> = new Set(
  Object.keys(createCollection('id' as never, [])),
);

export function isCollection<ITEM extends object, K extends keyof ITEM & string>(
  item: object,
): item is Collection<ITEM, K> {
  const record = item as AnyCollection;
  if (typeof record.idField !== 'string') return false;
  if (!Array.isArray(record.ids)) return false;
  if (typeof record.map !== 'object' || record.map === null || Array.isArray(record.map))
    return false;
  if (
    typeof record.refsCount !== 'object' ||
    record.refsCount === null ||
    Array.isArray(record.refsCount)
  )
    return false;
  const keys = Object.keys(item);
  for (const itemKey of keys) if (!collectionFieldsSet.has(itemKey)) return false;
  return true;
}

export function purgeCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
): Collection<ITEM, K> {
  return {
    ...asAny(collection),
    ids: [],
    map: {},
    refsCount: {},
  } as unknown as Collection<ITEM, K>;
}

export function addItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM,
): Collection<ITEM, K> {
  return addItems(collection, [newItem]);
}

/**
 * Batch add function
 * @param collection - The collection to add items to
 * @param newItems - Array of items to add
 * @returns New collection with items added (or original if no items were added)
 */
export function addItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItems: ITEM[],
): Collection<ITEM, K> {
  if (newItems.length === 0) return collection;
  const c = asAny(collection);
  const { idField } = c;
  const newIdsToAdd: any[] = [];
  const newMapEntries: Record<string, any> = {};
  const existingIdsSet = new Set(c.ids);
  for (const item of newItems) {
    const id = (item as any)[idField];
    if (!isString(id)) continue;
    const existsInMap = !!c.map[id];
    const existsInIds = existingIdsSet.has(id);
    if (existsInMap && existsInIds) continue;
    if (!existsInIds) {
      newIdsToAdd.push(id);
      existingIdsSet.add(id);
    }
    newMapEntries[id] = item;
  }
  if (newIdsToAdd.length === 0 && Object.keys(newMapEntries).length === 0) return collection;
  const newIds = newIdsToAdd.length > 0 ? [...c.ids, ...newIdsToAdd] : c.ids;
  const newMap =
    Object.keys(newMapEntries).length > 0 ? { ...c.map, ...newMapEntries } : c.map;
  return {
    ...c,
    ids: newIds,
    map: newMap,
  } as unknown as Collection<ITEM, K>;
}

export function addItemAt<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  index: number,
  newItem: ITEM,
): Collection<ITEM, K> {
  const c = asAny(collection);
  const { idField } = c;
  const id = (newItem as any)[idField];
  if (!isString(id)) return collection;
  if (c.map[id]) return collection;
  const idsWithoutCurrent = c.ids.filter((itemId) => itemId !== id);
  let ids: any[] = [];
  if (index < 0) ids = [id].concat(idsWithoutCurrent);
  else {
    ids = [...idsWithoutCurrent];
    ids.splice(index, 0, id);
  }
  return {
    ...c,
    ids,
    map: { ...c.map, [id]: newItem },
  } as unknown as Collection<ITEM, K>;
}

export function addItemAndCountRef<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM,
  index?: number,
): Collection<ITEM, K> {
  const { idField } = asAny(collection);
  const id = (newItem as any)[idField];
  if (!isString(id)) return collection;
  return increaseRefsCount(
    index !== void 0 ? addItemAt(collection, index, newItem) : addItem(collection, newItem),
    id as ITEM[K],
  );
}

export function upsertItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  updatedItem: ITEM,
): Collection<ITEM, K> {
  const id = (updatedItem as any)[asAny(collection).idField];
  if (!isString(id)) return collection;
  if (getItem(collection, id as ITEM[K] & string)) return updateItem(collection, updatedItem);
  return addItem(collection, updatedItem);
}

export function upsertItemAndCountRef<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  newItem: ITEM,
): Collection<ITEM, K> {
  const { idField } = asAny(collection);
  const id = (newItem as any)[idField];
  if (!isString(id)) return collection;
  return increaseRefsCount(upsertItem(collection, newItem), id as ITEM[K]);
}

export function updateItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  updatedItem: Partial<ITEM>,
): Collection<ITEM, K> {
  const c = asAny(collection);
  const { idField } = c;
  const id = (updatedItem as any)[idField];
  if (!id || !isString(id) || !c.map[id]) return collection;
  const newItem = { ...c.map[id], ...updatedItem };
  if (shallowEqual(newItem, c.map[id])) return collection;
  return {
    ...c,
    map: { ...c.map, [id]: newItem },
  } as unknown as Collection<ITEM, K>;
}

export function replaceItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  originalItemId: ITEM[K] & string,
  updatedItem: ITEM,
): Collection<ITEM, K> {
  return replaceItems(collection, [[originalItemId, updatedItem]]);
}

export function replaceItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  replaceTuples: Array<[originalItemId: ITEM[K] & string, updatedItem: ITEM]>,
): Collection<ITEM, K> {
  const c = asAny(collection);
  const idsIndexMap: Record<number, any> = {};
  const newItemsMap: Record<string, any> = {};
  for (const tuple of replaceTuples) {
    const [originalItemId, updatedItem] = tuple;
    const originalIndex = c.ids.indexOf(originalItemId);
    if (originalIndex < 0) continue;
    const newId = (updatedItem as any)[c.idField];
    if (!isString(newId)) continue;
    idsIndexMap[originalIndex] = newId;
    newItemsMap[newId] = updatedItem;
  }
  if (Object.keys(idsIndexMap).length === 0) return collection;
  const newIds = [...c.ids];
  const newMap: Record<string, any> = { ...c.map, ...newItemsMap };
  const newRefCounts: Record<string, number> = { ...c.refsCount };
  const idsToRemove = new Set<any>();
  for (let index = 0; index < c.ids.length; index++) {
    const newId = idsIndexMap[index];
    const oldId = c.ids[index];
    if (!newId) continue;
    if (oldId !== newId) {
      delete newMap[oldId];
      const existingIndex = c.ids.indexOf(newId);
      if (existingIndex >= 0 && existingIndex !== index) idsToRemove.add(newId);
    }
    newIds[index] = newId;
    newRefCounts[newId] = newRefCounts[oldId];
    if (oldId !== newId) delete newRefCounts[oldId];
  }
  const finalIds = newIds.filter((id, index, list) => {
    return !(idsToRemove.has(id) && list.indexOf(id) !== index);
  });
  return {
    ...c,
    ids: finalIds,
    map: { ...newMap },
    refsCount: newRefCounts,
  } as unknown as Collection<ITEM, K>;
}

export function removeItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K],
): Collection<ITEM, K> {
  if (!isString(itemId)) return collection;
  const c = asAny(collection);
  const ids = c.ids.filter((id) => {
    return id !== itemId;
  });
  if (ids.length === c.ids.length && !c.map[itemId]) return collection;
  const { [itemId]: _item, ...newMap } = c.map;
  const { [itemId]: _count, ...newRefsCount } = c.refsCount;
  return {
    ...c,
    ids,
    map: newMap,
    refsCount: newRefsCount,
  } as unknown as Collection<ITEM, K>;
}

export function increaseRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K],
): Collection<ITEM, K> {
  if (!isString(itemId)) return collection;
  const c = asAny(collection);
  return {
    ...c,
    refsCount: {
      ...c.refsCount,
      [itemId]: (c.refsCount[itemId] || 0) + 1,
    },
  } as unknown as Collection<ITEM, K>;
}

export function decreaseRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K],
): Collection<ITEM, K> {
  if (!isString(itemId)) return collection;
  const c = asAny(collection);
  const newRefsCount = (c.refsCount[itemId] || 0) - 1;
  if (newRefsCount <= 0) {
    const { [itemId]: _count, ...rest } = c.refsCount;
    return removeItem(
      {
        ...c,
        refsCount: rest,
      } as unknown as Collection<ITEM, K>,
      itemId,
    );
  }
  return {
    ...c,
    refsCount: {
      ...c.refsCount,
      [itemId]: newRefsCount,
    },
  } as unknown as Collection<ITEM, K>;
}

export function filterCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  filterFunction: (item: ITEM) => item is ITEM,
): Collection<ITEM, K> {
  const c = asAny(collection);
  const items = c.ids
    .map((id) => {
      return c.map[id];
    })
    .filter((item) => item !== void 0)
    .filter(filterFunction);
  if (items.length === c.ids.length) return collection;
  return createCollection(c.idField as K, items as ITEM[]);
}

export function deduplicateCollection<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
): Collection<ITEM, K> {
  const c = asAny(collection);
  const ids = c.ids.filter((id, index, list) => {
    return list.indexOf(id) === index;
  });
  if (ids.length === c.ids.length) return collection;
  return {
    ...c,
    ids,
  } as unknown as Collection<ITEM, K>;
}

export function getItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K] & string,
): ITEM | undefined {
  return asAny(collection).map[itemId];
}

export function getLastItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
): ITEM | undefined {
  const c = asAny(collection);
  const lastItemId = c.ids[c.ids.length - 1];
  return getItem(collection, lastItemId);
}

export function getItemIndex<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K],
): number {
  return asAny(collection).ids.indexOf(itemId);
}

export function getItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
): ITEM[] {
  const c = asAny(collection);
  const list: ITEM[] = [];
  for (const id of c.ids) if (c.map[id]) list.push(c.map[id]);
  return list;
}

export function findItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  findFunction: (item: ITEM) => boolean,
): ITEM | undefined {
  const c = asAny(collection);
  const foundId = c.ids.find((id) => {
    const collectionItem = getItem(collection, id);
    if (!collectionItem) return false;
    return findFunction(collectionItem);
  });
  if (!foundId) return;
  return getItem(collection, foundId);
}

export function findLastItem<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  findFunction: (item: ITEM) => boolean,
): ITEM | undefined {
  const c = asAny(collection);
  const foundId = [...c.ids].reverse().find((id) => {
    const collectionItem = getItem(collection, id);
    if (!collectionItem) return false;
    return findFunction(collectionItem);
  });
  if (!foundId) return;
  return getItem(collection, foundId);
}

export function filterItems<T extends ITEM, ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  filterFunction: (item: ITEM) => item is T,
): T[] {
  const c = asAny(collection);
  return c.ids
    .map((id) => {
      return c.map[id];
    })
    .filter((item) => item !== void 0)
    .filter(filterFunction);
}

export function getRefsCount<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  itemId: ITEM[K] & string,
): number {
  const c = asAny(collection);
  if (!c.refsCount[itemId]) return c.map[itemId] ? 1 : 0;
  return c.refsCount[itemId];
}
