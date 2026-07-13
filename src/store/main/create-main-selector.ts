/**
 * Lightweight selector helper for the main process.
 *
 * The main-process Redux StreamingStore has been removed. Selectors are now
 * plain functions invoked with an explicit state snapshot via
 * `selector.select(state, ...args)`, preserving the call surface previously
 * provided by `store.createSelector(...)` for main-process services and tests.
 */

import type { MainStoreState } from "./types";

export interface MainSelector<R, ARGS extends unknown[] = []> {
  select(state: MainStoreState, ...args: ARGS): R;
}

export function createMainSelector<ARGS extends unknown[] = [], R = unknown>(
  selectorFunc: (state: MainStoreState, ...args: ARGS) => R,
): MainSelector<R, ARGS> {
  return {
    select: (state: MainStoreState, ...args: ARGS): R => selectorFunc(state, ...args),
  };
}
