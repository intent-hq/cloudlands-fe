import { Readable } from 'svelte/store';

/**
 * Redux-free stand-in for the saga generator return type the toolkit used to
 * expose. The saga runtime has been removed, so this only preserves the
 * selector `.effect` type surface without depending on the saga engine.
 */
export type SagaGenerator<R = any> = Generator<any, R, any>;

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

/**
 * Minimal redux-free equivalent of the store handle that middleware and
 * selectors reference. Mirrors the structural shape the toolkit exposed.
 */
type ReduxStoreLike = {
  dispatch: (action: any) => any;
  getState: () => StoreState;
  subscribe: (listener: () => void) => () => void;
};

export type MiddlewareFunction = (
  action: GenericAction,
  api: {
    dispatch: ReduxStoreLike['dispatch'];
    getState: ReduxStoreLike['getState'];
  },
) => GenericAction | Promise<GenericAction> | void;

/**
 * Structural, redux-compatible middleware type. Provides the curried
 * api -> next -> action call shape so middleware authored against it gets
 * contextual parameter types, while staying permissive enough to accept the
 * saga middleware the app still wires while the engine is being removed.
 */
export type StoreMiddleware = (api: {
  dispatch: (action: any) => any;
  getState: () => any;
}) => (next: (action: any) => any) => (action: any) => any;

type StateDomain = string;
export type StoreStateMap = Record<StateDomain, any>;
export type StoreReducerFunction<TState = any> = (state: any, action: any) => TState;
export type ReducersMap = Record<string, StoreReducerFunction>;
export type StoreOptions = {
  throttledSelectorFrequency?: number;
  sagaMonitor?: boolean;
  traceSelectors?: boolean;
};
export type NormalizedStoreOptions = {
  throttledSelectorFrequency: number;
  sagaMonitor: boolean;
  traceSelectors: boolean;
};
export type StoreReducerState<Reducer> =
  Reducer extends StoreReducerFunction<infer State> ? State : never;
export type StoreStateFromStateMap<TStateMap extends StoreStateMap> = {
  [Domain in keyof TStateMap]: TStateMap[Domain];
};
export type StoreStateFromReducers<Reducers extends ReducersMap> = {
  [Domain in keyof Reducers]: StoreReducerState<Reducers[Domain]>;
};
export type StoreState<TStore = unknown> = TStore extends {
  readonly state: infer State;
}
  ? State
  : TStore extends {
        getReadableState(): Readable<infer State>;
      }
    ? State
    : TStore extends {
          getReducers(): infer Reducers;
        }
      ? Reducers extends ReducersMap
        ? StoreStateFromReducers<Reducers>
        : Record<string, any>
      : Record<string, any>;
export type StoreInstanceState<TStore = unknown> = StoreState<TStore>;
export type StoreReadableStateSource<TState = StoreState> = {
  getReadableState(): Readable<TState>;
};
export type PreloadedStoreState<TState = StoreState> = Partial<TState>;

export type ReadableArgs<ARGS extends any[]> = {
  [K in keyof ARGS]: ARGS[K] | Readable<ARGS[K]>;
};
export type StoreSelectorCallback<R, ARGS extends any[] = [], TState = StoreState> = (
  state: TState,
  ...args: ARGS
) => R;
export type StoreSelectorReadable<R, ARGS extends any[] = []> = (
  ...args: ReadableArgs<ARGS>
) => Readable<R>;
export type StoreSelectorSelect<R, ARGS extends any[] = [], TState = StoreState> =
  StoreSelectorCallback<R, ARGS, TState>;
export type StoreSelectorEffect<R, ARGS extends any[] = []> = (
  ...args: ARGS
) => SagaGenerator<R>;
type StoreSelectorWithStore<R, ARGS extends any[] = [], TState = StoreState> = (
  store: StoreReadableStateSource<TState> | ReduxStoreLike,
) => StoreSelectorReadable<R, ARGS>;
export type StoreSelector<R, ARGS extends any[] = [], TState = StoreState> =
  StoreSelectorReadable<R, ARGS> & {
    withStore: StoreSelectorWithStore<R, ARGS, TState>;
    select: StoreSelectorSelect<R, ARGS, TState>;
    effect: StoreSelectorEffect<R, ARGS>;
  };
export type CreateSelector = <
  TStore extends StoreReadableStateSource<any>,
  ARGS extends any[] = [],
  R = unknown,
>(
  store: TStore,
  selectorFunc: StoreSelectorCallback<R, ARGS, StoreState<TStore>>,
) => StoreSelector<R, ARGS, StoreState<TStore>>;
