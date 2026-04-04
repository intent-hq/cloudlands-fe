import type { Store, UnknownAction } from "redux";

import type { reducers } from "./reducer";
import type { __storeTarget } from "../utils/types";

export type MainReducersMap = typeof reducers;

export type MainStoreState = { readonly [__storeTarget]: "main" } & {
  [K in keyof MainReducersMap]: ReturnType<MainReducersMap[K]>;
};

export type MainReduxStore = Store<MainStoreState, UnknownAction>;
