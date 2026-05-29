/**
 * Main-process Redux middleware stack.
 *
 * Order: storeGuard → sagaMiddleware → loggerMiddleware (dev only)
 */

import type { Middleware } from "redux";
import createSagaMiddleware from "redux-saga";
import type { Saga, Task } from "redux-saga";

import type { MainStoreState } from "./types";
import { createStoreGuardMiddleware } from "../utils/store-guard-middleware";
import { createMainLoggerMiddleware } from "./middlewares/logger";

export const sagaMiddleware = createSagaMiddleware();

export const setSagaContext = (context: Record<string, unknown>): void => {
  sagaMiddleware.setContext(context);
};

export const runSaga = <S extends Saga>(saga: S, ...args: Parameters<S>): Task => {
  return sagaMiddleware.run(saga, ...args);
};

function buildMiddleware(): Middleware<any, MainStoreState, any>[] {
  const mw: Middleware<any, MainStoreState, any>[] = [
    createStoreGuardMiddleware("main"),
    sagaMiddleware,
  ];

  if (process.env.NODE_ENV === "development") {
    mw.push(createMainLoggerMiddleware());
  }

  return mw;
}

export const middleware: Middleware<any, MainStoreState, any>[] = buildMiddleware();