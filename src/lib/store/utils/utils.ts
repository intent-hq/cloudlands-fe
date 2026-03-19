import { getContext } from "svelte";
import type { ReduxStoreContext, ReduxStore } from "../types";
import { STORE_CONTEXT } from "../constants";

const LIFECYCLE_OUTSIDE_COMPONENT_ERROR = "lifecycle_outside_component";
const STORE_CONTEXT_OUTSIDE_COMPONENT_MESSAGE =
  "Store context accessed outside component initialization. " +
  "Store context helpers can only be called during component init " +
  "(top-level <script> block).";

export const isLifecycleOutsideComponentError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }

  // Svelte includes the stable error code token in this message; matching that
  // token keeps the check narrow without depending on the full human-readable text.
  if (error.message.includes(LIFECYCLE_OUTSIDE_COMPONENT_ERROR)) {
    return true;
  }

  return error.cause instanceof Error && isLifecycleOutsideComponentError(error.cause);
};

export const getStoreContext = (): ReduxStoreContext | undefined => {
  try {
    return getContext(STORE_CONTEXT);
  } catch (error) {
    if (isLifecycleOutsideComponentError(error)) {
      throw new Error(STORE_CONTEXT_OUTSIDE_COMPONENT_MESSAGE, { cause: error });
    }

    throw error;
  }
};

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

export function getDispatch(): ReduxStore["dispatch"] {
  let context: ReduxStoreContext | undefined;

  try {
    context = getStoreContext();
  } catch (error) {
    if (isLifecycleOutsideComponentError(error)) {
      throw new Error(
        "getDispatch() called outside component initialization. " +
          "Call getDispatch() during component init (top-level <script> block) " +
          "and store the returned dispatch function for event handlers, callbacks, " +
          "or async functions.",
        { cause: error }
      );
    }

    throw error;
  }

  if (!context?.store) {
    throw new Error("Missing redux store context. Wrap root component into <Store/>");
  }
  return context.store.dispatch;
}

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
