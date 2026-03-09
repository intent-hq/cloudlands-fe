import type { Middleware, Store, UnknownAction } from "redux";
import type { Readable } from "svelte/store";
import type { Saga, Task } from "redux-saga";
import type { reducers } from "./reducer";
import type { sagas } from "./sagas";

// ============================================================================
// Action Types
// ============================================================================

export type StoreAction<PL = undefined> = {
  type: string;
  payload: PL;
};

export type GenericAction = StoreAction<any>;

export type PayloadModifier<ARGS extends any[], PL> = (...args: ARGS) => PL;

export type StoreActionCreator<ARGS extends any[] = [], PL = ARGS> = {
  (...args: ARGS): StoreAction<PL>;
  type: string;
  toString: () => string;
};

export type SuccessResponse<PL, R> = {
  request: PL;
  response: R;
};

export type ErrorResponse<PL> = {
  request: PL;
  error: Error;
};

export type StoreAsyncAction<PL = undefined, R = unknown> = {
  type: string;
  asyncActionType: string;
  payload: PL;
  promise: Promise<R>;
  success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
  failure: StoreActionCreator<[Error], ErrorResponse<PL>>;
};

export type StoreAsyncActionCreator<ARGS extends any[] = [], PL = ARGS, R = unknown> = {
  (...args: ARGS): StoreAsyncAction<PL, R>;
  type: string;
  asyncActionType: string;
  success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
  failure: StoreActionCreator<[Error], ErrorResponse<PL>>;
  toString: () => string;
};

// ============================================================================
// Middleware Types
// ============================================================================

export type MiddlewareFunction = (
  action: GenericAction,
  api: { dispatch: ReduxStore["dispatch"]; getState: ReduxStore["getState"] }
) => GenericAction | Promise<GenericAction> | void;

export type StoreMiddleware = Middleware<any, StoreState, any>;

// ============================================================================
// Store Types
// ============================================================================

export type ReducersMap = typeof reducers;
export type StateDomain = keyof ReducersMap;
export type StoreState = {
  [K in keyof ReducersMap]: ReturnType<ReducersMap[K]>;
};

export type PreloadedStoreState = Partial<StoreState>;

export type ReduxStore = Store<StoreState, UnknownAction>;

export type SagaName = keyof typeof sagas;

export type ReduxStoreContext = {
  store: ReduxStore;
  storeState: Readable<StoreState>;
  dispose: () => void;
  runSaga: <S extends Saga>(saga: S, ...args: Parameters<S>) => Task;
  tasks?: {
    running: SagaName[];
    notRunning: SagaName[];
  };
};

// ============================================================================
// Selector Types
// ============================================================================

/**
 * Converts an args tuple so that each element can be either a plain value or a Readable.
 * Used by selectors to accept reactive arguments in Svelte components.
 */
export type ReadableArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Readable<ARGS[K]>;
};

export type StoreSelector<R, ARGS extends any[] = []> = {
  (...args: ReadableArgs<ARGS>): Readable<R>;
  withStore: (store: ReduxStore) => (...args: ReadableArgs<ARGS>) => Readable<R>;
  select: (state: StoreState, ...args: ARGS) => R;
  effect: (...args: ARGS) => any;
};

