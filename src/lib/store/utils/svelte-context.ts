/**
 * Svelte-dependent store context helpers.
 * These use `getContext` from Svelte and can ONLY run in the renderer process
 * during component initialization.
 *
 * Pure utilities (omitKey, assertValue) live in ./utils.ts.
 */

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
    return getContext<ReduxStoreContext>(STORE_CONTEXT);
  } catch (error) {
    if (isLifecycleOutsideComponentError(error)) {
      throw new Error(STORE_CONTEXT_OUTSIDE_COMPONENT_MESSAGE, { cause: error });
    }

    throw error;
  }
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
