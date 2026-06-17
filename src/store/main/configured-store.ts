import { StreamingStore } from "@augmentcode/ag-redux-toolkit/streaming-store";
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

import { middleware } from "./middleware";
import { reducers } from "./reducer";

export const store = new StreamingStore(reducers, middleware as StoreMiddleware[]);