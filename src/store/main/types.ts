import type { reducers } from "./reducer";
import type { __storeTarget } from "../utils/types";

export type MainReducersMap = typeof reducers;

/**
 * Plain shape of the (now removed) main-process Redux state.
 *
 * The StreamingStore that previously owned this state has been removed; the type
 * is retained so the slice selectors and the main-process services that read it
 * continue to type-check against the slice reducer return shapes.
 */
export type MainStoreState = {
  readonly [K in keyof MainReducersMap]: ReturnType<MainReducersMap[K]>;
} & { readonly [__storeTarget]: "main" };
