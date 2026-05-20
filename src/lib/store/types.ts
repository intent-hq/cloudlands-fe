import type { Store, UnknownAction } from 'redux';
import type { Readable } from 'svelte/store';
import type {
  PreloadedStoreState as ToolkitPreloadedStoreState,
  StoreState as ToolkitStoreState,
} from 'svelte-redux-toolkit/types';
import type { store as configuredStore } from './configured-store';

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
  | 'themeSaga'
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
  | 'changesSaga'
  | 'notesSaga'
  | 'workspaceEventsSaga'
  | 'paletteSaga'
  | 'agentsSaga'
  | 'contextSaga'
  | 'browserSaga'
  | 'authSaga'
  | 'uiSaga'
  | 'layoutSaga'
  | 'autoUpdateSaga'
  | 'workspaceNavigationLifecycleSaga'
  | 'retroactiveNavigationMountCheckSaga'
  | 'workspaceNavigationPersistenceSaga'
  | 'panelContextSaga'
  | 'workspaceSwitcherSaga'
  | 'releaseNotesSaga'
  | 'transientUiSaga'
  | 'acceptChangesStatusSaga'
  | 'executorResultSaga'
  | 'skillsSaga'
  | 'githubAuthSaga'
  | 'githubReposSaga'
  | 'githubRepoSearchSaga'
  | 'clonePreflightSaga'
  | 'linearAuthSaga'
  | 'sentryAuthSaga'
  | 'setupScriptsSaga'
  | 'mcpSettingsSaga'
  | 'commentsSaga'
  | 'taskAgentAssociationsSaga'
  | 'workspaceInitializerSaga'

  | 'sidebarNavSaga'
  | 'scriptsSaga'
  | 'agentFollowSaga'
  | 'gitStatusSaga'
  | 'agentOverviewSaga'
  | 'agentLockSaga'
  | 'panelLayoutSaga'
  | 'unreadTrackingSaga'
  | 'prStatusSaga'
  | 'bgExecutorSaga'
  | 'chatChangesSaga'
  | 'chatStateSaga'
  | 'chatStreamSaga'
  | 'fileExplorerSaga'
  | 'filesSaga'
  | 'agentQueueSaga'
  | 'agentIpcSaga'
  | 'agentChatEffectsSaga'
  | 'agentStreamSaga'
  | 'agentSubscriptionUISaga'
  | 'agentAvailabilitySaga'
  | 'sessionStatsSaga'
  | 'sagaCrashSentrySaga';

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
  /** Error message string (serializable) */
  error: string;
};

/**
 * Async action object returned by a StoreAsyncActionCreator.
 *
 * NOTE: The `promise` field intentionally holds a non-serializable Promise.
 * This is an architectural pattern — the promise is used by sagas and middleware
 * to coordinate async flows and is never persisted to Redux state. Serialization
 * checks should allowlist StoreAsyncAction's `promise` field.
 */
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

// ============================================================================
// Middleware Types
// ============================================================================

export type MiddlewareFunction = (
  action: GenericAction,
  api: { dispatch: ReduxStore["dispatch"]; getState: ReduxStore["getState"] }
) => GenericAction | Promise<GenericAction> | void;

// ============================================================================
// Store Types
// ============================================================================

export type StoreState = ToolkitStoreState<typeof configuredStore>;

export type PreloadedStoreState = ToolkitPreloadedStoreState<StoreState>;

export type ReduxStore = Store<StoreState, UnknownAction>;

export type ReduxStoreContext = {
  store: ReduxStore;
  storeState: Readable<StoreState>;
  dispose: () => void;
};
