/**
 * Central registry of all IPC channels in the application
 * This is the single source of truth for IPC channel names
 *
 * When adding new IPC channels:
 * 1. Add them here in the appropriate section
 * 2. Run 'npm run generate:ipc-channels' to update the preload allowed list
 * 3. The preload script will automatically allow the new channels
 */

export const IPC_CHANNELS = {
  // Workspace Management
  WORKSPACE: {
    LIST: 'workspace:list',
    CREATE: 'workspace:create',
    GET: 'workspace:get',
    GET_CURRENT: 'workspace:get-current',
    GET_BY_ID: 'workspace:get-by-id',
    GET_ROOT: 'workspace:get-root',
    OPEN: 'workspace:open',
    CLOSE: 'workspace:close',
    SAVE: 'workspace:save',
    UPDATE: 'workspace:update',
    DELETE: 'workspace:delete',
    ACTIVATE: 'workspace:activate',
    ARCHIVE: 'workspace:archive',
    UNARCHIVE: 'workspace:unarchive',
    CLEANUP: 'workspace:cleanup',
    PURGE: 'workspace:purge',
    DUPLICATE: 'workspace:duplicate',
    RENAME: 'workspace:rename',
    EXPORT: 'workspace:export',
    IMPORT: 'workspace:import',
    GET_METADATA: 'workspace:get-metadata',
    UPDATE_METADATA: 'workspace:update-metadata',
    GET_RECENT: 'workspace:get-recent',
    CLEAR_RECENT: 'workspace:clear-recent',
    GET_STATS: 'workspace:get-stats',
    VALIDATE: 'workspace:validate',
    PREFLIGHT_CLONE_CHECK: 'workspace:preflight-clone-check',
    REPAIR: 'workspace:repair',
    BACKUP: 'workspace:backup',
    RESTORE: 'workspace:restore',
    GET_SETTINGS: 'workspace:get-settings',
    UPDATE_SETTINGS: 'workspace:update-settings',
    TRIGGER_CHECK: 'workspace:trigger-check',
    DISCOVER_REPOS: 'workspace:discover-repos',
    LIST_FILES: 'workspace:list-files',
    TEST_WATCHER: 'workspace:test-watcher',
    FIND_REPOSITORIES: 'workspace:find-repositories',
    UPDATE_SPEC_WATCHER_TIMESTAMP: 'workspace:update-spec-watcher-timestamp',
    UPDATE_CURRENT_CONTEXT: 'workspace:update-current-context',
    SEARCH_IN_FILES: 'workspace:search-in-files',
    GET_RECENT_REPOSITORIES: 'workspace:get-recent-repositories',
    ADD_RECENT_REPOSITORY: 'workspace:add-recent-repository',
    CLEAR_RECENT_REPOSITORIES: 'workspace:clear-recent-repositories',
    REMOVE_RECENT_REPOSITORY: 'workspace:remove-recent-repository',
    UPDATE_GIT_INFO: 'workspace:update_git_info',
    GET_SETTINGS_ALT: 'workspace:getSettings',
    UPDATE_SETTINGS_ALT: 'workspace:updateSettings',
    LOAD_RULES: 'workspace:load-rules',
    RENAME_BRANCH: 'workspace:rename-branch',
    GET_HOVER_STATUS: 'workspace:get-hover-status',
  },

  // Agent Management
  AGENT: {
    LOAD_INITIAL_CONFIG: 'agent:load-initial-config',
    AVAILABLE: 'agent:available',
    RESUME: 'agent:resume',
    CLEANUP: 'agent:cleanup',
    GET_USER_RULES: 'agent:get-user-rules',
    GET_SPECIALIZATION_RULES: 'agent:get-specialization-rules',
    GET_ACTIVE_STREAMS: 'agent:get-active-streams',
    LIFECYCLE_START: 'agent:lifecycle:start',
    LIFECYCLE_STOP: 'agent:lifecycle:stop',
    MESSAGING_SEND: 'agent:messaging:send',
    MESSAGING_RECEIVE: 'agent:messaging:receive',
    TRACK_STARTED: 'agent:track-started',
    TRACK_COMPLETED: 'agent:track-completed',
    TRACK_ERROR: 'agent:track-error',
    CREATE: 'agent:create',
    ACTIVATE: 'agent:activate',
    SEND_MESSAGE: 'agent:send-message',
    STOP: 'agent:stop',
    CLEAR: 'agent:clear',
    SEND: 'agent:send',
    GET_SESSION: 'agent:get-session',
    LIST_SESSIONS: 'agent:list-sessions',
    UPDATE_SESSION: 'agent:update-session',
    DELETE_SESSION: 'agent:delete-session',
    EXPORT_SESSION: 'agent:export-session',
    IMPORT_SESSION: 'agent:import-session',
    GET_HISTORY: 'agent:get-history',
    UPDATE_METADATA: 'agent:update-metadata',
    RENAME: 'agent:rename',
    FORK_SESSION: 'agent:fork-session',
    MERGE_SESSIONS: 'agent:merge-sessions',
    GET_STATS: 'agent:get-stats',
    VALIDATE_SESSION: 'agent:validate-session',
    REPAIR_SESSION: 'agent:repair-session',
    GET_CONTEXT: 'agent:get-context',
    UPDATE_CONTEXT: 'agent:update-context',
    CONTEXT_UPDATE: 'agent:context:update',
    CONTEXT_GET_BY_WORKSPACE: 'agent:context:getByWorkspace',
    CONTEXT_GET_BY_SESSION: 'agent:context:getBySession',
    GET_CAPABILITIES: 'agent:get-capabilities',
    SET_CAPABILITIES: 'agent:set-capabilities',
    PAUSE: 'agent:pause',
    GET_STATUS: 'agent:get-status',
    SET_PRIORITY: 'agent:set-priority',
    GET_METRICS: 'agent:get-metrics',
    RESET_METRICS: 'agent:reset-metrics',
    GET_LOGS: 'agent:get-logs',
    CLEAR_LOGS: 'agent:clear-logs',
    SUBSCRIBE_UPDATES: 'agent:subscribe-updates',
    UNSUBSCRIBE_UPDATES: 'agent:unsubscribe-updates',
    GET_SUGGESTIONS: 'agent:get-suggestions',
    APPLY_SUGGESTION: 'agent:apply-suggestion',
    GET_COMPLETIONS: 'agent:get-completions',
    VALIDATE_INPUT: 'agent:validate-input',
    FORMAT_OUTPUT: 'agent:format-output',
    GET_SHORTCUTS: 'agent:get-shortcuts',
    ADD_SHORTCUT: 'agent:add-shortcut',
    REMOVE_SHORTCUT: 'agent:remove-shortcut',
    EXECUTE_SHORTCUT: 'agent:execute-shortcut',
    GET_PLUGINS: 'agent:get-plugins',
    INSTALL_PLUGIN: 'agent:install-plugin',
    UNINSTALL_PLUGIN: 'agent:uninstall-plugin',
    ENABLE_PLUGIN: 'agent:enable-plugin',
    DISABLE_PLUGIN: 'agent:disable-plugin',
    GET_PLUGIN_SETTINGS: 'agent:get-plugin-settings',
    UPDATE_PLUGIN_SETTINGS: 'agent:update-plugin-settings',
    EXECUTE_PLUGIN_ACTION: 'agent:execute-plugin-action',
    GET_WEBHOOKS: 'agent:get-webhooks',
    ADD_WEBHOOK: 'agent:add-webhook',
    REMOVE_WEBHOOK: 'agent:remove-webhook',
    TEST_WEBHOOK: 'agent:test-webhook',
    GET_INTEGRATIONS: 'agent:get-integrations',
    CONNECT_INTEGRATION: 'agent:connect-integration',
    DISCONNECT_INTEGRATION: 'agent:disconnect-integration',
    SYNC_INTEGRATION: 'agent:sync-integration',
    GET_INTEGRATION_STATUS: 'agent:get-integration-status',
    GET_INTEGRATION_DATA: 'agent:get-integration-data',
    UPDATE_INTEGRATION_SETTINGS: 'agent:update-integration-settings',
    TEST_INTEGRATION: 'agent:test-integration',
    GET_WORKFLOWS: 'agent:get-workflows',
    CREATE_WORKFLOW: 'agent:create-workflow',
    UPDATE_WORKFLOW: 'agent:update-workflow',
    DELETE_WORKFLOW: 'agent:delete-workflow',
    EXECUTE_WORKFLOW: 'agent:execute-workflow',
    PAUSE_WORKFLOW: 'agent:pause-workflow',
    RESUME_WORKFLOW: 'agent:resume-workflow',
    CANCEL_WORKFLOW: 'agent:cancel-workflow',
    GET_WORKFLOW_STATUS: 'agent:get-workflow-status',
    GET_WORKFLOW_HISTORY: 'agent:get-workflow-history',
    EXPORT_WORKFLOW: 'agent:export-workflow',
    IMPORT_WORKFLOW: 'agent:import-workflow',
    VALIDATE_WORKFLOW: 'agent:validate-workflow',
    OPTIMIZE_WORKFLOW: 'agent:optimize-workflow',
    GET_WORKFLOW_METRICS: 'agent:get-workflow-metrics',
    GET_WORKFLOW_LOGS: 'agent:get-workflow-logs',
    CLEAR_WORKFLOW_LOGS: 'agent:clear-workflow-logs',
    SCHEDULE_WORKFLOW: 'agent:schedule-workflow',
    UNSCHEDULE_WORKFLOW: 'agent:unschedule-workflow',
    GET_SCHEDULED_WORKFLOWS: 'agent:get-scheduled-workflows',
    GET_WORKFLOW_TRIGGERS: 'agent:get-workflow-triggers',
    ADD_WORKFLOW_TRIGGER: 'agent:add-workflow-trigger',
    REMOVE_WORKFLOW_TRIGGER: 'agent:remove-workflow-trigger',
    TEST_WORKFLOW_TRIGGER: 'agent:test-workflow-trigger',
    GET_WORKFLOW_VARIABLES: 'agent:get-workflow-variables',
    SET_WORKFLOW_VARIABLES: 'agent:set-workflow-variables',
    GET_WORKFLOW_DEPENDENCIES: 'agent:get-workflow-dependencies',
    RESOLVE_WORKFLOW_DEPENDENCIES: 'agent:resolve-workflow-dependencies',
    GET_WORKFLOW_PERMISSIONS: 'agent:get-workflow-permissions',
    SET_WORKFLOW_PERMISSIONS: 'agent:set-workflow-permissions',
    SHARE_WORKFLOW: 'agent:share-workflow',
    UNSHARE_WORKFLOW: 'agent:unshare-workflow',
    CLONE_WORKFLOW: 'agent:clone-workflow',
    MERGE_WORKFLOWS: 'agent:merge-workflows',
    DIFF_WORKFLOWS: 'agent:diff-workflows',
    GET_WORKFLOW_VERSIONS: 'agent:get-workflow-versions',
    RESTORE_WORKFLOW_VERSION: 'agent:restore-workflow-version',
    TAG_WORKFLOW_VERSION: 'agent:tag-workflow-version',
    GET_WORKFLOW_TAGS: 'agent:get-workflow-tags',
    REMOVE_WORKFLOW_TAG: 'agent:remove-workflow-tag',
    // Agent model operations
    SET_MODEL: 'agent:set-model',
    // Agent prompt operations
    ENHANCE_PROMPT: 'agent:enhance-prompt',
    GENERATE_LAYOUT: 'agent:generate-layout',
    // Agent persistence operations
    PERSISTENCE_SAVE: 'agent:persistence:save',
    PERSISTENCE_LOAD: 'agent:persistence:load',
    PERSISTENCE_DELETE: 'agent:persistence:delete',
    PERSISTENCE_LIST: 'agent:persistence:list',
    PERSISTENCE_SAVE_MESSAGE: 'agent:persistence:saveMessage',
    PERSISTENCE_BATCH: 'agent:persistence:batch',
    PERSISTENCE_METRICS: 'agent:persistence:metrics',
    PERSISTENCE_CLEAR: 'agent:persistence:clear',
  },

  // Events System
  // NOTE: Advanced queries (recent files, agent activity, workspace summary) are handled
  // via AgentEventTools on the main process side, not via IPC.
  EVENTS: {
    QUERY: 'events:query',
    SUBSCRIBE: 'events:subscribe',
    UNSUBSCRIBE: 'events:unsubscribe',
    EMIT: 'events:emit',
    GET_LAST_EVENT: 'events:getLastEvent',
    GET_STATISTICS: 'events:getStatistics',
    GET_AGENT_SUBSCRIPTIONS: 'events:get-agent-subscriptions',
    UNSUBSCRIBE_AGENT: 'events:unsubscribe-agent',
  },

  // Observability
  OBSERVABILITY: {
    COLLECT_EVENT: 'observability:collect-event',
    GET_EVENTS: 'observability:get-events',
    SUBSCRIBE: 'observability:subscribe',
    GET_SESSION_SUMMARY: 'observability:get-session-summary',
    GET_METRICS: 'observability:get-metrics',
    EXPORT: 'observability:export',
    CLEAR: 'observability:clear',
  },

  // Auggie Integration
  AUGGIE: {
    CHECK_AVAILABILITY: 'auggie:check-availability',
    STATUS: 'auggie:status',
    INSTALL: 'auggie:install',
    AUTHENTICATE: 'auggie:authenticate',
    GET_MODELS: 'auggie:get-models',
    GET_CONFIG: 'auggie:get-config',
    UPDATE_CONFIG: 'auggie:update-config',
    GET_LATEST_SESSION: 'auggie:get-latest-session',
    EXTRACT_FILE_CHANGES: 'auggie:extract-file-changes',
    GET_PATH: 'auggie:get-path',
    GET_USER_INFO: 'auggie:get-user-info',
    SETUP_MCP_CLAUDE_CODE: 'auggie:setup-mcp-claude-code',
    SETUP_MCP_CODEX: 'auggie:setup-mcp-codex',
    SETUP_MCP_OPENCODE: 'auggie:setup-mcp-opencode',
    CHECK_MCP_CLAUDE_CODE: 'auggie:check-mcp-claude-code',
    CHECK_MCP_CODEX: 'auggie:check-mcp-codex',
    CHECK_MCP_OPENCODE: 'auggie:check-mcp-opencode',
    UNINSTALL_MCP_CLAUDE_CODE: 'auggie:uninstall-mcp-claude-code',
    UNINSTALL_MCP_CODEX: 'auggie:uninstall-mcp-codex',
    UNINSTALL_MCP_OPENCODE: 'auggie:uninstall-mcp-opencode',
    SETUP_MCP_CORTEX: 'auggie:setup-mcp-cortex',
    CHECK_MCP_CORTEX: 'auggie:check-mcp-cortex',
    UNINSTALL_MCP_CORTEX: 'auggie:uninstall-mcp-cortex',
  },
  // OpenCode Integration
  OPENCODE: {
    CHECK_AVAILABILITY: 'opencode:check-availability',
    GET_MODELS: 'opencode:get-models',
  },

  // Claude Code Integration
  CLAUDE_CODE: {
    CHECK_AVAILABILITY: 'claude-code:check-availability',
    GET_MODELS: 'claude-code:get-models',
  },

  // Codex Integration
  CODEX: {
    CHECK_AVAILABILITY: 'codex:check-availability',
    GET_MODELS: 'codex:get-models',
  },

  // Cortex Integration
  CORTEX: {
    CHECK_AVAILABILITY: 'cortex:check-availability',
    GET_MODELS: 'cortex:get-models',
  },

  // Promotional Banner
  BANNER: {
    FETCH: 'banner:fetch',
  },

  // Provider Availability (aggregates all ACP providers)
  PROVIDERS: {
    GET_AVAILABILITY: 'providers:get-availability',
    GET_PATHS: 'providers:get-paths',
    CHECK_SINGLE: 'providers:check-single',
  },

  // Third Party Sources
  SOURCES: {
    CREATE: 'sources:create',
    LIST: 'sources:list',
    GET: 'sources:get',
    ADD: 'sources:add',
    REMOVE: 'sources:remove',
    UPDATE: 'sources:update',
    DELETE: 'sources:delete',
    REFRESH: 'sources:refresh',
    EXTRACT_METADATA: 'sources:extract-metadata',
  },

  // File Management
  FILE: {
    READ: 'file:read',
    WRITE: 'file:write',
    DELETE: 'file:delete',
    EXISTS: 'file:exists',
    LIST: 'file:list',
    COPY: 'file:copy',
    MOVE: 'file:move',
    GET_INFO: 'file:get-info',
    WATCH: 'file:watch',
    UNWATCH: 'file:unwatch',
    READ_DIR_WITH_STATS: 'file:readDirWithStats',
    GET_GITIGNORE_PATTERNS: 'file:getGitignorePatterns',
    READ_BATCH: 'file:read-batch',
    MKDIR: 'file:mkdir',
    GET_GIT_STATUS: 'file:getGitStatus',
    GET_TREE_WITH_SIZES: 'file:getTreeWithSizes',
    GET_DIRECTORY_STATUS: 'file:getDirectoryStatus',
  },

  // Notes
  NOTES: {
    LIST: 'notes:list',
    CREATE: 'notes:create',
    GET: 'notes:get',
    UPDATE: 'notes:update',
    DELETE: 'notes:delete',
    SEARCH: 'notes:search',
    EXPORT: 'notes:export',
    IMPORT: 'notes:import',
    RESTORE_SPEC: 'notes:restore-spec',
    RESTORE_VERSION: 'notes:restore-version',
    SUGGESTION: 'note:suggestion',
    // Task metadata operations (Phase 1A)
    MARK_AS_TASK: 'notes:mark-as-task',
    UPDATE_TASK_STATUS: 'notes:update-task-status',
    UPDATE_TASK_PEER_ORDER: 'notes:update-task-peer-order',
    REMOVE_TASK_METADATA: 'notes:remove-task-metadata',
    GET_TASK_NOTES: 'notes:get-task-notes',
    // Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph
    // ADD_DEPENDENCY, REMOVE_DEPENDENCY, GET_DEPENDENCIES channels removed
    GET_DEPENDENTS: 'notes:get-dependents', // Returns child notes (notes with this note as parentId)
    CREATE_PREREQUISITE_NOTE: 'notes:create-prerequisite-note',
    // Agent assignment operations (Phase 1C)
    ASSIGN_AGENT_TO_TASK: 'notes:assign-agent-to-task',
    // Task navigation
    FIND_NEXT_TASK: 'notes:find-next-task',
    FIND_READY_TASKS: 'notes:find-ready-tasks',
    // Task block conversion
    CONVERT_TASK_BLOCKS: 'notes:convert-task-blocks',
    // Version management
    FLUSH_PENDING_VERSION: 'notes:flush-pending-version',
    // Batch operations (for homepage progress cards)
    BATCH_LIST: 'notes:batch-list',
  },

  // Assets (images and files for notes)
  ASSETS: {
    SAVE: 'assets:save',
    GET: 'assets:get',
    GET_DATA_URL: 'assets:get-data-url',
    DELETE: 'assets:delete',
    LIST: 'assets:list',
  },

  // Notes Primitives (ws-block rendering)
  PRIMITIVES: {
    REFERENCE_RESOLVE: 'reference:resolve',
    CODEBASE_SEARCH: 'codebase:search',
    TERMINAL_RUN: 'terminal:runCommand',
    TERMINAL_KILL: 'terminal:killProcess',
    TERMINAL_SUBSCRIBE: 'terminal:subscribeOutput',
    PATCH_APPLY: 'patch:apply',
    PATCH_VALIDATE: 'patch:validate',
    PATCH_REVERT: 'patch:revert',
    AGENT_RUN: 'agent:runAction',
  },

  // System
  SYSTEM: {
    GET_INFO: 'system:get-info',
    GET_RESOURCES: 'system:get-resources',
    OPEN_EXTERNAL: 'system:open-external',
    SHOW_ITEM_IN_FOLDER: 'system:show-item-in-folder',
    BEEP: 'system:beep',
    HOME_DIRECTORY: 'system:home-directory',
    WORKSPACE_ROOT: 'system:workspace-root',
    EXECUTE_COMMAND: 'system:execute-command',
    EXECUTE_COMMAND_STREAMING: 'system:execute-command-streaming',
    CHECK_GIT: 'system:check-git',
    CHECK_RTK: 'system:check-rtk',
    LIST_FONTS: 'system:list-fonts',
  },

  // App
  APP: {
    SET_BADGE: 'app:set-badge',
    VERSION: 'app:version',
    GET_VERSION: 'app:get-version',
    NAME: 'app:name',
    PATH: 'app:path',
    ROOT: 'app:root',
    GET_MEMORY_USAGE: 'app:get-memory-usage',
    TRIGGER_MEMORY_CLEANUP: 'app:trigger-memory-cleanup',
  },

  // Window Management
  WINDOW: {
    RELOAD: 'window:reload',
    TOGGLE_DEVTOOLS: 'window:toggle-devtools',
    MINIMIZE: 'window:minimize',
    MAXIMIZE: 'window:maximize',
    CLOSE: 'window:close',
    CREATE: 'window:create',
    OPEN_NEW: 'window:open-new',
    SET_THEME: 'window:set-theme',
    GET_ZOOM_FACTOR: 'window:get-zoom-factor',
    SET_TITLE: 'window:set-title',
    SET_IN_WORKSPACE: 'window:set-in-workspace',
    SET_OPEN_WORKSPACE_TABS: 'window:set-open-workspace-tabs',
    SET_BROWSER_FOCUSED: 'window:set-browser-focused',
  },

  // Terminal
  TERMINAL: {
    CREATE_WITH_COMMAND: 'terminal:createWithCommand',
    PROFESSIONAL_CREATE: 'terminal:professional:create',
    PROFESSIONAL_LIST: 'terminal:professional:list',
    PROFESSIONAL_WRITE: 'terminal:professional:write',
    PROFESSIONAL_RESIZE: 'terminal:professional:resize',
    PROFESSIONAL_INFO: 'terminal:professional:info',
    PROFESSIONAL_REFRESH: 'terminal:professional:refresh',
    PROFESSIONAL_DISPOSE: 'terminal:professional:dispose',
    PROFESSIONAL_GET_BUFFER: 'terminal:professional:get-buffer',
  },

  // Git
  GIT: {
    STATUS: 'git:status',
    STATUS_CHANGED: 'git:status-changed',
    AUTH_REQUIRED: 'git:auth-required',
    KEYCHAIN_ACCESS_WARNING: 'git:keychain-access-warning',
    KEYCHAIN_CONSENT_RESPOND: 'git:keychain-consent-respond',
    CHECK_KEYCHAIN_RISK: 'git:check-keychain-risk',
    DIFF: 'git:diff',
    COMMIT: 'git:commit',
    COMMIT_DETAILS: 'git:commit-details',
    PUSH: 'git:push',
    PULL: 'git:pull',
    BRANCH: 'git:branch',
    CHECKOUT: 'git:checkout',
    LOG: 'git:log',
    HISTORY: 'git:history',
    GET_BRANCHES: 'git:getBranches',
    STAGE: 'git:stage',
    UNSTAGE: 'git:unstage',
    STAGE_HUNK: 'git:stage-hunk',
    UNSTAGE_HUNK: 'git:unstage-hunk',
    DISCARD: 'git:discard',
    REMOVE_LOCK: 'git:removeLock',
    SHOW_FILE: 'git:show-file',
    FILE_HISTORY: 'git:file-history',
    RENAME_BRANCH: 'git:rename-branch',
    PULL_BRANCH: 'git:pullBranch',
    GET_BRANCH_STATUS: 'git:getBranchStatus',
    GET_REMOTES: 'git:getRemotes',
    FETCH: 'git:fetch',
  },

  // Config
  CONFIG: {
    GET: 'config:get',
    SET: 'config:set',
    DELETE: 'config:delete',
    GET_ALL: 'config:get-all',
    RESET: 'config:reset',
    GET_MODEL: 'config:get-model',
    GET_ALL_MODELS: 'config:get-all-models',
    CLEAR_CACHE: 'config:clear-cache',
    INVALIDATE: 'config:invalidate',
    GET_STATS: 'config:get-stats',
  },

  // Settings (electron-store)
  SETTINGS: {
    GET: 'settings:get',
    SET: 'settings:set',
    GET_ALL: 'settings:getAll',
    UPDATE: 'settings:update',
  },

  // Feature Codes
  FEATURE_CODES: {
    ACTIVATE: 'feature-codes:activate',
    GET_ACTIVE: 'feature-codes:get-active',
    CLEAR: 'feature-codes:clear',
    DEACTIVATE: 'feature-codes:deactivate',
    RESTART_APP: 'feature-codes:restart-app',
  },

  // User MCP Settings (~/.augment/settings.json)
  USER_MCP: {
    GET_SETTINGS_FILE: 'user-mcp:get-settings-file',
    WRITE_SETTINGS_FILE: 'user-mcp:write-settings-file',
    GET_SETTINGS_PATH: 'user-mcp:get-settings-path',
    GET_SERVERS: 'user-mcp:get-servers', // Get parsed MCP servers
    GET_WORKSPACE_DISABLED: 'user-mcp:get-workspace-disabled', // Get disabled servers for a workspace
    SET_WORKSPACE_DISABLED: 'user-mcp:set-workspace-disabled', // Set disabled servers for a workspace
    CHECK_AUTH: 'user-mcp:check-auth', // Check if URL requires auth and if we have credentials
    TEST_CONNECTION: 'user-mcp:test-connection', // Test connection to HTTP/SSE server, returns status
    INITIATE_OAUTH: 'user-mcp:initiate-oauth', // Start OAuth flow for MCP server
    // MCP CLI commands
    MCP_LIST: 'user-mcp:mcp-list', // List MCP servers via CLI
    MCP_ADD: 'user-mcp:mcp-add', // Add MCP server via CLI
    MCP_REMOVE: 'user-mcp:mcp-remove', // Remove MCP server via CLI
  },

  // Notifications
  NOTIFICATION: {
    TEST: 'notification:test',
    REQUEST_PERMISSION: 'notification:requestPermission',
    SHOW: 'notification:show',
  },

  // ACP Permissions (for agent tool approval)
  PERMISSION: {
    REQUEST: 'permission:request',
    RESPOND: 'permission:respond',
    EVENT: 'permission:event', // For main -> renderer push
    GET_PENDING: 'permission:get-pending', // Get all pending permission requests (for page refresh recovery)
  },

  // Dialog
  DIALOG: {
    OPEN: 'dialog:open',
    SAVE: 'dialog:save',
    OPEN_FILE: 'dialog:openFile',
    OPEN_DIRECTORY: 'dialog:openDirectory',
    SAVE_FILE: 'dialog:saveFile',
    SHOW_MESSAGE: 'dialog:showMessage',
    SHOW_ERROR: 'dialog:showError',
    MESSAGE: 'dialog:message',
  },

  // Shell
  SHELL: {
    OPEN: 'shell:open',
    OPEN_PATH: 'shell:openPath',
    OPEN_EXTERNAL: 'shell:openExternal',
    TRASH_ITEM: 'shell:trashItem',
    SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
    INSTALL_CLI: 'shell:install-cli',
  },

  // Comments
  COMMENTS: {
    CREATE: 'comments:create',
    LIST: 'comments:list',
    UPDATE: 'comments:update',
    DELETE: 'comments:delete',
    ADD: 'comments:add',
    SUGGEST_CHANGE: 'comments:suggest-change',
    UPDATE_STATUS: 'comments:update-status',
  },

  // Editor
  EDITOR: {
    GET_SELECTION: 'editor:get-selection',
    GET_ACTIVE_FILE: 'editor:get-active-file',
    OPEN_FILE: 'editor:open-file',
    CLOSE_FILE: 'editor:close-file',
  },

  // External Editors (IDEs, terminals, etc.)
  EXTERNAL_EDITORS: {
    /** Detect installed editors from the registry */
    DETECT_INSTALLED: 'external-editors:detect-installed',
    /** Open a path in a specific editor by ID */
    OPEN: 'external-editors:open',
    /** Open a path with a user-selected app (shows file picker) */
    OPEN_WITH_OTHER: 'external-editors:open-with-other',
  },

  // First Visit State
  FIRST_VISIT: {
    LOAD: 'first-visit-state:load',
    SAVE: 'first-visit-state:save',
    DELETE: 'first-visit-state:delete',
    EXISTS: 'first-visit-state:exists',
  },

  // Panel Layout (layout history persistence)
  PANEL_LAYOUT: {
    LOAD: 'panel-layout:load',
    SAVE: 'panel-layout:save',
  },

  // Browser Debugger (CDP access to embedded browser tabs)
  BROWSER: {
    /** Register a browser tab's webContentsId for CDP access */
    REGISTER_TAB: 'browser:register-tab',
    /** Unregister a browser tab when it's closed */
    UNREGISTER_TAB: 'browser:unregister-tab',
    /** Execute code with access to browser CDP API */
    EXEC: 'browser:exec',
    /** Focus a browser tab (bring to front) - main->renderer event */
    FOCUS_TAB: 'browser:focus-tab',
    /** Request browser tab list from renderer (main->renderer event) */
    LIST_TABS_REQUEST: 'browser:list-tabs-request',
    /** Response with browser tab list (renderer->main) */
    LIST_TABS_RESPONSE: 'browser:list-tabs-response',
    /** Open a browser tab in a panel - main->renderer event */
    OPEN_TAB: 'browser:open-tab',
  },

  // File Tracking
  FILE_TRACKING: {
    INIT: 'file-tracking:init',
    LOAD: 'file-tracking:load',
    LOAD_COMMITS: 'file-tracking:load-commits',
    LOAD_OLDER_COMMITS: 'file-tracking:load-older-commits',
    SYNC: 'file-tracking:sync',
    CLEAR: 'file-tracking:clear',
    GET_CHANGES: 'file-tracking:get-changes',
    GET_STATUS: 'file-tracking:get-status',
    GET_LINE_STATS: 'file-tracking:get-line-stats',
    REFRESH: 'file-tracking:refresh',
    TRACK_CHANGE: 'file-tracking:track-change',
    STAGE_CHANGES: 'file-tracking:stage-changes',
    UNSTAGE_CHANGES: 'file-tracking:unstage-changes',
    LOAD_TRANSITIONS: 'file-tracking:load-transitions',
    // Event emitted by agent file operations to trigger immediate UI update
    AGENT_FILE_CHANGED: 'file-tracking:agent-file-changed',
  },

  // Persistence
  PERSISTENCE: {
    SAVE: 'persistence:save',
    LOAD: 'persistence:load',
    DELETE: 'persistence:delete',
    EXISTS: 'persistence:exists',
    LOAD_AGENT_CONFIG: 'persistence:load-agent-config',
    SAVE_AGENT_CONFIG: 'persistence:save-agent-config',
    LOAD_SESSION: 'persistence:load-session',
    SAVE_SESSION: 'persistence:save-session',
    SAVE_REGISTRY: 'persistence:save-registry',
    LOAD_REGISTRY: 'persistence:load-registry',
  },

  // Streaming
  STREAMING: {
    START: 'streaming:start',
    STOP: 'streaming:stop',
    PAUSE: 'streaming:pause',
    RESUME: 'streaming:resume',
    GET_STATS: 'streaming:get-stats',
  },

  // Agent Config
  AGENT_CONFIG: {
    GET: 'agent-config:get',
    UPDATE: 'agent-config:update',
    RESET: 'agent-config:reset',
  },

  // Log (Event Tracking and Log File Operations)
  LOG: {
    TRACK_FILE_CHANGE: 'log:track-file-change',
    TRACK_AGENT_EVENT: 'log:track-agent-event',
    TRACK_MCP_CALL: 'log:track-mcp-call',
    GET_EVENTS: 'log:get-events',
    CLEAR_EVENTS: 'log:clear-events',
    EVENTS_UPDATED: 'log:events-updated',
    PATHS: 'log:paths',
    READ: 'log:read',
    CLEAR: 'log:clear',
    SUMMARY: 'log:summary',
    EXPORT_DEBUG_BUNDLE: 'log:export-debug-bundle',
    PERSIST_RENDERER_LOGS: 'log:persist-renderer-logs',
  },

  /**
   * Activity Log (DEPRECATED)
   *
   * These channels are deprecated and no longer have handlers.
   * The activity log functionality has been replaced by the unified event system.
   * See: src/features/events/ for the new implementation.
   * Kept for backward compatibility with any legacy code.
   *
   * @deprecated Use EVENTS channels instead
   */
  ACTIVITY_LOG: {
    /** @deprecated Use events:query instead */
    GET_ENTRIES: 'activity-log:get-entries',
    /** @deprecated Use events:emit instead */
    ADD_ENTRY: 'activity-log:add-entry',
    /** @deprecated Use events:clear instead */
    CLEAR: 'activity-log:clear',
  },

  // User Rules
  USER_RULES: {
    GET: 'user-rules:get',
    SET: 'user-rules:set',
    DELETE: 'user-rules:delete',
    GET_ALL: 'user-rules:get-all',
    GET_FORMATTED: 'user-rules:get-formatted',
    SET_ENABLED: 'user-rules:set-enabled',
    EXPORT: 'user-rules:export',
    IMPORT: 'user-rules:import',
    GET_COMBINED_PROMPT: 'user-rules:get-combined-prompt',
    UPDATE: 'user-rules:update',
    // Per-type operations
    GET_BY_TYPE: 'user-rules:get-by-type',
    GET_FORMATTED_BY_TYPE: 'user-rules:get-formatted-by-type',
    UPDATE_BY_TYPE: 'user-rules:update-by-type',
    SET_ENABLED_BY_TYPE: 'user-rules:set-enabled-by-type',
    DELETE_BY_TYPE: 'user-rules:delete-by-type',
    EXPORT_BY_TYPE: 'user-rules:export-by-type',
  },

  // VS Code Integration
  VSCODE: {
    OPEN: 'vscode:open',
    OPEN_FILE: 'vscode:openFile',
    OPEN_DIFF: 'vscode:open-diff',
    OPEN_GIT_DIFF: 'vscode:open-git-diff',
  },

  // JetBrains Integration
  JETBRAINS: {
    OPEN: 'jetbrains:open',
  },

  // Xcode Integration
  XCODE: {
    OPEN: 'xcode:open',
  },

  // Deep Links
  DEEP_LINK: {
    HANDLE: 'deep-link:handle',
  },

  // Legacy/Compatibility
  LEGACY: {
    GET_HOME_DIRECTORY: 'get_home_directory',
  },

  // Rules
  RULES: {
    LIST: 'rules:list',
    LOAD_WORKSPACE: 'rules:load-workspace',
    GET_CONTEXT: 'rules:get-context',
  },

  // Specialists (file-based specialist management)
  SPECIALISTS: {
    LIST_FILES: 'specialists:list-files',
    LIST_BUNDLED: 'specialists:list-bundled',
    LIST_ALL: 'specialists:list-all',
    READ_FILE: 'specialists:read-file',
    WRITE_FILE: 'specialists:write-file',
    DELETE_FILE: 'specialists:delete-file',
    OPEN_FOLDER: 'specialists:open-folder',
    GET_FOLDER_PATH: 'specialists:get-folder-path',
    EXPORT_BUILTIN: 'specialists:export-builtin',
    FILE_EXISTS: 'specialists:file-exists',
    FILES_CHANGED: 'specialists:files-changed',
  },

  // Config Rules
  CONFIG_RULES: {
    GET_ALL: 'config:getAll',
  },

  // Per-Repo Config (.intent/config.json)
  REPO_CONFIG: {
    READ: 'repo-config:read',
    WRITE: 'repo-config:write',
    HAS_CONFIG: 'repo-config:has-config',
    ENSURE_INTENT_DIR: 'repo-config:ensure-intent-dir',
  },

  // Memories
  MEMORIES: {
    LIST: 'memories:list',
    GET: 'memories:get',
    CREATE: 'memories:create',
    UPDATE: 'memories:update',
    DELETE: 'memories:delete',
    SEARCH: 'memories:search',
    GET_CONTEXT: 'memories:get-context',
  },

  // User Activity (note read tracking)
  USER_ACTIVITY: {
    MARK_NOTE_READ: 'user-activity:mark-note-read',
    GET_NOTE_READ_STATUS: 'user-activity:get-note-read-status',
    GET_UNREAD_NOTE_IDS: 'user-activity:get-unread-note-ids',
  },

  // Editor Integration
  EDITOR_INTEGRATION: {
    OPEN: 'editor:open',
    SAVE: 'editor:save',
    SETTINGS: 'editor:settings',
  },

  // Diffs
  DIFFS: {
    LIST: 'diffs:list',
    CREATE: 'diffs:create',
    UPDATE: 'diffs:update',
    GET: 'diffs:get',
  },

  // Line Changes
  LINE_CHANGES: {
    GET_WORKSPACE_STATS: 'line-changes:get-workspace-stats',
    GET_ALL_WORKSPACE_STATS: 'line-changes:get-all-workspace-stats',
    GET_AGENT_STATS: 'line-changes:get-agent-stats',
    CALCULATE_DIFF: 'line-changes:calculate-diff',
    UPDATE_WORKSPACE_STATS: 'line-changes:update-workspace-stats',
    UPDATE_AGENT_STATS: 'line-changes:update-agent-stats',
    CLEAR_WORKSPACE_STATS: 'line-changes:clear-workspace-stats',
    CLEAR_AGENT_STATS: 'line-changes:clear-agent-stats',
    MARK_AGENT_ACTIVE: 'changes:mark-agent-active',
    GET_CURRENT: 'changes:get-current',
    START_AGENT_EXECUTION: 'changes:start-agent-execution',
    STOP_AGENT_EXECUTION: 'changes:stop-agent-execution',
    MARK_AGENT_MODIFIED_FILES: 'changes:mark-agent-modified-files',
  },

  // Line Attribution
  LINE_ATTRIBUTION: {
    LOAD: 'line-attribution:load',
    UPDATED: 'line-attribution:updated',
    COMPUTE_NOW: 'line-attribution:compute-now',
  },

  // File Attribution (for agent file writes)
  FILE_ATTRIBUTION: {
    RECORD_AGENT_WRITE: 'file-attribution:record-agent-write',
    READ_FILE_AND_RECORD: 'file-attribution:read-file-and-record',
  },

  // Git Tracking
  GIT_TRACKING: {
    GET_STATE: 'git-tracking:get-state',
    GET_SYNC_STATUS: 'git-tracking:get-sync-status',
    SYNC: 'git-tracking:sync',
    GET_FILE_DIFF: 'git-tracking:get-file-diff',
    IS_GITHUB_AUTHENTICATED: 'git-tracking:is-github-authenticated',
    GET_GITHUB_BRANCHES: 'git-tracking:get-github-branches',
    GET_PULL_REQUESTS: 'git-tracking:get-pull-requests',
    SEARCH_PULL_REQUESTS: 'git-tracking:search-pull-requests',
    GET_PULL_REQUEST: 'git-tracking:get-pull-request',
    CREATE_PULL_REQUEST: 'git-tracking:create-pull-request',
    GET_GITHUB_ISSUES: 'git-tracking:get-github-issues',
    SEARCH_GITHUB_ISSUES: 'git-tracking:search-github-issues',
    GET_REMOTE_URL: 'git-tracking:get-remote-url',
    GET_CHECK_RUNS: 'git-tracking:get-check-runs',
    GET_PR_REVIEWS: 'git-tracking:get-pr-reviews',
  },

  // GitHub Auth (via Augment API OAuth)
  GITHUB_AUTH: {
    IS_AUTHENTICATED: 'github-auth:is-authenticated',
    GET_USER: 'github-auth:get-user',
    START_AUTH: 'github-auth:start',
    POLL_FOR_TOKEN: 'github-auth:poll',
    CANCEL_AUTH: 'github-auth:cancel',
    LOGOUT: 'github-auth:logout',
    GET_AUTH_STATE: 'github-auth:get-auth-state',
    GET_STATUS: 'github-auth:get-status',
    LIST_REPOS: 'github-auth:list-repos',
    SEARCH_REPOS: 'github-auth:search-repos',
  },

  // Linear Auth (via Augment API OAuth)
  LINEAR_AUTH: {
    IS_AUTHENTICATED: 'linear-auth:is-authenticated',
    START_AUTH: 'linear-auth:start-auth',
    CANCEL_AUTH: 'linear-auth:cancel-auth',
    LOGOUT: 'linear-auth:logout',
    GET_AUTH_STATE: 'linear-auth:get-auth-state',
    GET_STATUS: 'linear-auth:get-status',
    FETCH_MY_ISSUES: 'linear-auth:fetch-my-issues',
    SEARCH_ISSUES: 'linear-auth:search-issues',
  },

  // Sentry Auth
  SENTRY_AUTH: {
    IS_AUTHENTICATED: 'sentry-auth:is-authenticated',
    SAVE_CONFIG: 'sentry-auth:save-config',
    GET_AUTH_STATE: 'sentry-auth:get-auth-state',
    LOGOUT: 'sentry-auth:logout',
    FETCH_PROJECTS: 'sentry-auth:fetch-projects',
    FETCH_ISSUES: 'sentry-auth:fetch-issues',
    SEARCH_ISSUES: 'sentry-auth:search-issues',
    GET_ISSUE: 'sentry-auth:get-issue',
  },

  // Observability Extended
  OBSERVABILITY_EXT: {},

  // MCP (Model Context Protocol)
  MCP: {
    EVENT: 'mcp:event',
    TRANSITION_WORKSPACE: 'mcp:transition-workspace',
    CALL_TOOL: 'mcp:call-tool',
    LIST_TOOLS: 'mcp:list-tools',
    CREATE_SERVER: 'mcp:create-server',
    GET_STATUS: 'mcp:get-status',
  },

  // Agent Testing
  AGENT_TESTING: {
    RUN: 'agent-testing:run',
    GET_REPORT: 'agent-testing:get-report',
    GET_AGENT_REPORTS: 'agent-testing:get-agent-reports',
    CLEANUP: 'agent-testing:cleanup',
  },

  // Remote File System
  REMOTE_FS: {
    INITIALIZE: 'remote-fs:initialize',
    READ_FILE: 'remote-fs:readFile',
    WRITE_FILE: 'remote-fs:writeFile',
    APPEND_FILE: 'remote-fs:appendFile',
    DELETE_FILE: 'remote-fs:deleteFile',
    READDIR: 'remote-fs:readdir',
    MKDIR: 'remote-fs:mkdir',
    RMDIR: 'remote-fs:rmdir',
    EXISTS: 'remote-fs:exists',
    STAT: 'remote-fs:stat',
    COPY: 'remote-fs:copy',
    MOVE: 'remote-fs:move',
    FIND: 'remote-fs:find',
    GREP: 'remote-fs:grep',
    DISCONNECT: 'remote-fs:disconnect',
    STATUS: 'remote-fs:status',
    CLEAR_CACHE: 'remote-fs:clearCache',
  },

  // Testing
  TESTING: {
    RUN_TESTS: 'testing:run-tests',
    RUN_LINT: 'testing:run-lint',
    RUN_BUILD: 'testing:run-build',
    STOP_PROCESS: 'testing:stop-process',
    GET_PROCESSES: 'testing:get-processes',
  },

  // Debug (development only)
  DEBUG: {
    TRIGGER_BACKEND_RESUME: 'debug:trigger-backend-resume',
    LIST_AGENTS: 'debug:list-agents',
  },

  // Setup Scripts
  SETUP_SCRIPTS: {
    GENERATE: 'setup-scripts:generate',
    DETECT_TYPE: 'setup-scripts:detect-type',
    GENERATE_WITH_AGENT: 'setup-scripts:generate-with-agent',
    STOP_AGENT: 'setup-scripts:stop-agent',
    STREAM_CHUNK: 'setup-scripts:stream-chunk',
    STREAM_COMPLETE: 'setup-scripts:stream-complete',
    STREAM_ERROR: 'setup-scripts:stream-error',
  },

  // Git Extended
  GIT_EXT: {
    IS_REPOSITORY: 'git:isRepository',
    GET_AUTO_COMMIT_STATUS: 'git:get-auto-commit-status',
    GET_BACKGROUND_OPS_STATUS: 'git:background-ops-status',
  },

  // Accept Changes
  ACCEPT_CHANGES: {
    GET_STATUS: 'accept-changes:get-status',
    PREPARE: 'accept-changes:prepare',
    EXECUTE: 'accept-changes:execute',
    EXPORT: 'accept-changes:export',
    CHECK_PATH_HAS_CHANGES: 'accept-changes:check-path-has-changes',
    ADD_REMOTE: 'accept-changes:add-remote',
    MERGE_PR: 'accept-changes:merge-pr',
  },

  // Chat Export
  CHAT_EXPORT: {
    CHAT_TO_HTML: 'export:chat-to-html',
  },

  // File Extended
  FILE_EXT: {},

  // Comments Extended
  COMMENTS_EXT: {},

  // Workspace Extended
  WORKSPACE_EXT: {},

  // Agent Launch
  AGENT_LAUNCH: {},

  // Agent Context
  AGENT_CONTEXT: {
    GET: 'agent-context:get',
  },

  // Sources Extended
  SOURCES_EXT: {},

  RECOVERY: {
    NEEDS_RECOVERY: 'recovery:needs-recovery',
    MARK_STREAMING: 'recovery:mark-streaming',
    MARK_COMPLETE: 'recovery:mark-complete',
    CLEAR_STREAMING: 'recovery:clear-streaming',
    CHECK_NEEDS_RECOVERY: 'recovery:check-needs-recovery',
    GET_STATUS: 'recovery:get-status',
    CREATE_CHECKPOINT: 'recovery:create-checkpoint',
    RESTORE_CHECKPOINT: 'recovery:restore-checkpoint',
    RECOVER_SESSION: 'recovery:recover-session',
    GET_STATS: 'recovery:get-stats',
  },

  // Agent Backend
  AGENT_BACKEND: {
    CREATE: 'agent:backend:create',
    STREAM_MESSAGE: 'agent:backend:stream-message',
    GET_STATUS: 'agent:backend:get-status',
    CANCEL_STREAM: 'agent:backend:cancel-stream',
    STOP: 'agent:backend:stop',
    GET: 'agent:backend:get',
    LIST: 'agent:backend:list',
    DELETE: 'agent:backend:delete',
    IS_ACTIVE: 'agent:backend:isActive',
    RESUME: 'agent:backend:resume',
    CHECK_PROCESS: 'agent:backend:check-process',
    RECONNECT: 'agent:backend:reconnect',
    RESUME_STREAM: 'agent:backend:resume-stream',
    GET_CHECKPOINT: 'agent:backend:get-checkpoint',
    // Message queue operations
    QUEUE_MESSAGE: 'agent:backend:queue-message',
    EDIT_QUEUED: 'agent:backend:edit-queued',
    REMOVE_QUEUED: 'agent:backend:remove-queued',
    GET_QUEUE: 'agent:backend:get-queue',
  },

  // Storage
  STORAGE: {
    SAVE: 'storage:save',
    DELETE: 'storage:delete',
  },

  // Sandbox (development only)
  SANDBOX: {
    GET_AGENT_RULES: 'sandbox:get-agent-rules',
  },

  // Auto-Update
  AUTO_UPDATE: {
    CHECK: 'auto-update:check',
    CHECK_MANUAL: 'auto-update:check-manual',
    DOWNLOAD: 'auto-update:download',
    INSTALL: 'auto-update:install',
    GET_STATE: 'auto-update:get-state',
    SET_CHANNEL: 'auto-update:set-channel',
    // Event channels (main → renderer)
    STATUS_CHANGED: 'auto-update:status-changed',
    PROGRESS: 'auto-update:progress',
    ERROR: 'auto-update:error',
    UP_TO_DATE: 'auto-update:up-to-date',
    SHOW_TOAST: 'auto-update:show-toast',
  },

  // Sentry (error tracking)
  SENTRY: {
    GET_CONFIG: 'sentry:get-config',
  },

  // Analytics (Segment)
  ANALYTICS: {
    GET_CONFIG: 'analytics:get-config',
  },

  // Picture-in-Picture Windows
  PIP: {
    OPEN: 'pip:open',
    CLOSE: 'pip:close',
    CLOSE_ALL_FOR_WORKSPACE: 'pip:close-all-for-workspace',
  },

  // SSH Remote Workspace Management
  SSH: {
    GET_CONFIG_HOSTS: 'ssh:get-config-hosts',
    LIST_KEYS: 'ssh:list-keys',
    GET_AGENT_STATUS: 'ssh:get-agent-status',
    TEST_CONNECTION: 'ssh:test-connection',
  },

  // Agent Skills
  SKILLS: {
    LIST: 'skills:list',
  },

  // Workspace Scripts
  SCRIPTS: {
    LIST: 'scripts:list',
    CREATE: 'scripts:create',
    UPDATE: 'scripts:update',
    REMOVE: 'scripts:remove',
    START: 'scripts:start',
    STOP: 'scripts:stop',
    RESTART: 'scripts:restart',
    GET_STATUS: 'scripts:get-status',
    GET_OUTPUT: 'scripts:get-output',
    DETECT: 'scripts:detect',
    SAVE_TO_REPO: 'scripts:save-to-repo',
  },
} as const;

// Event channels that are sent from main to renderer
export const EVENT_CHANNELS = [
  'event:workspace:created',
  'event:workspace:updated',
  'event:workspace:deleted',
  'workspace:clone-progress',
  'event:file:changed',
  'event:agent:started',
  'event:agent:stopped',
  'event:agent:message',
  'event:terminal:execute',
  'event:agent:scroll-to-turn',
  'exchange:update',
  'exchange:autonomous',
  'workspace:created',
  'workspace:updated',
  'workspace:deleted',
  'workspace:changes',
  'workspace:file-changes',
  'workspace:metadata-changed',
  'workspace:background-enrichment-complete',
  'file:changed',
  'file:created',
  'file:deleted',
  'file:renamed',
  'file:content-changed',
  'note:created',
  'note:updated',
  'note:deleted',
  'note:content-changed',
  'note-suggestion',
  'task:status-changed',
  'task:ready-tasks-changed',
  'directory:created',
  'directory:deleted',
  'directory:renamed',
  'agent:started',
  'agent:stopped',
  'agent:created',
  'agent:deleted',
  'agent:renamed',
  'agent:status', // Agent status changed (idle, responding, etc.)
  'agent:idle', // Agent entered idle state
  'agent:status-changed', // Agent status changed event
  'agent:loaded', // Agent loaded from persistence
  'agent:message',
  'agent:chunk',
  'agent:session:recovered',
  'agent:session-updated', // Agent session status changed
  'agent:session-completed', // Agent session completed
  'agent:subscribed', // Agent subscribed to workspace events
  'agent:unsubscribed', // Agent unsubscribed from workspace events
  'agent:woken-by-subscription', // Agent woken from idle by subscription event
  'agent:subscriptions-changed', // Agent subscription registry changed (hint for renderer refetch)
  'agent:subscriptions-restored', // Persisted subscriptions restored on startup
  'agent:event-delivery-failed', // Event delivery to agent failed after retries
  'agent:event-delivery-timeout', // Event delivery to agent timed out
  'agent:queue:updated',
  'agent:queue:processing',
  'agent:queue:processing-cancelled',
  'agent:message:error',
  // NOTE: 'agent:message:chunk' removed - legacy channel, all streaming uses session-specific channels
  'agent:message:received',
  'agent:message:content-blocks',
  'agent:prepare-handler', // Backend requests frontend to prepare stream handler
  'agent:handler-ready', // Frontend signals stream handler is ready
  'agent:stream-starting', // Backend notifies frontend a stream is about to start (safety net for handler registration)
  'health:check', // Health check metrics from backend
  'deep-link',
  'workspace-changes',
  'terminal:created',
  'terminal:data',
  'terminal:exit',
  'terminal:professional:data',
  'terminal:professional:exit',
  'terminal:professional:error',
  'terminal:professional:command:start',
  'terminal:professional:command:finished',
  'terminal:professional:command:executed',
  'terminal:professional:cwd:changed',
  'terminal:disposed', // Terminal disposed event (from workspace cleanup)
  'events:new',
  'events:cleared',
  'observability:event',
  'permission:event',
  'app:ready',
  'window:ready',
  'window:focus',
  'window:blur',
  'window:fullscreen',
  'window:zoom-changed',
  'navigate-to-settings', // Navigation to settings from menu
  'git:status-changed',
  'file-tracking:listener-ready',
  'file-tracking:changes-updated',
  'file-tracking:agent-file-changed',
  'line-attribution:updated',
  'setup-scripts:stream-chunk',
  'setup-scripts:stream-complete',
  'setup-scripts:stream-error',
  'background-agent:spawned', // Background agent spawned notification for toast
  'git:auth-required', // Git authentication required notification
  'git:keychain-access-warning', // Keychain access warning before network operations
  // Auto-commit domain events (main → renderer)
  'git:auto-commit-started',
  'git:auto-commit-succeeded',
  'git:auto-commit-hook-failure',
  // Background git operations events (main → renderer)
  'git:op-started',
  'git:op-progress',
  'git:op-completed',
  'git:op-failed',
  'github:auth-required', // GitHub OAuth authentication required notification
  'agent:auth-required', // Agent/auggie authentication required notification (for remote environments)
  'agent:remote-error', // Agent remote environment error notification
  'agent:plan-required', // Agent plan upgrade required notification (enterprise users without Intent access)
  'notification:show', // Notification shown event for sound playback in renderer
  'notification:navigate', // Notification click navigates to workspace
  // Auto-update events
  'auto-update:status-changed',
  'auto-update:progress',
  'auto-update:error',
  'auto-update:show-toast',
  'auto-update:up-to-date',
  // Picture-in-Picture events
  'pip:opened',
  'pip:closed',
  // Navigation events from main process (e.g., menu items)
  'navigate',
  // Reload request from main process menu (Cmd+R) - allows browser panels to handle refresh
  'app:reload-request',
  // Menu events for tab management
  'menu:new-agent',
  'menu:new-note',
  'menu:new-terminal',
  'menu:new-browser',
  'menu:close-tab',
  'menu:reopen-closed-tab',
  'menu:select-previous-tab',
  'menu:select-next-tab',
  // Zoom events - sent from main process when browser panel is focused
  // so the renderer can route zoom to the active webview
  'menu:zoom-in',
  'menu:zoom-out',
  'menu:reset-zoom',
  // Browser tab focus request from main process (CDP agent wants to focus a tab)
  'browser:focus-tab',
  // Browser tab list request from main process (CDP agent wants to list all browser tabs)
  'browser:list-tabs-request',
  // Browser tab open request from main process (agent wants to open a browser tab)
  'browser:open-tab',
  // MCP server error events (main → renderer)
  'mcp:server-error',
  // Analytics bridge (main → renderer)
  'analytics:track-from-main',
  // Script events (main → renderer)
  'script:started',
  'script:stopped',
  'script:output',
  'script:error',
  'script:url-detected',
  // Specialist file watcher events (main → renderer)
  'specialists:files-changed',
] as const;

// Dynamic channel patterns that use runtime IDs
export const DYNAMIC_CHANNEL_PATTERNS = [
  'agent:stream:',
  'agent-stream-',
  'auggie:stream:',
  'terminal:output:',
  'terminal:close:',
  'terminal:error:',
  'terminal:exit:',
  'terminal:professional:exit:',
  'note:content-changed:',
  'note:deleted:',
  'directory:created:',
  'file:content-changed:',
  'file:deleted:',
  'workspace:file-changes:',
  'workspace:metadata-changed:',
  'agent:session:',
  'events:',
] as const;

export type ElectronEventName = (typeof EVENT_CHANNELS)[number];
export type DynamicElectronEventName = `${(typeof DYNAMIC_CHANNEL_PATTERNS)[number]}${string}`;

// Helper function to get all static channels
export function getAllChannels(): string[] {
  const channels: string[] = [];

  function extractChannels(obj: any) {
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === 'string') {
        channels.push(value);
      } else if (typeof value === 'object' && value !== null) {
        extractChannels(value);
      }
    }
  }

  extractChannels(IPC_CHANNELS);
  return channels;
}

// Get all allowed channels (static + event channels)
export function getAllowedChannels(): string[] {
  return [...getAllChannels(), ...EVENT_CHANNELS];
}

// Check if a channel is dynamic
export function isDynamicChannel(channel: string): boolean {
  return DYNAMIC_CHANNEL_PATTERNS.some((pattern) => channel.startsWith(pattern));
}
