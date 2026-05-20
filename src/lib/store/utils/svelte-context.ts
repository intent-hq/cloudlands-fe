/**
 * Legacy component-dispatch compatibility helper.
 * New code should import the configured Store and call `appStore.dispatch(...)`
 * directly; remove this once the existing settings components/tests migrate.
 *
 * Pure utilities (omitKey, assertValue) live in ./utils.ts.
 */

import type { ReduxStore } from "../types";
import { appStore } from "../store";
export { readableProp } from "./readable-prop";

export function getDispatch(): ReduxStore["dispatch"] {
  return appStore.dispatch;
}
