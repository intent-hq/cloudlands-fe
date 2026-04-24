import { expect, describe, test } from "vitest";
import {
  createCollection,
  addItem,
  addItems,
  addItemAt,
  updateItem,
  upsertItem,
  removeItem,
  replaceItem,
  getItem,
  getItems,
  isCollection,
  type Collection,
} from "./collection-utils";

// Test data type
type TestItem = {
  id: string;
  name: string;
  value: number;
};

// Helper to check collection invariants
const assertCollectionInvariants = <ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
   
  _description: string
) => {
  // Check that ids are unique
  const uniqueIds = new Set(collection.ids);
  expect(uniqueIds.size).toBe(collection.ids.length);

  // Check that all ids in the list exist in the map
  for (const id of collection.ids) {
    expect(collection.map[id]).toBeDefined();
  }

  // Check that all items in map have their ids in the ids list
  for (const id of Object.keys(collection.map)) {
    expect(collection.ids).toContain(id);
  }
};

describe("createCollection", () => {
  test("creates empty collection", () => {
    const collection = createCollection<TestItem, "id">("id");

    expect(collection.idField).toBe("id");
    expect(collection.ids).toEqual([]);
    expect(collection.map).toEqual({});
    expect(collection.refsCount).toEqual({});
    assertCollectionInvariants(collection, "empty collection");
  });

  test("creates collection with items", () => {
    const items: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ];
    const collection = createCollection<TestItem, "id">("id", items);

    expect(collection.ids).toEqual(["1", "2"]);
    expect(collection.map["1"]).toEqual(items[0]);
    expect(collection.map["2"]).toEqual(items[1]);
    assertCollectionInvariants(collection, "collection with items");
  });

  test("creates collection with duplicate ids - keeps unique ids", () => {
    const items: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "1", name: "one-duplicate", value: 10 },
    ];
    const collection = createCollection<TestItem, "id">("id", items);

    // Should have unique ids
    expect(collection.ids).toEqual(["1", "2"]);
    // Last item with duplicate id should be in map
    expect(collection.map["1"]).toEqual({ id: "1", name: "one-duplicate", value: 10 });
    assertCollectionInvariants(collection, "collection with duplicate ids");
  });
});

describe("addItem", () => {
  test("adds new item to empty collection", () => {
    const collection = createCollection<TestItem, "id">("id");
    const newItem: TestItem = { id: "1", name: "one", value: 1 };

    const result = addItem(collection, newItem);

    expect(result.ids).toEqual(["1"]);
    expect(result.map["1"]).toEqual(newItem);
    assertCollectionInvariants(result, "collection after adding item");
  });

  test("adds new item to non-empty collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);
    const newItem: TestItem = { id: "2", name: "two", value: 2 };

    const result = addItem(collection, newItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["2"]).toEqual(newItem);
    assertCollectionInvariants(result, "collection after adding second item");
  });

  test("adding item with existing id does not change collection", () => {
    const existingItem: TestItem = { id: "1", name: "one", value: 1 };
    const collection = createCollection<TestItem, "id">("id", [existingItem]);
    const duplicateItem: TestItem = { id: "1", name: "one-duplicate", value: 10 };

    const result = addItem(collection, duplicateItem);

    // Should return same reference when no change
    expect(result).toBe(collection);
    expect(result.ids).toEqual(["1"]);
    expect(result.map["1"]).toEqual(existingItem);
    assertCollectionInvariants(result, "collection after adding duplicate");
  });

  test("adding item updates map if id exists in map but not in ids list", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Manually create inconsistent state (id in map but not in ids)
    collection.map["1"] = { id: "1", name: "one", value: 1 };

    const newItem: TestItem = { id: "1", name: "one-updated", value: 10 };
    const result = addItem(collection, newItem);

    expect(result.ids).toEqual(["1"]);
    expect(result.map["1"]).toEqual(newItem);
    assertCollectionInvariants(result, "collection after fixing inconsistency");
  });
});

describe("addItems", () => {
  test("adds multiple new items to empty collection", () => {
    const collection = createCollection<TestItem, "id">("id");
    const newItems: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ];

    const result = addItems(collection, newItems);

    expect(result.ids).toEqual(["1", "2", "3"]);
    expect(result.map["1"]).toEqual(newItems[0]);
    expect(result.map["2"]).toEqual(newItems[1]);
    expect(result.map["3"]).toEqual(newItems[2]);
    assertCollectionInvariants(result, "collection after adding multiple items");
  });

  test("adds multiple items to non-empty collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);
    const newItems: TestItem[] = [
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ];

    const result = addItems(collection, newItems);

    expect(result.ids).toEqual(["1", "2", "3"]);
    expect(result.map["2"]).toEqual(newItems[0]);
    expect(result.map["3"]).toEqual(newItems[1]);
    assertCollectionInvariants(result, "collection after adding items to non-empty");
  });

  test("adding empty array returns same collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const result = addItems(collection, []);

    expect(result).toBe(collection);
  });

  test("skips items with existing ids", () => {
    const existingItem: TestItem = { id: "1", name: "one", value: 1 };
    const collection = createCollection<TestItem, "id">("id", [existingItem]);
    const newItems: TestItem[] = [
      { id: "1", name: "one-duplicate", value: 10 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual(existingItem); // Original item unchanged
    expect(result.map["2"]).toEqual(newItems[1]);
    assertCollectionInvariants(result, "collection after adding with duplicates");
  });

  test("handles duplicates within newItems array", () => {
    const collection = createCollection<TestItem, "id">("id");
    const newItems: TestItem[] = [
      { id: "1", name: "one-first", value: 1 },
      { id: "1", name: "one-second", value: 10 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    expect(result.ids).toEqual(["1", "2"]);
    // Should use the last occurrence
    expect(result.map["1"]).toEqual(newItems[1]);
    expect(result.map["2"]).toEqual(newItems[2]);
    assertCollectionInvariants(result, "collection after adding with internal duplicates");
  });

  test("fixes inconsistent state (id in map but not in ids)", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Manually create inconsistent state
    collection.map["1"] = { id: "1", name: "one", value: 1 };

    const newItems: TestItem[] = [
      { id: "1", name: "one-updated", value: 10 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual(newItems[0]);
    expect(result.map["2"]).toEqual(newItems[1]);
    assertCollectionInvariants(result, "collection after fixing inconsistency");
  });

  test("returns same collection when all items already exist", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);
    const duplicateItems: TestItem[] = [
      { id: "1", name: "one-dup", value: 10 },
      { id: "2", name: "two-dup", value: 20 },
    ];

    const result = addItems(collection, duplicateItems);

    expect(result).toBe(collection);
  });

  test("addItems behaves same as multiple addItem calls", () => {
    const collection = createCollection<TestItem, "id">("id");
    const newItems: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ];

    // Using addItems
    const resultBatch = addItems(collection, newItems);

    // Using multiple addItem calls
    let resultSequential = collection;
    for (const item of newItems) {
      resultSequential = addItem(resultSequential, item);
    }

    expect(resultBatch.ids).toEqual(resultSequential.ids);
    expect(resultBatch.map).toEqual(resultSequential.map);
    assertCollectionInvariants(resultBatch, "batch result");
    assertCollectionInvariants(resultSequential, "sequential result");
  });
});

describe("updateItem", () => {
  test("updates existing item", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const updatedItem: TestItem = { id: "1", name: "one-updated", value: 10 };
    const result = updateItem(collection, updatedItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"].name).toBe("one-updated");
    expect(result.map["1"].value).toBe(10);
    assertCollectionInvariants(result, "collection after update");
  });

  test("updating non-existent item returns same collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const nonExistentItem: TestItem = { id: "999", name: "non-existent", value: 999 };
    const result = updateItem(collection, nonExistentItem);

    expect(result).toBe(collection);
    assertCollectionInvariants(result, "collection after updating non-existent item");
  });

  test("updating item does not add duplicate ids", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const updatedItem: TestItem = { id: "1", name: "one-updated", value: 10 };
    const result = updateItem(collection, updatedItem);

    // Ids list should remain unchanged
    expect(result.ids).toEqual(["1", "2"]);
    expect(new Set(result.ids).size).toBe(result.ids.length);
    assertCollectionInvariants(result, "collection after update - no duplicate ids");
  });

  test("updating with same values returns same collection", () => {
    const item: TestItem = { id: "1", name: "one", value: 1 };
    const collection = createCollection<TestItem, "id">("id", [item]);

    const result = updateItem(collection, item);

    expect(result).toBe(collection);
  });
});

describe("upsertItem", () => {
  test("upserts new item (acts as add)", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const newItem: TestItem = { id: "2", name: "two", value: 2 };
    const result = upsertItem(collection, newItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["2"]).toEqual(newItem);
    assertCollectionInvariants(result, "collection after upserting new item");
  });

  test("upserts existing item (acts as update)", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const updatedItem: TestItem = { id: "1", name: "one-updated", value: 10 };
    const result = upsertItem(collection, updatedItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"].name).toBe("one-updated");
    expect(result.map["1"].value).toBe(10);
    assertCollectionInvariants(result, "collection after upserting existing item");
  });

  test("upsert does not create duplicate ids", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const item: TestItem = { id: "2", name: "two", value: 2 };
    const result1 = upsertItem(collection, item);
    const result2 = upsertItem(result1, item);

    expect(result2.ids).toEqual(["1", "2"]);
    expect(new Set(result2.ids).size).toBe(result2.ids.length);
    assertCollectionInvariants(result2, "collection after multiple upserts");
  });
});

describe("removeItem", () => {
  test("removes item from collection", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    const result = removeItem(collection, "2");

    expect(result.ids).toEqual(["1", "3"]);
    expect(result.map["2"]).toBeUndefined();
    expect(result.map["1"]).toBeDefined();
    expect(result.map["3"]).toBeDefined();
    assertCollectionInvariants(result, "collection after removing item");
  });

  test("removes item and id from ids list", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const result = removeItem(collection, "1");

    expect(result.ids).toEqual(["2"]);
    expect(result.ids).not.toContain("1");
    expect(result.map["1"]).toBeUndefined();
    assertCollectionInvariants(result, "collection after removing item and id");
  });

  test("removing non-existent item returns same collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const result = removeItem(collection, "999");

    expect(result).toBe(collection);
    assertCollectionInvariants(result, "collection after removing non-existent item");
  });

  test("removes last item from collection", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const result = removeItem(collection, "1");

    expect(result.ids).toEqual([]);
    expect(result.map).toEqual({});
    assertCollectionInvariants(result, "empty collection after removing last item");
  });
});

describe("replaceItem", () => {
  test("replaces item with different id", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    const newItem: TestItem = { id: "2-new", name: "two-new", value: 20 };
    const result = replaceItem(collection, "2", newItem);

    expect(result.ids).toEqual(["1", "2-new", "3"]);
    expect(result.map["2"]).toBeUndefined();
    expect(result.map["2-new"]).toEqual(newItem);
    assertCollectionInvariants(result, "collection after replacing item");
  });

  test("replacing item removes duplicate id if new id already exists", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    // Replace item "2" with an item that has id "3" (which already exists)
    const newItem: TestItem = { id: "3", name: "three-new", value: 30 };
    const result = replaceItem(collection, "2", newItem);

    // Should keep the replacement at position 1 and remove the old "3" at position 2
    expect(result.ids).toEqual(["1", "3"]);
    expect(result.map["2"]).toBeUndefined();
    expect(result.map["3"]).toEqual(newItem);
    expect(result.ids.length).toBe(2);
    expect(new Set(result.ids).size).toBe(result.ids.length);
    assertCollectionInvariants(result, "collection after replacing with duplicate id");
  });

  test("replacing non-existent item does nothing", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const newItem: TestItem = { id: "2", name: "two", value: 2 };
    const result = replaceItem(collection, "999", newItem);

    expect(result).toBe(collection);
  });

  test("replacing item at index 0", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const newItem: TestItem = { id: "1-new", name: "one-new", value: 10 };
    const result = replaceItem(collection, "1", newItem);

    expect(result.ids[0]).toBe("1-new");
    expect(result.map["1-new"]).toEqual(newItem);
    expect(result.map["1"]).not.toBeDefined();
  });

  test("replace maintains position in ids list", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    const newItem: TestItem = { id: "2-new", name: "two-new", value: 20 };
    const result = replaceItem(collection, "2", newItem);

    expect(result.ids[1]).toBe("2-new");
    assertCollectionInvariants(result, "collection with maintained position");
  });

  test("replaceItem cleans up stale refsCount entries when id changes", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);
    // Set a refsCount for the item we're about to replace
    collection.refsCount["2"] = 5;

    const newItem: TestItem = { id: "2-new", name: "two-new", value: 20 };
    const result = replaceItem(collection, "2", newItem);

    // The new id should have the ref count
    expect(result.refsCount["2-new"]).toBe(5);
    // The old id should be cleaned up
    expect(result.refsCount["2"]).toBeUndefined();
  });
});

describe("addItemAt", () => {
  test("addItemAt with negative index", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    const newItem: TestItem = { id: "1", name: "one", value: 1 };
    const result = addItemAt(collection, -1, newItem);

    expect(result.ids).toEqual(["1", "2", "3"]);
    expect(result.map["1"]).toEqual(newItem);
  });

  test("addItemAt at index 0", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "2", name: "two", value: 2 }]);

    const newItem: TestItem = { id: "1", name: "one", value: 1 };
    const result = addItemAt(collection, 0, newItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual(newItem);
  });

  test("addItemAt at large index", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const newItem: TestItem = { id: "2", name: "two", value: 2 };
    const result = addItemAt(collection, 100, newItem);

    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["2"]).toEqual(newItem);
  });

  test("adding item with existing id at index returns same collection", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const duplicateItem: TestItem = { id: "1", name: "one-duplicate", value: 10 };
    const result = addItemAt(collection, 1, duplicateItem);

    expect(result).toBe(collection);
    assertCollectionInvariants(result, "collection after adding duplicate at index");
  });
});

describe("getItem and getItems", () => {
  test("getItem returns correct item", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const item = getItem(collection, "1");
    expect(item).toEqual({ id: "1", name: "one", value: 1 });
  });

  test("getItem returns undefined for non-existent item", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const item = getItem(collection, "999");
    expect(item).toBeUndefined();
  });

  test("getItems returns items in order", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    const items = getItems(collection);
    expect(items).toEqual([
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);
  });

  test("getItems skips missing items in map", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    // Manually create inconsistent state
    collection.ids.push("3");

    const items = getItems(collection);
    expect(items.length).toBe(2);
    expect(items).toEqual([
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);
  });
});

describe("Collection invariants - comprehensive tests", () => {
  test("multiple operations maintain unique ids", () => {
    let collection = createCollection<TestItem, "id">("id");

    // Add items
    collection = addItem(collection, { id: "1", name: "one", value: 1 });
    collection = addItem(collection, { id: "2", name: "two", value: 2 });
    collection = addItem(collection, { id: "3", name: "three", value: 3 });

    assertCollectionInvariants(collection, "after adding 3 items");
    expect(collection.ids).toEqual(["1", "2", "3"]);

    // Update item
    collection = updateItem(collection, { id: "2", name: "two-updated", value: 20 });
    assertCollectionInvariants(collection, "after updating item");
    expect(collection.ids).toEqual(["1", "2", "3"]);

    // Remove item
    collection = removeItem(collection, "2");
    assertCollectionInvariants(collection, "after removing item");
    expect(collection.ids).toEqual(["1", "3"]);

    // Upsert existing
    collection = upsertItem(collection, { id: "1", name: "one-upserted", value: 10 });
    assertCollectionInvariants(collection, "after upserting existing");
    expect(collection.ids).toEqual(["1", "3"]);

    // Upsert new
    collection = upsertItem(collection, { id: "4", name: "four", value: 4 });
    assertCollectionInvariants(collection, "after upserting new");
    expect(collection.ids).toEqual(["1", "3", "4"]);
  });

  test("adding same item multiple times does not duplicate", () => {
    let collection = createCollection<TestItem, "id">("id");
    const item: TestItem = { id: "1", name: "one", value: 1 };

    collection = addItem(collection, item);
    const firstAdd = collection;

    collection = addItem(collection, item);
    expect(collection).toBe(firstAdd); // Should return same reference

    collection = addItem(collection, { id: "1", name: "different", value: 999 });
    expect(collection).toBe(firstAdd); // Should still return same reference

    assertCollectionInvariants(collection, "after multiple add attempts");
    expect(collection.ids).toEqual(["1"]);
  });

  test("replace maintains order and uniqueness", () => {
    let collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
      { id: "4", name: "four", value: 4 },
    ]);

    // Replace middle item
    collection = replaceItem(collection, "2", { id: "2-new", name: "two-new", value: 20 });
    expect(collection.ids).toEqual(["1", "2-new", "3", "4"]);
    assertCollectionInvariants(collection, "after replacing middle item");

    // Replace last item
    collection = replaceItem(collection, "4", { id: "4-new", name: "four-new", value: 40 });
    expect(collection.ids).toEqual(["1", "2-new", "3", "4-new"]);
    assertCollectionInvariants(collection, "after replacing last item");
  });

  test("empty collection operations", () => {
    let collection = createCollection<TestItem, "id">("id");

    // Update on empty
    collection = updateItem(collection, { id: "1", name: "one", value: 1 });
    expect(collection.ids).toEqual([]);
    assertCollectionInvariants(collection, "after update on empty");

    // Remove on empty
    collection = removeItem(collection, "1");
    expect(collection.ids).toEqual([]);
    assertCollectionInvariants(collection, "after remove on empty");

    collection = replaceItem(collection, "1", { id: "2", name: "two", value: 2 });
    expect(collection.map["2"]).not.toBeDefined();
    expect(collection.ids).toEqual([]);
  });

  test("collection with many items maintains invariants", () => {
    const items: TestItem[] = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      name: `name-${i}`,
      value: i,
    }));

    const collection = createCollection<TestItem, "id">("id", items);

    assertCollectionInvariants(collection, "collection with 100 items");
    expect(collection.ids.length).toBe(100);
    expect(Object.keys(collection.map).length).toBe(100);
  });
});

describe("Bug fixes verification", () => {
  test("addItemAt with positive index works correctly", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const newItem: TestItem = { id: "3", name: "three", value: 3 };
    const result = addItemAt(collection, 1, newItem);

    // FIXED: Now correctly inserts at index 1
    expect(result.ids).toEqual(["1", "3", "2"]);
    expect(result.map["3"]).toEqual(newItem);
    assertCollectionInvariants(result, "after addItemAt with positive index");
  });

  test("replaceItem when replacing earlier item with later item's id (bug fixed)", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
      { id: "3", name: "three", value: 3 },
    ]);

    // Replace "1" (at index 0) with an item that has id "3" (which exists at index 2)
    const result = replaceItem(collection, "1", { id: "3", name: "three-new", value: 30 });

    // Should keep "3" at position 0 (where "1" was) and remove the old "3" at position 2
    expect(result.ids).toEqual(["3", "2"]);
    expect(result.map["3"]).toEqual({ id: "3", name: "three-new", value: 30 });
    expect(result.map["1"]).toBeUndefined();
    expect(result.ids.length).toBe(2);
    assertCollectionInvariants(result, "after replacing with later item's id");
  });
});

describe("Inconsistent state handling - addItems", () => {
  test("handles id in map but not in ids (inconsistent state)", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Manually create inconsistent state: item in map but not in ids
    collection.map["1"] = { id: "1", name: "orphan", value: 100 };

    const newItems: TestItem[] = [
      { id: "1", name: "one-updated", value: 1 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    // Should fix inconsistent state by adding id to ids and updating map
    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one-updated", value: 1 });
    expect(result.map["2"]).toEqual({ id: "2", name: "two", value: 2 });
    assertCollectionInvariants(result, "collection after fixing inconsistent state");
  });

  test("handles id in ids but not in map (inconsistent state)", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Manually create inconsistent state: id in ids but not in map
    collection.ids.push("1");

    const newItems: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    // Should add item to map without duplicating id
    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one", value: 1 });
    expect(result.map["2"]).toEqual({ id: "2", name: "two", value: 2 });
    assertCollectionInvariants(result, "collection after fixing inconsistent state");
  });

  test("handles item not in map and not in ids (normal case)", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "0", name: "zero", value: 0 },
    ]);

    const newItems: TestItem[] = [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    // Should add both items normally
    expect(result.ids).toEqual(["0", "1", "2"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one", value: 1 });
    expect(result.map["2"]).toEqual({ id: "2", name: "two", value: 2 });
    assertCollectionInvariants(result, "collection after adding new items");
  });

  test("handles item in both map and ids (skip case)", () => {
    const collection = createCollection<TestItem, "id">("id", [{ id: "1", name: "one", value: 1 }]);

    const newItems: TestItem[] = [
      { id: "1", name: "one-duplicate", value: 10 },
      { id: "2", name: "two", value: 2 },
    ];

    const result = addItems(collection, newItems);

    // Should skip existing item and add new one
    expect(result.ids).toEqual(["1", "2"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one", value: 1 }); // Original unchanged
    expect(result.map["2"]).toEqual({ id: "2", name: "two", value: 2 });
    assertCollectionInvariants(result, "collection after skipping existing item");
  });

  test("handles multiple inconsistent states in single batch", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Create multiple inconsistent states
    collection.map["1"] = { id: "1", name: "orphan-in-map", value: 100 }; // in map, not in ids
    collection.ids.push("2"); // in ids, not in map

    const newItems: TestItem[] = [
      { id: "1", name: "one", value: 1 }, // Fix: in map but not in ids
      { id: "2", name: "two", value: 2 }, // Fix: in ids but not in map
      { id: "3", name: "three", value: 3 }, // Normal: new item
    ];

    const result = addItems(collection, newItems);

    // Should fix all inconsistencies
    // Note: "2" stays at beginning because it was already in ids, "1" and "3" are appended
    expect(result.ids).toEqual(["2", "1", "3"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one", value: 1 });
    expect(result.map["2"]).toEqual({ id: "2", name: "two", value: 2 });
    expect(result.map["3"]).toEqual({ id: "3", name: "three", value: 3 });
    assertCollectionInvariants(result, "collection after fixing multiple inconsistencies");
  });

  test("returns same collection when trying to add items that all exist", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
      { id: "2", name: "two", value: 2 },
    ]);

    const newItems: TestItem[] = [
      { id: "1", name: "one-dup", value: 10 },
      { id: "2", name: "two-dup", value: 20 },
    ];

    const result = addItems(collection, newItems);

    // Should return same collection reference
    expect(result).toBe(collection);
  });

  test("handles empty collection with inconsistent state", () => {
    const collection = createCollection<TestItem, "id">("id");
    // Create inconsistent state in empty collection
    collection.map["1"] = { id: "1", name: "orphan", value: 100 };

    const newItems: TestItem[] = [{ id: "1", name: "one", value: 1 }];

    const result = addItems(collection, newItems);

    // Should fix inconsistent state
    expect(result.ids).toEqual(["1"]);
    expect(result.map["1"]).toEqual({ id: "1", name: "one", value: 1 });
    assertCollectionInvariants(result, "collection after fixing empty collection inconsistency");
  });
});


describe("isCollection", () => {
  test("returns true for a valid collection", () => {
    const collection = createCollection<TestItem, "id">("id", [
      { id: "1", name: "one", value: 1 },
    ]);
    expect(isCollection(collection)).toBe(true);
  });

  test("returns true for an empty collection", () => {
    const collection = createCollection<TestItem, "id">("id");
    expect(isCollection(collection)).toBe(true);
  });

  test("returns false for an empty object", () => {
    expect(isCollection({})).toBe(false);
  });

  test("returns false for partial matches - only ids", () => {
    expect(isCollection({ ids: [] })).toBe(false);
  });

  test("returns false for partial matches - missing refsCount", () => {
    expect(isCollection({ idField: "id", ids: [], map: {} })).toBe(false);
  });

  test("returns false for partial matches - missing map", () => {
    expect(isCollection({ idField: "id", ids: [], refsCount: {} })).toBe(false);
  });

  test("returns false for wrong types - idField is number", () => {
    expect(isCollection({ idField: 123, ids: [], map: {}, refsCount: {} })).toBe(false);
  });

  test("returns false for wrong types - ids is not array", () => {
    expect(isCollection({ idField: "id", ids: "not-array", map: {}, refsCount: {} })).toBe(false);
  });

  test("returns false for wrong types - map is null", () => {
    expect(isCollection({ idField: "id", ids: [], map: null, refsCount: {} })).toBe(false);
  });

  test("returns false for wrong types - map is array", () => {
    expect(isCollection({ idField: "id", ids: [], map: [], refsCount: {} })).toBe(false);
  });

  test("returns false for wrong types - refsCount is array", () => {
    expect(isCollection({ idField: "id", ids: [], map: {}, refsCount: [] })).toBe(false);
  });

  test("returns false for objects with extra fields", () => {
    expect(isCollection({ idField: "id", ids: [], map: {}, refsCount: {}, extra: true })).toBe(
      false
    );
  });

  test("returns false for non-collection objects", () => {
    expect(isCollection({ name: "test", value: 42 })).toBe(false);
    expect(isCollection({ id: "1" })).toBe(false);
  });
});
