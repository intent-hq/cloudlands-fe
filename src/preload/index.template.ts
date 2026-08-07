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
// Generated at: 2025-12-01T23:15:23.312Z
// Run 'npm run generate:ipc-channels' to regenerate
// ============================================

// All static IPC channels that are allowed
const ALLOWED_CHANNELS = [
  'workspace:list',
  'workspace:create',
  'workspace:get',
  'workspace:get-root',
  'workspace:open',
  'workspace:close',
  'workspace:save',
  'workspace:update',
  'workspace:delete',
  'workspace:activate',
  'workspace:archive',
  'workspace:unarchive',
  'workspace:cleanup',
  'workspace:duplicate',
  'workspace:rename',
  'workspace:export',
  'workspace:import',
  'workspace:get-metadata',
  'workspace:update-metadata',
  'workspace:get-recent',
  'workspace:clear-recent',
  'workspace:get-stats',
  'workspace:validate',
  'workspace:repair',
  'workspace:backup',
  'workspace:restore',
  'workspace:get-settings',
  'workspace:update-settings',
  'workspace:trigger-check',
  'workspace:list-files',
  'workspace:test-watcher',
  'workspace:find-repositories',
  'workspace:update-spec-watcher-timestamp',
  'workspace:update-current-context',
  'workspace:search-in-files',
  'workspace:get-recent-repositories',
  'workspace:add-recent-repository',
  'workspace:clear-recent-repositories',
  'workspace:update_git_info',
  'workspace:getSettings',
  'workspace:updateSettings',
  'workspace:load-rules',
  'agent:load-initial-config',
  'agent:available',
  'agent:resume',
  'agent:cleanup',
  'agent:get-user-rules',
  'agent:get-specialization-rules',
  'agent:get-active-streams',
  'agent:lifecycle:start',
  'agent:lifecycle:stop',
  'agent:messaging:send',
  'agent:messaging:receive',
  'agent:track-started',
  'agent:track-completed',
  'agent:track-error',
  'agent:create',
  'agent:activate',
  'agent:send-message',
  'agent:stop',
  'agent:clear',
  'agent:send',
  'agent:get-session',
  'agent:list-sessions',
  'agent:update-session',
  'agent:delete-session',
  'agent:export-session',
  'agent:import-session',
  'agent:get-history',
  'agent:update-metadata',
  'agent:fork-session',
  'agent:merge-sessions',
  'agent:get-stats',
  'agent:validate-session',
  'agent:repair-session',
  'agent:get-context',
  'agent:update-context',
  'agent:context:update',
  'agent:context:getByWorkspace',
  'agent:context:getBySession',
  'agent:get-capabilities',
  'agent:set-capabilities',
  'agent:pause',
  'agent:get-status',
  'agent:set-priority',
  'agent:get-metrics',
  'agent:reset-metrics',
  'agent:get-logs',
  'agent:clear-logs',
  'agent:subscribe-updates',
  'agent:unsubscribe-updates',
  'agent:get-suggestions',
  'agent:apply-suggestion',
  'agent:get-completions',
  'agent:validate-input',
  'agent:format-output',
  'agent:get-templates',
  'agent:apply-template',
  'agent:save-template',
  'agent:delete-template',
  'agent:get-shortcuts',
  'agent:add-shortcut',
  'agent:remove-shortcut',
  'agent:execute-shortcut',
  'agent:get-plugins',
  'agent:install-plugin',
  'agent:uninstall-plugin',
  'agent:enable-plugin',
  'agent:disable-plugin',
  'agent:get-plugin-settings',
  'agent:update-plugin-settings',
  'agent:execute-plugin-action',
  'agent:get-webhooks',
  'agent:add-webhook',
  'agent:remove-webhook',
  'agent:test-webhook',
  'agent:get-integrations',
  'agent:connect-integration',
  'agent:disconnect-integration',
  'agent:sync-integration',
  'agent:get-integration-status',
  'agent:get-integration-data',
  'agent:update-integration-settings',
  'agent:test-integration',
  'agent:get-workflows',
  'agent:create-workflow',
  'agent:update-workflow',
  'agent:delete-workflow',
  'agent:execute-workflow',
  'agent:pause-workflow',
  'agent:resume-workflow',
  'agent:cancel-workflow',
  'agent:get-workflow-status',
  'agent:get-workflow-history',
  'agent:export-workflow',
  'agent:import-workflow',
  'agent:validate-workflow',
  'agent:optimize-workflow',
  'agent:get-workflow-metrics',
  'agent:get-workflow-logs',
  'agent:clear-workflow-logs',
  'agent:schedule-workflow',
  'agent:unschedule-workflow',
  'agent:get-scheduled-workflows',
  'agent:get-workflow-triggers',
  'agent:add-workflow-trigger',
  'agent:remove-workflow-trigger',
  'agent:test-workflow-trigger',
  'agent:get-workflow-variables',
  'agent:set-workflow-variables',
  'agent:get-workflow-dependencies',
  'agent:resolve-workflow-dependencies',
  'agent:get-workflow-permissions',
  'agent:set-workflow-permissions',
  'agent:share-workflow',
  'agent:unshare-workflow',
  'agent:clone-workflow',
  'agent:merge-workflows',
  'agent:diff-workflows',
  'agent:get-workflow-versions',
  'agent:restore-workflow-version',
  'agent:tag-workflow-version',
  'agent:get-workflow-tags',
  'agent:remove-workflow-tag',
  'agent:persistence:save',
  'agent:persistence:load',
  'agent:persistence:delete',
  'agent:persistence:list',
  'agent:persistence:saveMessage',
  'agent:persistence:batch',
  'agent:persistence:metrics',
  'agent:persistence:clear',
  'events:initialize',
  'events:query',
  'events:subscribe',
  'events:unsubscribe',
  'events:emit',
  'events:getLastEvent',
  'events:getStatistics',
  'events:get-recent-files',
  'events:get-agent-activity',
  'events:get-summary',
  'events:get-stats',
  'events:clear',
  'auggie:check-availability',
  'auggie:install',
  'auggie:get-models',
  'auggie:get-config',
  'auggie:update-config',
  'auggie:get-latest-session',
  'auggie:extract-file-changes',
  'auggie:generate-agent-name',
  'file:read',
  'file:write',
  'file:delete',
  'file:exists',
  'file:list',
  'file:copy',
  'file:move',
  'file:get-info',
  'file:readDirWithStats',
  'file:getGitignorePatterns',
  'file:read-batch',
  'file:mkdir',
  'file:getGitStatus',
  'system:get-info',
  'system:get-resources',
  'system:open-external',
  'system:show-item-in-folder',
  'system:beep',
  'system:home-directory',
  'system:workspace-root',
  'system:execute-command',
  'system:execute-command-streaming',
  'system:check-git',
  'app:set-badge',
  'app:version',
  'app:get-version',
  'app:name',
  'app:path',
  'app:root',
  'window:reload',
  'window:toggle-devtools',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:create',
  'window:open-new',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'terminal:list',
  'terminal:get-output',
  'terminal:clear',
  'terminal:professional:create',
  'terminal:professional:list',
  'terminal:professional:write',
  'terminal:professional:resize',
  'terminal:professional:info',
  'terminal:professional:refresh',
  'terminal:professional:dispose',
  'terminal:getPersistentShell',
  'terminal:executeInShell',
  // Notes Primitives (ws-block rendering)
  'codebase:search',
  'terminal:runCommand',
  'terminal:killProcess',
  'terminal:subscribeOutput',
  'agent:runAction',
  'git:status',
  'git:diff',
  'git:commit',
  'git:commit-details',
  'git:push',
  'git:pull',
  'git:branch',
  'git:checkout',
  'git:log',
  'git:history',
  'git:getBranches',
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:removeLock',
  'git:show-file',
  'git:status-changed',
  'config:get',
  'config:set',
  'config:delete',
  'config:get-all',
  'config:reset',
  'settings:get',
  'settings:set',
  'settings:getAll',
  'settings:update',
  'feature-codes:activate',
  'feature-codes:get-active',
  'feature-codes:clear',
  'feature-codes:deactivate',
  'feature-codes:restart-app',
  'dialog:message',
  'shell:open',
  'shell:openPath',
  'shell:openExternal',
  'shell:trashItem',
  'shell:showItemInFolder',
  'editor:get-selection',
  'first-visit-state:load',
  'first-visit-state:save',
  'first-visit-state:delete',
  'first-visit-state:exists',
  'file-tracking:clear',
  'file-tracking:get-changes',
  'file-tracking:get-status',
  'file-tracking:refresh',
  'file-tracking:track-change',
  'file-tracking:stage-changes',
  'file-tracking:unstage-changes',
  'file-tracking:load-transitions',
  'streaming:start',
  'streaming:stop',
  'streaming:pause',
  'streaming:resume',
  'streaming:get-stats',
  'agent-config:get',
  'agent-config:update',
  'agent-config:reset',
  'log:track-file-change',
  'log:track-agent-event',
  'log:track-mcp-call',
  'log:get-events',
  'log:clear-events',
  'log:events-updated',
  'log:paths',
  'log:read',
  'log:clear',
  'log:summary',

  'user-rules:get',
  'user-rules:set',
  'user-rules:delete',
  'user-rules:get-all',
  'user-rules:get-formatted',
  'user-rules:set-enabled',
  'user-rules:export',
  'user-rules:import',
  'user-rules:get-combined-prompt',
  'user-rules:update',
  'user-rules:get-by-type',
  'user-rules:get-formatted-by-type',
  'user-rules:update-by-type',
  'user-rules:set-enabled-by-type',
  'user-rules:delete-by-type',
  'user-rules:export-by-type',
  'vscode:open',
  'vscode:openFile',
  'vscode:open-diff',
  'vscode:open-git-diff',
  'jetbrains:open',
  'deep-link:handle',
  'get_home_directory',
  'rules:list',
  'rules:load-workspace',
  'rules:get-context',
  'config:getAll',

  'diffs:list',
  'diffs:create',
  'diffs:update',
  'diffs:get',
  'line-attribution:load',
  'line-attribution:updated',
  'line-attribution:compute-now',
  'git-tracking:get-state',
  'git-tracking:get-sync-status',
  'git-tracking:sync',
  'git-tracking:get-file-diff',
  'git-tracking:is-github-authenticated',
  'git-tracking:get-pull-requests',
  'git-tracking:get-pull-request',
  'git-tracking:create-pull-request',
  'agent-testing:run',
  'agent-testing:get-report',
  'agent-testing:get-agent-reports',
  'agent-testing:cleanup',
  'setup-scripts:generate',
  'setup-scripts:detect-type',
  'setup-scripts:generate-with-agent',
  'setup-scripts:stop-agent',
  'setup-scripts:stream-chunk',
  'setup-scripts:stream-complete',
  'setup-scripts:stream-error',
  'git:isRepository',
  'accept-changes:check-path-has-changes',
  'agent-context:get',
  'recovery:needs-recovery',
  'recovery:mark-streaming',
  'recovery:mark-complete',
  'recovery:clear-streaming',
  'recovery:check-needs-recovery',
  'recovery:get-status',
  'recovery:create-checkpoint',
  'recovery:restore-checkpoint',
  'recovery:recover-session',
  'recovery:get-stats',
  'storage:save',
  'storage:delete',
  'debug:emit-event',
  'event:workspace:created',
  'event:workspace:updated',
  'event:workspace:deleted',
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
  'directory:created',
  'directory:deleted',
  'directory:renamed',
  'agent:started',
  'agent:stopped',
  'agent:created',
  'agent:deleted',
  'agent:restored',
  'agent:renamed',
  'agent:status',
  'agent:idle',
  'agent:status-changed',
  'agent:loaded',
  'agent:message',
  'agent:chunk',
  'agent:session:recovered',
  'agent:session-updated',
  'agent:session-completed',
  'agent:subscribed',
  'agent:unsubscribed',
  'agent:woken-by-subscription',
  'agent:subscriptions-restored',
  'agent:subscriptions-changed',
  'agent:event-delivery-failed',
  'agent:event-delivery-timeout',
  'agent:queue:updated',
  'agent:queue:processing',
  'agent:message:error',
  // NOTE: 'agent:message:chunk' removed - legacy channel, all streaming uses session-specific channels
  'agent:message:received',
  'agent:message:content-blocks',
  'agent:stream:pong',
  'deep-link',
  'workspace-changes',
  'terminal:data',
  'terminal:exit',
  'terminal:professional:data',
  'terminal:professional:exit',
  'terminal:professional:error',
  'terminal:professional:command:start',
  'terminal:professional:command:finished',
  'terminal:professional:cwd:changed',
  'events:new',
  'events:cleared',
  'app:ready',
  'window:ready',
  'window:focus',
  'window:blur',
  'window:fullscreen',
  'file-tracking:listener-ready',
  'file-tracking:changes-updated',
  'setup-scripts:stream-chunk',
  'setup-scripts:stream-complete',
  'setup-scripts:stream-error',
];

// Dynamic channel patterns that are matched with startsWith()
const DYNAMIC_CHANNEL_PATTERNS = [
  'agent:stream:',
  'auggie:stream:',
  'terminal:output:',
  'terminal:exit:',
  'terminal:professional:exit:',
  'terminal:close:',
  'terminal:error:',
  'note:content-changed:',
  'note:deleted:',
  'directory:created:',
  'file:deleted:',
  'workspace:file-changes:',
  'workspace:metadata-changed:',
  'agent:session:',
  'events:',
];

// Event channels for IPC renderer on() listeners
const EVENT_CHANNELS = [
  'event:workspace:created',
  'event:workspace:updated',
  'event:workspace:deleted',
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
  'agent:restored',
  'agent:renamed',
  'agent:status',
  'agent:idle',
  'agent:status-changed',
  'agent:loaded',
  'agent:message',
  'agent:chunk',
  'agent:session:recovered',
  'agent:session-updated',
  'agent:session-completed',
  'agent:subscribed',
  'agent:unsubscribed',
  'agent:woken-by-subscription',
  'agent:subscriptions-restored',
  'agent:subscriptions-changed',
  'agent:event-delivery-failed',
  'agent:event-delivery-timeout',
  'agent:queue:updated',
  'agent:queue:processing',
  'agent:message:error',
  // NOTE: 'agent:message:chunk' removed - legacy channel, all streaming uses session-specific channels
  'agent:message:received',
  'agent:user-message:sent',
  'agent:message:content-blocks',
  'agent:stream:pong',
  'deep-link',
  'workspace-changes',
  'terminal:data',
  'terminal:exit',
  'terminal:professional:data',
  'terminal:professional:exit',
  'terminal:professional:error',
  'terminal:professional:command:start',
  'terminal:professional:command:finished',
  'terminal:professional:cwd:changed',
  'events:new',
  'events:cleared',
  'app:ready',
  'window:ready',
  'window:focus',
  'window:blur',
  'window:fullscreen',
  'file-tracking:listener-ready',
  'file-tracking:changes-updated',
  'setup-scripts:stream-chunk',
  'setup-scripts:stream-complete',
  'setup-scripts:stream-error',
  'notification:navigate',
  'websocket-api:discovery-auto-disabled',
];

/**
 * Check if a channel is allowed (either static, dynamic, or event)
 */
function isChannelAllowed(channel: string): boolean {
  return (
    ALLOWED_CHANNELS.includes(channel) ||
    DYNAMIC_CHANNEL_PATTERNS.some((pattern) => channel.startsWith(pattern)) ||
    EVENT_CHANNELS.includes(channel) ||
    // Safety fallback: allow GitHub auth channels even if generated list is stale
    channel.startsWith('github-auth:')
  );
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
