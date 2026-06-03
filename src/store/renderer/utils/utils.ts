/**
 * Pure utility functions with NO Svelte dependency.
 * Safe to import from both the renderer and the main process.
 */

/**
 * Asserts that a value is not null or undefined, throwing an error if it is.
 * This is a type guard that narrows the type to exclude null and undefined.
 *
 * @param value - The value to check
 * @returns The value with null and undefined excluded from its type
 * @throws Error if the value is null or undefined
 */
export const assertValue = <T>(value: T): NonNullable<T> => {
  if (value === undefined || value === null) {
    throw new Error("Unexpected empty value");
  }
  return value;
};

/**
 * Removes a key from an object immutably without using `delete`.
 * Using destructuring instead of `delete` avoids V8 de-optimization
 * that can occur when objects have properties deleted.
 *
 * @param obj - The object to remove the key from
 * @param key - The key to remove
 * @returns A new object without the specified key, or the original object if key doesn't exist
 */
export function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  if (!(key in obj)) {
    return obj;
  }
   
  const { [key]: _, ...rest } = obj;
  return rest as T;
}
