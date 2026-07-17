import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { REDUX_DEBUG_LS_KEY } from "./constants";

const mocks = vi.hoisted(() => {
  const createPassthroughMiddleware = () => {
    return vi.fn(() => (next: (action: unknown) => unknown) => (action: unknown) => next(action));
  };

  const batchingMiddleware = createPassthroughMiddleware();
  const sentryMiddleware = createPassthroughMiddleware();
  const gitReadMiddleware = createPassthroughMiddleware();
  const agentReadMiddleware = createPassthroughMiddleware();
  const agentSubscriptionReadMiddleware = createPassthroughMiddleware();
  const filesReadMiddleware = createPassthroughMiddleware();
  const chatReadMiddleware = createPassthroughMiddleware();
  const chatSendMiddleware = createPassthroughMiddleware();
  const permissionResponseMiddleware = createPassthroughMiddleware();
  const daemonEventsBridgeMiddleware = createPassthroughMiddleware();
  const settingsHydrationMiddleware = createPassthroughMiddleware();
  const modelSelectionPersistenceMiddleware = createPassthroughMiddleware();
  const providerSettingsPersistenceMiddleware = createPassthroughMiddleware();
  const modelReloadMiddleware = createPassthroughMiddleware();
  const providerAvailabilityCheckMiddleware = createPassthroughMiddleware();
  const agentStreamMiddleware = createPassthroughMiddleware();
  const agentCreationMiddleware = createPassthroughMiddleware();
  const agentMutationMiddleware = createPassthroughMiddleware();
  const contextMutationMiddleware = createPassthroughMiddleware();
  const taskAgentAssociationsMutationMiddleware = createPassthroughMiddleware();
  const appLayoutNavigationMiddleware = createPassthroughMiddleware();
  const workspaceNavigationTabMiddleware = createPassthroughMiddleware();
  const workspaceNavigationLayoutMiddleware = createPassthroughMiddleware();
  const fileExplorerReadMiddleware = createPassthroughMiddleware();
  const filesWriteMiddleware = createPassthroughMiddleware();
  const notesWriteMiddleware = createPassthroughMiddleware();
  const notesVersionsMiddleware = createPassthroughMiddleware();
  const notesReadMiddleware = createPassthroughMiddleware();
  const githubAuthMiddleware = createPassthroughMiddleware();
  const sentryAuthMiddleware = createPassthroughMiddleware();
  const linearAuthMiddleware = createPassthroughMiddleware();
  const mcpManagementMiddleware = createPassthroughMiddleware();
  const workspaceOperationsMiddleware = createPassthroughMiddleware();
  const directoryPickerReadMiddleware = createPassthroughMiddleware();
  const lifecycleReadMiddleware = createPassthroughMiddleware();
  const lifecycleIpcReadMiddleware = createPassthroughMiddleware();
  const uiLayoutPersistenceMiddleware = createPassthroughMiddleware();
  const unreadTrackingPersistenceMiddleware = createPassthroughMiddleware();
  const tabStatePersistenceMiddleware = createPassthroughMiddleware();
  const panelLayoutPersistenceMiddleware = createPassthroughMiddleware();
  const fileContentPruneService = createPassthroughMiddleware();
  const terminalPersistenceMiddleware = createPassthroughMiddleware();
  const externalEditorsPersistenceMiddleware = createPassthroughMiddleware();
  const zoomSyncMiddleware = createPassthroughMiddleware();
  const workspaceSettingsPersistenceMiddleware = createPassthroughMiddleware();
  const userPreferencesBetaPersistenceMiddleware = createPassthroughMiddleware();
  const userPreferencesNotificationPersistenceMiddleware = createPassthroughMiddleware();
  const sidebarNavPersistenceMiddleware = createPassthroughMiddleware();
  const browserPersistenceMiddleware = createPassthroughMiddleware();
  const userPreferencesPersistenceMiddleware = createPassthroughMiddleware();
  const themeMutationMiddleware = createPassthroughMiddleware();
  const autoUpdateMutationMiddleware = createPassthroughMiddleware();
  const specialistsMutationMiddleware = createPassthroughMiddleware();
  const loggerMiddleware = createPassthroughMiddleware();
  const refCheckMiddleware = createPassthroughMiddleware();
  const structuredCloneMiddleware = createPassthroughMiddleware();
  const storeGuardMiddleware = createPassthroughMiddleware();

  return {
    createBatchingMiddleware: vi.fn(() => batchingMiddleware),
    createSentryBreadcrumbsMiddleware: vi.fn(() => sentryMiddleware),
    createGitReadMiddleware: vi.fn(() => gitReadMiddleware),
    createAgentReadMiddleware: vi.fn(() => agentReadMiddleware),
    createAgentSubscriptionReadMiddleware: vi.fn(() => agentSubscriptionReadMiddleware),
    createFilesReadMiddleware: vi.fn(() => filesReadMiddleware),
    createChatReadMiddleware: vi.fn(() => chatReadMiddleware),
    createChatSendMiddleware: vi.fn(() => chatSendMiddleware),
    createPermissionResponseMiddleware: vi.fn(() => permissionResponseMiddleware),
    createDaemonEventsBridgeMiddleware: vi.fn(() => daemonEventsBridgeMiddleware),
    createSettingsHydrationMiddleware: vi.fn(() => settingsHydrationMiddleware),
    createModelSelectionPersistenceMiddleware: vi.fn(() => modelSelectionPersistenceMiddleware),
    createProviderSettingsPersistenceMiddleware: vi.fn(() => providerSettingsPersistenceMiddleware),
    createModelReloadMiddleware: vi.fn(() => modelReloadMiddleware),
    createProviderAvailabilityCheckMiddleware: vi.fn(() => providerAvailabilityCheckMiddleware),
    createAgentStreamMiddleware: vi.fn(() => agentStreamMiddleware),
    createAgentCreationMiddleware: vi.fn(() => agentCreationMiddleware),
    createAgentMutationMiddleware: vi.fn(() => agentMutationMiddleware),
    createContextMutationMiddleware: vi.fn(() => contextMutationMiddleware),
    createTaskAgentAssociationsMutationMiddleware: vi.fn(
      () => taskAgentAssociationsMutationMiddleware,
    ),
    createAppLayoutNavigationMiddleware: vi.fn(() => appLayoutNavigationMiddleware),
    createWorkspaceNavigationTabMiddleware: vi.fn(() => workspaceNavigationTabMiddleware),
    createWorkspaceNavigationLayoutMiddleware: vi.fn(() => workspaceNavigationLayoutMiddleware),
    createFileExplorerReadMiddleware: vi.fn(() => fileExplorerReadMiddleware),
    createFilesWriteMiddleware: vi.fn(() => filesWriteMiddleware),
    createNotesWriteMiddleware: vi.fn(() => notesWriteMiddleware),
    createNotesVersionsMiddleware: vi.fn(() => notesVersionsMiddleware),
    createNotesReadMiddleware: vi.fn(() => notesReadMiddleware),
    createGitHubAuthMiddleware: vi.fn(() => githubAuthMiddleware),
    createSentryAuthMiddleware: vi.fn(() => sentryAuthMiddleware),
    createLinearAuthMiddleware: vi.fn(() => linearAuthMiddleware),
    createMcpManagementMiddleware: vi.fn(() => mcpManagementMiddleware),
    createWorkspaceOperationsMiddleware: vi.fn(() => workspaceOperationsMiddleware),
    createDirectoryPickerReadMiddleware: vi.fn(() => directoryPickerReadMiddleware),
    createLifecycleReadMiddleware: vi.fn(() => lifecycleReadMiddleware),
    createLifecycleIpcReadMiddleware: vi.fn(() => lifecycleIpcReadMiddleware),
    createUiLayoutPersistenceMiddleware: vi.fn(() => uiLayoutPersistenceMiddleware),
    createUnreadTrackingPersistenceMiddleware: vi.fn(() => unreadTrackingPersistenceMiddleware),
    createTabStatePersistenceMiddleware: vi.fn(() => tabStatePersistenceMiddleware),
    createPanelLayoutPersistenceMiddleware: vi.fn(() => panelLayoutPersistenceMiddleware),
    createFileContentPruneService: vi.fn(() => fileContentPruneService),
    createTerminalPersistenceMiddleware: vi.fn(() => terminalPersistenceMiddleware),
    createExternalEditorsPersistenceMiddleware: vi.fn(() => externalEditorsPersistenceMiddleware),
    createZoomSyncMiddleware: vi.fn(() => zoomSyncMiddleware),
    createWorkspaceSettingsPersistenceMiddleware: vi.fn(
      () => workspaceSettingsPersistenceMiddleware,
    ),
    createUserPreferencesBetaPersistenceMiddleware: vi.fn(
      () => userPreferencesBetaPersistenceMiddleware,
    ),
    createUserPreferencesNotificationPersistenceMiddleware: vi.fn(
      () => userPreferencesNotificationPersistenceMiddleware,
    ),
    createSidebarNavPersistenceMiddleware: vi.fn(() => sidebarNavPersistenceMiddleware),
    createBrowserPersistenceMiddleware: vi.fn(() => browserPersistenceMiddleware),
    createUserPreferencesPersistenceMiddleware: vi.fn(() => userPreferencesPersistenceMiddleware),
    createThemeMutationMiddleware: vi.fn(() => themeMutationMiddleware),
    createAutoUpdateMutationMiddleware: vi.fn(() => autoUpdateMutationMiddleware),
    createSpecialistsMutationMiddleware: vi.fn(() => specialistsMutationMiddleware),
    createLoggerMiddleware: vi.fn(() => loggerMiddleware),
    createReferenceChangeDetectorMiddleware: vi.fn(() => refCheckMiddleware),
    createStructuredCloneCheckerMiddleware: vi.fn(() => structuredCloneMiddleware),
    createStoreGuardMiddleware: vi.fn(() => storeGuardMiddleware),
    batchingMiddleware,
    sentryMiddleware,
    gitReadMiddleware,
    agentReadMiddleware,
    agentSubscriptionReadMiddleware,
    filesReadMiddleware,
    chatReadMiddleware,
    chatSendMiddleware,
    permissionResponseMiddleware,
    daemonEventsBridgeMiddleware,
    settingsHydrationMiddleware,
    modelSelectionPersistenceMiddleware,
    providerSettingsPersistenceMiddleware,
    modelReloadMiddleware,
    providerAvailabilityCheckMiddleware,
    agentStreamMiddleware,
    agentCreationMiddleware,
    agentMutationMiddleware,
    contextMutationMiddleware,
    taskAgentAssociationsMutationMiddleware,
    appLayoutNavigationMiddleware,
    workspaceNavigationTabMiddleware,
    workspaceNavigationLayoutMiddleware,
    fileExplorerReadMiddleware,
    filesWriteMiddleware,
    notesWriteMiddleware,
    notesVersionsMiddleware,
    notesReadMiddleware,
    githubAuthMiddleware,
    sentryAuthMiddleware,
    linearAuthMiddleware,
    mcpManagementMiddleware,
    workspaceOperationsMiddleware,
    directoryPickerReadMiddleware,
    lifecycleReadMiddleware,
    lifecycleIpcReadMiddleware,
    uiLayoutPersistenceMiddleware,
    unreadTrackingPersistenceMiddleware,
    tabStatePersistenceMiddleware,
    panelLayoutPersistenceMiddleware,
    fileContentPruneService,
    terminalPersistenceMiddleware,
    externalEditorsPersistenceMiddleware,
    zoomSyncMiddleware,
    workspaceSettingsPersistenceMiddleware,
    userPreferencesBetaPersistenceMiddleware,
    userPreferencesNotificationPersistenceMiddleware,
    sidebarNavPersistenceMiddleware,
    browserPersistenceMiddleware,
    userPreferencesPersistenceMiddleware,
    themeMutationMiddleware,
    autoUpdateMutationMiddleware,
    specialistsMutationMiddleware,
    loggerMiddleware,
    structuredCloneMiddleware,
    storeGuardMiddleware,
  };
});

vi.mock("$features/git/git-read-service", () => ({ createGitReadMiddleware: mocks.createGitReadMiddleware }));
vi.mock("$features/agent/agent-read-service", () => ({ createAgentReadMiddleware: mocks.createAgentReadMiddleware }));
vi.mock("$features/agent/agent-subscription-read-service", () => ({
  createAgentSubscriptionReadMiddleware: mocks.createAgentSubscriptionReadMiddleware,
}));
vi.mock("$features/files/files-read-service", () => ({ createFilesReadMiddleware: mocks.createFilesReadMiddleware }));
vi.mock("$features/agent/chat-read-service", () => ({ createChatReadMiddleware: mocks.createChatReadMiddleware }));
vi.mock("$features/agent/chat-send-service", () => ({ createChatSendMiddleware: mocks.createChatSendMiddleware }));
vi.mock("$features/permission/permission-response-service", () => ({
  createPermissionResponseMiddleware: mocks.createPermissionResponseMiddleware,
}));
vi.mock("$features/events/daemon-events-bridge", () => ({
  createDaemonEventsBridgeMiddleware: mocks.createDaemonEventsBridgeMiddleware,
}));
vi.mock("$features/settings/settings-hydration-service", () => ({
  createSettingsHydrationMiddleware: mocks.createSettingsHydrationMiddleware,
}));
vi.mock("$features/settings/model-selection-persistence-service", () => ({
  createModelSelectionPersistenceMiddleware: mocks.createModelSelectionPersistenceMiddleware,
}));
vi.mock("$features/settings/provider-settings-persistence-service", () => ({
  createProviderSettingsPersistenceMiddleware: mocks.createProviderSettingsPersistenceMiddleware,
}));
vi.mock("$features/settings/model-reload-service", () => ({
  createModelReloadMiddleware: mocks.createModelReloadMiddleware,
}));
vi.mock("$features/providers/provider-availability-check-service", () => ({
  createProviderAvailabilityCheckMiddleware: mocks.createProviderAvailabilityCheckMiddleware,
}));
vi.mock("$features/agent/agent-stream-service", () => ({
  createAgentStreamMiddleware: mocks.createAgentStreamMiddleware,
}));
vi.mock("$features/agent/agent-creation-service", () => ({
  createAgentCreationMiddleware: mocks.createAgentCreationMiddleware,
}));
vi.mock("$features/agent/agent-mutation-service", () => ({
  createAgentMutationMiddleware: mocks.createAgentMutationMiddleware,
}));
vi.mock("$features/context/context-mutation-service", () => ({
  createContextMutationMiddleware: mocks.createContextMutationMiddleware,
}));
vi.mock("$features/tasks/task-agent-associations-mutation-service", () => ({
  createTaskAgentAssociationsMutationMiddleware:
    mocks.createTaskAgentAssociationsMutationMiddleware,
}));
vi.mock("$features/layout/app-layout-navigation-service", () => ({
  createAppLayoutNavigationMiddleware: mocks.createAppLayoutNavigationMiddleware,
}));
vi.mock("$features/layout/workspace-navigation-tab-service", () => ({
  createWorkspaceNavigationTabMiddleware: mocks.createWorkspaceNavigationTabMiddleware,
}));
vi.mock("$features/layout/workspace-navigation-layout-service", () => ({
  createWorkspaceNavigationLayoutMiddleware: mocks.createWorkspaceNavigationLayoutMiddleware,
}));
vi.mock("$features/file-explorer/file-explorer-read-service", () => ({
  createFileExplorerReadMiddleware: mocks.createFileExplorerReadMiddleware,
}));
vi.mock("$features/files/files-write-service", () => ({
  createFilesWriteMiddleware: mocks.createFilesWriteMiddleware,
}));
vi.mock("$features/notes/notes-write-service", () => ({
  createNotesWriteMiddleware: mocks.createNotesWriteMiddleware,
}));
vi.mock("$features/notes/notes-versions-service", () => ({
  createNotesVersionsMiddleware: mocks.createNotesVersionsMiddleware,
}));
vi.mock("$features/notes/notes-read-service", () => ({
  createNotesReadMiddleware: mocks.createNotesReadMiddleware,
  applyNoteFromEvent: vi.fn(),
}));
vi.mock("$features/github-auth/github-auth-store-service", () => ({
  createGitHubAuthMiddleware: mocks.createGitHubAuthMiddleware,
}));
vi.mock("$features/sentry-auth/sentry-auth-store-service", () => ({
  createSentryAuthMiddleware: mocks.createSentryAuthMiddleware,
}));
vi.mock("$features/linear-auth/linear-auth-store-service", () => ({
  createLinearAuthMiddleware: mocks.createLinearAuthMiddleware,
}));
vi.mock("$features/mcp/mcp-management-service", () => ({
  createMcpManagementMiddleware: mocks.createMcpManagementMiddleware,
}));
vi.mock("$features/workspace/workspace-operations-service", () => ({
  createWorkspaceOperationsMiddleware: mocks.createWorkspaceOperationsMiddleware,
}));
vi.mock("$features/onboarding/directory-picker-read-service", () => ({
  createDirectoryPickerReadMiddleware: mocks.createDirectoryPickerReadMiddleware,
}));
vi.mock("./middlewares/lifecycle-read-service", () => ({
  createLifecycleReadMiddleware: mocks.createLifecycleReadMiddleware,
}));
vi.mock("./middlewares/lifecycle-ipc-read-service", () => ({
  createLifecycleIpcReadMiddleware: mocks.createLifecycleIpcReadMiddleware,
}));
vi.mock("./middlewares/ui-layout-persistence-service", () => ({
  createUiLayoutPersistenceMiddleware: mocks.createUiLayoutPersistenceMiddleware,
}));
vi.mock("./middlewares/unread-tracking-persistence-service", () => ({
  createUnreadTrackingPersistenceMiddleware: mocks.createUnreadTrackingPersistenceMiddleware,
}));
vi.mock("./middlewares/tab-state-persistence-service", () => ({
  createTabStatePersistenceMiddleware: mocks.createTabStatePersistenceMiddleware,
}));
vi.mock("./middlewares/panel-layout-persistence-service", () => ({
  createPanelLayoutPersistenceMiddleware: mocks.createPanelLayoutPersistenceMiddleware,
}));
vi.mock("./middlewares/file-content-prune-service", () => ({
  createFileContentPruneService: mocks.createFileContentPruneService,
}));
vi.mock("./middlewares/terminal-persistence-service", () => ({
  createTerminalPersistenceMiddleware: mocks.createTerminalPersistenceMiddleware,
}));
vi.mock("./middlewares/external-editors-persistence-service", () => ({
  createExternalEditorsPersistenceMiddleware: mocks.createExternalEditorsPersistenceMiddleware,
}));
vi.mock("./middlewares/zoom-sync-service", () => ({
  createZoomSyncMiddleware: mocks.createZoomSyncMiddleware,
}));
vi.mock("./middlewares/workspace-settings-persistence-service", () => ({
  createWorkspaceSettingsPersistenceMiddleware: mocks.createWorkspaceSettingsPersistenceMiddleware,
}));
vi.mock("./middlewares/user-preferences-beta-persistence-service", () => ({
  createUserPreferencesBetaPersistenceMiddleware:
    mocks.createUserPreferencesBetaPersistenceMiddleware,
}));
vi.mock("./middlewares/user-preferences-notification-persistence-service", () => ({
  createUserPreferencesNotificationPersistenceMiddleware:
    mocks.createUserPreferencesNotificationPersistenceMiddleware,
}));
vi.mock("./middlewares/sidebar-nav-persistence-service", () => ({
  createSidebarNavPersistenceMiddleware: mocks.createSidebarNavPersistenceMiddleware,
}));
vi.mock("./middlewares/browser-persistence-service", () => ({
  createBrowserPersistenceMiddleware: mocks.createBrowserPersistenceMiddleware,
}));
vi.mock("./middlewares/user-preferences-persistence-service", () => ({
  createUserPreferencesPersistenceMiddleware: mocks.createUserPreferencesPersistenceMiddleware,
}));
vi.mock("$features/theme/theme-service", () => ({
  createThemeMutationMiddleware: mocks.createThemeMutationMiddleware,
}));
vi.mock("$features/auto-update/auto-update-mutation-service", () => ({
  createAutoUpdateMutationMiddleware: mocks.createAutoUpdateMutationMiddleware,
}));
vi.mock("$features/specialists/specialists-mutation-service", () => ({
  createSpecialistsMutationMiddleware: mocks.createSpecialistsMutationMiddleware,
}));
vi.mock("./middlewares/batch", () => ({ createBatchingMiddleware: mocks.createBatchingMiddleware }));
vi.mock("./middlewares/logger", () => ({ createLoggerMiddleware: mocks.createLoggerMiddleware }));
vi.mock("./middlewares/sentry-breadcrumbs", () => ({
  createSentryBreadcrumbsMiddleware: mocks.createSentryBreadcrumbsMiddleware,
}));
vi.mock("./middlewares/state-reference-checks", () => ({
  createReferenceChangeDetectorMiddleware: mocks.createReferenceChangeDetectorMiddleware,
}));
vi.mock("./middlewares/structured-clone-checker", () => ({
  createStructuredCloneCheckerMiddleware: mocks.createStructuredCloneCheckerMiddleware,
}));
vi.mock("../../store/utils/store-guard-middleware", () => ({
  createStoreGuardMiddleware: mocks.createStoreGuardMiddleware,
}));

const localStorageGetItem = window.localStorage.getItem as unknown as Mock;
const localStorageSetItem = window.localStorage.setItem as unknown as Mock;
const localStorageRemoveItem = window.localStorage.removeItem as unknown as Mock;

const setLocalStorageEntries = (entries: Record<string, string | null | undefined>) => {
  localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
};

async function initStoreForReduxLoggingTests() {
  const { initAppStore } = await import("./store");
  const readableState = {
    subscribe: (run: (state: Record<string, never>) => void) => {
      run({});
      return () => {};
    },
  };
  return initAppStore({
    init: vi.fn(() => vi.fn()),
    getReadableState: vi.fn(() => readableState),
    dispatch: vi.fn((action: unknown) => action),
    state: {},
  } as any);
}

describe("store middleware Redux logging gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DEV", false);
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intentFlags?: unknown }).intentFlags;
  });

  it("adds the logger middleware automatically in the Vitest dev environment", async () => {
    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sentryMiddleware,
      mocks.gitReadMiddleware,
      mocks.agentReadMiddleware,
      mocks.agentSubscriptionReadMiddleware,
      mocks.filesReadMiddleware,
      mocks.chatReadMiddleware,
      mocks.chatSendMiddleware,
      mocks.permissionResponseMiddleware,
      mocks.daemonEventsBridgeMiddleware,
      mocks.settingsHydrationMiddleware,
      mocks.modelSelectionPersistenceMiddleware,
      mocks.providerSettingsPersistenceMiddleware,
      mocks.modelReloadMiddleware,
      mocks.providerAvailabilityCheckMiddleware,
      mocks.agentStreamMiddleware,
      mocks.agentCreationMiddleware,
      mocks.agentMutationMiddleware,
      mocks.contextMutationMiddleware,
      mocks.taskAgentAssociationsMutationMiddleware,
      mocks.appLayoutNavigationMiddleware,
      mocks.workspaceNavigationTabMiddleware,
      mocks.workspaceNavigationLayoutMiddleware,
      mocks.fileExplorerReadMiddleware,
      mocks.filesWriteMiddleware,
      mocks.notesWriteMiddleware,
      mocks.notesVersionsMiddleware,
      mocks.notesReadMiddleware,
      mocks.githubAuthMiddleware,
      mocks.sentryAuthMiddleware,
      mocks.linearAuthMiddleware,
      mocks.mcpManagementMiddleware,
      mocks.workspaceOperationsMiddleware,
      mocks.lifecycleReadMiddleware,
      mocks.lifecycleIpcReadMiddleware,
      mocks.directoryPickerReadMiddleware,
      mocks.uiLayoutPersistenceMiddleware,
      mocks.unreadTrackingPersistenceMiddleware,
      mocks.tabStatePersistenceMiddleware,
      mocks.sidebarNavPersistenceMiddleware,
      mocks.browserPersistenceMiddleware,
      mocks.panelLayoutPersistenceMiddleware,
      mocks.fileContentPruneService,
      mocks.terminalPersistenceMiddleware,
      mocks.externalEditorsPersistenceMiddleware,
      mocks.zoomSyncMiddleware,
      mocks.workspaceSettingsPersistenceMiddleware,
      mocks.userPreferencesBetaPersistenceMiddleware,
      mocks.userPreferencesNotificationPersistenceMiddleware,
      mocks.userPreferencesPersistenceMiddleware,
      mocks.themeMutationMiddleware,
      mocks.autoUpdateMutationMiddleware,
      mocks.specialistsMutationMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("adds the logger middleware when intent:redux-debug is enabled in localStorage", async () => {
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: "true" });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sentryMiddleware,
      mocks.gitReadMiddleware,
      mocks.agentReadMiddleware,
      mocks.agentSubscriptionReadMiddleware,
      mocks.filesReadMiddleware,
      mocks.chatReadMiddleware,
      mocks.chatSendMiddleware,
      mocks.permissionResponseMiddleware,
      mocks.daemonEventsBridgeMiddleware,
      mocks.settingsHydrationMiddleware,
      mocks.modelSelectionPersistenceMiddleware,
      mocks.providerSettingsPersistenceMiddleware,
      mocks.modelReloadMiddleware,
      mocks.providerAvailabilityCheckMiddleware,
      mocks.agentStreamMiddleware,
      mocks.agentCreationMiddleware,
      mocks.agentMutationMiddleware,
      mocks.contextMutationMiddleware,
      mocks.taskAgentAssociationsMutationMiddleware,
      mocks.appLayoutNavigationMiddleware,
      mocks.workspaceNavigationTabMiddleware,
      mocks.workspaceNavigationLayoutMiddleware,
      mocks.fileExplorerReadMiddleware,
      mocks.filesWriteMiddleware,
      mocks.notesWriteMiddleware,
      mocks.notesVersionsMiddleware,
      mocks.notesReadMiddleware,
      mocks.githubAuthMiddleware,
      mocks.sentryAuthMiddleware,
      mocks.linearAuthMiddleware,
      mocks.mcpManagementMiddleware,
      mocks.workspaceOperationsMiddleware,
      mocks.lifecycleReadMiddleware,
      mocks.lifecycleIpcReadMiddleware,
      mocks.directoryPickerReadMiddleware,
      mocks.uiLayoutPersistenceMiddleware,
      mocks.unreadTrackingPersistenceMiddleware,
      mocks.tabStatePersistenceMiddleware,
      mocks.sidebarNavPersistenceMiddleware,
      mocks.browserPersistenceMiddleware,
      mocks.panelLayoutPersistenceMiddleware,
      mocks.fileContentPruneService,
      mocks.terminalPersistenceMiddleware,
      mocks.externalEditorsPersistenceMiddleware,
      mocks.zoomSyncMiddleware,
      mocks.workspaceSettingsPersistenceMiddleware,
      mocks.userPreferencesBetaPersistenceMiddleware,
      mocks.userPreferencesNotificationPersistenceMiddleware,
      mocks.userPreferencesPersistenceMiddleware,
      mocks.themeMutationMiddleware,
      mocks.autoUpdateMutationMiddleware,
      mocks.specialistsMutationMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("adds the logger middleware automatically in dev mode when no explicit override is set", async () => {
    vi.stubEnv("DEV", true);

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sentryMiddleware,
      mocks.gitReadMiddleware,
      mocks.agentReadMiddleware,
      mocks.agentSubscriptionReadMiddleware,
      mocks.filesReadMiddleware,
      mocks.chatReadMiddleware,
      mocks.chatSendMiddleware,
      mocks.permissionResponseMiddleware,
      mocks.daemonEventsBridgeMiddleware,
      mocks.settingsHydrationMiddleware,
      mocks.modelSelectionPersistenceMiddleware,
      mocks.providerSettingsPersistenceMiddleware,
      mocks.modelReloadMiddleware,
      mocks.providerAvailabilityCheckMiddleware,
      mocks.agentStreamMiddleware,
      mocks.agentCreationMiddleware,
      mocks.agentMutationMiddleware,
      mocks.contextMutationMiddleware,
      mocks.taskAgentAssociationsMutationMiddleware,
      mocks.appLayoutNavigationMiddleware,
      mocks.workspaceNavigationTabMiddleware,
      mocks.workspaceNavigationLayoutMiddleware,
      mocks.fileExplorerReadMiddleware,
      mocks.filesWriteMiddleware,
      mocks.notesWriteMiddleware,
      mocks.notesVersionsMiddleware,
      mocks.notesReadMiddleware,
      mocks.githubAuthMiddleware,
      mocks.sentryAuthMiddleware,
      mocks.linearAuthMiddleware,
      mocks.mcpManagementMiddleware,
      mocks.workspaceOperationsMiddleware,
      mocks.lifecycleReadMiddleware,
      mocks.lifecycleIpcReadMiddleware,
      mocks.directoryPickerReadMiddleware,
      mocks.uiLayoutPersistenceMiddleware,
      mocks.unreadTrackingPersistenceMiddleware,
      mocks.tabStatePersistenceMiddleware,
      mocks.sidebarNavPersistenceMiddleware,
      mocks.browserPersistenceMiddleware,
      mocks.panelLayoutPersistenceMiddleware,
      mocks.fileContentPruneService,
      mocks.terminalPersistenceMiddleware,
      mocks.externalEditorsPersistenceMiddleware,
      mocks.zoomSyncMiddleware,
      mocks.workspaceSettingsPersistenceMiddleware,
      mocks.userPreferencesBetaPersistenceMiddleware,
      mocks.userPreferencesNotificationPersistenceMiddleware,
      mocks.userPreferencesPersistenceMiddleware,
      mocks.themeMutationMiddleware,
      mocks.autoUpdateMutationMiddleware,
      mocks.specialistsMutationMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("keeps an explicit localStorage disable higher priority than dev mode", async () => {
    vi.stubEnv("DEV", true);
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: "false" });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sentryMiddleware,
      mocks.gitReadMiddleware,
      mocks.agentReadMiddleware,
      mocks.agentSubscriptionReadMiddleware,
      mocks.filesReadMiddleware,
      mocks.chatReadMiddleware,
      mocks.chatSendMiddleware,
      mocks.permissionResponseMiddleware,
      mocks.daemonEventsBridgeMiddleware,
      mocks.settingsHydrationMiddleware,
      mocks.modelSelectionPersistenceMiddleware,
      mocks.providerSettingsPersistenceMiddleware,
      mocks.modelReloadMiddleware,
      mocks.providerAvailabilityCheckMiddleware,
      mocks.agentStreamMiddleware,
      mocks.agentCreationMiddleware,
      mocks.agentMutationMiddleware,
      mocks.contextMutationMiddleware,
      mocks.taskAgentAssociationsMutationMiddleware,
      mocks.appLayoutNavigationMiddleware,
      mocks.workspaceNavigationTabMiddleware,
      mocks.workspaceNavigationLayoutMiddleware,
      mocks.fileExplorerReadMiddleware,
      mocks.filesWriteMiddleware,
      mocks.notesWriteMiddleware,
      mocks.notesVersionsMiddleware,
      mocks.notesReadMiddleware,
      mocks.githubAuthMiddleware,
      mocks.sentryAuthMiddleware,
      mocks.linearAuthMiddleware,
      mocks.mcpManagementMiddleware,
      mocks.workspaceOperationsMiddleware,
      mocks.lifecycleReadMiddleware,
      mocks.lifecycleIpcReadMiddleware,
      mocks.directoryPickerReadMiddleware,
      mocks.uiLayoutPersistenceMiddleware,
      mocks.unreadTrackingPersistenceMiddleware,
      mocks.tabStatePersistenceMiddleware,
      mocks.sidebarNavPersistenceMiddleware,
      mocks.browserPersistenceMiddleware,
      mocks.panelLayoutPersistenceMiddleware,
      mocks.fileContentPruneService,
      mocks.terminalPersistenceMiddleware,
      mocks.externalEditorsPersistenceMiddleware,
      mocks.zoomSyncMiddleware,
      mocks.workspaceSettingsPersistenceMiddleware,
      mocks.userPreferencesBetaPersistenceMiddleware,
      mocks.userPreferencesNotificationPersistenceMiddleware,
      mocks.userPreferencesPersistenceMiddleware,
      mocks.themeMutationMiddleware,
      mocks.autoUpdateMutationMiddleware,
      mocks.specialistsMutationMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });

  it("passes the intent flag webview name through to the logger middleware when globally enabled", async () => {
    (window as Window & { intentFlags?: { enableReduxLogger: boolean; webviewName: string } }).intentFlags = {
      enableReduxLogger: true,
      webviewName: "composer",
    };

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("composer");
    expect(middleware.at(-1)).toBe(mocks.loggerMiddleware);
  });

  it("does not crash store middleware initialization when reading the Redux logging flag throws", async () => {
    vi.stubEnv("DEV", true);
    localStorageGetItem.mockImplementation((key: string) => {
      if (key === REDUX_DEBUG_LS_KEY) {
        throw new Error("Storage unavailable");
      }

      return null;
    });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sentryMiddleware,
      mocks.gitReadMiddleware,
      mocks.agentReadMiddleware,
      mocks.agentSubscriptionReadMiddleware,
      mocks.filesReadMiddleware,
      mocks.chatReadMiddleware,
      mocks.chatSendMiddleware,
      mocks.permissionResponseMiddleware,
      mocks.daemonEventsBridgeMiddleware,
      mocks.settingsHydrationMiddleware,
      mocks.modelSelectionPersistenceMiddleware,
      mocks.providerSettingsPersistenceMiddleware,
      mocks.modelReloadMiddleware,
      mocks.providerAvailabilityCheckMiddleware,
      mocks.agentStreamMiddleware,
      mocks.agentCreationMiddleware,
      mocks.agentMutationMiddleware,
      mocks.contextMutationMiddleware,
      mocks.taskAgentAssociationsMutationMiddleware,
      mocks.appLayoutNavigationMiddleware,
      mocks.workspaceNavigationTabMiddleware,
      mocks.workspaceNavigationLayoutMiddleware,
      mocks.fileExplorerReadMiddleware,
      mocks.filesWriteMiddleware,
      mocks.notesWriteMiddleware,
      mocks.notesVersionsMiddleware,
      mocks.notesReadMiddleware,
      mocks.githubAuthMiddleware,
      mocks.sentryAuthMiddleware,
      mocks.linearAuthMiddleware,
      mocks.mcpManagementMiddleware,
      mocks.workspaceOperationsMiddleware,
      mocks.lifecycleReadMiddleware,
      mocks.lifecycleIpcReadMiddleware,
      mocks.directoryPickerReadMiddleware,
      mocks.uiLayoutPersistenceMiddleware,
      mocks.unreadTrackingPersistenceMiddleware,
      mocks.tabStatePersistenceMiddleware,
      mocks.sidebarNavPersistenceMiddleware,
      mocks.browserPersistenceMiddleware,
      mocks.panelLayoutPersistenceMiddleware,
      mocks.fileContentPruneService,
      mocks.terminalPersistenceMiddleware,
      mocks.externalEditorsPersistenceMiddleware,
      mocks.zoomSyncMiddleware,
      mocks.workspaceSettingsPersistenceMiddleware,
      mocks.userPreferencesBetaPersistenceMiddleware,
      mocks.userPreferencesNotificationPersistenceMiddleware,
      mocks.userPreferencesPersistenceMiddleware,
      mocks.themeMutationMiddleware,
      mocks.autoUpdateMutationMiddleware,
      mocks.specialistsMutationMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });
});

describe("window.intent Redux logging interface", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intent?: unknown }).intent;
  });

  it("registers enableReduxLogging and disableReduxLogging on window.intent", async () => {
    const storeContext = await initStoreForReduxLoggingTests();

    expect(window.intent?.enableReduxLogging).toBeTypeOf("function");
    expect(window.intent?.disableReduxLogging).toBeTypeOf("function");

    storeContext.dispose();
  });

  it("persists Redux logging toggles and logs that reload is required", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const storeContext = await initStoreForReduxLoggingTests();

      window.intent?.enableReduxLogging?.();
      expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, "true");
      expect(consoleLog).toHaveBeenCalledWith("Redux logging preference updated. Reload to take effect.");

      consoleLog.mockClear();

      window.intent?.disableReduxLogging?.();
      expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, "false");
      expect(consoleLog).toHaveBeenCalledWith("Redux logging preference updated. Reload to take effect.");

      storeContext.dispose();
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("toggles Redux logging using stored boolean string values", async () => {
    const entries: Record<string, string | null> = { [REDUX_DEBUG_LS_KEY]: "false" };
    localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
    localStorageSetItem.mockImplementation((key: string, value: string) => {
      entries[key] = value;
    });
    localStorageRemoveItem.mockImplementation((key: string) => {
      entries[key] = null;
    });

    const storeContext = await initStoreForReduxLoggingTests();

    window.intent?.debug?.toggleReduxLogs?.();
    expect(localStorageSetItem).toHaveBeenLastCalledWith(REDUX_DEBUG_LS_KEY, "true");
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe("true");

    window.intent?.debug?.toggleReduxLogs?.();
    expect(localStorageSetItem).toHaveBeenLastCalledWith(REDUX_DEBUG_LS_KEY, "false");
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe("false");

    storeContext.dispose();
  });
});

type ChangesPayloadForTest = {
  changes: Record<string, { prev: unknown; next: unknown }>;
};

type NoChangesPayloadForTest = {
  state: unknown;
};

function expectGetterDescriptor(object: object, property: string, enumerable = false) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);

  expect(descriptor?.get).toEqual(expect.any(Function));
  expect(descriptor?.value).toBeUndefined();
  expect(descriptor?.enumerable).toBe(enumerable);
}

function expectChangesPayloadClassInstance(payload: ChangesPayloadForTest) {
  const prototype = Object.getPrototypeOf(payload);

  expect(prototype).not.toBe(Object.prototype);
  expect(prototype?.constructor?.name).toBe("ChangesPayload");
  expect(Object.getOwnPropertyDescriptor(payload, "action")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(prototype, "action")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "prevState")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "nextState")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "changes")).toBeUndefined();
  expectGetterDescriptor(prototype, "changes");
}

function expectNoChangesPayloadClassInstance(payload: NoChangesPayloadForTest) {
  const prototype = Object.getPrototypeOf(payload);

  expect(prototype).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(payload, "action")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "prevState")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "nextState")).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, "changes")).toBeUndefined();
  expect(Object.keys(payload)).toEqual(["state"]);
}

describe("createLoggerMiddleware", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("logs the welcome message only once", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    createLoggerMiddleware("composer");
    createLoggerMiddleware("composer");

    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it("logs changed state with raw action and a separate lazy state payload log", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const prevState = {
      count: 1,
      todos: { byId: { "todo-1": { title: "Draft", tags: ["inbox", "soon"] } } },
    };
    const nextState = {
      count: 2,
      todos: {
        byId: {
          "todo-1": { title: "Done", tags: ["inbox", "shipped"] },
          "todo-2": { title: "New", tags: ["later"] },
        },
        order: ["todo-1", "todo-2"],
      },
    };
    let currentState = prevState;
    const action = { type: "TEST_ACTION" };
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => currentState),
    };
    const next = vi.fn((receivedAction: unknown) => {
      currentState = nextState;
      return receivedAction;
    });

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith("%cTEST_ACTION", "color: inherit; font-weight: 600");
    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(group).not.toHaveBeenCalled();
    expect(consoleDir).not.toHaveBeenCalled();

    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const lazyPayload = consoleLog.mock.calls[1]?.[2] as ChangesPayloadForTest;

    expect(consoleLog.mock.calls[0]?.slice(0, 2)).toEqual(["%c action    ", "color: #03A9F4; font-weight: bold"]);
    expect(consoleLog.mock.calls[1]?.slice(0, 2)).toEqual(["%c state    ", "color: #4CAF50; font-weight: bold"]);
    expect(actionPayload).toBe(action);
    expect(lazyPayload).not.toBe(action);
    expect(lazyPayload).not.toBe(prevState);
    expect(lazyPayload).not.toBe(nextState);
    expectChangesPayloadClassInstance(lazyPayload);
    expect(lazyPayload.changes).toEqual({
      count: { prev: 1, next: 2 },
      "todos.byId.todo-1.title": { prev: "Draft", next: "Done" },
      "todos.byId.todo-1.tags[1]": { prev: "soon", next: "shipped" },
      "todos.byId.todo-2": { prev: undefined, next: { title: "New", tags: ["later"] } },
      "todos.order": { prev: undefined, next: ["todo-1", "todo-2"] },
    });

    expect(groupEnd).toHaveBeenCalledTimes(1);
  });

  it("computes changes only when the changes accessor is read", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    let diffReadCount = 0;
    const prevState = { nested: { count: 1 } };
    const nextState = {
      get nested() {
        diffReadCount++;
        return { count: 2 };
      },
    };
    let currentState: unknown = prevState;
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => currentState),
    };
    const next = vi.fn((receivedAction: unknown) => {
      currentState = nextState;
      return receivedAction;
    });

    expect(() => middleware(storeApi as never)(next)({ type: "TEST_ACTION" })).not.toThrow();
    expect(diffReadCount).toBe(0);

    const statePayload = consoleLog.mock.calls[1]?.[2] as ChangesPayloadForTest;

    expectChangesPayloadClassInstance(statePayload);
    expect(diffReadCount).toBe(0);

    const firstChanges = statePayload.changes;

    expect(diffReadCount).toBe(1);
    expect(firstChanges).toEqual({ "nested.count": { prev: 1, next: 2 } });

    const secondChanges = statePayload.changes;

    expect(diffReadCount).toBe(2);
    expect(secondChanges).toEqual(firstChanges);
    expect(secondChanges).not.toBe(firstChanges);
    expectGetterDescriptor(Object.getPrototypeOf(statePayload), "changes");
  });

  it("logs unchanged state without prev state and uses the no changes label", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const state = { count: 1 };
    const action = { type: "TEST_ACTION", payload: "payload text" };
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => state),
    };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith("%cTEST_ACTION payload text", "color: #9E9E9E; font-weight: 300");
    expect(consoleLog.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["%c action    ", "color: #03A9F4; font-weight: bold"],
      ["%c state (no changes)", "color: #9E9E9E; font-weight: lighter"],
    ]);
    expect(group).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith(
      "%c state (no changes)",
      "color: #9E9E9E; font-weight: lighter",
      expect.any(Object)
    );
    expect(consoleDir).not.toHaveBeenCalled();

    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const statePayload = consoleLog.mock.calls[1]?.[2] as NoChangesPayloadForTest;

    expect(actionPayload).toBe(action);
    expect(statePayload).not.toBe(action);
    expect(statePayload).not.toBe(state);
    expectNoChangesPayloadClassInstance(statePayload);
    expect(statePayload.state).toBe(state);
    expect(groupEnd).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ type: "TEST_ACTION" }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: "payload text" }, "TEST_ACTION payload text"],
    [{ type: "TEST_ACTION", payload: 42 }, "TEST_ACTION 42"],
    [{ type: "TEST_ACTION", payload: ["payload text"] }, "TEST_ACTION payload text"],
    [{ type: "TEST_ACTION", payload: [42, 7] }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: { text: "payload text" } }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: [{ text: "payload text" }] }, "TEST_ACTION"],
  ])("preserves simplified action titles for %j", async (action, expectedTitle) => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const state = { count: 1 };
    vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => state),
    };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    middleware(storeApi as never)(next)(action);

    expect(groupCollapsed).toHaveBeenCalledWith(`%c${expectedTitle}`, "color: #9E9E9E; font-weight: 300");
  });
});