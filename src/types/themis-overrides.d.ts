declare module '@augmentcode/themis/utils/store/create-reducer' {
  import type { UnknownAction } from 'redux';
  import type { StoreAction, StoreActionCreator } from '@augmentcode/themis/types';

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

declare module '@augmentcode/themis/utils/sagas/selector-channel-effects' {
  import type { EventChannel, Task } from 'redux-saga';
  import type { StoreSelectorCallback, StoreSelectorEffect } from '@augmentcode/themis/types';

  export type SelectorChannelSelector<R, ARGS extends any[] = [], TState = any> = {
    select: StoreSelectorCallback<R, ARGS, TState>;
    effect: StoreSelectorEffect<R, ARGS>;
  };

  export type SelectorChannelPayload<R> = {
    payload: R;
    prevPayload: R | undefined | null;
  };

  export type SelectorWorkerSaga<R> = (
    payload: SelectorChannelPayload<R>,
  ) => Generator<any, void, any>;

  export function createChannelFromSelector<R, ARGS extends any[]>(
    selector: SelectorChannelSelector<R, ARGS, any>,
    ...args: ARGS
  ): Generator<any, EventChannel<SelectorChannelPayload<R>>, any>;

  export function takeEveryFromSelector<R>(
    selector: SelectorChannelSelector<R, [], any>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeEveryFromSelector<R, ARGS extends any[]>(
    selector: SelectorChannelSelector<R, ARGS, any>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;

  export function takeLatestFromSelector<R>(
    selector: SelectorChannelSelector<R, [], any>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeLatestFromSelector<R, ARGS extends any[]>(
    selector: SelectorChannelSelector<R, ARGS, any>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;

  export function takeLeadingFromSelector<R>(
    selector: SelectorChannelSelector<R, [], any>,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
  export function takeLeadingFromSelector<R, ARGS extends any[]>(
    selector: SelectorChannelSelector<R, ARGS, any>,
    args: ARGS,
    worker: SelectorWorkerSaga<R>,
  ): Generator<any, Task, any>;
}
