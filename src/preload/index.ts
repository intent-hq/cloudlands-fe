/**
 * Preload Script
 *
 * Clean, secure bridge between renderer and main process.
 * Uses contextBridge for security.
 */

import {
  contextBridge,
  ipcRenderer,
  webUtils,
} from 'electron';



// ============================================
// GENERATED IPC CHANNELS - DO NOT EDIT MANUALLY
// Run 'npm run generate:ipc-channels' to regenerate
// ============================================

// All static IPC channels that are allowed
const ALLOWED_CHANNELS = [
  "workspace:list",
  "workspace:create",
  "workspace:get",
  "workspace:get-current",
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
  "workspace:remove-recent-repository",
  "workspace:update_git_info",
  "workspace:getSettings",
  "workspace:updateSettings",
  "workspace:load-rules",
  "workspace:rename-branch",
  "workspace:get-hover-status",
  "workspace:get-diff-summary",
  "workspace:get-git-summary",
  "workspace:get-tasks",
  "agent:load-initial-config",
  "agent:available",
  "agent:resume",
  "agent:cleanup",
  "agent:get-user-rules",
  "agent:get-specialization-rules",
  "agent:get-active-streams",
  "agent:track-started",
  "agent:track-completed",
  "agent:track-error",
  "agent:create",
  "agent:circuit-breaker:reset",
  "agent:send-message",
  "agent:stop",
  "agent:send",
  "agent:get-session",
  "agent:list-sessions",
  "agent:delete-session",
  "agent:rename",
  "agent:set-priority",
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
  "events:query",
  "events:subscribe",
  "events:unsubscribe",
  "events:emit",
  "events:getLastEvent",
  "events:getStatistics",
  "events:get-agent-subscriptions",
  "events:unsubscribe-agent",
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
  "auggie:uninstall-mcp-claude-code",
  "auggie:uninstall-mcp-codex",
  "auggie:uninstall-mcp-opencode",
  "auggie:uninstall-mcp-cortex",
  "auggie:uninstall-mcp-pi",
  "auggie:uninstall-mcp-droid",
  "opencode:check-availability",
  "opencode:get-models",
  "claude-code:check-availability",
  "claude-code:get-models",
  "codex:check-availability",
  "codex:get-models",
  "codex/managed-install/status",
  "codex/managed-install/progress",
  "cortex:check-availability",
  "cortex:get-models",
  "pi:get-models",
  "pi:check-mcp-adapter",
  "pi:install-mcp-adapter",
  "droid:check-availability",
  "droid:get-models",
  "grok:get-models",
  "unsloth:get-models",
  "providers:get-availability",
  "providers:get-paths",
  "providers:check-single",
  "file:read",
  "file:write",
  "file:delete",
  "file:exists",
  "file:list",
  "file:copy",
  "file:move",
  "file:get-info",
  "file:readDirWithStats",
  "file:getGitignorePatterns",
  "file:read-batch",
  "file:mkdir",
  "file:getGitStatus",
  "file:getTreeWithSizes",
  "file:getDirectoryStatus",
  "codebase:search",
  "terminal:runCommand",
  "terminal:killProcess",
  "terminal:subscribeOutput",
  "agent:runAction",
  "system:get-info",
  "system:get-resources",
  "system:open-external",
  "system:show-item-in-folder",
  "system:write-clipboard",
  "system:beep",
  "system:home-directory",
  "system:workspace-root",
  "system:execute-command",
  "system:execute-command-streaming",
  "system:check-git",
  "system:check-node",
  "system:check-rtk",
  "system:list-fonts",
  "app:set-badge",
  "app:set-language-preference",
  "app:version",
  "app:get-version",
  "app:name",
  "app:path",
  "app:root",
  "app:ui:navigate",
  "app:ui:highlight",
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
  "window:set-open-workspace-tabs",
  "window:set-browser-focused",
  "window:set-full-screen",
  "window:get-full-screen",
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
  "git:numstat",
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
  "settings:get",
  "settings:set",
  "settings:getAll",
  "settings:update",
  "feature-codes:activate",
  "feature-codes:get-active",
  "feature-codes:clear",
  "feature-codes:deactivate",
  "feature-codes:restart-app",
  "user-mcp:check-auth",
  "user-mcp:test-connection",
  "notification:test",
  "notification:requestPermission",
  "notification:show",
  "dialog:message",
  "dialog:open",
  "shell:open",
  "shell:openPath",
  "shell:openExternal",
  "shell:trashItem",
  "shell:showItemInFolder",
  "editor:get-selection",
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
  "file-tracking:agent-file-changed",
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
  "user-activity:mark-note-read",
  "user-activity:get-note-read-status",
  "user-activity:get-unread-note-ids",
  "diffs:list",
  "diffs:create",
  "diffs:update",
  "diffs:get",
  "line-attribution:updated",
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
  "git-tracking:get-check-runs",
  "git-tracking:get-pr-reviews",
  "github-auth:is-authenticated",
  "github-auth:get-user",
  "github-auth:start",
  "github-auth:poll",
  "github-auth:cancel",
  "github-auth:logout",
  "github-auth:get-auth-state",
  "github-auth:get-status",
  "github-auth:list-repos",
  "github-auth:search-repos",
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
  "agent-testing:run",
  "agent-testing:get-report",
  "agent-testing:get-agent-reports",
  "agent-testing:cleanup",
  "debug:trigger-backend-resume",
  "debug:list-agents",
  "setup-scripts:generate",
  "setup-scripts:read-repo-config",
  "setup-scripts:detect-type",
  "setup-scripts:generate-with-agent",
  "setup-scripts:stop-agent",
  "setup-scripts:stream-chunk",
  "setup-scripts:stream-complete",
  "setup-scripts:stream-error",
  "git:isRepository",
  "git:get-auto-commit-status",
  "git:background-ops-status",
  "accept-changes:check-path-has-changes",
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
  "storage:save",
  "storage:delete",
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
  "pip:open",
  "pip:close",
  "pip:close-all-for-workspace",
  "websocket-api:get-status",
  "websocket-api:set-enabled",
  "websocket-api:regenerate-token",
  "websocket-api:set-discovery",
  "scripts:list",
  "scripts:create",
  "scripts:update",
  "scripts:remove",
  "scripts:start",
  "scripts:stop",
  "scripts:restart",
  "scripts:get-status",
  "scripts:get-output",
  "token-usage:get",
  "token-usage:changed",
  "backend:request",
  "backend:subscribe",
  "backend:unsubscribe",
  "backend:get-status",
  "backend:notification",
  "backend:status",
  "backend:spawn-sidecar",
  "backend:get-sidecar-run-log",
  "hardware-console:clear-lighting",
  "hardware-console:clear-lighting-done",
  "event:workspace:created",
  "event:workspace:updated",
  "event:workspace:deleted",
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
  "workspace:archived",
  "workspace:changes",
  "workspace:file-changes",
  "workspace:metadata-changed",
  "workspace:tasks-changed",
  "workspace:background-enrichment-complete",
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
  "agent:restored",
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
  "agent:circuit-breaker:status",
  "agent:message:error",
  "agent:message:received",
  "agent:user-message:sent",
  "agent:message:content-blocks",
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
  "codex/managed-install/status",
  "codex/managed-install/progress",
  "terminal:disposed",
  "events:new",
  "events:cleared",
  "app:ready",
  "app:ui:navigate",
  "app:ui:highlight",
  "window:ready",
  "window:focus",
  "window:blur",
  "window:fullscreen",
  "window:zoom-changed",
  "navigate-to-settings",
  "git:status-changed",
  "file-tracking:changes-updated",
  "file-tracking:agent-file-changed",
  "line-attribution:updated",
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
  "notification:navigate",
  "app:workspace-operation-requested",
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
  "script:started",
  "script:stopped",
  "script:output",
  "script:error",
  "script:url-detected",
  "websocket-api:discovery-auto-disabled",
  "token-usage:changed",
  "backend:notification",
  "backend:status",
  "hardware-console:clear-lighting"
];

// Dynamic channel patterns that are matched with startsWith()
const DYNAMIC_CHANNEL_PATTERNS = [
  "agent:stream:",
  "auggie:stream:",
  "terminal:output:",
  "terminal:close:",
  "terminal:error:",
  "terminal:exit:",
  "terminal:professional:exit:",
  "note:content-changed:",
  "note:deleted:",
  "directory:created:",
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
  "workspace:archived",
  "workspace:changes",
  "workspace:file-changes",
  "workspace:metadata-changed",
  "workspace:tasks-changed",
  "workspace:background-enrichment-complete",
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
  "agent:restored",
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
  "agent:circuit-breaker:status",
  "agent:message:error",
  "agent:message:received",
  "agent:user-message:sent",
  "agent:message:content-blocks",
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
  "codex/managed-install/status",
  "codex/managed-install/progress",
  "terminal:disposed",
  "events:new",
  "events:cleared",
  "app:ready",
  "app:ui:navigate",
  "app:ui:highlight",
  "window:ready",
  "window:focus",
  "window:blur",
  "window:fullscreen",
  "window:zoom-changed",
  "navigate-to-settings",
  "git:status-changed",
  "file-tracking:changes-updated",
  "file-tracking:agent-file-changed",
  "line-attribution:updated",
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
  "notification:navigate",
  "app:workspace-operation-requested",
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
  "script:started",
  "script:stopped",
  "script:output",
  "script:error",
  "script:url-detected",
  "websocket-api:discovery-auto-disabled",
  "token-usage:changed",
  "backend:notification",
  "backend:status",
  "hardware-console:clear-lighting"
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

// Define the API exposed to the renderer
const electronAPI = {
  // IPC invoke (request/response)
  invoke: (channel: string, ...args: any[]) => {
    // Use generated allowed channels for security
    if (isChannelAllowed(channel)) {
      // Pass args as-is to respect union schemas and other complex types
      // The validation middleware will handle type checking
      return ipcRenderer.invoke(channel, ...args).catch((err) => {
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
    // Increase max listeners for dynamic channels (e.g., agent:stream:uuid)
    // These channels are commonly used and shouldn't trigger memory warnings
    const dynamicPrefixes = ['agent:stream:', 'terminal:'];
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
      let channelListeners = listenerRegistry.get(channel);
      if (!channelListeners) {
        channelListeners = new Map();
        listenerRegistry.set(channel, channelListeners);
      }
      channelListeners.set(listenerId, {
        id: listenerId,
        original: callback,
        wrapped: wrappedCallback,
      });

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
    if (channelListeners && entry) {
      ipcRenderer.removeListener(channel, entry.wrapped);
      channelListeners.delete(listenerId);
      if (channelListeners.size === 0) {
        listenerRegistry.delete(channel);
      }
      return;
    }

    // Listener not found - this is normal if removeAllListeners() was called first
    // (e.g., renderer stream lifecycle cleans up stream channels with removeAllListeners,
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
