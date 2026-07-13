import { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new Store(reducers, middleware as unknown as StoreMiddleware[]);