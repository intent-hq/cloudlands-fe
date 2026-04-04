import type { SagaGenerator } from "typed-redux-saga";
import { select } from "typed-redux-saga";

import { createCachedSelector } from "../../utils/create-cached-selector";
import type { MainStoreState } from "../types";

export type MainStoreSelector<R, ARGS extends unknown[] = []> = {
  select: (state: MainStoreState, ...args: ARGS) => R;
  effect: (...args: ARGS) => SagaGenerator<R>;
};

const isTestEnv =
  typeof process !== "undefined" &&
  (process.env.VITEST === "true" || process.env.NODE_ENV === "test");

const assertMainProcessSelectorContext = () => {
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined" && !isTestEnv) {
    throw new Error("Main-process selector called in renderer context.");
  }
};

export const createSelector = <ARGS extends unknown[] = [], R = unknown>(
  selectorFunc: (state: MainStoreState, ...args: ARGS) => R
): MainStoreSelector<R, ARGS> => {
  const cachedSelector = createCachedSelector<MainStoreState, ARGS, R>(selectorFunc);
  const guardedSelect = (state: MainStoreState, ...args: ARGS): R => {
    assertMainProcessSelectorContext();
    return cachedSelector(state, ...args);
  };

  return {
    select: guardedSelect,
    effect: (...args: ARGS) => select(guardedSelect, ...args),
  };
};