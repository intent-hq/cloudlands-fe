import { Store } from "ag-redux-toolkit/svelte-store";
import type { StoreMiddleware } from "ag-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new Store(reducers, middleware as unknown as StoreMiddleware[]);