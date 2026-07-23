/**
 * Main Process Entry Point
 *
 * Sets up all IPC handlers for the application
 */

// CRITICAL: Import build-time config FIRST
// These values are baked in at build time from .env (see scripts/generate-build-config.cjs)
import { BUILD_CONFIG } from './build-config.generated.js';

// Import electron early to check app.isPackaged for reliable environment detection
// We need createRequire for CommonJS compatibility with electron
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ipcMain, app, BrowserWindow } = require('electron');

// PERF: Enable --expose-gc to allow manual GC
// This must be done before app.isReady()
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// EARLY: Redirect userData to the "intent-cloudlands" directory under the platform
// appData dir (e.g. ~/Library/Application Support/intent-cloudlands on macOS), on all
// platforms and in both dev and packaged builds. The app starts fresh here — no
// migration from the old app-name-derived directory. This must run before the
// dev-instance namespacing below and before setupConsoleLogCapture() so the
// SingletonLock and logs land in the new directory.
import * as path from 'path';
import {
  resolveDevUserDataDirName,
  resolveUserDataBasePath,
} from './utils/resolve-dev-instance.js';
app.setPath('userData', resolveUserDataBasePath(app.getPath('appData')));

// EARLY: Support multiple dev instances by using unique userData paths.
// Namespaced by absolute DEV_PORT so cloudlands-fe cannot collide with other Electron
// dev apps (e.g. the reference Intent build's "dev-instance-N" scheme) on the
// SingletonLock, yielding intent-cloudlands/cloudlands-dev[-PORT] in dev. This must
// run before setupConsoleLogCapture() so logs go to the correct userData directory.
const devUserDataSegment = resolveDevUserDataDirName();
if (devUserDataSegment) {
  const uniqueUserData = path.join(app.getPath('userData'), devUserDataSegment);
  app.setPath('userData', uniqueUserData);
}

// EARLY: Capture all main-process console output to {userData}/logs/console-output.log
// This must run before most initialization so we capture everything.
import { setupConsoleLogCapture } from './logging/console-log-capture.js';
setupConsoleLogCapture();

// Set app name early - in dev mode, show custom name or "Intent [Dev N]" in dock/menu bar
const isDev = process.env.NODE_ENV === 'development';
app.setName(resolveAppTitle());

// Track registered handlers globally
const __registeredHandlers = new Set<string>();
(global as any).__ipcRegisteredHandlers = __registeredHandlers;

// Store handler functions so they can be called from the HTTP IPC bridge
// This enables browser-mode rendering with real data from the running Electron app
const __ipcHandlerFunctions = new Map<string, (...args: any[]) => any>();
(global as any).__ipcHandlerFunctions = __ipcHandlerFunctions;

// Store the original handle method
const originalHandle = ipcMain.handle.bind(ipcMain);

// Override ipcMain.handle using Object.defineProperty
// Silent registration - we'll log a summary at the end instead of per-handler
Object.defineProperty(ipcMain, 'handle', {
  value(channel: string, handler: any) {
    __registeredHandlers.add(channel);
    __ipcHandlerFunctions.set(channel, handler);
    // Silent - no per-handler logging to reduce noise
    return originalHandle(channel, handler);
  },
  writable: false,
  configurable: true,
});

// Log handler count summary after startup
setTimeout(() => {
  // Import Logger dynamically to avoid circular dependencies
  import('../shared/logger')
    .then(({ Logger }) => {
      const ipcLogger = new Logger('IPC');
      // Group handlers by prefix for a cleaner summary
      const grouped = new Map<string, number>();
      for (const channel of __registeredHandlers) {
        const prefix = channel.split(':')[0];
        grouped.set(prefix, (grouped.get(prefix) || 0) + 1);
      }
      const summary = Array.from(grouped.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([prefix, count]) => `${prefix}(${count})`)
        .join(', ');
      ipcLogger.info(`IPC Handlers: ${__registeredHandlers.size} total`, { summary });
    })
    .catch(() => {
      // Silently ignore logger import failures during startup
    });
}, 5000);

// Now import everything else
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { dialog, protocol } from 'electron';
import * as fs from 'fs';

import { Logger } from '../shared/logger';
import { compareWorkspaceActivityDisplayTimeDesc } from '../shared/utils/workspace-activity-time';
import { exportHandlerDebugInfo, setupIPCInterceptor } from './ipc-handler-wrapper';
import { initializeWarningSuppression } from './utils/suppress-warnings';
import { setupWebviewSecurity } from './webview-security';
import { createDebugBundle } from '../features/debug-export/main/debug-bundle.service';

// No custom protocol needed - we'll use file:// protocol
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';

// Early startup timing for diagnostics
const startupStartTime = Date.now();
const logStartupTiming = (phase: string) => {
  const elapsed = Date.now() - startupStartTime;
  console.log(`[Startup ${elapsed}ms] ${phase}`);
};
logStartupTiming('Module initialization complete');

// Seed PATH from the daemon (`host.env`, PROTOCOL §5.14) so child processes
// spawned locally inherit the BE host's authoritative PATH instead of a PATH
// we'd have to reconstruct from local shell profiles. The FE pre-populates
// the OS-essential directories synchronously so the JSON-RPC client itself
// has enough PATH to launch its socket transport on macOS GUI starts; the
// daemon's enhanced PATH then overwrites it once `host.env` returns. Failure
// is fail-open (we keep the essential PATH) so startup is never blocked by
// an unreachable daemon.
const mainLogger = new Logger('Main');
if (process.platform !== 'win32') {
  const essentialPaths = [
    '/bin',
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const currentPath = process.env.PATH || '';
  const pathSet = new Set(currentPath.split(':').filter(Boolean));
  for (const p of essentialPaths) {
    pathSet.add(p);
  }
  process.env.PATH = Array.from(pathSet).join(':');
}

const hostEnvPromise = (async () => {
  try {
    const { initializeHostEnv } = await import('../shared/main/find-binary');
    const result = await initializeHostEnv();
    if (result) {
      if (result.enhancedPath) {
        process.env.PATH = result.enhancedPath;
      } else if (result.path) {
        process.env.PATH = result.path;
      }
      mainLogger.info('Seeded PATH from host.env', {
        pathEntries: result.pathEntries.length,
        shell: result.shell,
      });
    }
  } catch (error) {
    mainLogger.warn('host.env seed failed; keeping pre-populated PATH', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();

const hostEnvTimeout = new Promise<void>((resolve) => {
  setTimeout(() => {
    mainLogger.warn('host.env took too long, continuing without waiting');
    resolve();
  }, 2000);
});

await Promise.race([hostEnvPromise, hostEnvTimeout]);
logStartupTiming('host.env seed complete');

// Initialize warning suppression early
initializeWarningSuppression();
logStartupTiming('Warning suppression initialized');

// Register custom protocols before app.whenReady()
// workspace-asset:// is needed for serving images in notes
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'workspace-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Complete the IPC interceptor setup (for unhandled rejection tracking)
setupIPCInterceptor();

// Import new IPC setup functions
import { registerAcceptChangesHandlers } from '../features/accept-changes/main/accept-changes.ipc';
import { registerAgentContextHandlers } from '../features/agent/agent-context.ipc';
import { setupAuggieIPC } from '../features/auggie/main/auggie.ipc';
import { setupOpencodeIPC } from '../features/opencode/main/opencode.ipc';
import { setupClaudeCodeIPC } from '../features/claude-code/main/claude-code.ipc';
import { setupPiIPC } from '../features/pi/main/pi.ipc';
import { setupCodexIPC } from '../features/codex/main/codex.ipc';
import { setupCortexIPC } from '../features/cortex/main/cortex.ipc';
import { setupDroidIPC } from '../features/droid/main/droid.ipc';
import { setupGrokIPC } from '../features/grok/main/grok.ipc';
import { setupFeatureCodesIPC } from '../features/feature-codes/main/feature-codes.ipc';
import { setupProviderAvailabilityIPC } from '../features/providers/main/provider-availability.service';
import { setupConfigIPC, getConfigManager } from '../features/config/main/config.ipc';
import { setupDiffsIPC } from '../features/diffs/main/diffs.ipc';

import { setupEventsIPC } from '../features/events/main/events.ipc';
import { registerExternalEditorsHandlers } from '../features/external-editors/main/external-editors.ipc';
import { setupFileIPC } from '../features/file/main/file.ipc';
import { setupGitTrackingIPC } from '../features/git-tracking/main/git-tracking.ipc';
import { setupGitIPC } from '../features/git/main/git.ipc';
import { setupGitHubAuthIPC } from '../features/github-auth/main/github-auth.ipc';
import { registerIDEHandlers } from '../features/ide/main/ide.ipc';
import { setupPanelLayoutHistoryIPC } from '../features/layout/main/panel-layout-history.ipc';
import { setupLinearAuthIPC } from '../features/linear-auth/main/linear-auth.ipc';
import { setupLogIPC } from '../features/log/main/log.ipc';
import { setupNotificationIPC } from '../features/notifications/main/notification.ipc';
import { getNotificationService } from '../features/notifications/main/notification.service';
import { setupRulesIPC } from '../features/rules/main/rules.ipc';
import { setupSpecialistsIPC } from '../features/specialists/main/specialists.ipc';
import { setupAutoUpdateIPC } from '../features/auto-update/main/auto-update.ipc';
import { isInstallingUpdate } from '../features/auto-update/main/auto-update.service';
import {
  registerBackendHandlers,
  disposeBackendClient,
  getBackendClient,
} from '../features/backend/main/backend.ipc';
import { getConnectionMode } from '../features/backend/main/connection-mode';
import { startIntentdSidecar, stopIntentdSidecar } from '../features/backend/main/intentd-sidecar';
import { setupUserRulesIPC as setupWorkspaceRulesIPC } from '../features/rules/main/user-rules.ipc';

import { setupSentryAuthIPC } from '../features/sentry-auth/main/sentry-auth.ipc';
import { registerScriptsHandlers } from '../features/scripts/main/scripts.ipc';
import { disposeAllScriptProcessManagers } from '../features/scripts/main/script-process-manager';
import { registerSetupScriptsHandlers } from '../features/setup-scripts/main/setup-scripts.ipc';
import {
  setupSystemIPC,
  isFocusedWindowInWorkspace,
  isFocusedWindowBrowserActive,
  getFocusedWindowWorkspaceId,
  getAllOpenWorkspaceIds,
  getWindowIdForWorkspace,
  installIntentCli,
  autoRepairCliSymlink,
} from '../features/system/main/system.ipc';
import { cleanupTerminals, setupTerminalIPC } from '../features/terminal/main/terminal.ipc';
import { setupUserActivityIPC } from '../features/user-activity/main/user-activity.ipc';
import { setupFirstVisitStateIPC } from '../features/workspace/main/first-visit-state.ipc';
import {
  initializeChangeDetectorManager,
  setupWorkspaceIPC,
} from '../features/workspace/main/workspace.ipc';
import { setupWorkspaceSummaryIPC } from '../features/workspace/main/workspace-summary.ipc';
import { startupMetrics } from '../utils/startup-metrics';
import { CdpMcpBridge } from './cdp-mcp-bridge';
import { buildQuitDialogOptions } from './quit-dialog';
import { listRespondingAgents } from './running-agents';

import { registerMissingAgentHandlers } from '../features/agent/main/agent-missing.ipc';
import { cleanupStaleTempFiles } from '../shared/main/temp-files';
import { initSpecialistsService } from '../features/agent/main/specialists.service';
import { initAppSettingsService } from '../features/workspace/main/app-settings.service';
import { workspaceService } from '../features/workspace/main/workspace.service';

import { registerDeepLinkHandlers } from '../features/deeplink/main/deeplink.ipc';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { registerChatExportHandlers } from '../features/export/main/export.ipc';
import { registerDebugExportHandlers } from '../features/debug-export/main/debug-export.ipc';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { registerWorkspacePRHandlers } from '../features/workspace/main/workspace-pr.ipc';
import { ipcCleanupManager } from './ipc-cleanup-manager';
import { resolveAppTitle } from './utils/resolve-app-title.js';
import { getMainWindow } from './state';
import {
  captureWindowSessionsSnapshot,
  clearWindowSessionsSnapshot,
  createWindow,
  createWindowForDeepLink,
  createWindowForSession,
  getWindowSessionsPath,
  loadWindowSessions,
  saveWindowSessions,
} from './window.js';
import {
  setupAppProtocolHandler,
  setupWorkspaceAssetProtocolHandler,
} from './protocol-handlers.js';

const logger = new Logger('Main');

let cdpMcpServer: CdpMcpBridge | null = null;
let isShuttingDown = false;

// Deep link handler for intent:// protocol URLs
const deepLinkHandler = new DeepLinkHandler();

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  // Suppress webview navigation errors (ERR_ABORTED happens when switching URLs)
  const errMsg = error?.message || String(error);
  if (errMsg.includes('GUEST_VIEW_MANAGER_CALL') && errMsg.includes('ERR_ABORTED')) {
    return; // Silently ignore webview navigation abort errors
  }
  logger.error('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason, promise) => {
  // Suppress webview navigation errors (ERR_ABORTED happens when switching URLs)
  const errMsg = reason instanceof Error ? reason.message : String(reason);
  if (errMsg.includes('GUEST_VIEW_MANAGER_CALL') && errMsg.includes('ERR_ABORTED')) {
    return; // Silently ignore webview navigation abort errors
  }
  logger.error('Unhandled Rejection', reason as Error, { promise });
});

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await gracefulShutdown();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  await gracefulShutdown();
});

async function gracefulShutdown() {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    // Cleanup terminals gracefully - this properly cleans up PTY processes
    // to prevent Napi::Error crashes during shutdown
    await cleanupTerminals();

    // Allow native conpty threads to complete their exit callbacks
    // before tearing down the Node environment. The conpty.cc background thread
    // calls tsfn.BlockingCall() then tsfn.Release() after the PTY process exits;
    // if the environment is torn down too quickly, the assertion at conpty.cc:110
    // fires. This delay gives those threads time to finish.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Stop all running workspace scripts (spawned via child_process.spawn)
    try {
      await disposeAllScriptProcessManagers();
      logger.info('All script process managers disposed');
    } catch (error) {
      logger.error(
        'Error disposing script process managers:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Dispose the live backend JSON-RPC client (closes the UDS/TCP socket).
    try {
      disposeBackendClient();
      logger.info('Backend JSON-RPC client disposed');
    } catch (error) {
      logger.error(
        'Error disposing backend client:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Stop the intentd sidecar daemon (if we spawned it). SIGTERM with a grace
    // period, then SIGKILL. This runs AFTER disposeBackendClient() so the FE
    // closes the socket before we kill the daemon. In external mode the daemon
    // is not ours to stop — skip the stop path entirely so no code path ever
    // signals an external daemon.
    if (getConnectionMode() === 'external') {
      logger.info('External daemon — not stopping');
    } else {
      try {
        await stopIntentdSidecar();
        logger.info('Sidecar daemon stopped');
      } catch (error) {
        logger.error(
          'Error stopping sidecar daemon:',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    // Agent lifecycle is owned by the intentd daemon (PROTOCOL.md §5.5);
    // the legacy main-process unified backend shutdown was retired with it.

    // Stop CDP MCP Server
    if (cdpMcpServer) {
      try {
        await cdpMcpServer.stop();
        logger.info('CDP MCP Server stopped');
      } catch (error) {
        logger.error(
          'Error stopping CDP MCP Server:',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    // Cleanup IPC handlers
    ipcCleanupManager.cleanupAll();

    // Cleanup auto-updater (stop periodic update checks)
    try {
      const { cleanupAutoUpdater } = await import('../features/auto-update/main/auto-update.ipc');
      cleanupAutoUpdater();
    } catch {
      // Auto-updater may not be initialized
    }

    const mainWindow = getMainWindow();

    // Close all windows
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }

    // Force exit the app after cleanup
    // Using app.exit() instead of app.quit() to avoid triggering before-quit again
    app.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', error as Error);
    process.exit(1);
  }
}

// Enable CDP debugging port (dev-only)
// This allows external tools to connect to the Chrome DevTools Protocol
if (process.env.NODE_ENV === 'development' && process.env.ENABLE_CDP_DEBUG) {
  const cdpPort = process.env.CDP_PORT || '9223';
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
  logger.info(`CDP debugging enabled on port ${cdpPort}`);
}

app.whenReady().then(async () => {
  startupMetrics.start('total');
  logger.info('Setting up critical IPC handlers for fast startup');

  // SECURITY: Setup webview security handlers early, before any windows are created
  setupWebviewSecurity();

  // Keep window sessions file up-to-date so it's always available on quit/crash.
  // This debounced saver fires on window move/resize/navigate to ensure the sessions
  // file reflects the latest state even when before-quit can't capture windows (e.g.,
  // on Windows/Linux when closing the last window triggers app.quit()).
  let sessionSaveTimeout: NodeJS.Timeout | null = null;
  const debouncedSaveWindowSessions = () => {
    if (sessionSaveTimeout) clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(() => saveWindowSessions(), 1000);
  };

  app.on('browser-window-created', (_event: Electron.Event, window: BrowserWindowType) => {
    window.on('resize', debouncedSaveWindowSessions);
    window.on('move', debouncedSaveWindowSessions);
    window.webContents.on('did-navigate', debouncedSaveWindowSessions);
    window.webContents.on('did-navigate-in-page', debouncedSaveWindowSessions);
    // Capture a synchronous snapshot right before the window is destroyed so
    // the in-memory cache inside saveWindowSessions() holds the final layout.
    // Needed for the non-macOS window-all-closed path, where the handler runs
    // after BrowserWindow.getAllWindows() has already emptied and an async
    // saveWindowSessions() call would otherwise serialize nothing.
    window.on('close', captureWindowSessionsSnapshot);
  });

  // Set application menu with correct app name on macOS
  const { Menu } = require('electron');
  const appName = resolveAppTitle();
  const isDevMode = process.env.NODE_ENV === 'development';
  const isMacOS = process.platform === 'darwin';

  // Build version string with commit hash
  const commitHash = BUILD_CONFIG.GIT_COMMIT_HASH;
  const versionWithCommit = commitHash ? `${app.getVersion()} (${commitHash})` : app.getVersion();

  // Store about panel info for use in dialogs
  const aboutPanelInfo = {
    applicationName: appName,
    applicationVersion: versionWithCommit,
    copyright: '\u00A9 2026 Intent Contributors',
    providerVersion: '',
  };

  // Set initial about panel options (macOS only)
  if (isMacOS) {
    app.setAboutPanelOptions({
      applicationName: aboutPanelInfo.applicationName,
      applicationVersion: aboutPanelInfo.applicationVersion,
      copyright: aboutPanelInfo.copyright,
    });
  }

  // Asynchronously fetch active provider version and update the about panel.
  // Routed through the daemon's `host.exec` (PROTOCOL §5.14) — the FE no longer
  // spawns provider `--version` locally. Failure is silent: the About panel just
  // omits the CLI version line (honest-degrade on RPC / non-zero exit).
  (async () => {
    try {
      const { hostExec } = await import('../shared/main/host-exec.js');
      const { getDefaultProviderConfig } = await import('../shared/config/provider-config.js');
      const defaultProvider = getDefaultProviderConfig();

      const result = await hostExec(defaultProvider.command, {
        args: ['--version'],
        timeoutMs: 5000,
      });
      if (result.exitCode !== 0) {
        logger.debug('Could not get provider CLI version for about panel', {
          exitCode: result.exitCode,
        });
        return;
      }
      const providerVersion = (result.stdout || '').trim();
      if (providerVersion) {
        aboutPanelInfo.providerVersion = `${defaultProvider.displayName} CLI: ${providerVersion}`;
        if (isMacOS) {
          app.setAboutPanelOptions({
            applicationName: aboutPanelInfo.applicationName,
            applicationVersion: aboutPanelInfo.applicationVersion,
            version: aboutPanelInfo.providerVersion,
            copyright: aboutPanelInfo.copyright,
          });
        }
      }
    } catch (err) {
      // Provider CLI not installed / not accessible / RPC failure - that's fine
      logger.debug('Could not get provider CLI version for about panel', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  // Function to build the File menu with recent workspaces
  const buildFileMenu = async (): Promise<Electron.MenuItemConstructorOptions> => {
    // Check if focused window is in a workspace (for enabling/disabling tab menu items)
    const inWorkspace = isFocusedWindowInWorkspace();
    const recentWorkspacesSubmenu: Electron.MenuItemConstructorOptions[] = [];

    // Load recent workspaces (lite mode — only need titles for the menu,
    // not git diffs/summaries which spawn 4 git subprocesses per workspace)
    try {
      const result = await protocolAdapter.listAllWorkspaces({ lite: true });
      if (result.ok && result.data) {
        // Sort by shared display activity semantics and take top 5
        type WorkspaceItem = {
          status?: string;
          createdAt: string;
          lastActivity?: string;
          updatedAt: string;
          title?: string;
          name?: string;
          id: string;
        };
        const recentWorkspaces = (result.data as WorkspaceItem[])
          .filter((w: WorkspaceItem) => w.status !== 'deleted' && w.status !== 'archived')
          .sort(compareWorkspaceActivityDisplayTimeDesc)
          .slice(0, 5);

        for (const workspace of recentWorkspaces) {
          const displayName = workspace.title || workspace.name || workspace.id;
          recentWorkspacesSubmenu.push({
            label: displayName,
            click: () => {
              const mainWindow = getMainWindow();
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('navigate', `/workspace/${workspace.id}`);
              }
            },
          });
        }
      }
    } catch (error) {
      logger.warn('[Menu] Failed to load recent workspaces for menu:', error);
    }

    // Add "No Recent Spaces" if empty
    if (recentWorkspacesSubmenu.length === 0) {
      recentWorkspacesSubmenu.push({
        label: 'No Recent Spaces',
        enabled: false,
      });
    }

    const fileMenuItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => {
          createWindow();
        },
      },
      {
        label: 'New Workspace',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('navigate', '/workspace/new');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'New Agent',
        accelerator: 'CmdOrCtrl+T',
        enabled: inWorkspace,
        // Don't register accelerator - let renderer handle Cmd+T first
        // so the terminal can intercept it when focused
        registerAccelerator: false,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:new-agent');
          }
        },
      },
      {
        label: 'New Note',
        accelerator: 'CmdOrCtrl+Alt+N',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:new-note');
          }
        },
      },
      {
        label: 'New Terminal',
        accelerator: 'CmdOrCtrl+Alt+T',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:new-terminal');
          }
        },
      },
      {
        label: 'New Browser',
        accelerator: 'CmdOrCtrl+Alt+B',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:new-browser');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Open Recent',
        submenu: recentWorkspacesSubmenu,
      },
      { type: 'separator' },
    ];

    // Add Settings on Windows (before Close Window)
    if (!isMacOS) {
      fileMenuItems.push({
        label: 'Settings...',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('navigate', '/settings');
          }
        },
      });
      fileMenuItems.push({ type: 'separator' });
    }

    fileMenuItems.push(
      {
        label: 'Close Tab',
        accelerator: 'CmdOrCtrl+W',
        enabled: inWorkspace,
        // Don't register accelerator - let renderer handle Cmd+W first for tabs
        registerAccelerator: false,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:close-tab');
          }
        },
      },
      {
        label: 'Close Window',
        accelerator: 'CmdOrCtrl+Shift+W',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.close();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Reopen Closed Tab',
        accelerator: 'CmdOrCtrl+Shift+T',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:reopen-closed-tab');
          }
        },
      },
    );

    // Add Exit on Windows (at the end of File menu)
    if (!isMacOS) {
      fileMenuItems.push({ type: 'separator' });
      fileMenuItems.push({
        label: 'Exit',
        role: 'quit',
      });
    }

    return {
      label: 'File',
      submenu: fileMenuItems,
    };
  };

  // Function to rebuild and set the application menu
  const rebuildMenu = async () => {
    // Check if focused window is in a workspace (for enabling/disabling tab menu items)
    const inWorkspace = isFocusedWindowInWorkspace();
    const fileMenu = await buildFileMenu();

    // Build the Window menu items
    const windowMenuItems: Electron.MenuItemConstructorOptions[] = [
      { role: 'minimize', accelerator: 'CmdOrCtrl+M' },
      { role: 'zoom', label: 'Fill' },
      { type: 'separator' },
      {
        label: 'Select Previous Tab',
        accelerator: 'CmdOrCtrl+Shift+[',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:select-previous-tab');
          }
        },
      },
      {
        label: 'Select Next Tab',
        accelerator: 'CmdOrCtrl+Shift+]',
        enabled: inWorkspace,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:select-next-tab');
          }
        },
      },
      { type: 'separator' },
    ];

    // Add 'Bring All to Front' only on macOS (role: 'front' is macOS-only)
    if (isMacOS) {
      windowMenuItems.push({ role: 'front', label: 'Bring All to Front' });
    }

    // Add workspaces with open windows to the Window menu
    const openWorkspaceIds = getAllOpenWorkspaceIds();
    if (openWorkspaceIds.length > 0) {
      type WorkspaceItem = { status?: string; title?: string; name?: string; id: string };
      const workspaceTitles = new Map<string, string>();
      try {
        const result = await protocolAdapter.listAllWorkspaces({ lite: true });
        if (result.ok && result.data) {
          for (const ws of result.data as WorkspaceItem[]) {
            const displayName = ws.title || ws.name || ws.id;
            workspaceTitles.set(ws.id, displayName);
          }
        }
      } catch {
        // Fall back to workspace IDs
      }

      const focusedWorkspaceId = getFocusedWindowWorkspaceId();

      windowMenuItems.push({ type: 'separator' });
      for (const wsId of openWorkspaceIds) {
        const label = workspaceTitles.get(wsId) || wsId;
        windowMenuItems.push({
          label,
          type: 'radio',
          checked: wsId === focusedWorkspaceId,
          click: () => {
            const windowId = getWindowIdForWorkspace(wsId);
            if (windowId !== undefined) {
              const win = BrowserWindow.fromId(windowId);
              if (win && !win.isDestroyed()) {
                if (win.isMinimized()) {
                  win.restore();
                }
                win.focus();
              }
            }
          },
        });
      }
    }

    // Build the Help menu items
    const helpMenuItems: Electron.MenuItemConstructorOptions[] = [];

    // Add About on Windows (macOS uses the app menu)
    if (!isMacOS) {
      helpMenuItems.push({
        label: `About ${appName}`,
        click: () => {
          const aboutMessage = [
            `${aboutPanelInfo.applicationName}`,
            `Version: ${aboutPanelInfo.applicationVersion}`,
            aboutPanelInfo.providerVersion ? `${aboutPanelInfo.providerVersion}` : '',
            `${aboutPanelInfo.copyright}`,
          ]
            .filter(Boolean)
            .join('\n');

          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `About ${appName}`,
              message: aboutMessage,
            });
          } else {
            dialog.showMessageBox({
              type: 'info',
              title: `About ${appName}`,
              message: aboutMessage,
            });
          }
        },
      });
      helpMenuItems.push({
        label: 'Check for Updates...',
        click: async () => {
          const mainWindow = getMainWindow();
          logger.info('[Menu] Check for Updates clicked', {
            isDevMode,
            hasMainWindow: !!mainWindow,
          });

          // Signal renderer to show toast immediately for responsive feedback
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-update:show-toast');
          }

          if (isDevMode) {
            // In dev mode, auto-updater is not initialized
            // Send "up to date" notification directly
            if (mainWindow && !mainWindow.isDestroyed()) {
              logger.info('[Menu] Sending auto-update:up-to-date to renderer');
              mainWindow.webContents.send('auto-update:up-to-date', {
                version: app.getVersion(),
                isDev: true,
              });
            } else {
              logger.warn('[Menu] mainWindow not available for sending up-to-date notification');
            }
          } else {
            // In production, use the auto-update service
            try {
              const { autoUpdateService } =
                await import('../features/auto-update/main/auto-update.service');
              await autoUpdateService.checkForUpdatesManual();
            } catch (error) {
              logger.error('Failed to check for updates:', error as Error);
            }
          }
        },
      });
      helpMenuItems.push({
        label: "Install 'intent' command in PATH...",
        click: async () => {
          const mainWindow = getMainWindow();
          try {
            const result = await installIntentCli();
            if (result?.success) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'CLI Installation',
                  message: result.message || 'CLI installed successfully',
                });
              } else {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'CLI Installation',
                  message: result.message || 'CLI installed successfully',
                });
              }
            } else {
              dialog.showErrorBox(
                'CLI Installation Failed',
                result?.message || 'Failed to install CLI',
              );
            }
          } catch (error) {
            dialog.showErrorBox(
              'CLI Installation Error',
              error instanceof Error ? error.message : 'An error occurred',
            );
          }
        },
      });
      helpMenuItems.push({ type: 'separator' });
    }

    // Add Export Debug Logs (cross-platform)
    helpMenuItems.push({
      label: 'Export Debug Logs',
      click: async () => {
        try {
          // Create the debug bundle
          const workspaceId = getFocusedWindowWorkspaceId();
          const bundlePath = await createDebugBundle(workspaceId);

          // Generate suggested filename with date
          const now = new Date();
          const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
          const timeStr = now.toTimeString().slice(0, 5).replace(':', ''); // HHmm
          const suggestedFilename = `intent-debug-${dateStr}-${timeStr}.zip`;

          // Show save dialog
          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: suggestedFilename,
            filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
          });

          if (canceled || !filePath) {
            // Clean up temp bundle
            try {
              await fs.promises.unlink(bundlePath);
            } catch {
              // Ignore cleanup errors
            }
            return;
          }

          // Move bundle to final location
          await fs.promises.copyFile(bundlePath, filePath);
          await fs.promises.unlink(bundlePath);

          logger.info('Debug bundle exported successfully', { filePath });
        } catch (error) {
          logger.error('Failed to export debug logs', error as Error);
        }
      },
    });

    // Build the template based on platform
    const template: Electron.MenuItemConstructorOptions[] = [];

    // Add app menu only on macOS
    if (isMacOS) {
      template.push({
        label: appName,
        submenu: [
          { role: 'about', label: `About ${appName}` },
          {
            label: 'Check for Updates...',
            click: async () => {
              const mainWindow = getMainWindow();
              logger.info('[Menu] Check for Updates clicked', {
                isDevMode,
                hasMainWindow: !!mainWindow,
              });

              // Signal renderer to show toast immediately for responsive feedback
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('auto-update:show-toast');
              }

              if (isDevMode) {
                // In dev mode, auto-updater is not initialized
                // Send "up to date" notification directly
                if (mainWindow && !mainWindow.isDestroyed()) {
                  logger.info('[Menu] Sending auto-update:up-to-date to renderer');
                  mainWindow.webContents.send('auto-update:up-to-date', {
                    version: app.getVersion(),
                    isDev: true,
                  });
                } else {
                  logger.warn(
                    '[Menu] mainWindow not available for sending up-to-date notification',
                  );
                }
              } else {
                // In production, use the auto-update service
                try {
                  const { autoUpdateService } =
                    await import('../features/auto-update/main/auto-update.service');
                  await autoUpdateService.checkForUpdatesManual();
                } catch (error) {
                  logger.error('Failed to check for updates:', error as Error);
                }
              }
            },
          },
          { type: 'separator' },
          {
            label: 'Settings...',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (focusedWindow && !focusedWindow.isDestroyed()) {
                focusedWindow.webContents.send('navigate', '/settings');
              }
            },
          },
          {
            label: "Install 'intent' command in PATH...",
            click: async () => {
              const mainWindow = getMainWindow();
              try {
                const result = await installIntentCli();
                if (result?.success) {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    dialog.showMessageBox(mainWindow, {
                      type: 'info',
                      title: 'CLI Installation',
                      message: result.message || 'CLI installed successfully',
                    });
                  } else {
                    dialog.showMessageBox({
                      type: 'info',
                      title: 'CLI Installation',
                      message: result.message || 'CLI installed successfully',
                    });
                  }
                } else {
                  dialog.showErrorBox(
                    'CLI Installation Failed',
                    result?.message || 'Failed to install CLI',
                  );
                }
              } catch (error) {
                dialog.showErrorBox(
                  'CLI Installation Error',
                  error instanceof Error ? error.message : 'An error occurred',
                );
              }
            },
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${appName}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${appName}` },
        ],
      });
    }

    // Add standard menus (File, Edit, View, Window, Help)
    template.push(
      fileMenu,
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            // Don't register the accelerator - let the renderer handle Cmd+R
            // so browser panels can refresh instead of reloading the whole app
            registerAccelerator: false,
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (focusedWindow && !focusedWindow.isDestroyed()) {
                focusedWindow.webContents.reload();
              }
            },
          },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          {
            label: 'Actual Size',
            accelerator: 'CmdOrCtrl+0',
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (!focusedWindow || focusedWindow.isDestroyed()) return;
              // Route zoom to main app or webview based on renderer-tracked panel focus
              if (isFocusedWindowBrowserActive()) {
                focusedWindow.webContents.send('menu:reset-zoom');
              } else {
                focusedWindow.webContents.setZoomLevel(0);
              }
            },
          },
          {
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+=',
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (!focusedWindow || focusedWindow.isDestroyed()) return;
              if (isFocusedWindowBrowserActive()) {
                focusedWindow.webContents.send('menu:zoom-in');
              } else {
                focusedWindow.webContents.setZoomLevel(
                  focusedWindow.webContents.getZoomLevel() + 0.5,
                );
              }
            },
          },
          {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (!focusedWindow || focusedWindow.isDestroyed()) return;
              if (isFocusedWindowBrowserActive()) {
                focusedWindow.webContents.send('menu:zoom-out');
              } else {
                focusedWindow.webContents.setZoomLevel(
                  focusedWindow.webContents.getZoomLevel() - 0.5,
                );
              }
            },
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: windowMenuItems,
      },
      {
        label: 'Help',
        submenu: helpMenuItems,
      },
    );

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  // Build initial menu (workspaces may not be loaded yet, will update later)
  rebuildMenu();

  // Rebuild menu when a window gains focus to refresh recent workspaces
  let menuRebuildTimeout: NodeJS.Timeout | null = null;
  app.on('browser-window-focus', () => {
    // Debounce menu rebuilds to avoid excessive updates
    if (menuRebuildTimeout) {
      clearTimeout(menuRebuildTimeout);
    }
    menuRebuildTimeout = setTimeout(() => {
      rebuildMenu();
      menuRebuildTimeout = null;
    }, 1000);
  });

  // Rebuild menu when workspace state changes (enables/disables tab menu items)
  app.on('window-workspace-state-changed', () => {
    const openWorkspaceIds = getAllOpenWorkspaceIds();
    try {
      workspaceService.trimCachesToOpenWorkspaces(openWorkspaceIds);
    } catch (error) {
      logger.warn('Failed to trim inactive workspace caches', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    rebuildMenu();
  });

  // Set up custom protocol handler for production builds
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    setupAppProtocolHandler();
  }

  // workspace-asset:// is needed in both dev and production (note images)
  setupWorkspaceAssetProtocolHandler();

  // Patch ipcMain to automatically track all handlers for cleanup
  // In production, ipcMain.handle may be non-writable (as set above). The cleanup manager
  // now skips when non-writable/non-configurable, so this call is safe/no-op there.
  ipcCleanupManager.patchIPCMain();

  // Log IPC debug info on startup (development only)
  if (process.env.NODE_ENV === 'development') {
    // Export handler info after a delay to ensure all handlers are registered
    setTimeout(() => {
      exportHandlerDebugInfo();

      // Get debug info and force save
      const debugInfo = ipcDebugTracker.getDebugInfo();
      if (debugInfo.missingHandlers.length > 0) {
        logger.warn(`Missing IPC handlers detected: ${debugInfo.missingHandlers.join(', ')}`);
      }

      // Force save debug data
      ipcDebugTracker.forceSave();
    }, 5000);
  }

  // PERFORMANCE OPTIMIZATION: Change detector is now lazily initialized
  // The manager is lightweight at import time and initializes on first use
  // This removes ~2 seconds from startup time
  startupMetrics.start('changeDetectorInit');
  // Just set up listeners - actual initialization happens on first workspace load
  initializeChangeDetectorManager();
  startupMetrics.end('changeDetectorInit');

  // Setup ONLY critical IPC handlers needed for initial render
  // This significantly improves startup time
  startupMetrics.start('criticalIPC');

  // Initialize specialists service BEFORE workspace IPC - this is critical!
  // The workspace creation flow calls resolveSpecialistForAgent() which needs the store initialized.
  await initSpecialistsService();

  // Initialize app settings service for branch prefix and other settings
  await initAppSettingsService();

  setupWorkspaceIPC();
  setupWorkspaceSummaryIPC();
  setupFileIPC();
  setupSystemIPC();
  await setupConfigIPC();
  setupGitIPC(); // Needed for git operations
  setupGitHubAuthIPC(); // Needed for GitHub device flow auth
  setupLinearAuthIPC(); // Needed for Linear auth via the daemon
  setupSentryAuthIPC(); // Needed for Sentry auth via API token

  registerIDEHandlers(); // Needed for IDE integration
  registerExternalEditorsHandlers(); // Needed for external editor detection and opening
  registerWorkspacePRHandlers(); // Needed for PR operations
  registerMissingAgentHandlers(); // Needed for agent context operations
  registerDeepLinkHandlers(); // Needed for deep link and file operations

  // These handlers are called immediately on startup, so register them synchronously
  setupAuggieIPC(); // Needed for auggie:get-models
  setupOpencodeIPC(); // Needed for opencode:get-models
  setupClaudeCodeIPC(); // Needed for claude-code:get-models
  setupCodexIPC(); // Needed for codex:get-models
  setupCortexIPC(); // Needed for cortex:get-models
  setupPiIPC(); // Needed for pi:get-models
  setupDroidIPC(); // Needed for droid:get-models
  setupGrokIPC(); // Needed for grok:get-models
  setupFeatureCodesIPC(); // Feature codes for gating features like Cortex
  setupProviderAvailabilityIPC(); // Needed for providers:get-availability
  setupEventsIPC(); // Needed for events:query
  registerSetupScriptsHandlers(); // Needed for onboarding setup scripts
  registerScriptsHandlers(); // Needed for workspace script management (CRUD, lifecycle, output)
  registerAcceptChangesHandlers(); // Needed for AcceptChangesPanel on workspace open

  setupTerminalIPC(); // Needed for CLI blocks in notes (includes get-buffer handler)
  registerChatExportHandlers(); // Needed for chat export functionality
  registerDebugExportHandlers(); // Needed for debug log export functionality

  // Pass the shared ConfigManager to workspace rules service
  const configManager = getConfigManager();
  await setupWorkspaceRulesIPC(configManager || undefined); // Needed for initial agent system prompt
  setupGitTrackingIPC(); // Needed for renderer git tracking on startup
  setupSpecialistsIPC(); // Needed for specialist selection on startup
  setupAutoUpdateIPC(); // Needed for auto-update IPC on startup

  // Start the intentd sidecar daemon (if spawn policy allows). This MUST run
  // before registerBackendHandlers() so the daemon is ready before the first
  // JSON-RPC client connection attempt. Adoption logic (probe socket first)
  // ensures we don't spawn when an external daemon is already running.
  await startIntentdSidecar(process.env, app.isPackaged, process.resourcesPath, process.cwd());

  registerBackendHandlers(); // Needed for live JSON-RPC transport (workspaces domain)
  startupMetrics.end('criticalIPC');

  logger.info('Critical IPC handlers registered, creating window');

  // Setup remaining IPC handlers asynchronously after window is shown
  // Using setImmediate to not block the main thread
  setImmediate(async () => {
    startupMetrics.start('secondaryIPC');
    logger.info('Setting up secondary IPC handlers in background');

    setupFirstVisitStateIPC();
    setupPanelLayoutHistoryIPC();
    setupUserActivityIPC();

    // MINIMAL REFACTOR: Commenting out duplicate IPC handler
    registerAgentContextHandlers();

    // setupTerminalIPC(); // Already called in critical IPC setup
    setupDiffsIPC();
    setupLogIPC();
    // setupAuggieIPC(); // Already called in critical IPC setup
    // setupEventsIPC(); // Already called in critical IPC setup
    // setupGitTrackingIPC(); // Already called in critical IPC setup
    // registerAcceptChangesHandlers(); // Already called in critical IPC setup
    setupRulesIPC();
    // setupSpecialistsIPC(); // Already called in critical IPC setup
    // Token usage is daemon-owned (workspace.getTokenUsage, PROTOCOL §5.23);
    // the renderer reads it directly over the JSON-RPC bridge.
    // setupWorkspaceRulesIPC(); // Already called in critical IPC setup
    // registerSetupScriptsHandlers(); // Already called in critical IPC setup

    // Setup notification IPC handlers
    setupNotificationIPC();

    // Start the app-wide notification service — one global agent:idle
    // subscription covering all workspaces (PROTOCOL.md §6.1: omitting
    // workspaceId subscribes to events from every workspace).
    try {
      getNotificationService().start();
    } catch (error) {
      logger.warn('Failed to start notification service', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Setup keychain consent IPC handlers for git network operations
    const { setupKeychainIPC } = await import('../features/git/main/keychain.ipc');
    setupKeychainIPC();

    // Setup browser debugger IPC handlers for CDP access to embedded browser tabs
    const { registerBrowserHandlers } = await import('../features/browser/main/browser.ipc');
    registerBrowserHandlers();

    // setupAutoUpdateIPC(); // Already called in critical IPC setup
    // Initialize auto-updater in production (not needed at startup, depends on mainWindow)
    const { initializeAutoUpdater } = await import('../features/auto-update/main/auto-update.ipc');
    const mainWindow = getMainWindow();
    if (process.env.NODE_ENV !== 'development' && mainWindow) {
      initializeAutoUpdater(mainWindow);
    }

    // Setup development-only IPC handlers
    if (process.env.NODE_ENV === 'development') {
      // Debug tools for testing backend-initiated flows
      const { setupDebugIPC } = await import('../features/debug/main/debug.ipc');
      setupDebugIPC();
    }

    // Event-triggered handlers (message delivery, auto-commit) are now sagas
    // forked from workspaceEventsSaga — no manual registration needed.

    // Migrate workspaces from ~/intent/{id} to ~/intent/workspaces/{id}
    try {
      const migrationResult = await protocolAdapter.migrateWorkspacesToCanonicalLocation();
      if (migrationResult.migrated > 0 || migrationResult.errors > 0) {
        logger.info('Workspace migration on startup', migrationResult);
      }
    } catch (error) {
      logger.warn('Error migrating workspaces on startup', { error });
    }

    // Clean up stale temp files from ~/.intent/tmp (from crashed/killed agents)
    try {
      const result = await cleanupStaleTempFiles();
      if (result.removed > 0) {
        logger.info('Cleaned up stale temp files on startup', result);
      }
    } catch (error) {
      logger.debug('Error cleaning up stale temp files', { error });
    }

    // Auto-repair CLI symlink on startup (production only, silent)
    try {
      await autoRepairCliSymlink();
    } catch (error) {
      logger.debug('Error auto-repairing CLI symlink on startup', { error });
    }

    // RTK detection and prompt injection moved daemon-side (intentd PR #190).
    // The FE-local rtk-detector.ts module and its hydration are no longer used.

    startupMetrics.end('secondaryIPC');
    logger.info('All secondary IPC handlers registered successfully');
  });

  // Create window(s) immediately after critical handlers
  // This shows the window much faster to the user
  // Guard against second instance creating a window
  if (!isSecondInstance) {
    startupMetrics.start('createWindow');

    // Check for intent:// deep link in process.argv (cold start)
    const intentUrlArg = process.argv.find((arg: string) => arg.startsWith('intent://'));

    // Try to restore saved window sessions (unless we have a deep link to process)
    const savedSessions = intentUrlArg ? null : loadWindowSessions();
    if (savedSessions && savedSessions.length > 0) {
      logger.info('Restoring window sessions from previous run', { count: savedSessions.length });
      for (let i = 0; i < savedSessions.length; i++) {
        createWindowForSession(savedSessions[i], i === 0);
      }
    } else {
      // No saved sessions (or has deep link) — create a single default window
      createWindow();
    }

    startupMetrics.end('createWindow');
  }

  // Register intent:// protocol handler with the OS.
  // In production, electron-builder registers the scheme statically (Info.plist / registry),
  // but we also call setAsDefaultProtocolClient at runtime as a belt-and-suspenders measure
  // to ensure the association is set even if the installer didn't complete properly.
  // In dev mode, we pass extra args so macOS launches the Electron binary correctly.
  try {
    if (isDev) {
      app.setAsDefaultProtocolClient('intent', process.execPath, [path.resolve(app.getAppPath())]);
      logger.info('Registered intent:// protocol handler for development mode', {
        execPath: process.execPath,
        appPath: path.resolve(app.getAppPath()),
      });
    } else {
      app.setAsDefaultProtocolClient('intent');
      logger.info('Registered intent:// protocol handler for production mode');
    }
  } catch (error) {
    logger.warn('Failed to register intent:// protocol handler:', error);
  }

  // Process any pending deep link URL that was received before the window was ready
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await deepLinkHandler.processPendingUrl(mainWindow);
  }

  // Log initial startup metrics
  try {
    startupMetrics.end('total');
    startupMetrics.logSummary();
  } catch (error) {
    logger.error('Failed to log startup metrics:', error);
  }

  // Post-window setup (HTTP MCP server removed; renderer is mock-driven)
  (async () => {
    // Setup handlers that require the window to exist
    // PERFORMANCE OPTIMIZATION: Run in parallel since they're independent
    try {
      startupMetrics.start('postWindowIPC');
    } catch (error) {
      logger.warn('Failed to start postWindowIPC metric:', error);
    }

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.error('Main window unavailable during post-window setup; skipping');
      return;
    }

    try {
      startupMetrics.end('postWindowIPC');
    } catch (error) {
      logger.warn('Failed to end postWindowIPC metric:', error);
    }

    // Start CDP MCP Server (dev-only)
    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_CDP_DEBUG) {
      startupMetrics.start('cdpMcpServer');
      try {
        cdpMcpServer = new CdpMcpBridge();
        await cdpMcpServer.start();
        logger.info('CDP MCP Server started for debugging');
      } catch (error) {
        logger.warn(
          'CDP MCP Server failed to start, continuing without it',
          error instanceof Error ? error : new Error(String(error)),
        );
        // Don't fail app startup if CDP server fails
      }
      startupMetrics.end('cdpMcpServer');
    }

    // Final metrics summary after all async operations
    setTimeout(() => startupMetrics.logSummary(), 2000);
  })();
});

// This window-all-closed handler was duplicated and has been removed.
// The proper handler is defined below at line 448.

/**
 * Show the running-agent confirmation prompt if any agents are active.
 *
 * Returns true if the caller should proceed with quit/teardown (no agents
 * running, or user confirmed), false if the user cancelled.
 *
 * Shared between `before-quit` (Cmd+Q path) and `window-all-closed` (non-macOS
 * last-window-close path) so both paths honor the prompt. Historically only
 * `before-quit` checked, but `window-all-closed` tears down providers before
 * `app.quit()` fires, so by the time `before-quit` runs the active-stream
 * check sees zero and silently skips the prompt.
 */
async function confirmQuitWithRunningAgents(): Promise<boolean> {
  // Live agent turns run inside the intentd daemon (agent.sendMessage, PROTOCOL
  // §5.5), so the daemon's per-agent `isResponding` flag is the source of truth
  // for "still running". The old check read main-process stream/accumulator
  // state that no longer exists post-port (the main Redux store was removed),
  // which crashed with an unhandled rejection on every quit.
  const respondingAgents = await listRespondingAgents(getBackendClient());
  if (respondingAgents.length === 0) {
    return true;
  }

  logger.info('Active agents detected during quit attempt', {
    count: respondingAgents.length,
    agentIds: respondingAgents.map((s) => s.agentId),
  });

  // The dialog copy branches on the connection mode (see quit-dialog.ts):
  // in sidecar mode quitting shuts down the daemon and its running agents
  // (destructive framing, resume on next launch); in external mode the daemon
  // outlives the app, so closing is non-destructive and the copy lists the
  // agents that keep running in the background.
  const result = await dialog.showMessageBox(
    buildQuitDialogOptions(getConnectionMode(), respondingAgents),
  );

  if (result.response === 1) {
    logger.info('User cancelled quit due to running agents');
    return false;
  }

  logger.info('User confirmed quit despite running agents');
  return true;
}

app.on('before-quit', async (event: Electron.Event) => {
  logger.info('App before-quit event triggered');

  // Only prevent default and run gracefulShutdown if we're not already shutting down
  if (!isShuttingDown) {
    event.preventDefault();

    // Save window sessions now that quit is prevented.
    // Must be called AFTER event.preventDefault() because saveWindowSessions is async
    // and preventDefault must be called synchronously within the event handler.
    await saveWindowSessions();

    const proceed = await confirmQuitWithRunningAgents();
    if (!proceed) {
      return;
    }

    await gracefulShutdown();
  }
});

app.on('window-all-closed', async () => {
  // On macOS the app stays alive after all windows are closed.
  // Clear the saved sessions file so that clicking the dock icon opens a single
  // fresh window instead of restoring every window the user just closed.
  // Guard with !isShuttingDown so that an intentional quit (Cmd+Q) — which
  // already saved sessions in before-quit — doesn't lose them.
  if (process.platform === 'darwin' && !isShuttingDown && !isInstallingUpdate) {
    try {
      const sessionsPath = getWindowSessionsPath();
      if (fs.existsSync(sessionsPath)) {
        fs.unlinkSync(sessionsPath);
        logger.info('Cleared window sessions (all windows manually closed on macOS)');
      }
    } catch (err) {
      logger.warn('Failed to clear sessions file on window-all-closed:', err);
    }
    // Also wipe the in-memory fallback snapshot so a pending debounced saver,
    // or any later saveWindowSessions() trigger, can't resurrect the file we
    // just deleted from the last-known-sessions cache.
    clearWindowSessionsSnapshot();
  }

  // On non-macOS this handler runs the full backend teardown (persist, kill
  // providers, stop MCP servers) before calling app.quit(). By the time
  // app.quit() emits `before-quit`, providers are already dead and the prompt
  // there sees zero active streams. So we must run the running-agent prompt
  // HERE, before any teardown, on the non-macOS last-window-close path.
  // If the user cancels, re-open a fresh window so the app is still reachable
  // (on Windows/Linux there are no windows left) and return early without
  // tearing anything down or calling app.quit().
  if (process.platform !== 'darwin' && !isShuttingDown && !isInstallingUpdate) {
    const proceed = await confirmQuitWithRunningAgents();
    if (!proceed) {
      logger.info('window-all-closed quit cancelled; re-opening a window');
      try {
        createWindow();
      } catch (err) {
        logger.error(
          'Failed to re-open window after cancelled quit',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      return;
    }
    // Persist window sessions before handing off to gracefulShutdown().
    // gracefulShutdown() calls app.exit(0), which skips `before-quit` entirely,
    // so the saveWindowSessions() call inside the before-quit handler never
    // fires on this non-macOS last-window-close path. Without this explicit
    // save, window positions/state for the just-closed windows would be lost
    // on next launch. The debounced background saver (1s) is best-effort and
    // may not have captured the final state; always flush synchronously here.
    try {
      await saveWindowSessions();
    } catch (err) {
      logger.error(
        'Failed to save window sessions on window-all-closed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    // Delegate the confirmed-quit teardown to gracefulShutdown(), which is the
    // same path before-quit (Cmd+Q) uses. gracefulShutdown() sets
    // isShuttingDown=true internally (so any subsequent before-quit is a
    // no-op), runs the full cleanup ordering — including the items only it
    // performs (cleanupTerminals + settling delay,
    // disposeAllScriptProcessManagers, cleanupAutoUpdater) — and
    // then calls app.exit(0). Delegating here (instead of running a bespoke
    // partial teardown and calling app.quit()) prevents before-quit re-entry
    // that otherwise showed a second running-agent prompt and ran a duplicate
    // teardown, while still performing the gracefulShutdown-only cleanup the
    // older app.quit()→before-quit hop was relied upon to do.
    await gracefulShutdown();
    return;
  }

  // Terminal cleanup is NOT done here — app.quit() (line 2692) triggers
  // before-quit → gracefulShutdown() which already calls cleanupTerminals()
  // with a proper settling delay. Calling it here too caused a double-cleanup
  // race that could crash conpty's native thread.

  // Cleanup IPC debug tracker
  ipcDebugTracker.dispose();

  // Cleanup all IPC handlers
  ipcCleanupManager.cleanupAll();

  // Agent lifecycle is owned by the intentd daemon; no main-process agent
  // backend remains to shut down here.

  // Stop CDP MCP Server
  if (cdpMcpServer) {
    try {
      await cdpMcpServer.stop();
      logger.info('CDP MCP Server stopped');
    } catch (error) {
      logger.error(
        'Error stopping CDP MCP Server:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle intent:// protocol URLs on macOS
// This is called when the user opens an intent:// URL (e.g., from a link or command line)
app.on('open-url', async (event: Electron.Event, url: string) => {
  event.preventDefault();
  logger.info('Received open-url event:', { url });

  // If app is ready and has a main window, create a new window for the deep link
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await createWindowForDeepLink(url, deepLinkHandler);
  } else {
    // App is not ready yet, store the URL for processing after startup
    logger.info('App not ready, storing URL for later processing');
    await deepLinkHandler.handleDeepLink(url, null);
  }
});

// Handle intent:// protocol URLs on Windows/Linux (second instance)
// This is called when the user tries to open the app again with an intent:// URL
let isSecondInstance = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance already holds the SingletonLock in this userData directory.
  // Log which path is contended before quitting so this isn't a silent no-op — a
  // common failure mode when a foreign Electron dev app shares the same userData dir.
  const contendedUserData = app.getPath('userData');
  const message = `Another instance is already running; SingletonLock in userData=${contendedUserData} is held. Exiting.`;
  console.error(`[Main] ${message}`);
  try {
    logger.error(message, { userData: contendedUserData });
  } catch {
    // logger may not have a transport wired up this early on some platforms
  }
  isSecondInstance = true;
  app.quit();
} else {
  app.on('second-instance', async (_event: Electron.Event, commandLine: string[]) => {
    logger.info('Received second-instance event:', { commandLine });

    // Look for intent:// URL in command line arguments
    const deepLinkUrl = commandLine.find((arg: string) => arg.startsWith('intent://'));

    if (deepLinkUrl) {
      logger.info('Found deep link URL in second instance:', { url: deepLinkUrl });
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        await createWindowForDeepLink(deepLinkUrl, deepLinkHandler);
      }
    } else {
      // No deep link, just focus the existing window
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    }
  });
}

app.on('activate', () => {
  if (isSecondInstance) return;

  const allWindows = BrowserWindow.getAllWindows().filter(
    (w: BrowserWindowType) => !w.isDestroyed(),
  );
  if (allWindows.length > 0) {
    // Focus an existing window instead of creating a new one
    const mainWindow = getMainWindow();
    const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : allWindows[0];
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.show();
    targetWindow.focus();
  } else {
    // No windows at all — restore sessions or create a new one
    const savedSessions = loadWindowSessions();
    if (savedSessions && savedSessions.length > 0) {
      logger.info('Restoring window sessions on activate', { count: savedSessions.length });
      for (let i = 0; i < savedSessions.length; i++) {
        createWindowForSession(savedSessions[i], i === 0);
      }
    } else {
      createWindow();
    }
  }
});
