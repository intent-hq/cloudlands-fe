/**
 * Main-process Redux middleware stack.
 *
 * StreamingStore appends its own saga middleware internally.
 * Order: storeGuard → loggerMiddleware (dev only) → StreamingStore saga middleware
 */

import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

import { createStoreGuardMiddleware } from "../utils/store-guard-middleware";
import { createMainLoggerMiddleware } from "./middlewares/logger";

function buildMiddleware(): StoreMiddleware[] {
  const mw: StoreMiddleware[] = [
    createStoreGuardMiddleware("main"),
  ];

  if (process.env.NODE_ENV === "development") {
    mw.push(createMainLoggerMiddleware());
  }

  return mw;
}

export const middleware: StoreMiddleware[] = buildMiddleware();