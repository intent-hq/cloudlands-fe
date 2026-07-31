import { Store } from "@augmentcode/themis/svelte-store";
import type { StoreMiddleware } from "@augmentcode/themis/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new Store(reducers, middleware as unknown as StoreMiddleware[]);