// Every localStorage write outside the shared-preference helper, with its scope and the
// reason it needs no helper. `scripts/check-local-storage-scope.mjs` fails a write that
// is not listed here, an entry that matches no write, and an unknown scope.
//
// File → key expression (the source text of the write's key argument) → [scope, reason].
// Scopes are defined in the check (`SCOPES`). A preference every host view must agree
// on does not belong here: move it onto `sharedPreference` / `sharedPreferenceSaga`.
export const DECLARED_WRITES = Object.freeze({
  'src/features/acp-official/permissions/permission-manager.ts': {
    PERMISSION_RULES_KEY: [
      'app',
      'browser fallback of a main-process module: the app runs it in the main process, where rules go to the config store',
    ],
  },
  'src/features/home/home-workspaces-saga.ts': {
    scope: [
      'host',
      'the Home document of one account on one backend; homeSetAsideStorageSyncSaga follows other views and a view-only save merges the stored records first',
    ],
  },
  'src/features/machine-setup/machine-setup-saga.ts': {
    LAST_SSH_LOGIN_STORAGE_KEY: [
      'app',
      'read from storage each time the setup wizard opens; nothing keeps a copy',
    ],
  },
  'src/features/onboarding/onboarding-layout.preview.svelte': {
    INITIALIZE_GIT_CHOICE_STORAGE_KEY: [
      'dev',
      'catalog preview that seeds and restores the stored choice',
    ],
  },
  'src/features/onboarding/utils/onboarding-skip-mark.ts': {
    'namespaceBackendKey(ONBOARDING_SKIP_STORAGE_KEY, backendId)': [
      'marker',
      'permanent per-backend mark, read from storage at each check',
    ],
  },
  'src/features/setup-scripts/last-used.ts': {
    RECENT_SETUP_SCRIPTS_STORAGE_KEY: [
      'app',
      'read from storage at each use, and merged into the stored map before each save',
    ],
    LAST_USED_SETUP_SCRIPTS_STORAGE_KEY: [
      'app',
      'read from storage at each use, and merged into the stored map before each save',
    ],
  },
  'src/features/terminal/terminal-buffer-manager.ts': {
    TERMINAL_BUFFER_INDEX_KEY: ['cache', 'index of the saved terminal buffers'],
    'this.storageKey': ['cache', 'scrollback snapshot of one terminal'],
    key: ['cache', 'removes expired scrollback snapshots'],
  },
  'src/features/terminal/terminal-history-tracker.ts': {
    key: ['cache', 'command history of one terminal'],
    '`${this.STORAGE_PREFIX}${terminalId}`': [
      'cache',
      'removes the command history of a closed terminal',
    ],
  },
  'src/lib/component-catalog/CatalogShell.svelte': {
    '<alias>': ['dev', 'component catalog preferences'],
  },
  'src/lib/component-catalog/ChatPolishGeometryControls.svelte': {
    '<alias>': ['dev', 'component catalog chat-polish controls'],
  },
  'src/lib/components/chat/agent-subscriptions-view-state.ts': {
    STORAGE_KEY: [
      'view',
      'which subscription sections are expanded, per agent; read from storage and merged before each save',
    ],
  },
  'src/lib/components/chat/proposals/proposal-draft-storage.ts': {
    key: ['draft', 'edited proposal draft of one agent'],
    legacyKey: ['draft', 'moves a draft off its legacy key'],
    'loadedFromLegacy ? legacyKey : key': ['draft', 'removes an expired or malformed draft'],
    'draftKey(agentId, proposalId)': ['draft', 'clears a finished draft'],
    'draftKey(agentId, proposalId, LEGACY_KEY_PREFIX)': [
      'draft',
      'clears a finished draft under its legacy key',
    ],
  },
  'src/lib/components/chat/proposals/settings-proposal-actions.ts': {
    storageKey: [
      'app',
      'settings bridge: writes keys other modules own and keeps no copy; the owners follow the write in other views',
    ],
  },
  'src/lib/components/debug/DebugPanel.svelte': {
    '`workspace-visited-${simWorkspaceId}`': ['dev', 'debug panel reset'],
    '`workspace-drawer-state-${simWorkspaceId}`': ['dev', 'debug panel reset'],
    "'selected-workspace-id'": ['dev', 'debug panel reset'],
  },
  'src/lib/components/settings/LinearAuthConnection.svelte': {
    LINEAR_ISSUE_FILTER_STORAGE_KEY: [
      'app',
      'read from storage each time the Linear settings section mounts',
    ],
  },
  'src/lib/config/debug.ts': {
    DEBUG_FLAGS_KEY: ['dev', 'debug flags'],
  },
  'src/lib/utils/logger.ts': {
    'this.storageKey': ['dev', 'persisted debug log buffer'],
  },
  'src/store/renderer/seeders/settings-legacy-bridge-seeder.ts': {
    storageKey: ['app', 'settings bridge: reads storage at each request and keeps no copy'],
  },
  'src/store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga.ts': {
    BG_MODEL_MIGRATION_MARKER_KEY: ['marker', 'one-time model migration done'],
  },
  'src/store/renderer/slices/browser/sagas/browser-persistence-saga.ts': {
    'storageKey(workspaceId)': ['view', 'recent URLs of one workspace browser panel'],
  },
  'src/store/renderer/slices/dock-conversation/dock-composer-last-tool.ts': {
    STORAGE_KEY: [
      'app',
      'read from storage at each use, and merged into the stored map before each save',
    ],
  },
  'src/store/renderer/slices/dock-conversation/dock-conversation-last-agent.ts': {
    STORAGE_KEY: [
      'app',
      'read from storage at each use, and merged into the stored map before each save',
    ],
  },
  'src/store/renderer/slices/dock-conversation/sagas/dock-context-links-saga.ts': {
    key: [
      'app',
      'only the dock window saves it, and reads it back to confirm; it loads from storage for each routing context',
    ],
  },
  'src/store/renderer/slices/hardware-console/sagas/shared-window-cycle-saga.ts': {
    WINDOW_CYCLE_STORAGE_KEY: [
      'app',
      'the console owner window publishes it; sharedWindowCycle follows it in every other window',
    ],
  },
  'src/store/renderer/slices/hud/sagas/hud-saga.ts': {
    storageKey: ['view', 'grid filter of the HUD window'],
  },
  'src/store/renderer/slices/panel-layout/sagas/panel-layout-saga.ts': {
    'storageKey(wsId, yield* selectActiveBackendId())': ['view', 'panel layout of one workspace'],
  },
  'src/store/renderer/slices/proposal-lifecycle/sagas/proposal-lifecycle-saga.ts': {
    PROPOSAL_LIFECYCLE_STORAGE_KEY: [
      'unsynced',
      'proposal outcomes: a follow needs a merge that keeps in-flight entries',
    ],
  },
  'src/store/renderer/slices/provider-models/sagas/model-name-cache-saga.ts': {
    MODEL_NAMES_STORAGE_KEY: ['cache', 'model display names from the daemon'],
  },
  'src/store/renderer/slices/question-ui/sagas/question-ui-persistence-saga.ts': {
    key: ['draft', 'unsent answer to one question'],
    collapsedKey: ['draft', 'collapsed state of one question'],
    storageKey: ['draft', 'removes a malformed draft'],
    'current.storageKey': ['draft', 'clears an answered question'],
    '`${current.storageKey}${COLLAPSED_SUFFIX}`': ['draft', 'clears an answered question'],
  },
  'src/store/renderer/slices/settings-proposal-history/sagas/settings-proposal-history-saga.ts': {
    SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY: [
      'unsynced',
      'applied settings proposals: a follow needs a merge with unsaved entries',
    ],
  },
  'src/store/renderer/slices/sidebar-nav/sagas/sidebar-nav-saga.ts': {
    'chiefActiveAgentIdKey(yield* selectActiveBackendId())': [
      'view',
      'which Chief thread this view shows',
    ],
    'selectedTabsKey(yield* selectActiveBackendId(), workspaceId)': [
      'view',
      'sidebar tabs selected in one workspace',
    ],
    'noteOrderKey(yield* selectActiveBackendId(), workspaceId)': [
      'view',
      'note order of one workspace sidebar',
    ],
    'collapsedNotesKey(yield* selectActiveBackendId(), workspaceId)': [
      'view',
      'collapsed notes of one workspace sidebar',
    ],
    'expandedNotesKey(yield* selectActiveBackendId(), workspaceId)': [
      'view',
      'expanded notes of one workspace sidebar',
    ],
  },
  'src/store/renderer/slices/sidebar-nav/sagas/workspace-label-saga.ts': {
    doneKey: ['marker', 'one-time pin-to-label migration done for one backend'],
  },
  'src/store/renderer/slices/specialist-proposal-history/sagas/specialist-proposal-history-saga.ts':
    {
      SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY: [
        'unsynced',
        'applied specialist proposals: a follow needs a merge with unsaved entries',
      ],
    },
  'src/store/renderer/slices/tab-state/sagas/tab-state-saga.ts': {
    'tabsKey(backendId)': ['view', 'open workspace tabs of one backend'],
    'scrollKey(backendId)': ['view', 'tab scroll positions of one backend'],
  },
  'src/store/renderer/slices/terminals/sagas/terminal-persistence-saga.ts': {
    CUSTOM_NAMES_STORAGE_KEY: [
      'view',
      'terminal names; read from storage and merged before each save',
    ],
    key: ['cache', 'drops metadata of terminals that no longer exist'],
    WORKSPACE_STATE_STORAGE_KEY: [
      'view',
      'terminal panel state per workspace; read from storage and merged before each save',
    ],
    'metadataStorageKey(workspaceId)': ['cache', 'terminal metadata of one workspace'],
  },
  'src/store/renderer/slices/ui-layout/sagas/ui-layout-persistence-saga.ts': {
    key: [
      'view',
      'size or collapsed state of one resizable panel, under the key its component gives',
    ],
  },
  'src/store/renderer/slices/workspace/utils/workspace-storage-manager.ts': {
    key: ['view', 'navigation state of one workspace; setupCrossWindowSync follows other windows'],
  },
  'src/store/renderer/store.ts': {
    key: ['dev', 'Redux debug toggles'],
    REDUX_DEBUG_LS_KEY: ['dev', 'Redux debug toggle'],
  },
});
