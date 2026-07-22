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
    // On-demand summaries (kept out of metadata payloads)
    GET_DIFF_SUMMARY: 'workspace:get-diff-summary',
    GET_GIT_SUMMARY: 'workspace:get-git-summary',
    GET_TASKS: 'workspace:get-tasks',
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
    TRACK_STARTED: 'agent:track-started',
    TRACK_COMPLETED: 'agent:track-completed',
    TRACK_ERROR: 'agent:track-error',
    CREATE: 'agent:create',
    CIRCUIT_BREAKER_RESET: 'agent:circuit-breaker:reset',
    SEND_MESSAGE: 'agent:send-message',
    STOP: 'agent:stop',
    SEND: 'agent:send',
    GET_SESSION: 'agent:get-session',
    LIST_SESSIONS: 'agent:list-sessions',
    DELETE_SESSION: 'agent:delete-session',
    RENAME: 'agent:rename',
    SET_PRIORITY: 'agent:set-priority',
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
    UNINSTALL_MCP_CLAUDE_CODE: 'auggie:uninstall-mcp-claude-code',
    UNINSTALL_MCP_CODEX: 'auggie:uninstall-mcp-codex',
    UNINSTALL_MCP_OPENCODE: 'auggie:uninstall-mcp-opencode',
    UNINSTALL_MCP_CORTEX: 'auggie:uninstall-mcp-cortex',
    UNINSTALL_MCP_PI: 'auggie:uninstall-mcp-pi',
    UNINSTALL_MCP_DROID: 'auggie:uninstall-mcp-droid',
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
    MANAGED_INSTALL_STATUS: 'codex/managed-install/status',
    MANAGED_INSTALL_PROGRESS: 'codex/managed-install/progress',
  },

  // Cortex Integration
  CORTEX: {
    CHECK_AVAILABILITY: 'cortex:check-availability',
    GET_MODELS: 'cortex:get-models',
  },

  // Pi Integration
  PI: {
    GET_MODELS: 'pi:get-models',
    CHECK_MCP_ADAPTER: 'pi:check-mcp-adapter',
    INSTALL_MCP_ADAPTER: 'pi:install-mcp-adapter',
  },

  // Factory Droid Integration
  DROID: {
    CHECK_AVAILABILITY: 'droid:check-availability',
    GET_MODELS: 'droid:get-models',
  },

  // Grok Build Integration
  GROK: {
    GET_MODELS: 'grok:get-models',
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
    READ_DIR_WITH_STATS: 'file:readDirWithStats',
    GET_GITIGNORE_PATTERNS: 'file:getGitignorePatterns',
    READ_BATCH: 'file:read-batch',
    MKDIR: 'file:mkdir',
    GET_GIT_STATUS: 'file:getGitStatus',
    GET_TREE_WITH_SIZES: 'file:getTreeWithSizes',
    GET_DIRECTORY_STATUS: 'file:getDirectoryStatus',
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
    WRITE_CLIPBOARD: 'system:write-clipboard',
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
    UI_NAVIGATE: 'app:ui:navigate',
    UI_HIGHLIGHT: 'app:ui:highlight',
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
    NUMSTAT: 'git:numstat',
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

  // User MCP Settings — HTTP/SSE server auth checks and OAuth flow.
  USER_MCP: {
    CHECK_AUTH: 'user-mcp:check-auth', // Check if URL requires auth and if we have credentials
    TEST_CONNECTION: 'user-mcp:test-connection', // Test connection to HTTP/SSE server, returns status
    INITIATE_OAUTH: 'user-mcp:initiate-oauth', // Start OAuth flow for MCP server
  },

  // Notifications
  NOTIFICATION: {
    TEST: 'notification:test',
    REQUEST_PERMISSION: 'notification:requestPermission',
    SHOW: 'notification:show',
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

  // Editor (browser text selection only)
  EDITOR: {
    GET_SELECTION: 'editor:get-selection',
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
    // Event emitted by agent file operations to trigger immediate UI update
    AGENT_FILE_CHANGED: 'file-tracking:agent-file-changed',
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

  // User Activity (note read tracking)
  USER_ACTIVITY: {
    MARK_NOTE_READ: 'user-activity:mark-note-read',
    GET_NOTE_READ_STATUS: 'user-activity:get-note-read-status',
    GET_UNREAD_NOTE_IDS: 'user-activity:get-unread-note-ids',
  },



  // Diffs
  DIFFS: {
    LIST: 'diffs:list',
    CREATE: 'diffs:create',
    UPDATE: 'diffs:update',
    GET: 'diffs:get',
  },

  // Line Attribution
  LINE_ATTRIBUTION: {
    UPDATED: 'line-attribution:updated',
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

  // GitHub Auth (via daemon API OAuth)
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

  // Linear Auth (via daemon API OAuth)
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



  // Debug (development only)
  DEBUG: {
    TRIGGER_BACKEND_RESUME: 'debug:trigger-backend-resume',
    LIST_AGENTS: 'debug:list-agents',
  },

  // Setup Scripts
  SETUP_SCRIPTS: {
    GENERATE: 'setup-scripts:generate',
    READ_REPO_CONFIG: 'setup-scripts:read-repo-config',
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

  // Accept Changes — the workflow itself (status/prepare/execute/merge-pr/
  // add-remote) is served by the intentd daemon over `backend:request`
  // (PROTOCOL.md §5.18); only the local filesystem probe stays on IPC.
  ACCEPT_CHANGES: {
    CHECK_PATH_HAS_CHANGES: 'accept-changes:check-path-has-changes',
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
    FORCE_MESSAGE: 'agent:backend:force-message',
  },

  // Storage
  STORAGE: {
    SAVE: 'storage:save',
    DELETE: 'storage:delete',
  },



  // Auto-Update
  AUTO_UPDATE: {
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

  // WebSocket API
  WEBSOCKET_API: {
    GET_STATUS: 'websocket-api:get-status',
    SET_ENABLED: 'websocket-api:set-enabled',
    REGENERATE_TOKEN: 'websocket-api:regenerate-token',
    SET_DISCOVERY: 'websocket-api:set-discovery',
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
  },

  // Workspace Token Usage (aggregated agent token consumption)
  TOKEN_USAGE: {
    GET: 'token-usage:get',
    CHANGED: 'token-usage:changed',
  },

  // Live backend transport (JSON-RPC 2.0 bridge to the intentd daemon).
  // The JSON-RPC client lives in the main process; the renderer reaches it
  // through these request/subscription channels and receives daemon
  // notifications on the BACKEND.NOTIFICATION event channel.
  BACKEND: {
    REQUEST: 'backend:request',
    SUBSCRIBE: 'backend:subscribe',
    UNSUBSCRIBE: 'backend:unsubscribe',
    GET_STATUS: 'backend:get-status',
    NOTIFICATION: 'backend:notification',
    STATUS: 'backend:status',
    SPAWN_SIDECAR: 'backend:spawn-sidecar',
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
  'workspace:archived',
  'workspace:changes',
  'workspace:file-changes',
  'workspace:metadata-changed',
  'workspace:tasks-changed',
  'workspace:background-enrichment-complete',
  'file:changed',
  'file:created',
  'file:deleted',
  'file:renamed',
  'file:content-changed',
  'watcher:file-changed',
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
  'agent:restored', // Compensating event when durable delete fails after agent:deleted broadcast
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
  'agent:circuit-breaker:status', // Circuit breaker state changed (open/half-open/closed) for a workspace
  'agent:message:error',
  // NOTE: 'agent:message:chunk' removed - legacy channel, all streaming uses session-specific channels
  'agent:message:received',
  'agent:user-message:sent',
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
  'codex/managed-install/status',
  'codex/managed-install/progress',
  'terminal:disposed', // Terminal disposed event (from workspace cleanup)
  'events:new',
  'events:cleared',
  'app:ready',
  'app:ui:navigate',
  'app:ui:highlight',
  'window:ready',
  'window:focus',
  'window:blur',
  'window:fullscreen',
  'window:zoom-changed',
  'navigate-to-settings', // Navigation to settings from menu
  'git:status-changed',
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
  'system:memory-pressure', // Memory pressure level transitioned (normal/warning/critical)
  'app:workspace-operation-requested', // App-level MCP workspace operation request (main → renderer saga)
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
  // Script events (main → renderer)
  'script:started',
  'script:stopped',
  'script:output',
  'script:error',
  'script:url-detected',
  // Specialist file watcher events (main → renderer)
  'specialists:files-changed',
  // WebSocket API events (main → renderer)
  'websocket-api:discovery-auto-disabled',
  // Workspace token usage changed (main → renderer)
  'token-usage:changed',
  // Live backend transport (main → renderer): daemon JSON-RPC notifications
  // and connection-status changes pushed from the main-process client.
  'backend:notification',
  'backend:status',
] as const;

// Dynamic channel patterns that use runtime IDs
export const DYNAMIC_CHANNEL_PATTERNS = [
  'agent:stream:',
  'auggie:stream:',
  'terminal:output:',
  'terminal:close:',
  'terminal:error:',
  'terminal:exit:',
  'terminal:professional:exit:',
  'note:content-changed:',
  'note:deleted:',
  'directory:created:',
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
