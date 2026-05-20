/**
 * Re-export collection utilities for main-process consumption.
 * Main-process slices should import from here instead of $lib/store/utils/.
 */
export {
  type Collection,
  type RefsCounter,
  createCollection,
  collectionFieldsSet,
  isCollection,
  purgeCollection,
  addItem,
  addItems,
  addItemAt,
  addItemAndCountRef,
  upsertItem,
  upsertItemAndCountRef,
  updateItem,
  replaceItem,
  replaceItems,
  removeItem,
  increaseRefsCount,
  decreaseRefsCount,
  filterCollection,
  deduplicateCollection,
  getItem,
  getLastItem,
  getItemIndex,
  getItems,
  findItem,
  findLastItem,
  filterItems,
  getRefsCount,
} from "svelte-redux-toolkit/utils/collections/collection-utils";

