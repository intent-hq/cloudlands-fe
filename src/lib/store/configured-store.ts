import { Store } from "svelte-redux-toolkit/store";
import type { StoreMiddleware } from "svelte-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new Store(reducers, middleware as unknown as StoreMiddleware[]);