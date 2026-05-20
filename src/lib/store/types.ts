import type { Store } from 'svelte-redux-toolkit/store';
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
// Store Types
// ============================================================================

export type StoreState = ToolkitStoreState<typeof configuredStore>;

export type PreloadedStoreState = ToolkitPreloadedStoreState<StoreState>;

export type ReduxStoreContext = {
  store: Store<any, any, any>;
  dispose: () => void;
};
