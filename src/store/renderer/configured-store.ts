import { Store } from "$lib/store-shim/svelte-store";
import type { StoreMiddleware } from "$lib/store-shim/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new Store(reducers, middleware as unknown as StoreMiddleware[]);