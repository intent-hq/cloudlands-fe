import {
  toStore,
  type Readable,
} from "svelte/store";

/**
 * Converts a reactive Svelte prop getter into a readable store for selector arguments.
 */
export function readableProp<T>(getValue: () => T): Readable<T> {
  return toStore(getValue);
}