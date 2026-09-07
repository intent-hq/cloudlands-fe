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
  resolveDevIntentdDataDir,
  resolveDevUserDataDirName,
  resolveUserDataBasePath,
  shouldIsolateDevIntentdDataDir,
} from './utils/resolve-dev-instance.js';
app.setPath('userData', resolveUserDataBasePath(app.getPath('appData')));

// EARLY: Support multiple dev instances by using unique userData paths.
// Namespaced by absolute DEV_PORT so cloudlands-fe cannot collide with other Electron
// dev apps (e.g. the reference Intent build's "dev-instance-N" scheme) on the
// SingletonLock, yielding intent-cloudlands/cloudlands-dev[-PORT] in dev. This must
// run before setupConsoleLogCapture() so logs go to the correct userData directory.
import { createAuthorizedIpcHandler } from './ipc-authorization.js';
const devUserDataSegment = resolveDevUserDataDirName();
if (devUserDataSegment) {
  const uniqueUserData = path.join(app.getPath('userData'), devUserDataSegment);
  app.setPath('userData', uniqueUserData);
}

// EARLY: When dev explicitly opts into sidecar spawning, default that daemon's data
// directory to a per-DEV_PORT dir so parallel instances stay isolated. Connect-only
// `pnpm run dev` keeps the global socket; otherwise it would target an isolated socket
// that no process creates. Inherited data dirs and explicit transports still win.
// Gated on !app.isPackaged — the same signal backend.ipc.ts uses to pick a transport, so
// isolation and socket resolution cannot disagree (NODE_ENV would: an unpackaged launch
// without it still resolves a dev UDS socket). Must run before the sidecar spawn and the
// first backend client connection, both of which read INTENTD_DATA_DIR off process.env.
if (shouldIsolateDevIntentdDataDir(process.env, !app.isPackaged)) {
  process.env.INTENTD_DATA_DIR = resolveDevIntentdDataDir(app.getPath('appData'));
  // Logged directly: this runs before setupConsoleLogCapture(), so it is stdout-only.
  // i18n-ignore (log line)
  console.log(`[main] dev intentd data dir defaulted to ${process.env.INTENTD_DATA_DIR}`);
}

// EARLY: Capture all main-process console output to {userData}/logs/console-output.log
// This must run before most initialization so we capture everything.
import { setupConsoleLogCapture } from './logging/console-log-capture.js';
setupConsoleLogCapture();

// Set the application name early. The same resolved value labels the macOS app menu.
const isDev = process.env.NODE_ENV === 'development';
const appName = setResolvedAppName(app);

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
    const authorizedHandler = createAuthorizedIpcHandler(channel, handler);
    __ipcHandlerFunctions.set(channel, authorizedHandler);
    // Silent - no per-handler logging to reduce noise
    return originalHandle(channel, authorizedHandler);
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
import { dialog, protocol, session } from 'electron';
import * as fs from 'fs';

import { Logger } from '../shared/logger';
import { compareWorkspaceActivityDisplayTimeDesc } from '../shared/utils/workspace-activity-time';
import { exportHandlerDebugInfo, setupIPCInterceptor } from './ipc-handler-wrapper';
import { initializeWarningSuppression } from './utils/suppress-warnings';
import { runWithHardExitTimeout } from './utils/hard-exit-timeout';
import { handleUncaughtException, handleUnhandledRejection } from './utils/process-error-handlers';
import { isWebviewPopupWindow, setupWebviewSecurity } from './webview-security';
import { attachAppCommandHistoryNavigation } from './app-command-navigation';
import { attachSwipeHistoryNavigation } from './swipe-navigation';
import { setupHardwareConsoleMain } from '../features/hardware-console/main/hardware-console.ipc';
import { setupConsoleOwnerTracking } from '../features/hardware-console/main/console-owner';
import { requestHardwareConsoleLightingClear } from '../features/hardware-console/main/clear-lighting-shutdown';
import { createDebugBundle } from '../features/debug-export/main/debug-bundle.service';
import {
  createStackSampleFile,
  shouldShowStackSampleMenuItem,
} from '../features/debug-export/main/stack-sample.service';

// No custom protocol needed - we'll use file:// protocol
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';

// Early startup timing for diagnostics
const startupStartTime = Date.now();
const logStartupTiming = (phase: string) => {
  const elapsed = Date.now() - startupStartTime;
  console.log(`[Startup ${elapsed}ms] ${phase}`);
};
// i18n-ignore (developer log message)
logStartupTiming('Module initialization complete');

const mainLogger = new Logger('Main');

// Build identity banner (intent-hq/monorepo#3649): record which build produced
// this log file. `app.getVersion()` is guarded so a non-Electron import of this
// module cannot throw before logging starts. The dedicated BuildInfo category
// is pinned to INFO in logging-config.ts so the banner survives the packaged
// build's WARN default level.
const appVersion = app && typeof app.getVersion === 'function' ? app.getVersion() : 'unknown';
new Logger('BuildInfo').info(
  // i18n-ignore (developer log message)
  `Intent v${appVersion} (commit ${BUILD_CONFIG.GIT_COMMIT_HASH || 'unknown'})`,
  {
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  },
);

// Seed PATH from the daemon (`host.env`, PROTOCOL §5.14) so child processes
// spawned locally inherit the BE host's authoritative PATH instead of a PATH
// we'd have to reconstruct from local shell profiles. The FE pre-populates
// the OS-essential directories synchronously so the JSON-RPC client itself
// has enough PATH to launch its socket transport on macOS GUI starts; the
// daemon's enhanced PATH then overwrites it once `host.env` returns. Failure
// is fail-open (we keep the essential PATH) so startup is never blocked by
// an unreachable daemon.
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

async function seedPathFromHostEnv(): Promise<void> {
  const abortController = new AbortController();
  const hostEnvPromise = (async () => {
    try {
      const { initializeHostEnv } = await import('../shared/main/find-binary');
      const result = await initializeHostEnv({
        retryForMs: 2000,
        retryDelayMs: 100,
        signal: abortController.signal,
      });
      if (result) {
        if (result.enhancedPath) {
          process.env.PATH = result.enhancedPath;
        } else if (result.path) {
          process.env.PATH = result.path;
        }
        // i18n-ignore (developer log message)
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const hostEnvTimeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      abortController.abort();
      mainLogger.warn('host.env took too long, continuing without waiting');
      resolve();
    }, 2000);
  });

  await Promise.race([hostEnvPromise, hostEnvTimeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  logStartupTiming('host.env seed complete');
}

// Initialize warning suppression early
initializeWarningSuppression();
// i18n-ignore (developer log message)
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
  {
    scheme: 'workspace-file',
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
import { setupUnslothIPC } from '../features/unsloth/main/unsloth.ipc';
import { setupAntigravityIPC } from '../features/antigravity/main/antigravity.ipc';
import { setupFeatureCodesIPC } from '../features/feature-codes/main/feature-codes.ipc';
import { setupProviderAvailabilityIPC } from '../features/providers/main/provider-availability.service';
import { setupConfigIPC, getConfigManager } from '../features/config/main/config.ipc';

import { setupEventsIPC } from '../features/events/main/events.ipc';
import { registerExternalEditorsHandlers } from '../features/external-editors/main/external-editors.ipc';
import { setupFileIPC } from '../features/file/main/file.ipc';
import { registerIDEHandlers } from '../features/ide/main/ide.ipc';
import { setupPanelLayoutHistoryIPC } from '../features/layout/main/panel-layout-history.ipc';
import { setupLogIPC } from '../features/log/main/log.ipc';
import { setupNotificationIPC } from '../features/notifications/main/notification.ipc';
import { getNotificationService } from '../features/notifications/main/notification.service';
import { setupRulesIPC } from '../features/rules/main/rules.ipc';
import { setupSpecialistsIPC } from '../features/specialists/main/specialists.ipc';
import { setupAutoUpdateIPC } from '../features/auto-update/main/auto-update.ipc';
import { setupReleaseNotesIPC } from '../features/release-notes/main/release-notes.ipc';
import { isInstallingUpdate } from '../features/auto-update/main/auto-update.service';
import {
  registerBackendHandlers,
  connectBackendClient,
  disconnectBackendClient,
  disposeAllBackendClients,
  isSameHostBackendActive,
} from '../features/backend/main/backend.ipc';
import { registerWorkspaceTransferHandlers } from '../features/backend/main/workspace-transfer.ipc';
import { registerWorkspaceImportHandlers } from '../features/backend/main/workspace-import.ipc';
import { getConnectionMode, getDaemonVersionInfo } from '../features/backend/main/connection-mode';
import { getActiveId, list as listConnections } from '../features/backend/main/connections-store';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import {
  probeDaemonVersion,
  resolveSocketPath,
  startIntentdSidecar,
  stopIntentdSidecar,
} from '../features/backend/main/intentd-sidecar';
import { readPinnedVersion } from '../features/backend/main/intentd-version-pin';
import { formatIntentdAboutVersion } from '../features/backend/main/intentd-about-version';
import { startMemoryMonitor, stopMemoryMonitor } from './memory-monitor';
import { setupUserRulesIPC as setupWorkspaceRulesIPC } from '../features/rules/main/user-rules.ipc';

import { registerSetupScriptsHandlers } from '../features/setup-scripts/main/setup-scripts.ipc';
import {
  setupSystemIPC,
  isFocusedWindowInWorkspace,
  getFocusedWindowWorkspaceId,
  getAllOpenWorkspaceIds,
  installIntentCli,
  autoRepairCliSymlink,
} from '../features/system/main/system.ipc';
import { cleanupTerminals, setupTerminalIPC } from '../features/terminal/main/terminal.ipc';
import { setupUserActivityIPC } from '../features/user-activity/main/user-activity.ipc';
import { setupFirstVisitStateIPC } from '../features/workspace/main/first-visit-state.ipc';
import { setupWorkspaceIPC } from '../features/workspace/main/workspace.ipc';
import { setupWorkspaceSummaryIPC } from '../features/workspace/main/workspace-summary.ipc';
import { startupMetrics } from '../utils/startup-metrics';
import type { CdpMcpBridge } from './cdp-mcp-bridge';
import { setMainLanguagePreference, getMainLanguagePreference } from './main-locale';
import { isCdpMcpBridgeEnabled } from './utils/cdp-debug';
import { confirmQuitWithRunningAgents } from './quit-confirmation';
import { m } from '../shared/paraglide/messages.js';
import { sendWorkspaceCommand as sendWorkspaceMenuCommand } from './menu-workspace-command';
import { openNewWindowFromMenu } from './menu-new-window';
import { toggleWindowDevTools } from './menu-devtools-toggle';
import { handleMenuZoom } from './menu-zoom';

import { registerMissingAgentHandlers } from '../features/agent/main/agent-missing.ipc';
import { registerVoiceLocalHandlers } from '../features/voice/main/voice-local.ipc';
import { cleanupStaleTempFiles } from '../shared/main/temp-files';
import {
  initSpecialistsService,
  refreshGitHubAuthStatus,
} from '../features/agent/main/specialists.service';
import { initAppSettingsService } from '../features/workspace/main/app-settings.service';
import { workspaceService } from '../features/workspace/main/workspace.service';

import { registerDeepLinkHandlers } from '../features/deeplink/main/deeplink.ipc';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { handlePairDeepLink, routePairLinkFromOs } from '../features/deeplink/main/pair-deep-link';
import { scrubToken } from '../features/deeplink/utils/scrub-token';
import { findIntentUrl } from '../features/deeplink/utils/find-intent-url';
import { isPairingUri } from '../shared/utils/pairing-uri';
import { registerChatExportHandlers } from '../features/export/main/export.ipc';
import { registerDebugExportHandlers } from '../features/debug-export/main/debug-export.ipc';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { registerWorkspacePRHandlers } from '../features/workspace/main/workspace-pr.ipc';
import { ipcCleanupManager } from './ipc-cleanup-manager';
import { setResolvedAppName } from './utils/resolve-app-title.js';
import { isHudWindow, isTrackedHudWindow } from './hud-window.js';
import { getBackendIdForWindow } from './window-backend.js';
import { buildWindowMenuEntries } from './window-menu-entries.js';
import { buildAboutDialogOptions, formatThirdPartyCredits } from './about-dialog.js';
import { getMainWindow } from './state';
import {
  captureWindowSessionsSnapshot,
  clearWindowSessionsSnapshot,
  createWindow,
  createWindowForDeepLink,
  getWindowSessionsPath,
  markWindowSessionTeardown,
  restoreAllBackendWindowSessions,
  saveAllWindowSessions,
  setOnLastWindowClosedForBackend,
  stampWindowWithBackend,
} from './window.js';
import {
  setupAppProtocolHandler,
  setupWorkspaceAssetProtocolHandler,
  setupWorkspaceFileProtocolHandler,
  setupWorkspaceMediaBackendHinting,
} from './protocol-handlers.js';

const logger = new Logger('Main');

let cdpMcpServer: CdpMcpBridge | null = null;
let isShuttingDown = false;

// Deep link handler for intent:// protocol URLs
const deepLinkHandler = new DeepLinkHandler();

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  handleUncaughtException(logger, error);
});

process.on('unhandledRejection', (reason, promise) => {
  handleUnhandledRejection(logger, reason, promise);
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

// Hard deadline for the gracefulShutdown() cleanup chain
// (intent-hq/monorepo#1300). 10s sits comfortably above the sidecar's own
// 5s SIGTERM→SIGKILL escalation inside stopIntentdSidecar().
const GRACEFUL_SHUTDOWN_HARD_EXIT_MS = 10_000;

async function gracefulShutdown() {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // Quit-time window closes (performGracefulShutdown's mainWindow.close())
  // are not deliberate per-backend closes: without this mark, closing the
  // last window of one backend while another backend's windows survive would
  // tombstone + prune the bucket that before-quit just saved. Every quit path
  // (before-quit, window-all-closed, SIGTERM/SIGINT) funnels through here
  // before any window is closed.
  markWindowSessionTeardown();

  // Bound the cleanup chain with a hard-exit watchdog: if a cleanup step
  // stalls and app.exit(0) is never reached, force-exit so SIGTERM/SIGINT
  // always terminate the process.
  await runWithHardExitTimeout(
    performGracefulShutdown,
    () => {
      logger.warn(
        // i18n-ignore (developer log message)
        `Graceful shutdown did not complete within the ${GRACEFUL_SHUTDOWN_HARD_EXIT_MS}ms hard-exit timeout — forcing exit`,
      );
      app.exit(1);
    },
    GRACEFUL_SHUTDOWN_HARD_EXIT_MS,
  );
}

async function performGracefulShutdown() {
  try {
    // Stop memory sampling first: it is pure instrumentation, and clearing its
    // interval here means no timer survives any of the quit paths (before-quit,
    // SIGTERM, SIGINT) that funnel through this function.
    stopMemoryMonitor();

    // Ask renderers to clear hardware-console lighting FIRST, while the
    // windows (which own the WebHID connection) are still alive. Bounded
    // (750ms overall ack timeout) and fail-soft — never throws, never delays
    // shutdown beyond the timeout, and stays well within the hard-exit
    // watchdog above.
    await requestHardwareConsoleLightingClear(BrowserWindow.getAllWindows(), ipcMain);

    // Cleanup terminals gracefully - this properly cleans up PTY processes
    // to prevent Napi::Error crashes during shutdown
    await cleanupTerminals();

    // Allow native conpty threads to complete their exit callbacks
    // before tearing down the Node environment. The conpty.cc background thread
    // calls tsfn.BlockingCall() then tsfn.Release() after the PTY process exits;
    // if the environment is torn down too quickly, the assertion at conpty.cc:110
    // fires. This delay gives those threads time to finish.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Dispose every pooled backend JSON-RPC client (closes the UDS/WSS sockets).
    try {
      disposeAllBackendClients();
      logger.info('Backend JSON-RPC clients disposed');
    } catch (error) {
      logger.error(
        // i18n-ignore (developer log message)
        'Error disposing backend clients:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Stop the intentd sidecar daemon (if we spawned it). SIGTERM with a grace
    // period, then SIGKILL. This runs AFTER disposeAllBackendClients() so the FE
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
          // i18n-ignore (developer log message)
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
          // i18n-ignore (developer log message)
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

/**
 * Persist every open backend's window sessions. Persisted activeId chooses the
 * first backend restored at boot; it is not the identity of every live window.
 */
async function saveOpenWindowSessions(): Promise<void> {
  await saveAllWindowSessions();
}

app.whenReady().then(async () => {
  startupMetrics.start('total');
  logger.info('Setting up critical IPC handlers for fast startup');

  // SECURITY: Setup webview security handlers early, before any windows are created
  setupWebviewSecurity();

  // WebHID handlers for the hardware console (silent grant for supported
  // Work Louder devices) — must be registered before any windows exist.
  setupHardwareConsoleMain(session.defaultSession);

  // Console-owner tracking (single hardware-input owner, #1928) — must attach
  // its browser-window-created/focus listeners before any windows exist so the
  // first boot window becomes the initial owner.
  setupConsoleOwnerTracking();

  // Keep window sessions file up-to-date so it's always available on quit/crash.
  // This debounced saver fires on window move/resize/navigate to ensure the sessions
  // file reflects the latest state even when before-quit can't capture windows (e.g.,
  // on Windows/Linux when closing the last window triggers app.quit()).
  let sessionSaveTimeout: NodeJS.Timeout | null = null;
  const debouncedSaveWindowSessions = () => {
    if (sessionSaveTimeout) clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(() => void saveOpenWindowSessions(), 1000);
  };

  // Dispose a non-local backend's pooled client when its last window is
  // explicitly closed (window.ts already excludes local). Guard against the
  // quit flow: before-quit closes every window, and per-backend disposal
  // there would race gracefulShutdown()'s own client teardown.
  setOnLastWindowClosedForBackend((backendId) => {
    if (isShuttingDown) return;
    disconnectBackendClient(backendId);
  });

  app.on('browser-window-created', (_event: Electron.Event, window: BrowserWindowType) => {
    stampWindowWithBackend(window);
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
    // Windows: forward mouse X-button app-commands to the renderer as
    // app:history-navigate IPC events (see src/main/app-command-navigation.ts).
    attachAppCommandHistoryNavigation(window);
    // macOS: forward swipe gestures (incl. Logi Options+ synthesized swipes
    // for mouse side buttons) the same way (see src/main/swipe-navigation.ts).
    attachSwipeHistoryNavigation(window);
  });

  // Set application menu with correct app name on macOS
  const { Menu } = require('electron');
  const isDevMode = process.env.NODE_ENV === 'development';
  const isMacOS = process.platform === 'darwin';

  // Resolve the main-process locale from the OS now that app.getLocale() is
  // available (the renderer syncs any explicit preference later over
  // app:set-language-preference).
  setMainLanguagePreference(getMainLanguagePreference());

  // Build version string with commit hash
  const commitHash = BUILD_CONFIG.GIT_COMMIT_HASH;
  const versionWithCommit = commitHash ? `${app.getVersion()} (${commitHash})` : app.getVersion();

  // Bundled sidecar intentd version: the pin is readable synchronously; the
  // build commit is filled in by refreshAboutPanelIntentdVersion once the
  // daemon is up (after startIntentdSidecar below).
  const pinnedIntentdVersion = readPinnedVersion({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });

  // Store about panel info for use in dialogs
  const aboutPanelInfo = {
    applicationName: appName,
    applicationVersion: versionWithCommit,
    copyright: '\u00A9 2026 Intent Contributors',
    intentdVersion: formatIntentdAboutVersion({ pinnedVersion: pinnedIntentdVersion }) ?? '',
  };

  const applyAboutPanelOptions = (): void => {
    if (!isMacOS) return;
    app.setAboutPanelOptions({
      applicationName: aboutPanelInfo.applicationName,
      applicationVersion: aboutPanelInfo.applicationVersion,
      ...(aboutPanelInfo.intentdVersion ? { version: aboutPanelInfo.intentdVersion } : {}),
      copyright: aboutPanelInfo.copyright,
      credits: formatThirdPartyCredits(),
    });
  };

  // Help → About dialog (all platforms; macOS additionally has the native
  // about panel in the app menu).
  const showAboutDialog = (): void => {
    const options = buildAboutDialogOptions(aboutPanelInfo);
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, options);
    } else {
      dialog.showMessageBox(options);
    }
  };

  // Set initial about panel options (macOS only)
  applyAboutPanelOptions();

  // Best-effort refresh of the bundled sidecar's build commit: reuse the
  // adoption handshake's cached info when it already carries a commit,
  // otherwise probe the local daemon's system.status once. Failure is silent —
  // the About box just keeps showing the pin (or omits the line entirely when
  // the pin is unreadable too), the same honest-degrade as the removed
  // provider CLI line.
  const refreshAboutPanelIntentdVersion = async (): Promise<void> => {
    try {
      const cached = getDaemonVersionInfo();
      let probedVersion = cached?.daemonVersion ?? null;
      let buildCommit = cached?.daemonBuildCommit ?? null;
      if (!buildCommit) {
        const probe = await probeDaemonVersion(resolveSocketPath(process.env));
        probedVersion = probe.version ?? probedVersion;
        buildCommit = probe.buildCommit ?? buildCommit;
      }
      const line = formatIntentdAboutVersion({
        pinnedVersion: pinnedIntentdVersion,
        probedVersion,
        buildCommit,
      });
      if (line && line !== aboutPanelInfo.intentdVersion) {
        aboutPanelInfo.intentdVersion = line;
        applyAboutPanelOptions();
      }
    } catch (err) {
      logger.debug('Could not get intentd build commit for about panel', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

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
        label: m.menu_no_recent_spaces(),
        enabled: false,
      });
    }

    const fileMenuItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: m.menu_new_window(),
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => {
          // New Window inherits the focused window's backend (falls back to
          // the main window's backend, then local) instead of the local default.
          openNewWindowFromMenu();
        },
      },
      {
        label: m.menu_new_workspace(),
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
        label: m.menu_new_agent(),
        accelerator: 'CmdOrCtrl+T',
        enabled: inWorkspace,
        // Don't register accelerator - let renderer handle Cmd+T first
        // so the terminal can intercept it when focused
        registerAccelerator: false,
        click: () => {
          sendWorkspaceCommand('menu:new-agent');
        },
      },
      {
        label: m.menu_new_note(),
        accelerator: 'CmdOrCtrl+Alt+N',
        enabled: inWorkspace,
        click: () => {
          sendWorkspaceCommand('menu:new-note');
        },
      },
      {
        label: m.menu_new_terminal(),
        accelerator: 'CmdOrCtrl+Alt+T',
        enabled: inWorkspace,
        click: () => {
          sendWorkspaceCommand('menu:new-terminal');
        },
      },
      {
        label: m.menu_new_browser(),
        accelerator: 'CmdOrCtrl+Alt+B',
        enabled: inWorkspace,
        click: () => {
          sendWorkspaceCommand('menu:new-browser');
        },
      },
      { type: 'separator' },
      {
        label: m.menu_open_recent(),
        submenu: recentWorkspacesSubmenu,
      },
      { type: 'separator' },
      {
        label: m.menu_import_workspace(),
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow() ?? getMainWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('menu:import-workspace');
          }
        },
      },
      { type: 'separator' },
    ];

    // Add Settings on Windows (before Close Window)
    if (!isMacOS) {
      fileMenuItems.push({
        label: m.menu_settings(),
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
        label: m.menu_close_tab(),
        accelerator: 'CmdOrCtrl+W',
        enabled: inWorkspace,
        // Don't register accelerator - let renderer handle Cmd+W first for tabs
        registerAccelerator: false,
        click: () => {
          sendWorkspaceCommand('menu:close-tab');
        },
      },
      {
        label: m.menu_close_window(),
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.close();
          }
        },
      },
      { type: 'separator' },
      {
        label: m.menu_reopen_closed_tab(),
        accelerator: 'CmdOrCtrl+Shift+T',
        enabled: inWorkspace,
        // Let the renderer compare workspace-tab, panel-tab, and column history.
        registerAccelerator: false,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            sendWorkspaceCommand('menu:reopen-closed-tab');
          }
        },
      },
    );

    // Add Exit on Windows (at the end of File menu)
    if (!isMacOS) {
      fileMenuItems.push({ type: 'separator' });
      fileMenuItems.push({
        label: m.menu_exit(),
        role: 'quit',
      });
    }

    return {
      label: m.menu_file(),
      submenu: fileMenuItems,
    };
  };

  const sendWorkspaceCommand = (channel: string): void => {
    sendWorkspaceMenuCommand(
      BrowserWindow.getFocusedWindow(),
      channel,
      getFocusedWindowWorkspaceId(),
    );
  };

  // Function to rebuild and set the application menu
  const rebuildMenu = async () => {
    // Check if focused window is in a workspace (for enabling/disabling tab menu items)
    const inWorkspace = isFocusedWindowInWorkspace();
    const fileMenu = await buildFileMenu();

    // Build the Window menu items
    const windowMenuItems: Electron.MenuItemConstructorOptions[] = [
      { role: 'minimize', label: m.menu_minimize(), accelerator: 'CmdOrCtrl+M' },
      { role: 'zoom', label: m.menu_window_fill() },
      { type: 'separator' },
      {
        label: m.menu_select_previous_tab(),
        accelerator: 'CmdOrCtrl+[',
        enabled: inWorkspace,
        // Let the renderer preserve editor and terminal ownership.
        registerAccelerator: false,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            sendWorkspaceCommand('menu:select-previous-tab');
          }
        },
      },
      {
        label: m.menu_select_next_tab(),
        accelerator: 'CmdOrCtrl+]',
        enabled: inWorkspace,
        // Let the renderer preserve editor and terminal ownership.
        registerAccelerator: false,
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            sendWorkspaceCommand('menu:select-next-tab');
          }
        },
      },
      { type: 'separator' },
    ];

    // Add 'Bring All to Front' only on macOS (role: 'front' is macOS-only)
    if (isMacOS) {
      windowMenuItems.push({ role: 'front', label: m.menu_bring_all_to_front() });
    }

    // Add the app's open windows to the Window menu, labeled by kind + backend.
    // External webview popups (OAuth/auth flows) are not app windows — skip them.
    const liveWindows = (BrowserWindow.getAllWindows() as BrowserWindowType[]).filter(
      (w) => !w.isDestroyed() && !isWebviewPopupWindow(w),
    );
    if (liveWindows.length > 0) {
      let connections: Awaited<ReturnType<typeof listConnections>> = [];
      try {
        connections = await listConnections();
      } catch {
        // Fall back to backend ids as labels
      }
      const entries = buildWindowMenuEntries(
        liveWindows.map((w) => ({
          windowId: w.id,
          isHud: isHudWindow(w) || isTrackedHudWindow(w),
          backendId: getBackendIdForWindow(w),
          isFocused: w.isFocused(),
        })),
        connections,
        {
          mainWindowLabel: appName,
          hudLabel: m.menu_window_hud_label(),
          localBackendLabel: m.menu_window_localBackend_label(),
        },
      );

      windowMenuItems.push({ type: 'separator' });
      for (const entry of entries) {
        windowMenuItems.push({
          label: entry.label,
          type: 'radio',
          checked: entry.checked,
          click: () => {
            const win = BrowserWindow.fromId(entry.windowId);
            if (win && !win.isDestroyed()) {
              if (win.isMinimized()) {
                win.restore();
              }
              win.focus();
            }
          },
        });
      }
    }

    // Build the Help menu items
    const helpMenuItems: Electron.MenuItemConstructorOptions[] = [];

    // About (all platforms) — carries the third-party license credits
    helpMenuItems.push({
      label: m.menu_about_app({ appName }),
      click: showAboutDialog,
    });

    // Check for Updates / Install CLI live in the app menu on macOS
    if (!isMacOS) {
      helpMenuItems.push({
        label: m.menu_check_for_updates(),
        click: async () => {
          logger.info('[Menu] Check for Updates clicked', { isDevMode });

          const { broadcastToRenderers } =
            await import('../features/auto-update/main/auto-update-broadcast');
          // Signal renderers to show toast immediately for responsive feedback
          broadcastToRenderers('auto-update:show-toast');

          if (isDevMode) {
            // In dev mode, auto-updater is not initialized
            // Send "up to date" notification directly
            logger.info('[Menu] Broadcasting auto-update:up-to-date to renderers');
            broadcastToRenderers('auto-update:up-to-date', {
              version: app.getVersion(),
              isDev: true,
            });
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
        label: m.menu_install_cli(),
        click: async () => {
          const mainWindow = getMainWindow();
          try {
            const result = await installIntentCli();
            if (result?.success) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: m.dialog_cli_install_title(),
                  message: result.message || m.dialog_cli_install_success(),
                });
              } else {
                dialog.showMessageBox({
                  type: 'info',
                  title: m.dialog_cli_install_title(),
                  message: result.message || m.dialog_cli_install_success(),
                });
              }
            } else {
              dialog.showErrorBox(
                m.dialog_cli_install_failed_title(),
                result?.message || m.dialog_cli_install_failed_message(),
              );
            }
          } catch (error) {
            dialog.showErrorBox(
              m.dialog_cli_install_error_title(),
              error instanceof Error ? error.message : m.dialog_cli_install_error_fallback(),
            );
          }
        },
      });
    }
    helpMenuItems.push({ type: 'separator' });

    // Add Show Release Notes (cross-platform, works in dev too — the renderer
    // fetches on demand and falls back to "not available" when there are none)
    helpMenuItems.push({
      label: m.menu_show_release_notes(),
      click: async () => {
        const targetWindow = BrowserWindow.getFocusedWindow() ?? getMainWindow();
        const { sendShowReleaseNotes } =
          await import('../features/release-notes/main/release-notes.ipc');
        sendShowReleaseNotes(targetWindow, { notes: null });
      },
    });

    // Add Export Debug Logs (cross-platform)
    helpMenuItems.push({
      label: m.menu_export_debug_logs(),
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
            filters: [{ name: m.dialog_zip_files_filter(), extensions: ['zip'] }],
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

    // Add Sample intentd Process (daemon-side capture via debug.sampleStacks,
    // PROTOCOL §5.43). Hidden on a Windows FE whose daemon is same-host (UDS,
    // no saved remote) — it can never support sampling (#1889); the menu is
    // rebuilt on 'backend-connection-changed' so the gate tracks changes. Any
    // other unsupported daemon surfaces its own error through the dialog below.
    if (shouldShowStackSampleMenuItem(process.platform, isSameHostBackendActive())) {
      helpMenuItems.push({
        label: m.menu_sample_intentd_process(),
        click: async () => {
          let samplePath: string | undefined;
          try {
            // Capture the sample into a temp file (blocks for the sampling window)
            ({ filePath: samplePath } = await createStackSampleFile());

            // Generate suggested filename with date
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const timeStr = now.toTimeString().slice(0, 5).replace(':', ''); // HHmm
            const suggestedFilename = `intentd-sample-${dateStr}-${timeStr}.txt`;

            // Show save dialog
            const { filePath, canceled } = await dialog.showSaveDialog({
              defaultPath: suggestedFilename,
              filters: [{ name: m.dialog_text_files_filter(), extensions: ['txt'] }],
            });

            if (canceled || !filePath) {
              // Clean up temp sample
              try {
                await fs.promises.unlink(samplePath);
              } catch {
                // Ignore cleanup errors
              }
              return;
            }

            // Move sample to final location
            await fs.promises.copyFile(samplePath, filePath);
            try {
              await fs.promises.unlink(samplePath);
            } catch {
              // Ignore cleanup errors — the sample was already saved
            }

            logger.info('intentd stack sample exported successfully', { filePath });
          } catch (error) {
            logger.error('Failed to sample intentd process', error as Error);
            if (samplePath) {
              try {
                await fs.promises.unlink(samplePath);
              } catch {
                // Ignore cleanup errors
              }
            }
            dialog.showErrorBox(
              m.dialog_sample_intentd_failed_title(),
              error instanceof Error ? error.message : m.dialog_sample_intentd_failed_message(),
            );
          }
        },
      });
    }

    // Build the template based on platform
    const template: Electron.MenuItemConstructorOptions[] = [];

    // Add app menu only on macOS
    if (isMacOS) {
      template.push({
        label: appName,
        submenu: [
          { role: 'about', label: m.menu_about_app({ appName }) },
          {
            label: m.menu_check_for_updates(),
            click: async () => {
              logger.info('[Menu] Check for Updates clicked', { isDevMode });

              const { broadcastToRenderers } =
                await import('../features/auto-update/main/auto-update-broadcast');
              // Signal renderers to show toast immediately for responsive feedback
              broadcastToRenderers('auto-update:show-toast');

              if (isDevMode) {
                // In dev mode, auto-updater is not initialized
                // Send "up to date" notification directly
                logger.info('[Menu] Broadcasting auto-update:up-to-date to renderers');
                broadcastToRenderers('auto-update:up-to-date', {
                  version: app.getVersion(),
                  isDev: true,
                });
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
            label: m.menu_settings(),
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              const focusedWindow = BrowserWindow.getFocusedWindow();
              if (focusedWindow && !focusedWindow.isDestroyed()) {
                focusedWindow.webContents.send('navigate', '/settings');
              }
            },
          },
          {
            label: m.menu_install_cli(),
            click: async () => {
              const mainWindow = getMainWindow();
              try {
                const result = await installIntentCli();
                if (result?.success) {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    dialog.showMessageBox(mainWindow, {
                      type: 'info',
                      title: m.dialog_cli_install_title(),
                      message: result.message || m.dialog_cli_install_success(),
                    });
                  } else {
                    dialog.showMessageBox({
                      type: 'info',
                      title: m.dialog_cli_install_title(),
                      message: result.message || m.dialog_cli_install_success(),
                    });
                  }
                } else {
                  dialog.showErrorBox(
                    m.dialog_cli_install_failed_title(),
                    result?.message || m.dialog_cli_install_failed_message(),
                  );
                }
              } catch (error) {
                dialog.showErrorBox(
                  m.dialog_cli_install_error_title(),
                  error instanceof Error ? error.message : m.dialog_cli_install_error_fallback(),
                );
              }
            },
          },
          { type: 'separator' },
          { role: 'services', label: m.menu_services() },
          { type: 'separator' },
          { role: 'hide', label: m.menu_hide_app({ appName }) },
          { role: 'hideOthers', label: m.menu_hide_others() },
          { role: 'unhide', label: m.menu_show_all() },
          { type: 'separator' },
          { role: 'quit', label: m.menu_quit_app({ appName }) },
        ],
      });
    }

    // Add standard menus (File, Edit, View, Window, Help)
    // Electron never localizes built-in role labels, so every role item gets
    // an explicit label from the message catalog. The Edit menu mirrors the
    // default `editMenu` role expansion for this Electron version
    // (per-platform structure included) with the roles kept for behavior.
    template.push(
      fileMenu,
      {
        label: m.menu_edit(),
        submenu: [
          { role: 'undo', label: m.menu_undo() },
          { role: 'redo', label: m.menu_redo() },
          { type: 'separator' },
          { role: 'cut', label: m.menu_cut() },
          { role: 'copy', label: m.menu_copy() },
          { role: 'paste', label: m.menu_paste() },
          ...(isMacOS
            ? ([
                { role: 'pasteAndMatchStyle', label: m.menu_paste_and_match_style() },
                { role: 'delete', label: m.menu_delete() },
                { role: 'selectAll', label: m.menu_select_all() },
                { type: 'separator' },
                {
                  label: m.menu_substitutions(),
                  submenu: [
                    { role: 'showSubstitutions', label: m.menu_show_substitutions() },
                    { type: 'separator' },
                    { role: 'toggleSmartQuotes', label: m.menu_smart_quotes() },
                    { role: 'toggleSmartDashes', label: m.menu_smart_dashes() },
                    { role: 'toggleTextReplacement', label: m.menu_text_replacement() },
                  ],
                },
                {
                  label: m.menu_speech(),
                  submenu: [
                    { role: 'startSpeaking', label: m.menu_start_speaking() },
                    { role: 'stopSpeaking', label: m.menu_stop_speaking() },
                  ],
                },
              ] as Electron.MenuItemConstructorOptions[])
            : ([
                { role: 'delete', label: m.menu_delete() },
                { type: 'separator' },
                { role: 'selectAll', label: m.menu_select_all() },
              ] as Electron.MenuItemConstructorOptions[])),
        ],
      },
      {
        label: m.menu_view(),
        submenu: [
          {
            label: m.menu_reload(),
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
          { role: 'forceReload', label: m.menu_force_reload() },
          { type: 'separator' },
          {
            label: m.menu_toggle_devtools(),
            accelerator: isMacOS ? 'Alt+Command+I' : 'Ctrl+Shift+I',
            // Don't use role: 'toggleDevTools' — it targets
            // getFocusedWebContents(), which can be a hidden offscreen
            // keep-alive <webview> guest (intent-hq/monorepo#2844). Always
            // toggle DevTools for the focused window's own renderer.
            click: () => {
              toggleWindowDevTools(BrowserWindow.getFocusedWindow());
            },
          },
          { type: 'separator' },
          {
            label: m.menu_actual_size(),
            accelerator: 'CmdOrCtrl+0',
            click: () => handleMenuZoom('menu:reset-zoom', sendWorkspaceCommand),
          },
          {
            label: m.menu_zoom_in(),
            accelerator: 'CmdOrCtrl+=',
            click: () => handleMenuZoom('menu:zoom-in', sendWorkspaceCommand),
          },
          {
            label: m.menu_zoom_out(),
            accelerator: 'CmdOrCtrl+-',
            click: () => handleMenuZoom('menu:zoom-out', sendWorkspaceCommand),
          },
          { type: 'separator' },
          { role: 'togglefullscreen', label: m.menu_toggle_fullscreen() },
        ],
      },
      {
        label: m.menu_window(),
        submenu: windowMenuItems,
      },
      {
        label: m.menu_help(),
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

  // Rebuild menu when the main-process locale changes (renderer synced a new
  // language preference over app:set-language-preference); the macOS about
  // panel's localized credits are re-applied for the same reason.
  app.on('main-locale-changed', () => {
    applyAboutPanelOptions();
    rebuildMenu();
  });

  // Rebuild menu when the active backend changes (backend switch or boot
  // restore of a remote) — the Help ▸ Sample intentd Process item is gated on
  // win32 + local sidecar (#1889)
  app.on('backend-connection-changed', () => {
    rebuildMenu();
  });

  // Rebuild menu when connection records change (add/forget/rename/hostname
  // capture) so window entries pick up fresh backend labels
  app.on('connections-changed', () => {
    rebuildMenu();
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

  // workspace-file:// is needed in both dev and production (workspace file images)
  setupWorkspaceFileProtocolHandler();

  // Stamp the requesting window's backend onto workspace media requests so a
  // workspace id shared across backends is served by the right daemon.
  setupWorkspaceMediaBackendHinting();

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

  // Setup ONLY critical IPC handlers needed for initial render
  // This significantly improves startup time
  startupMetrics.start('criticalIPC');

  // Initialize specialists service BEFORE workspace IPC - this is critical!
  // The instruction service calls formatSpecialistsForPrompt(), which needs the
  // specialist file cache initialized.
  await initSpecialistsService();

  // Initialize app settings service for branch prefix and other settings
  await initAppSettingsService();

  setupWorkspaceIPC();
  setupWorkspaceSummaryIPC();
  setupFileIPC();
  setupSystemIPC();
  await setupConfigIPC();
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
  setupUnslothIPC(); // Needed for unsloth:get-models
  setupAntigravityIPC(); // Needed for antigravity:get-models
  setupFeatureCodesIPC(); // Feature codes for gating experimental features
  setupProviderAvailabilityIPC(); // Needed for providers:get-availability
  setupEventsIPC(); // Needed for events:query
  registerSetupScriptsHandlers(); // Needed for onboarding setup scripts
  registerAcceptChangesHandlers(); // Needed for the Changes sidebar on workspace open

  setupTerminalIPC(); // Needed for CLI blocks in notes (includes get-buffer handler)
  registerChatExportHandlers(); // Needed for chat export functionality
  registerDebugExportHandlers(); // Needed for debug log export functionality

  // Pass the shared ConfigManager to workspace rules service
  const configManager = getConfigManager();
  await setupWorkspaceRulesIPC(configManager || undefined); // Needed for initial agent system prompt
  setupSpecialistsIPC(); // Needed for specialist selection on startup
  setupAutoUpdateIPC(); // Needed for auto-update IPC on startup
  setupReleaseNotesIPC(); // Needed for the Help ▸ Show Release Notes fetch

  // Start the intentd sidecar daemon (if spawn policy allows). This MUST run
  // before registerBackendHandlers() so the daemon is ready before the first
  // JSON-RPC client connection attempt. Adoption logic (probe socket first)
  // ensures we don't spawn when an external daemon is already running.
  await startIntentdSidecar(process.env, app.isPackaged, process.resourcesPath, process.cwd());

  // Per-process memory sampling → console-output.log, so a debug bundle can
  // name the process that grew. Started after the daemon so the very first
  // sample already sees the sidecar and its agent children.
  startMemoryMonitor();

  // The daemon owns PATH discovery. Seed only after starting/adopting it, and
  // retry briefly while a newly spawned sidecar creates its socket.
  await seedPathFromHostEnv();

  // Fill in the bundled sidecar's build commit on the About box now that the
  // daemon is up (fire-and-forget; see refreshAboutPanelIntentdVersion above).
  void refreshAboutPanelIntentdVersion();

  registerBackendHandlers(); // Needed for live JSON-RPC transport (workspaces domain)
  registerWorkspaceTransferHandlers(); // Workspace transfer relay (wizard steps 3–4)
  registerWorkspaceImportHandlers(); // Import Workspace from File (File menu)

  // Hydrate the main-process provider catalog cache (non-blocking): the
  // JSON-RPC client queues the request until the daemon socket connects.
  const { primeProviderCatalog } = await import('./utils/provider-catalog-accessor.js');
  primeProviderCatalog();

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
    registerVoiceLocalHandlers(); // Local OS transcription (macOS speech helper)

    // MINIMAL REFACTOR: Commenting out duplicate IPC handler
    registerAgentContextHandlers();

    // setupTerminalIPC(); // Already called in critical IPC setup
    setupLogIPC();
    // setupAuggieIPC(); // Already called in critical IPC setup
    // setupEventsIPC(); // Already called in critical IPC setup
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

    // setupAutoUpdateIPC(); // Already called in critical IPC setup
    // Initialize auto-updater in production. Runs BEFORE any awaited step in
    // this task so the GET_STATE boot gate is always settled — a rejection in
    // a later awaited import must not leave boot-time GET_STATE waiters
    // hanging. (auto-update.ipc is statically imported above, so this dynamic
    // import is a cache hit.)
    const { initializeAutoUpdater, markAutoUpdaterNotInitialized } =
      await import('../features/auto-update/main/auto-update.ipc');
    if (process.env.NODE_ENV !== 'development' && process.env.TESTING !== 'true') {
      // Initialize regardless of whether a window exists yet
      // (intent-hq/monorepo#1848): this setImmediate task can run before
      // window creation — the outer flow awaits getActiveId() first, which
      // yields the event loop — and gating on the window used to skip
      // initialization for the whole session, leaving manual checks to die in
      // the watchdog timeout. Renderer notifications broadcast to whatever
      // windows are live at send time.
      initializeAutoUpdater();
    } else {
      // Dev mode: the updater never initializes — unblock boot-time
      // GET_STATE waiters so they answer the default state.
      markAutoUpdaterNotInitialized();
    }

    // Setup browser debugger IPC handlers for CDP access to embedded browser tabs
    const { registerBrowserHandlers } = await import('../features/browser/main/browser.ipc');
    registerBrowserHandlers();

    // Show this version's release notes on the first launch after an update.
    // Packaged builds only — a dev build's version is never a published tag.
    // Run regardless of whether a window exists yet (intent-hq/monorepo#3054,
    // same race as #1848 above): this setImmediate task can run before window
    // creation, and gating on the window skipped the check — and the pref
    // advance — for the whole session. The window is resolved at send time
    // inside the check; with no window the notes park as pending for the
    // renderer's get-pending claim.
    if (app.isPackaged) {
      const { initializeReleaseNotesOnStartup } =
        await import('../features/release-notes/main/release-notes.ipc');
      void initializeReleaseNotesOnStartup(getMainWindow);
    }

    // Setup development-only IPC handlers
    if (process.env.NODE_ENV === 'development') {
      // Debug tools for testing backend-initiated flows
      const { setupDebugIPC } = await import('../features/debug/main/debug.ipc');
      setupDebugIPC();
    }

    // Event-triggered handlers (message delivery, auto-commit) are now sagas
    // forked from workspaceEventsSaga — no manual registration needed.

    // Legacy workspace-location migration removed — the daemon owns workspace
    // directories (PROTOCOL.md §5.1); the FE no longer moves data on disk.

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
    const intentUrlArg = findIntentUrl(process.argv);
    const isPairLinkArg = intentUrlArg !== undefined && isPairingUri(intentUrlArg);

    // A pair link is handled fully in the main process: park it now and let
    // the pending-URL pass after window creation route it to the pair handler.
    // It is never embedded in the renderer load URL — createWindow skips it.
    if (intentUrlArg !== undefined && isPairLinkArg) {
      await deepLinkHandler.handleDeepLink(intentUrlArg, null);
    }

    // Try to restore saved window sessions (unless we have a deep link to
    // process, which keeps its single-window bypass — pair links are exempt:
    // they embed nothing in a window, so a pair cold start restores sessions
    // normally and then connects/foregrounds the linked backend on top).
    // EVERY backend with a saved session bucket is restored, each bucket's
    // windows stamped with its own backend id and backed by its own pooled
    // client (fail-soft — an
    // unreachable backend still gets its windows behind the stopped overlay).
    // The last-used bucket (persisted activeId, legacy field) restores first
    // and provides the main window; each backend's own pooled client connects
    // on demand, so no boot-time reconciliation of the field is needed.
    const bootBackendId = await getActiveId();
    const restored =
      intentUrlArg && !isPairLinkArg
        ? false
        : await restoreAllBackendWindowSessions(bootBackendId, connectBackendClient);
    if (!restored) {
      // No saved sessions anywhere (or has deep link) — create a single default
      // window. A remote boot backend needs its pooled client connected first
      // (only the local client is created lazily); if its client cannot be
      // built (deleted record, missing token), fall back to a local window
      // rather than one whose every RPC fails closed.
      let windowBackendId = bootBackendId;
      if (bootBackendId !== LOCAL_CONNECTION_ID) {
        try {
          await connectBackendClient(bootBackendId);
        } catch (error) {
          logger.warn('Boot backend has no connectable client; opening a local window', {
            backendId: bootBackendId,
            error: error instanceof Error ? error.message : String(error),
          });
          windowBackendId = LOCAL_CONNECTION_ID;
        }
      }
      createWindow(windowBackendId);
    }

    startupMetrics.end('createWindow');
  }

  // GitHub-dependent specialist filtering is noncritical for first paint. Start
  // its daemon-backed refresh only after backend handlers and the first window
  // are available; the service conservatively hides those specialists until it
  // completes. Do not await this on the first-window startup path.
  void refreshGitHubAuthStatus();

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

    // The legacy self-connecting bridge is opt-in because connecting Electron to
    // its own CDP endpoint can trigger a native SIGTRAP. External CDP remains enabled.
    if (isCdpMcpBridgeEnabled(process.env)) {
      startupMetrics.start('cdpMcpServer');
      try {
        const { CdpMcpBridge } = await import('./cdp-mcp-bridge');
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

// The running-agent confirmation prompt lives in quit-confirmation.ts so the
// auto-update service can run it BEFORE quitAndInstall() without importing
// this module (index.ts imports auto-update.service.ts — importing back would
// be circular). Shared between `before-quit` (Cmd+Q path) and
// `window-all-closed` (non-macOS last-window-close path) so both paths honor
// the prompt.

app.on('before-quit', async (event: Electron.Event) => {
  logger.info('App before-quit event triggered');

  // Only prevent default and run gracefulShutdown if we're not already shutting down
  if (!isShuttingDown) {
    event.preventDefault();

    // Save window sessions now that quit is prevented.
    // Must be called AFTER event.preventDefault() because saveWindowSessions is async
    // and preventDefault must be called synchronously within the event handler.
    await saveOpenWindowSessions();

    // Skip the prompt when quitting to install an update: installUpdate()
    // already ran the confirmation while the windows were still open, so
    // re-prompting here would double-prompt the confirmed install path.
    if (!isInstallingUpdate) {
      const proceed = await confirmQuitWithRunningAgents();
      if (!proceed) {
        return;
      }
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
          // i18n-ignore (developer log message)
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
      await saveOpenWindowSessions();
    } catch (err) {
      logger.error(
        // i18n-ignore (developer log message)
        'Failed to save window sessions on window-all-closed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    // Delegate the confirmed-quit teardown to gracefulShutdown(), which is the
    // same path before-quit (Cmd+Q) uses. gracefulShutdown() sets
    // isShuttingDown=true internally (so any subsequent before-quit is a
    // no-op), runs the full cleanup ordering — including the items only it
    // performs (cleanupTerminals + settling delay,
    // cleanupAutoUpdater) — and
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
        // i18n-ignore (developer log message)
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
  logger.info('Received open-url event:', { url: scrubToken(url) });

  // Pair links bypass the renderer/window pipeline entirely: handled in the
  // main process whenever the app is ready — the flow needs no existing
  // window (the confirm dialog can show parentless and openBackendWindow
  // creates its own window), which covers macOS staying alive with zero
  // windows open. Before ready, parked as pending for the startup pass.
  if (isPairingUri(url)) {
    await routePairLinkFromOs(url, (pending) => deepLinkHandler.handleDeepLink(pending, null));
    return;
  }

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
  // i18n-ignore (developer log message)
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
    logger.info('Received second-instance event:', { commandLine: commandLine.map(scrubToken) });

    // Look for intent:// URL in command line arguments
    const deepLinkUrl = findIntentUrl(commandLine);

    if (deepLinkUrl) {
      logger.info('Found deep link URL in second instance:', { url: scrubToken(deepLinkUrl) });
      if (isPairingUri(deepLinkUrl)) {
        // Pair links go straight to the main-process handler — the first
        // instance is already running, so no parking or window is needed.
        await handlePairDeepLink(deepLinkUrl);
      } else {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          await createWindowForDeepLink(deepLinkUrl, deepLinkHandler);
        }
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

app.on('activate', async () => {
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
    // No windows at all — restore every backend's saved sessions (same
    // multi-bucket restore as boot) or create a new one. The active backend
    // (T21) restores first and provides the main window, so a dock-click
    // reopen never keys everything to the hard-coded local default.
    const backendId = await getActiveId();
    const restored = await restoreAllBackendWindowSessions(backendId, connectBackendClient);
    if (!restored) {
      createWindow(backendId);
    }
  }
});
