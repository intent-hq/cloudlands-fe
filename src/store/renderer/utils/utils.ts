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
