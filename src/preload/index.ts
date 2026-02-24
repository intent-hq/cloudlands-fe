/**
 * Preload Script
 *
 * Clean, secure bridge between renderer and main process.
 * Uses contextBridge for security.
 *
 * Note: Sentry is NOT initialized here. The preload runs in a special isolated context
 * that is not compatible with @sentry/electron/renderer. Errors in the main process
 * are captured by Sentry in src/main/index.ts, and renderer errors are captured
 * by Sentry in the renderer process initialization.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';



// ============================================
// GENERATED IPC CHANNELS - DO NOT EDIT MANUALLY
// Run 'npm run generate:ipc-channels' to regenerate
// ============================================

// All static IPC channels that are allowed
const ALLOWED_CHANNELS = [
  "workspace:list",
  "workspace:create",
  "workspace:get",
  "workspace:get-by-id",
  "workspace:get-root",
  "workspace:open",
  "workspace:close",
  "workspace:save",
  "workspace:update",
  "workspace:delete",
  "workspace:activate",
  "workspace:archive",
  "workspace:unarchive",
  "workspace:cleanup",
  "workspace:purge",
  "workspace:duplicate",
  "workspace:rename",
  "workspace:export",
  "workspace:import",
  "workspace:get-metadata",
  "workspace:update-metadata",
  "workspace:get-recent",
  "workspace:clear-recent",
  "workspace:get-stats",
  "workspace:validate",
  "workspace:repair",
  "workspace:backup",
  "workspace:restore",
  "workspace:get-settings",
  "workspace:update-settings",
  "workspace:trigger-check",
  "workspace:list-files",
  "workspace:test-watcher",
  "workspace:find-repositories",
  "workspace:update-spec-watcher-timestamp",
  "workspace:update-current-context",
  "workspace:search-in-files",
  "workspace:get-recent-repositories",
  "workspace:add-recent-repository",
  "workspace:clear-recent-repositories",
  "workspace:update_git_info",
  "workspace:getSettings",
  "workspace:updateSettings",
  "workspace:load-rules",
  "workspace:rename-branch",
  "workspace:get-hover-status",
  "agent:load-initial-config",
  "agent:available",
  "agent:resume",
  "agent:cleanup",
  "agent:get-user-rules",
  "agent:get-specialization-rules",
  "agent:get-active-streams",
  "agent:lifecycle:start",
  "agent:lifecycle:stop",
  "agent:messaging:send",
  "agent:messaging:receive",
  "agent:track-started",
  "agent:track-completed",
  "agent:track-error",
  "agent:create",
  "agent:activate",
  "agent:send-message",
  "agent:stop",
  "agent:clear",
  "agent:send",
  "agent:get-session",
  "agent:list-sessions",
  "agent:update-session",
  "agent:delete-session",
  "agent:export-session",
  "agent:import-session",
  "agent:get-history",
  "agent:update-metadata",
  "agent:rename",
  "agent:fork-session",
  "agent:merge-sessions",
  "agent:get-stats",
  "agent:validate-session",
  "agent:repair-session",
  "agent:get-context",
  "agent:update-context",
  "agent:context:update",
  "agent:context:getByWorkspace",
  "agent:context:getBySession",
  "agent:get-capabilities",
  "agent:set-capabilities",
  "agent:pause",
  "agent:get-status",
  "agent:set-priority",
  "agent:get-metrics",
  "agent:reset-metrics",
  "agent:get-logs",
  "agent:clear-logs",
  "agent:subscribe-updates",
  "agent:unsubscribe-updates",
  "agent:get-suggestions",
  "agent:apply-suggestion",
  "agent:get-completions",
  "agent:validate-input",
  "agent:format-output",
  "agent:get-shortcuts",
  "agent:add-shortcut",
  "agent:remove-shortcut",
  "agent:execute-shortcut",
  "agent:get-plugins",
  "agent:install-plugin",
  "agent:uninstall-plugin",
  "agent:enable-plugin",
  "agent:disable-plugin",
  "agent:get-plugin-settings",
  "agent:update-plugin-settings",
  "agent:execute-plugin-action",
  "agent:get-webhooks",
  "agent:add-webhook",
  "agent:remove-webhook",
  "agent:test-webhook",
  "agent:get-integrations",
  "agent:connect-integration",
  "agent:disconnect-integration",
  "agent:sync-integration",
  "agent:get-integration-status",
  "agent:get-integration-data",
  "agent:update-integration-settings",
  "agent:test-integration",
  "agent:get-workflows",
  "agent:create-workflow",
  "agent:update-workflow",
  "agent:delete-workflow",
  "agent:execute-workflow",
  "agent:pause-workflow",
  "agent:resume-workflow",
  "agent:cancel-workflow",
  "agent:get-workflow-status",
  "agent:get-workflow-history",
  "agent:export-workflow",
  "agent:import-workflow",
  "agent:validate-workflow",
  "agent:optimize-workflow",
  "agent:get-workflow-metrics",
  "agent:get-workflow-logs",
  "agent:clear-workflow-logs",
  "agent:schedule-workflow",
  "agent:unschedule-workflow",
  "agent:get-scheduled-workflows",
  "agent:get-workflow-triggers",
  "agent:add-workflow-trigger",
  "agent:remove-workflow-trigger",
  "agent:test-workflow-trigger",
  "agent:get-workflow-variables",
  "agent:set-workflow-variables",
  "agent:get-workflow-dependencies",
  "agent:resolve-workflow-dependencies",
  "agent:get-workflow-permissions",
  "agent:set-workflow-permissions",
  "agent:share-workflow",
  "agent:unshare-workflow",
  "agent:clone-workflow",
  "agent:merge-workflows",
  "agent:diff-workflows",
  "agent:get-workflow-versions",
  "agent:restore-workflow-version",
  "agent:tag-workflow-version",
  "agent:get-workflow-tags",
  "agent:remove-workflow-tag",
  "agent:set-model",
  "agent:enhance-prompt",
  "agent:generate-layout",
  "agent:persistence:save",
  "agent:persistence:load",
  "agent:persistence:delete",
  "agent:persistence:list",
  "agent:persistence:saveMessage",
  "agent:persistence:batch",
  "agent:persistence:metrics",
  "agent:persistence:clear",
  "events:query",
  "events:subscribe",
  "events:unsubscribe",
  "events:emit",
  "events:getLastEvent",
  "events:getStatistics",
  "events:get-agent-subscriptions",
  "events:unsubscribe-agent",
  "observability:collect-event",
  "observability:get-events",
  "observability:subscribe",
  "observability:get-session-summary",
  "observability:get-metrics",
  "observability:export",
  "observability:clear",
  "auggie:check-availability",
  "auggie:status",
  "auggie:install",
  "auggie:authenticate",
  "auggie:get-models",
  "auggie:get-config",
  "auggie:update-config",
  "auggie:get-latest-session",
  "auggie:extract-file-changes",
  "auggie:get-path",
  "auggie:get-user-info",
  "auggie:setup-mcp-claude-code",
  "auggie:setup-mcp-codex",
  "auggie:setup-mcp-opencode",
  "auggie:check-mcp-claude-code",
  "auggie:check-mcp-codex",
  "auggie:check-mcp-opencode",
  "auggie:uninstall-mcp-claude-code",
  "auggie:uninstall-mcp-codex",
  "auggie:uninstall-mcp-opencode",
  "auggie:setup-mcp-cortex",
  "auggie:check-mcp-cortex",
  "auggie:uninstall-mcp-cortex",
  "opencode:check-availability",
  "opencode:get-models",
  "claude-code:check-availability",
  "claude-code:get-models",
  "codex:check-availability",
  "codex:get-models",
  "cortex:check-availability",
  "cortex:get-models",
  "providers:get-availability",
  "providers:get-paths",
  "sources:create",
  "sources:list",
  "sources:get",
  "sources:add",
  "sources:remove",
  "sources:update",
  "sources:delete",
  "sources:refresh",
  "sources:extract-metadata",
  "file:read",
  "file:write",
  "file:delete",
  "file:exists",
  "file:list",
  "file:copy",
  "file:move",
  "file:get-info",
  "file:watch",
  "file:unwatch",
  "file:readDirWithStats",
  "file:getGitignorePatterns",
  "file:read-batch",
  "file:mkdir",
  "file:getGitStatus",
  "file:getTreeWithSizes",
  "file:getDirectoryStatus",
  "notes:list",
  "notes:create",
  "notes:get",
  "notes:update",
  "notes:delete",
  "notes:search",
  "notes:export",
  "notes:import",
  "notes:restore-spec",
  "notes:restore-version",
  "note:suggestion",
  "notes:mark-as-task",
  "notes:update-task-status",
  "notes:update-task-peer-order",
  "notes:remove-task-metadata",
  "notes:get-task-notes",
  "notes:get-dependents",
  "notes:create-prerequisite-note",
  "notes:assign-agent-to-task",
  "notes:find-next-task",
  "notes:find-ready-tasks",
  "notes:convert-task-blocks",
  "notes:flush-pending-version",
  "notes:batch-list",
  "assets:save",
  "assets:get",
  "assets:get-data-url",
  "assets:delete",
  "assets:list",
  "reference:resolve",
  "codebase:search",
  "terminal:runCommand",
  "terminal:killProcess",
  "terminal:subscribeOutput",
  "patch:apply",
  "patch:validate",
  "patch:revert",
  "agent:runAction",
  "system:get-info",
  "system:get-resources",
  "system:open-external",
  "system:show-item-in-folder",
  "system:beep",
  "system:home-directory",
  "system:workspace-root",
  "system:execute-command",
  "system:execute-command-streaming",
  "system:check-git",
  "app:set-badge",
  "app:version",
  "app:get-version",
  "app:name",
  "app:path",
  "app:root",
  "app:get-memory-usage",
  "app:trigger-memory-cleanup",
  "window:reload",
  "window:toggle-devtools",
  "window:minimize",
  "window:maximize",
  "window:close",
  "window:create",
  "window:open-new",
  "window:set-theme",
  "window:get-zoom-factor",
  "window:set-title",
  "window:set-in-workspace",
  "window:set-browser-focused",
  "terminal:createWithCommand",
  "terminal:professional:create",
  "terminal:professional:list",
  "terminal:professional:write",
  "terminal:professional:resize",
  "terminal:professional:info",
  "terminal:professional:refresh",
  "terminal:professional:dispose",
  "terminal:professional:get-buffer",
  "git:status",
  "git:status-changed",
  "git:auth-required",
  "git:keychain-access-warning",
  "git:keychain-consent-respond",
  "git:check-keychain-risk",
  "git:diff",
  "git:commit",
  "git:commit-details",
  "git:push",
  "git:pull",
  "git:branch",
  "git:checkout",
  "git:log",
  "git:history",
  "git:getBranches",
  "git:stage",
  "git:unstage",
  "git:stage-hunk",
  "git:unstage-hunk",
  "git:discard",
  "git:removeLock",
  "git:show-file",
  "git:file-history",
  "git:rename-branch",
  "git:pullBranch",
  "git:getBranchStatus",
  "git:getRemotes",
  "git:fetch",
  "config:get",
  "config:set",
  "config:delete",
  "config:get-all",
  "config:reset",
  "config:get-model",
  "config:get-all-models",
  "config:clear-cache",
  "config:invalidate",
  "config:get-stats",
  "settings:get",
  "settings:set",
  "settings:getAll",
  "settings:update",
  "feature-codes:activate",
  "feature-codes:get-active",
  "feature-codes:clear",
  "feature-codes:deactivate",
  "feature-codes:restart-app",
  "user-mcp:get-settings-file",
  "user-mcp:write-settings-file",
  "user-mcp:get-settings-path",
  "user-mcp:get-servers",
  "user-mcp:get-workspace-disabled",
  "user-mcp:set-workspace-disabled",
  "user-mcp:check-auth",
  "user-mcp:test-connection",
  "user-mcp:initiate-oauth",
  "user-mcp:mcp-list",
  "user-mcp:mcp-add",
  "user-mcp:mcp-remove",
  "notification:test",
  "notification:requestPermission",
  "notification:show",
  "permission:request",
  "permission:respond",
  "permission:event",
  "permission:get-pending",
  "dialog:open",
  "dialog:save",
  "dialog:openFile",
  "dialog:openDirectory",
  "dialog:saveFile",
  "dialog:showMessage",
  "dialog:showError",
  "dialog:message",
  "shell:open",
  "shell:openPath",
  "shell:openExternal",
  "shell:trashItem",
  "shell:showItemInFolder",
  "shell:install-cli",
  "comments:create",
  "comments:list",
  "comments:update",
  "comments:delete",
  "comments:add",
  "comments:suggest-change",
  "comments:update-status",
  "editor:get-selection",
  "editor:get-active-file",
  "editor:open-file",
  "editor:close-file",
  "external-editors:detect-installed",
  "external-editors:open",
  "external-editors:open-with-other",
  "first-visit-state:load",
  "first-visit-state:save",
  "first-visit-state:delete",
  "first-visit-state:exists",
  "panel-layout:load",
  "panel-layout:save",
  "browser:register-tab",
  "browser:unregister-tab",
  "browser:exec",
  "browser:focus-tab",
  "browser:list-tabs-request",
  "browser:list-tabs-response",
  "browser:open-tab",
  "file-tracking:init",
  "file-tracking:load",
  "file-tracking:load-commits",
  "file-tracking:load-older-commits",
  "file-tracking:sync",
  "file-tracking:clear",
  "file-tracking:get-changes",
  "file-tracking:get-status",
  "file-tracking:get-line-stats",
  "file-tracking:refresh",
  "file-tracking:track-change",
  "file-tracking:stage-changes",
  "file-tracking:unstage-changes",
  "file-tracking:load-transitions",
  "file-tracking:agent-file-changed",
  "persistence:save",
  "persistence:load",
  "persistence:delete",
  "persistence:exists",
  "persistence:load-agent-config",
  "persistence:save-agent-config",
  "persistence:load-session",
  "persistence:save-session",
  "persistence:save-registry",
  "persistence:load-registry",
  "streaming:start",
  "streaming:stop",
  "streaming:pause",
  "streaming:resume",
  "streaming:get-stats",
  "agent-config:get",
  "agent-config:update",
  "agent-config:reset",
  "log:track-file-change",
  "log:track-agent-event",
  "log:track-mcp-call",
  "log:get-events",
  "log:clear-events",
  "log:events-updated",
  "log:paths",
  "log:read",
  "log:clear",
  "log:summary",
  "log:export-debug-bundle",
  "log:persist-renderer-logs",
  "activity-log:get-entries",
  "activity-log:add-entry",
  "activity-log:clear",
  "user-rules:get",
  "user-rules:set",
  "user-rules:delete",
  "user-rules:get-all",
  "user-rules:get-formatted",
  "user-rules:set-enabled",
  "user-rules:export",
  "user-rules:import",
  "user-rules:get-combined-prompt",
  "user-rules:update",
  "user-rules:get-by-type",
  "user-rules:get-formatted-by-type",
  "user-rules:update-by-type",
  "user-rules:set-enabled-by-type",
  "user-rules:delete-by-type",
  "user-rules:export-by-type",
  "vscode:open",
  "vscode:openFile",
  "vscode:open-diff",
  "vscode:open-git-diff",
  "jetbrains:open",
  "xcode:open",
  "deep-link:handle",
  "get_home_directory",
  "rules:list",
  "rules:load-workspace",
  "rules:get-context",
  "specialists:list-files",
  "specialists:list-bundled",
  "specialists:list-all",
  "specialists:read-file",
  "specialists:write-file",
  "specialists:delete-file",
  "specialists:open-folder",
  "specialists:get-folder-path",
  "specialists:export-builtin",
  "specialists:file-exists",
  "config:getAll",
  "repo-config:read",
  "repo-config:write",
  "repo-config:has-config",
  "repo-config:ensure-intent-dir",
  "memories:list",
  "memories:get",
  "memories:create",
  "memories:update",
  "memories:delete",
  "memories:search",
  "memories:get-context",
  "user-activity:mark-note-read",
  "user-activity:get-note-read-status",
  "user-activity:get-unread-note-ids",
  "editor:open",
  "editor:save",
  "editor:settings",
  "diffs:list",
  "diffs:create",
  "diffs:update",
  "diffs:get",
  "line-changes:get-workspace-stats",
  "line-changes:get-all-workspace-stats",
  "line-changes:get-agent-stats",
  "line-changes:calculate-diff",
  "line-changes:update-workspace-stats",
  "line-changes:update-agent-stats",
  "line-changes:clear-workspace-stats",
  "line-changes:clear-agent-stats",
  "changes:mark-agent-active",
  "changes:get-current",
  "changes:start-agent-execution",
  "changes:stop-agent-execution",
  "changes:mark-agent-modified-files",
  "line-attribution:load",
  "line-attribution:updated",
  "line-attribution:compute-now",
  "file-attribution:record-agent-write",
  "file-attribution:read-file-and-record",
  "git-tracking:get-state",
  "git-tracking:get-sync-status",
  "git-tracking:sync",
  "git-tracking:get-file-diff",
  "git-tracking:is-github-authenticated",
  "git-tracking:get-github-branches",
  "git-tracking:get-pull-requests",
  "git-tracking:search-pull-requests",
  "git-tracking:get-pull-request",
  "git-tracking:create-pull-request",
  "git-tracking:get-github-issues",
  "git-tracking:search-github-issues",
  "git-tracking:get-remote-url",
  "github-auth:is-authenticated",
  "github-auth:get-user",
  "github-auth:start",
  "github-auth:poll",
  "github-auth:cancel",
  "github-auth:logout",
  "github-auth:get-auth-state",
  "github-auth:get-status",
  "linear-auth:is-authenticated",
  "linear-auth:start-auth",
  "linear-auth:cancel-auth",
  "linear-auth:logout",
  "linear-auth:get-auth-state",
  "linear-auth:get-status",
  "linear-auth:fetch-my-issues",
  "linear-auth:search-issues",
  "sentry-auth:is-authenticated",
  "sentry-auth:save-config",
  "sentry-auth:get-auth-state",
  "sentry-auth:logout",
  "sentry-auth:fetch-projects",
  "sentry-auth:fetch-issues",
  "sentry-auth:search-issues",
  "sentry-auth:get-issue",
  "mcp:event",
  "mcp:transition-workspace",
  "mcp:call-tool",
  "mcp:list-tools",
  "mcp:create-server",
  "mcp:get-status",
  "agent-testing:run",
  "agent-testing:get-report",
  "agent-testing:get-agent-reports",
  "agent-testing:cleanup",
  "remote-fs:initialize",
  "remote-fs:readFile",
  "remote-fs:writeFile",
  "remote-fs:appendFile",
  "remote-fs:deleteFile",
  "remote-fs:readdir",
  "remote-fs:mkdir",
  "remote-fs:rmdir",
  "remote-fs:exists",
  "remote-fs:stat",
  "remote-fs:copy",
  "remote-fs:move",
  "remote-fs:find",
  "remote-fs:grep",
  "remote-fs:disconnect",
  "remote-fs:status",
  "remote-fs:clearCache",
  "testing:run-tests",
  "testing:run-lint",
  "testing:run-build",
  "testing:stop-process",
  "testing:get-processes",
  "debug:trigger-backend-resume",
  "debug:list-agents",
  "setup-scripts:generate",
  "setup-scripts:detect-type",
  "setup-scripts:generate-with-agent",
  "setup-scripts:stop-agent",
  "setup-scripts:stream-chunk",
  "setup-scripts:stream-complete",
  "setup-scripts:stream-error",
  "git:isRepository",
  "git:get-auto-commit-status",
  "git:background-ops-status",
  "accept-changes:get-status",
  "accept-changes:prepare",
  "accept-changes:execute",
  "accept-changes:export",
  "accept-changes:check-path-has-changes",
  "accept-changes:add-remote",
  "accept-changes:merge-pr",
  "export:chat-to-html",
  "agent-context:get",
  "recovery:needs-recovery",
  "recovery:mark-streaming",
  "recovery:mark-complete",
  "recovery:clear-streaming",
  "recovery:check-needs-recovery",
  "recovery:get-status",
  "recovery:create-checkpoint",
  "recovery:restore-checkpoint",
  "recovery:recover-session",
  "recovery:get-stats",
  "agent:backend:create",
  "agent:backend:stream-message",
  "agent:backend:get-status",
  "agent:backend:cancel-stream",
  "agent:backend:stop",
  "agent:backend:get",
  "agent:backend:list",
  "agent:backend:delete",
  "agent:backend:isActive",
  "agent:backend:resume",
  "agent:backend:check-process",
  "agent:backend:reconnect",
  "agent:backend:resume-stream",
  "agent:backend:get-checkpoint",
  "agent:backend:queue-message",
  "agent:backend:edit-queued",
  "agent:backend:remove-queued",
  "agent:backend:get-queue",
  "storage:save",
  "storage:delete",
  "sandbox:get-agent-rules",
  "auto-update:check",
  "auto-update:check-manual",
  "auto-update:download",
  "auto-update:install",
  "auto-update:get-state",
  "auto-update:set-channel",
  "auto-update:status-changed",
  "auto-update:progress",
  "auto-update:error",
  "auto-update:up-to-date",
  "auto-update:show-toast",
  "sentry:get-config",
  "analytics:get-config",
  "pip:open",
  "pip:close",
  "pip:close-all-for-workspace",
  "ssh:get-config-hosts",
  "ssh:list-keys",
  "ssh:get-agent-status",
  "ssh:test-connection",
  "event:workspace:created",
  "event:workspace:updated",
  "event:workspace:deleted",
  "workspace:clone-progress",
  "event:file:changed",
  "event:agent:started",
  "event:agent:stopped",
  "event:agent:message",
  "event:terminal:execute",
  "event:agent:scroll-to-turn",
  "exchange:update",
  "exchange:autonomous",
  "workspace:created",
  "workspace:updated",
  "workspace:deleted",
  "workspace:changes",
  "workspace:file-changes",
  "workspace:metadata-changed",
  "file:changed",
  "file:created",
  "file:deleted",
  "file:renamed",
  "file:content-changed",
  "note:created",
  "note:updated",
  "note:deleted",
  "note:content-changed",
  "note-suggestion",
  "task:status-changed",
  "task:ready-tasks-changed",
  "directory:created",
  "directory:deleted",
  "directory:renamed",
  "agent:started",
  "agent:stopped",
  "agent:created",
  "agent:deleted",
  "agent:renamed",
  "agent:status",
  "agent:idle",
  "agent:status-changed",
  "agent:loaded",
  "agent:message",
  "agent:chunk",
  "agent:session:recovered",
  "agent:session-updated",
  "agent:session-completed",
  "agent:subscribed",
  "agent:unsubscribed",
  "agent:woken-by-subscription",
  "agent:subscriptions-changed",
  "agent:subscriptions-restored",
  "agent:event-delivery-failed",
  "agent:event-delivery-timeout",
  "agent:queue:updated",
  "agent:queue:processing",
  "agent:queue:processing-cancelled",
  "agent:message:error",
  "agent:message:received",
  "agent:message:content-blocks",
  "agent:prepare-handler",
  "agent:handler-ready",
  "agent:stream-starting",
  "health:check",
  "deep-link",
  "workspace-changes",
  "terminal:created",
  "terminal:data",
  "terminal:exit",
  "terminal:professional:data",
  "terminal:professional:exit",
  "terminal:professional:error",
  "terminal:professional:command:start",
  "terminal:professional:command:finished",
  "terminal:professional:command:executed",
  "terminal:professional:cwd:changed",
  "terminal:disposed",
  "events:new",
  "events:cleared",
  "observability:event",
  "app:ready",
  "window:ready",
  "window:focus",
  "window:blur",
  "window:fullscreen",
  "window:zoom-changed",
  "navigate-to-settings",
  "file-tracking:listener-ready",
  "file-tracking:changes-updated",
  "setup-scripts:stream-chunk",
  "setup-scripts:stream-complete",
  "setup-scripts:stream-error",
  "background-agent:spawned",
  "git:auth-required",
  "git:keychain-access-warning",
  "git:auto-commit-started",
  "git:auto-commit-succeeded",
  "git:auto-commit-hook-failure",
  "git:op-started",
  "git:op-progress",
  "git:op-completed",
  "git:op-failed",
  "github:auth-required",
  "agent:auth-required",
  "agent:remote-error",
  "agent:plan-required",
  "notification:show",
  "auto-update:status-changed",
  "auto-update:progress",
  "auto-update:error",
  "auto-update:show-toast",
  "auto-update:up-to-date",
  "pip:opened",
  "pip:closed",
  "navigate",
  "app:reload-request",
  "menu:new-agent",
  "menu:new-note",
  "menu:new-terminal",
  "menu:new-browser",
  "menu:close-tab",
  "menu:reopen-closed-tab",
  "menu:select-previous-tab",
  "menu:select-next-tab",
  "menu:zoom-in",
  "menu:zoom-out",
  "menu:reset-zoom",
  "browser:focus-tab",
  "browser:list-tabs-request",
  "browser:open-tab"
];

// Dynamic channel patterns that are matched with startsWith()
const DYNAMIC_CHANNEL_PATTERNS = [
  "agent:stream:",
  "agent-stream-",
  "auggie:stream:",
  "terminal:output:",
  "terminal:close:",
  "terminal:error:",
  "terminal:exit:",
  "terminal:professional:exit:",
  "note:content-changed:",
  "note:deleted:",
  "directory:created:",
  "file:content-changed:",
  "file:deleted:",
  "workspace:file-changes:",
  "workspace:metadata-changed:",
  "agent:session:",
  "events:"
];

// Event channels for IPC renderer on() listeners
const EVENT_CHANNELS = [
  "event:workspace:created",
  "event:workspace:updated",
  "event:workspace:deleted",
  "workspace:clone-progress",
  "event:file:changed",
  "event:agent:started",
  "event:agent:stopped",
  "event:agent:message",
  "event:terminal:execute",
  "event:agent:scroll-to-turn",
  "exchange:update",
  "exchange:autonomous",
  "workspace:created",
  "workspace:updated",
  "workspace:deleted",
  "workspace:changes",
  "workspace:file-changes",
  "workspace:metadata-changed",
  "file:changed",
  "file:created",
  "file:deleted",
  "file:renamed",
  "file:content-changed",
  "note:created",
  "note:updated",
  "note:deleted",
  "note:content-changed",
  "note-suggestion",
  "task:status-changed",
  "task:ready-tasks-changed",
  "directory:created",
  "directory:deleted",
  "directory:renamed",
  "agent:started",
  "agent:stopped",
  "agent:created",
  "agent:deleted",
  "agent:renamed",
  "agent:status",
  "agent:idle",
  "agent:status-changed",
  "agent:loaded",
  "agent:message",
  "agent:chunk",
  "agent:session:recovered",
  "agent:session-updated",
  "agent:session-completed",
  "agent:subscribed",
  "agent:unsubscribed",
  "agent:woken-by-subscription",
  "agent:subscriptions-changed",
  "agent:subscriptions-restored",
  "agent:event-delivery-failed",
  "agent:event-delivery-timeout",
  "agent:queue:updated",
  "agent:queue:processing",
  "agent:queue:processing-cancelled",
  "agent:message:error",
  "agent:message:received",
  "agent:message:content-blocks",
  "agent:prepare-handler",
  "agent:handler-ready",
  "agent:stream-starting",
  "health:check",
  "deep-link",
  "workspace-changes",
  "terminal:created",
  "terminal:data",
  "terminal:exit",
  "terminal:professional:data",
  "terminal:professional:exit",
  "terminal:professional:error",
  "terminal:professional:command:start",
  "terminal:professional:command:finished",
  "terminal:professional:command:executed",
  "terminal:professional:cwd:changed",
  "terminal:disposed",
  "events:new",
  "events:cleared",
  "observability:event",
  "app:ready",
  "window:ready",
  "window:focus",
  "window:blur",
  "window:fullscreen",
  "window:zoom-changed",
  "navigate-to-settings",
  "file-tracking:listener-ready",
  "file-tracking:changes-updated",
  "setup-scripts:stream-chunk",
  "setup-scripts:stream-complete",
  "setup-scripts:stream-error",
  "background-agent:spawned",
  "git:auth-required",
  "git:keychain-access-warning",
  "git:auto-commit-started",
  "git:auto-commit-succeeded",
  "git:auto-commit-hook-failure",
  "git:op-started",
  "git:op-progress",
  "git:op-completed",
  "git:op-failed",
  "github:auth-required",
  "agent:auth-required",
  "agent:remote-error",
  "agent:plan-required",
  "notification:show",
  "auto-update:status-changed",
  "auto-update:progress",
  "auto-update:error",
  "auto-update:show-toast",
  "auto-update:up-to-date",
  "pip:opened",
  "pip:closed",
  "navigate",
  "app:reload-request",
  "menu:new-agent",
  "menu:new-note",
  "menu:new-terminal",
  "menu:new-browser",
  "menu:close-tab",
  "menu:reopen-closed-tab",
  "menu:select-previous-tab",
  "menu:select-next-tab",
  "menu:zoom-in",
  "menu:zoom-out",
  "menu:reset-zoom",
  "browser:focus-tab",
  "browser:list-tabs-request",
  "browser:open-tab",
  "mcp:server-error"
];

/**
 * Check if a channel is allowed (either static, dynamic, or event)
 */
function isChannelAllowed(channel: string): boolean {
  return ALLOWED_CHANNELS.includes(channel) ||
         DYNAMIC_CHANNEL_PATTERNS.some(pattern => channel.startsWith(pattern)) ||
         EVENT_CHANNELS.includes(channel);
}

// ============================================
// END GENERATED IPC CHANNELS
// ============================================

// Note: Preload scripts run in a special context and cannot import from shared modules
// Console statements here are acceptable as they're for debugging the preload bridge

// Simple logger for preload context - can't import external modules
const logger = {
  info: (...args: any[]): void => console.log('[Preload]', ...args),
  warn: (...args: any[]): void => console.warn('[Preload]', ...args),
  error: (...args: any[]): void => console.error('[Preload]', ...args),
  debug: (...args: any[]): void => console.log('[Preload:Debug]', ...args),
};

// Track IPC listener wrappers for proper cleanup.
//
// IMPORTANT: under Electron context isolation, function identity across the bridge
// is unreliable. Prefer ID-based cleanup via offById().
type ListenerEntry = {
  id: string;
  original: (...args: any[]) => void;
  wrapped: (...args: any[]) => void;
};

// Maps channel -> listenerId -> { original callback reference, wrapped callback }
const listenerRegistry = new Map<string, Map<string, ListenerEntry>>();

let listenerIdCounter = 0;
function generateListenerId(): string {
  listenerIdCounter += 1;
  // Counter prevents collisions within the same millisecond.
  return `l${Date.now()}_${listenerIdCounter}`;
}

// Sentry config cache - populated via IPC from main process
let sentryConfigCache: { dsn?: string; environment?: string; release?: string } | null = null;

// Define the API exposed to the renderer
const electronAPI = {
  // Sentry configuration - fetched from main process via IPC
  // The main process has the env vars loaded via dotenv
  getSentryConfig: () => sentryConfigCache,

  // Async version that fetches from main process (call this on app init)
  fetchSentryConfig: async () => {
    if (sentryConfigCache) return sentryConfigCache;
    try {
      sentryConfigCache = await ipcRenderer.invoke('sentry:get-config');
      return sentryConfigCache;
    } catch (error) {
      console.warn('[Preload] Failed to fetch Sentry config:', error);
      return null;
    }
  },

  // IPC invoke (request/response)
  invoke: (channel: string, data?: any) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      // Pass data as-is to respect union schemas and other complex types
      // The validation middleware will handle type checking
      return ipcRenderer.invoke(channel, data).catch((err) => {
        logger.error(`[Preload] IPC invoke failed for ${channel}:`, err);
        throw err;
      });
    } else {
      const err = new Error(`Unauthorized channel: ${channel}`);
      logger.warn(`[Preload] Blocked IPC invoke on unauthorized channel: ${channel}`);
      return Promise.reject(err);
    }
  },

  // IPC send (one-way)
  send: (channel: string, ...args: any[]) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      logger.warn(`[Preload] Blocked IPC send on unauthorized channel: ${channel}`);
    }
  },

  // IPC on (listen for events from main)
  // Returns a unique listener ID for reliable cleanup with offById()
  on: (channel: string, callback: (...args: any[]) => void): string => {
    // Increase max listeners for dynamic channels (e.g., file:content-changed:uuid)
    // These channels are commonly used and shouldn't trigger memory warnings
    const dynamicPrefixes = ['file:content-changed:', 'agent:stream:', 'terminal:'];
    const isDynamicChannel = dynamicPrefixes.some((prefix) => channel.startsWith(prefix));
    if (isDynamicChannel) {
      ipcRenderer.setMaxListeners(50); // Higher limit for dynamic channels
    }

    // Use generated allowed channels (includes dynamic patterns)
    if (isChannelAllowed(channel)) {
      // Create a wrapper function that matches the IPC renderer signature
      const wrappedCallback = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
        try {
          // Ensure we have at least one argument, even if it's undefined
          // This prevents errors when handlers expect data but receive nothing
          if (args.length === 0) {
            callback({});
          } else if (args.length === 1) {
            // For single argument, pass it directly (most common case)
            callback(args[0]);
          } else {
            // For multiple arguments, pass them all
            callback(...args);
          }
        } catch (error) {
          logger.error(`[Preload] Error in event handler for ${channel}:`, error);
        }
      };

      const listenerId = generateListenerId();

      // Register the callback mapping for later removal
      if (!listenerRegistry.has(channel)) {
        listenerRegistry.set(channel, new Map());
      }
      listenerRegistry
        .get(channel)!
        .set(listenerId, { id: listenerId, original: callback, wrapped: wrappedCallback });

      // Attach wrapper reference to original callback for external access
      // This allows callers to retrieve the wrapped function via (callback as any).__ipcWrapper
      (callback as any).__ipcWrapper = wrappedCallback;
      (callback as any).__ipcListenerId = listenerId;

      ipcRenderer.on(channel, wrappedCallback);

      return listenerId;
    } else {
      logger.warn(`[Preload] Blocked IPC listener on unauthorized channel: ${channel}`);
      return '';
    }
  },

  // IPC off (remove listener)
  off: (channel: string, callback: (...args: any[]) => void) => {
    // Look up the wrapped callback from the registry
    const channelListeners = listenerRegistry.get(channel);
    if (channelListeners) {
      for (const [listenerId, entry] of channelListeners.entries()) {
        if (entry.original === callback) {
          ipcRenderer.removeListener(channel, entry.wrapped);
          channelListeners.delete(listenerId);
          // Clean up empty maps
          if (channelListeners.size === 0) {
            listenerRegistry.delete(channel);
          }
          return;
        }
      }
    }
    // Fallback: try removing with the original callback directly
    // (in case it was registered outside this API)
    logger.warn(
      `[Preload] Listener registry miss for channel ${channel} - callback not found in registry. This may indicate a listener leak.`,
    );
    ipcRenderer.removeListener(channel, callback);
  },

  // Remove listener by ID - reliable with Electron's context isolation
  offById: (channel: string, listenerId: string) => {
    if (!listenerId) return;

    if (!isChannelAllowed(channel)) {
      logger.warn(`[Preload] Blocked offById on unauthorized channel: ${channel}`);
      return;
    }

    const channelListeners = listenerRegistry.get(channel);
    const entry = channelListeners?.get(listenerId);
    if (entry) {
      ipcRenderer.removeListener(channel, entry.wrapped);
      channelListeners!.delete(listenerId);
      if (channelListeners!.size === 0) {
        listenerRegistry.delete(channel);
      }
      return;
    }

    // Listener not found - this is normal if removeAllListeners() was called first
    // (e.g., agent.service.ts cleans up stream channels with removeAllListeners,
    // then component cleanup calls offById). No warning needed.
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel: string) => {
    if (isChannelAllowed(channel)) {
      ipcRenderer.removeAllListeners(channel);
      // Also clean up our registry
      listenerRegistry.delete(channel);
    } else {
      logger.warn(`[Preload] Blocked removeAllListeners on unauthorized channel: ${channel}`);
    }
  },

  // IPC once (listen once)
  once: (channel: string, callback: (...args: any[]) => void) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    } else {
      logger.warn(`[Preload] Blocked IPC once on unauthorized channel: ${channel}`);
    }
  },

  // File utilities - get filesystem path for dropped/selected files
  // Uses Electron's webUtils.getPathForFile which works with contextIsolation
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // Platform info
  platform: process.platform,
  arch: process.arch,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for TypeScript
export type ElectronAPI = typeof electronAPI;

// Add type augmentation for window
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
