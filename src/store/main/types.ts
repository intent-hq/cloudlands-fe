import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from "ag-redux-toolkit/types";

import type { reducers } from "./reducer";
import type { store as configuredStore } from "./configured-store";
import type { __storeTarget } from "../utils/types";

export type MainReducersMap = typeof reducers;

export type MainStore = typeof configuredStore;

export type MainStoreState = ToolkitStoreState<MainStore> & { readonly [__storeTarget]: "main" };

export type PreloadedMainStoreState = ToolkitPreloadedStoreState<MainStoreState>;
