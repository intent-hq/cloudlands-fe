declare module "svelte-redux-toolkit/utils/store/create-reducer" {
  import type { UnknownAction } from "redux";
  import type { StoreAction, StoreActionCreator } from "svelte-redux-toolkit/types";

  export type StoreReducer<S, A> = (state: S, action: A) => S;

  export type CreatedReducer<S> = {
    (state: S | undefined, action: StoreAction<any> | UnknownAction): S;
    with: <ARGS extends any[], PL = ARGS>(
      action: StoreActionCreator<ARGS, PL>,
      reducer: StoreReducer<S, StoreAction<PL>>,
    ) => CreatedReducer<S>;
    initialState: S;
  };

  export function createReducer<S>(initialState: S): CreatedReducer<S>;
}

declare module "svelte-redux-toolkit/utils/store/create-action" {
  export type StoreAction<PL = undefined> = {
    type: string;
    payload: PL;
  };

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
    error: string;
  };

  export type StoreAsyncAction<PL = undefined, R = unknown> = {
    type: string;
    asyncActionType: string;
    payload: PL;
    promise: Promise<R>;
    success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
    failure: StoreActionCreator<[string], ErrorResponse<PL>>;
  };

  export type StoreAsyncActionCreator<ARGS extends any[] = [], PL = ARGS, R = unknown> = {
    (...args: ARGS): StoreAsyncAction<PL, R>;
    type: string;
    asyncActionType: string;
    success: StoreActionCreator<[R], SuccessResponse<PL, R>>;
    failure: StoreActionCreator<[string], ErrorResponse<PL>>;
    toString: () => string;
  };

  export function createAction<ARGS extends any[], PL>(
    actionType: string,
    payloadModifier: PayloadModifier<ARGS, PL>,
  ): StoreActionCreator<ARGS, PL>;
  export function createAction<ARGS extends any[]>(
    actionType: string,
    payloadModifier: PayloadModifier<ARGS, ARGS>,
  ): StoreActionCreator<ARGS, ARGS>;
  export function createAction(actionType: string, payloadModifier?: undefined): StoreActionCreator<[], undefined>;
  export function createAction<ARGS extends any[]>(
    actionType: string,
    payloadModifier?: undefined,
  ): StoreActionCreator<ARGS, ARGS>;

  export function createAsyncAction<ARGS extends any[], PL, R = unknown>(
    asyncActionType: string,
    stagesActionType: string,
    payloadModifier: PayloadModifier<ARGS, PL>,
  ): StoreAsyncActionCreator<ARGS, PL, R>;
  export function createAsyncAction<ARGS extends any[]>(
    asyncActionType: string,
    stagesActionType: string,
    payloadModifier?: PayloadModifier<ARGS, ARGS>,
  ): StoreAsyncActionCreator<ARGS>;
  export function createAsyncAction<R = unknown>(
    asyncActionType: string,
    stagesActionType: string,
    payloadModifier?: undefined,
  ): StoreAsyncActionCreator<[], undefined, R>;
  export function createAsyncAction<ARGS extends any[], R = unknown>(
    asyncActionType: string,
    stagesActionType: string,
  ): StoreAsyncActionCreator<ARGS, ARGS, R>;
}

declare module "svelte-redux-toolkit/utils/sagas/selector-channel-effects" {
  import type { EventChannel, Task } from "redux-saga";
  import type { StoreSelector } from "$lib/store/types";

  export type SelectorChannelPayload<R> = {
    payload: R;
    prevPayload: R | undefined | null;
  };

  export type SelectorWorkerSaga<R> = (payload: SelectorChannelPayload<R>) => Generator<any, void, any>;

  export function createChannelFromSelector<R, ARGS extends any[]>(
    selector: StoreSelector<R, ARGS>,
    ...args: ARGS
  ): Generator<any, EventChannel<SelectorChannelPayload<R>>, any>;

  export function takeEveryFromSelector<R>(
    selector: StoreSelector<R, []>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeEveryFromSelector<R, ARGS extends any[]>(
    selector: StoreSelector<R, ARGS>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;

  export function takeLatestFromSelector<R>(
    selector: StoreSelector<R, []>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeLatestFromSelector<R, ARGS extends any[]>(
    selector: StoreSelector<R, ARGS>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;

  export function takeLeadingFromSelector<R>(
    selector: StoreSelector<R, []>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeLeadingFromSelector<R, ARGS extends any[]>(
    selector: StoreSelector<R, ARGS>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
}
