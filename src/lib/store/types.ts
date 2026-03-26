import type { Middleware, Store, UnknownAction } from 'redux';
import type { Readable } from 'svelte/store';
import type { Saga, Task } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import type { reducers } from './reducer';

/**
 * SagaName is declared as an explicit string literal union to avoid importing
 * from `./sagas`, which would transitively pull every saga module (and their
 * renderer-only dependencies like `$app/navigation`) into any compilation
 * unit that touches store types — including the main-process typecheck.
 *
 * To keep this in sync with the `sagas` registry, `sagas.ts` includes a
 * compile-time assertion that ensures the keys of the `sagas` object match
 * this type exactly.
 */
export type SagaName =
  | 'providerSettingsSaga'
  | 'backgroundAgentSettingsSaga'
  | 'externalEditorsSaga'
  | 'uiLayoutSaga'
  | 'tabStateSaga'
  | 'terminalsSaga'
  | 'noteReadTrackingSaga'
  | 'permissionSaga'
  | 'featureCodesSaga'
  | 'knownReposSaga'
  | 'deepLinksSaga'
  | 'modelSaga'
  | 'specialistsSaga'
  | 'systemStatusSaga'
  | 'pipSaga'
  | 'userPreferencesSaga'
  | 'workspaceOperationsSaga'
  | 'workspaceSettingsSaga'
  | 'streamingSaga'
  | 'workspaceSaga'
  | 'gitSaga'
  | 'fileTrackingSaga'
  | 'notesSaga'
  | 'agentsSaga'
  | 'messagesSaga'
  | 'contextSaga'
  | 'browserSaga'
  | 'mcpSaga'
  | 'diffsSaga'
  | 'settingsSaga'
  | 'authSaga'
  | 'uiSaga'
  | 'layoutSaga'
  | 'autoUpdateSaga'
  | 'workspaceInitializerSaga';

// ============================================================================
// Saga Status Types
// ============================================================================

export type SagaCrashRecord = {
  crashedAt: Date;
  error: Error;
};

export type SagaStatusRecord = {
  isRunning: boolean;
  launchedAtTs: number | null;
  crashes: SagaCrashRecord[];
};

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

export type ReduxStoreContext = {
  store: ReduxStore;
  storeState: Readable<StoreState>;
  dispose: () => void;
  runSaga: <S extends Saga>(saga: S, ...args: Parameters<S>) => Task;
  tasks?: Record<SagaName, SagaStatusRecord>;
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

export type StoreSelectorCallback<R, ARGS extends any[] = []> = (
  state: StoreState,
  ...args: ARGS
) => R;

export type StoreSelectorReadable<R, ARGS extends any[] = []> = (
  ...args: ReadableArgs<ARGS>
) => Readable<R>;

export type StoreSelectorSelect<R, ARGS extends any[] = []> = StoreSelectorCallback<R, ARGS>;

export type StoreSelectorEffect<R, ARGS extends any[] = []> = (...args: ARGS) => SagaGenerator<R>;

export type StoreSelectorWithStore<R, ARGS extends any[] = []> = (
  store: ReduxStore
) => StoreSelectorReadable<R, ARGS>;

export type StoreSelector<R, ARGS extends any[] = []> = StoreSelectorReadable<R, ARGS> & {
  withStore: StoreSelectorWithStore<R, ARGS>;
  select: StoreSelectorSelect<R, ARGS>;
  effect: StoreSelectorEffect<R, ARGS>;
};

export type CreateSelector = <ARGS extends any[] = [], R = unknown>(
  selectorFunc: StoreSelectorCallback<R, ARGS>
) => StoreSelector<R, ARGS>;

