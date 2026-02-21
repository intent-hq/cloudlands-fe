/**
 * Main Process Entry Point
 *
 * Sets up all IPC handlers for the application
 */

// CRITICAL: Import build-time config FIRST
// These values are baked in at build time from .env (see scripts/generate-build-config.cjs)
// This ensures Sentry config is available in production builds without shipping .env
import { BUILD_CONFIG } from './build-config.generated.js';

// CRITICAL: Initialize Sentry SECOND, before anything else
// This ensures we capture all errors from the very start
import * as Sentry from '@sentry/electron/main';

// Import electron early to check app.isPackaged for reliable environment detection
// We need createRequire for CommonJS compatibility with electron
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ipcMain, app, BrowserWindow, screen, nativeTheme } = require('electron');

// PERF: Enable --expose-gc to allow manual GC on critical memory pressure
// This must be done before app.isReady() and only triggers GC when memory is critically high
// See memoryMonitor.onPressure handler below for usage
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// Use app.isPackaged for reliable production detection
// This is true when running from a packaged app (dmg, exe), false in development
const isProduction = app.isPackaged;
const environment = isProduction ? 'production' : 'development';

/**
 * Check if a Sentry exception should be filtered out before sending.
 * Filters known benign errors that don't need to be reported.
 */
function shouldFilterMainProcessException(exception: { type?: string; value?: string }): boolean {
  const { type, value } = exception;

  // Filter "Canceled" errors - these are benign cancellation signals
  if (type === 'Canceled' || value === 'Canceled' || value?.includes('Canceled: Canceled')) {
    return true;
  }

  // Filter EPIPE errors - these are benign broken pipe errors that occur when
  // a child process exits before its stdin/stdout pipe is fully consumed.
  // This is a normal race condition in process lifecycle management.
  if (value?.includes('EPIPE')) {
    return true;
  }

  // Filter minified bits-ui/Svelte 5 snippet call errors from renderer process.
  // In @sentry/electron, renderer events may be forwarded through the main process SDK.
  // The renderer's beforeSend should catch these, but this is a safety net.
  // See: https://github.com/huntabyte/bits-ui/discussions/1302
  if (
    type === 'TypeError' &&
    value &&
    /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(value)
  ) {
    return true;
  }

  return false;
}

Sentry.init({
  dsn: BUILD_CONFIG.SENTRY_DSN,
  environment,
  release: BUILD_CONFIG.SENTRY_RELEASE,
  tracesSampleRate: isProduction ? 0.25 : 1.0,
  enabled: !!BUILD_CONFIG.SENTRY_DSN,
  debug: !isProduction, // Only enable debug in development
  // Filter out known benign errors
  beforeSend: (event) => {
    const exceptions = event.exception?.values || [];
    for (const ex of exceptions) {
      if (shouldFilterMainProcessException(ex)) {
        return null; // Drop the event
      }
    }
    return event;
  },
});

// Log Sentry initialization status
if (BUILD_CONFIG.SENTRY_DSN) {
  console.log('[Sentry] Initialized', {
    environment,
    release: BUILD_CONFIG.SENTRY_RELEASE,
    isPackaged: app.isPackaged,
  });
} else {
  console.warn('[Sentry] Not initialized - SENTRY_DSN not set');
}

// NOTE: Git-specific environment variables are applied per-command in shared/git/git-env.ts
// to avoid leaking non-interactive settings into user terminals.

// Base dev port used for deriving instance numbers (keeps menu/window titles unique)
const DEV_PORT_BASE = 5177;

function resolveDevInstance(): string {
  const envInstance = (process.env.DEV_INSTANCE || '').trim();
  if (envInstance) return envInstance;

  const devPort = Number(process.env.DEV_PORT);
  if (Number.isFinite(devPort) && devPort >= DEV_PORT_BASE) {
    return String(devPort - DEV_PORT_BASE + 1);
  }

  return '';
}

/**
 * Build the window/app title.
 * - In production: "Intent"
 * - In dev with --name: "Intent [MyName]"
 * - In dev without --name: "Intent [Dev N]" or "Intent [Dev]"
 */
function resolveAppTitle(): string {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) return 'Intent';

  const devName = (process.env.DEV_NAME || '').trim();
  if (devName) return `Intent [${devName}]`;

  const devInstance = resolveDevInstance();
  return devInstance ? `Intent [Dev ${devInstance}]` : 'Intent [Dev]';
}

function decodeUrlPath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function safeResolvePath(root: string, requestPath: string): string | null {
  const rootPath = path.resolve(root);
  const resolvedPath = path.resolve(rootPath, requestPath);
  if (resolvedPath === rootPath || resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    return resolvedPath;
  }
  return null;
}

// Set app name early - in dev mode, show custom name or "Intent [Dev N]" in dock/menu bar
const isDev = process.env.NODE_ENV === 'development';
app.setName(resolveAppTitle());

// Track registered handlers globally
const __registeredHandlers = new Set<string>();
(global as any).__ipcRegisteredHandlers = __registeredHandlers;

// Store the original handle method
const originalHandle = ipcMain.handle.bind(ipcMain);

// Override ipcMain.handle using Object.defineProperty
// Silent registration - we'll log a summary at the end instead of per-handler
Object.defineProperty(ipcMain, 'handle', {
  value(channel: string, handler: any) {
    __registeredHandlers.add(channel);
    // Silent - no per-handler logging to reduce noise
    return originalHandle(channel, handler);
  },
  writable: false,
  configurable: true,
});

// Register Sentry config IPC handler EARLY so renderer can get config
// Uses BUILD_CONFIG for DSN/release, and app.isPackaged for environment detection
ipcMain.handle('sentry:get-config', () => ({
  dsn: BUILD_CONFIG.SENTRY_DSN,
  environment, // Uses the environment variable defined above (based on app.isPackaged)
  release: BUILD_CONFIG.SENTRY_RELEASE,
}));

// Register Analytics (Segment) config IPC handler EARLY so renderer can initialize
ipcMain.handle('analytics:get-config', () => ({
  writeKey: BUILD_CONFIG.SEGMENT_WRITE_KEY || null,
  enabled: !!BUILD_CONFIG.SEGMENT_WRITE_KEY,
}));

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
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../shared/logger';
import { exportHandlerDebugInfo, setupIPCInterceptor } from './ipc-handler-wrapper';
import { initializeWarningSuppression } from './utils/suppress-warnings';
import { setupWebviewSecurity } from './webview-security';
import { createDebugBundle } from '../features/debug-export/main/debug-bundle.service';

// No custom protocol needed - we'll use file:// protocol
import { ipcDebugTracker } from '../shared/main/ipc-debug-tracker';
import { memoryMonitor } from '../shared/main/memory-monitor';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Early startup timing for diagnostics
const startupStartTime = Date.now();
const logStartupTiming = (phase: string) => {
  const elapsed = Date.now() - startupStartTime;
  console.log(`[Startup ${elapsed}ms] ${phase}`);
};
logStartupTiming('Module initialization complete');

// Fix PATH for macOS GUI apps (when launched from Finder)
// This must be done as early as possible, before any other modules are loaded
const mainLogger = new Logger('Main');
if (process.platform === 'darwin' && !process.env.RUNNING_IN_TERMINAL) {
  // CRITICAL: Pre-populate PATH with essential system directories BEFORE fix-path
  // This is necessary because fix-path itself needs to spawn a shell,
  // which requires /bin/sh to be in PATH. When Electron apps are launched
  // from Finder, PATH may not include /bin or /usr/bin, causing fix-path to fail.
  const essentialPaths = [
    '/bin',
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin', // Apple Silicon Homebrew
    '/usr/sbin',
    '/sbin',
  ];

  const currentPath = process.env.PATH || '';
  const pathSet = new Set(currentPath.split(':').filter(Boolean));

  // Add essential paths if not already present
  for (const p of essentialPaths) {
    pathSet.add(p);
  }

  process.env.PATH = Array.from(pathSet).join(':');
  mainLogger.info('Pre-populated PATH with essential system directories', {
    path: process.env.PATH,
  });

  // Now run fix-path with a timeout to get the user's full shell PATH
  // This adds user-specific paths like ~/.nvm, ~/.cargo, etc.
  const fixPathPromise = (async () => {
    try {
      const fixPath = await import('fix-path');
      fixPath.default();
      mainLogger.info('Fixed PATH for macOS GUI app', { path: process.env.PATH });
    } catch (error) {
      mainLogger.warn(
        'Failed to fix PATH, app may have issues finding npm/auggie when launched from Finder',
        { error },
      );
    }
  })();

  // Don't block startup - let fix-path run in background with timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      mainLogger.warn('fix-path took too long, continuing without waiting');
      resolve();
    }, 2000); // 2 second timeout
  });

  await Promise.race([fixPathPromise, timeoutPromise]);
}
logStartupTiming('fix-path complete');

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
import { setupAgentTestingIPC } from '../features/agent-testing/main/agent-testing.ipc';
import { registerAgentContextHandlers } from '../features/agent/agent-context.ipc';
import { setupConfigIPC as setupAgentConfigIPC } from '../features/agent/main/config.ipc';
import {
  initializeUnifiedBackend,
  shutdownUnifiedBackend,
} from '../features/agent/main/init-unified-backend';
import { setupPersistenceIPC } from '../features/agent/main/persistence.ipc';
import { setupAuggieIPC } from '../features/auggie/main/auggie.ipc';
import { setupOpencodeIPC } from '../features/opencode/main/opencode.ipc';
import { setupClaudeCodeIPC } from '../features/claude-code/main/claude-code.ipc';
import { setupCodexIPC } from '../features/codex/main/codex.ipc';
import { setupCortexIPC } from '../features/cortex/main/cortex.ipc';
import { setupFeatureCodesIPC } from '../features/feature-codes/main/feature-codes.ipc';
import { setupProviderAvailabilityIPC } from '../features/providers/main/provider-availability.service';
import { setupCommentsIPC } from '../features/comments/main/comments.ipc';
import { setupConfigIPC } from '../features/config/main/config.ipc';
import { setupDiffsIPC } from '../features/diffs/main/diffs.ipc';
import { setupEditorIPC } from '../features/editor/main/editor.ipc';
import { setupEventsIPC } from '../features/events/main/events.ipc';
import { registerExternalEditorsHandlers } from '../features/external-editors/main/external-editors.ipc';
import { setupFileTrackingIPC } from '../features/file-tracking/main/file-tracking.ipc';
import { setupFileIPC } from '../features/file/main/file.ipc';
import { setupGitTrackingIPC } from '../features/git-tracking/main/git-tracking.ipc';
import { setupGitIPC } from '../features/git/main/git.ipc';
import { setupGitHubAuthIPC } from '../features/github-auth/main/github-auth.ipc';
import { registerIDEHandlers } from '../features/ide/main/ide.ipc';
import { setupPanelLayoutHistoryIPC } from '../features/layout/main/panel-layout-history.ipc';
import { registerLineChangesIPC } from '../features/line-changes/line-changes.ipc';
import { setupLinearAuthIPC } from '../features/linear-auth/main/linear-auth.ipc';
import { setupLogIPC } from '../features/log/main/log.ipc';
import { setupMCPIPC, cleanupMCP } from '../features/mcp/mcp.ipc';
import { setupMemoriesIPC } from '../features/memories/main/memories.ipc';
import { setupAssetsIPC } from '../features/notes/main/assets.ipc';
import { setupLineAttributionIPC } from '../features/notes/main/line-attribution.ipc';
import { lineAttributionService } from '../features/notes/main/line-attribution.service';
import { setupNotesPrimitivesIPC, cleanupNoteTerminals } from '../features/notes/main/notes-primitives.ipc';
import { setupNotesIPC } from '../features/notes/main/notes.ipc';
import { setupNotificationIPC } from '../features/notifications/main/notification.ipc';
import { setupObservabilityIPC, cleanupObservability } from '../features/observability/main/observability.ipc';
import { setupRemoteFileSystemIPC } from '../features/remote-fs/main/remote-fs.ipc';
import { setupRulesIPC } from '../features/rules/main/rules.ipc';
import { setupSpecialistsIPC } from '../features/specialists/main/specialists.ipc';
import { setupUserRulesIPC as setupWorkspaceRulesIPC } from '../features/rules/main/user-rules.ipc';
import { setupSandboxIPC } from '../features/sandbox/main/sandbox.ipc';
import { setupSentryAuthIPC } from '../features/sentry-auth/main/sentry-auth.ipc';
import { registerSetupScriptsHandlers } from '../features/setup-scripts/main/setup-scripts.ipc';
import {
  setupSystemIPC,
  isFocusedWindowInWorkspace,
  isFocusedWindowBrowserActive,
  getFocusedWindowWorkspaceId,
  installIntentCli,
  autoRepairCliSymlink,
} from '../features/system/main/system.ipc';
import { cleanupTerminals, setupTerminalIPC } from '../features/terminal/main/terminal.ipc';
import { setupTestingIPC } from '../features/testing/main/testing.ipc';
import { setupThirdPartySourcesIPC } from '../features/third-party-sources/main/third-party-sources.ipc';
import { setupUserActivityIPC } from '../features/user-activity/main/user-activity.ipc';
import { setupFirstVisitStateIPC } from '../features/workspace/main/first-visit-state.ipc';
import { setupFileAttributionIPC } from '../features/workspace/main/provenance/file-attribution.ipc';
import { setupRepoConfigIPC } from '../features/workspace/main/repo-config.ipc';
import {
  initializeChangeDetectorManager,
  setupWorkspaceIPC,
} from '../features/workspace/main/workspace.ipc';
import { startupMetrics } from '../utils/startup-metrics';
import { CdpMcpBridge } from './cdp-mcp-bridge';
import { HttpMcpBridge } from './http-mcp-bridge';

import { agentBackendHandler } from '../features/agent/main/agent-backend-handler.service';
import { registerMissingAgentHandlers } from '../features/agent/main/agent-missing.ipc';
import { agentPoolService } from '../features/agent/main/agent-pool.service';
import { cleanupStaleTempFiles } from '../features/agent/main/agent-providers/acp-provider';
import { initializeUnifiedAgentHandlers } from '../features/agent/main/init-unified-handlers';
import { initSpecialistsService } from '../features/agent/main/specialists.service';
import { initAppSettingsService } from '../features/workspace/main/app-settings.service';
import { getConfigManager } from '../features/config/main/config.ipc';
import { registerDeepLinkHandlers } from '../features/deeplink/main/deeplink.ipc';
import { DeepLinkHandler } from '../features/deeplink/deep-link-handler';
import { eventHandlerRegistry } from '../features/events/main/event-handler-registry';
import { registerEventTriggeredAgents } from '../features/events/main/event-triggered-agents';
import { registerChatExportHandlers } from '../features/export/main/export.ipc';
import { registerDebugExportHandlers } from '../features/debug-export/main/debug-export.ipc';
import { protocolAdapter } from '../features/protocol/main/protocol-adapter';
import { registerSSHHandlers } from '../features/ssh/main/ssh.ipc';
import { registerWorkspacePRHandlers } from '../features/workspace/main/workspace-pr.ipc';
import { ipcCleanupManager } from './ipc-cleanup-manager';

const logger = new Logger('Main');

let mainWindow: BrowserWindowType | null = null;
let httpMcpServer: HttpMcpBridge | null = null;
let cdpMcpServer: CdpMcpBridge | null = null;
let isShuttingDown = false;
let httpMcpHealthCheckInterval: NodeJS.Timeout | null = null;

// Deep link handler for intent:// protocol URLs
const deepLinkHandler = new DeepLinkHandler();

// Global error handlers to prevent silent crashes
process.on('uncaughtException', (error) => {
  // Suppress webview navigation errors (ERR_ABORTED happens when switching URLs)
  const errMsg = error?.message || String(error);
  if (errMsg.includes('GUEST_VIEW_MANAGER_CALL') && errMsg.includes('ERR_ABORTED')) {
    return; // Silently ignore webview navigation abort errors
  }
  Sentry.captureException(error, { tags: { type: 'uncaughtException' } });
  logger.error('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason, promise) => {
  // Suppress webview navigation errors (ERR_ABORTED happens when switching URLs)
  const errMsg = reason instanceof Error ? reason.message : String(reason);
  if (errMsg.includes('GUEST_VIEW_MANAGER_CALL') && errMsg.includes('ERR_ABORTED')) {
    return; // Silently ignore webview navigation abort errors
  }
  Sentry.captureException(reason, { tags: { type: 'unhandledRejection' } });
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
    // to prevent Napi::Error crashes during shutdown (AUGMENT-INTENT-8)
    await cleanupTerminals();

    // Kill any active note terminal processes (exec() spawns via shell,
    // so these need tree-kill to avoid orphaning the child command)
    try {
      cleanupNoteTerminals();
      logger.info('Note terminals cleaned up');
    } catch (error) {
      logger.error('Error cleaning up note terminals:', error instanceof Error ? error : new Error(String(error)));
    }

    // Stop all MCP Hub child processes (workspace, notes, git servers per workspace)
    // These are spawned by ServerManager and will persist as orphaned processes if not killed
    try {
      await cleanupMCP();
      logger.info('MCP Hub servers stopped');
    } catch (error) {
      logger.error('Error stopping MCP Hub servers:', error instanceof Error ? error : new Error(String(error)));
    }

    // Shutdown unified backend - kills all active agent (auggie) processes
    // This also disposes the agent pool (warm/pre-warmed agent processes)
    try {
      await shutdownUnifiedBackend();
      logger.info('Unified backend shutdown complete');
    } catch (error) {
      logger.error('Error during unified backend shutdown:', error instanceof Error ? error : new Error(String(error)));
    }

    // Stop HTTP MCP Server
    if (httpMcpHealthCheckInterval) {
      clearInterval(httpMcpHealthCheckInterval);
      httpMcpHealthCheckInterval = null;
    }
    if (httpMcpServer) {
      try {
        await httpMcpServer.stop();
        logger.info('HTTP MCP Server stopped');
      } catch (error) {
        logger.error('Error stopping HTTP MCP Server:', error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Stop CDP MCP Server
    if (cdpMcpServer) {
      try {
        await cdpMcpServer.stop();
        logger.info('CDP MCP Server stopped');
      } catch (error) {
        logger.error('Error stopping CDP MCP Server:', error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Cleanup IPC handlers
    ipcCleanupManager.cleanupAll();

    // Cleanup observability storage (close SQLite DB) to prevent
    // native crashes from better-sqlite3 during exit (AUGMENT-INTENT-9)
    cleanupObservability();

    // Cleanup auto-updater (stop periodic update checks)
    try {
      const { cleanupAutoUpdater } = await import('../features/auto-update/main/auto-update.ipc');
      cleanupAutoUpdater();
    } catch {
      // Auto-updater may not be initialized
    }

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

// ---- Window Session Persistence ----
// Saves and restores window sessions so the app reopens with the same workspaces/windows.

interface WindowSession {
  route: string;
  bounds: { x: number; y: number; width: number; height: number };
}

function getWindowSessionsPath(): string {
  return path.join(app.getPath('userData'), 'window-sessions.json');
}

async function saveWindowSessions(): Promise<void> {
  try {
    const allWindows = BrowserWindow.getAllWindows();
    const sessions: WindowSession[] = allWindows
      .filter((w: BrowserWindowType) => {
        if (w.isDestroyed()) return false;
        const url = w.webContents.getURL();
        // Skip windows that haven't loaded yet (about:blank) or have empty URLs
        if (!url || url === 'about:blank') return false;
        return true;
      })
      .map((w: BrowserWindowType) => {
        const bounds = w.getBounds();
        const url = w.webContents.getURL();
        let route = '/';
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'file:') {
            // Windows created via WINDOW_CHANNELS.CREATE use file:// with ?initialRoute=
            const initialRoute = parsed.searchParams.get('initialRoute');
            route = initialRoute || '/';
          } else {
            // For dev (http:) and production (app:): pathname is the route
            route = parsed.pathname;
          }
        } catch {
          // Fall back to home
        }
        return { route, bounds };
      });

    const sessionsPath = getWindowSessionsPath();
    if (sessions.length > 0) {
      await fsAsync.writeFile(sessionsPath, JSON.stringify(sessions), 'utf-8');
      logger.info('Saved window sessions', { count: sessions.length, routes: sessions.map(s => s.route) });
    }
  } catch (err) {
    logger.warn('Failed to save window sessions:', err);
  }
}

function isValidWindowSession(s: unknown): s is WindowSession {
  if (typeof s !== 'object' || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (typeof obj.route !== 'string') return false;
  if (typeof obj.bounds !== 'object' || obj.bounds === null) return false;
  const b = obj.bounds as Record<string, unknown>;
  return (
    typeof b.x === 'number' &&
    typeof b.y === 'number' &&
    typeof b.width === 'number' &&
    typeof b.height === 'number'
  );
}

function loadWindowSessions(): WindowSession[] | null {
  try {
    const sessionsPath = getWindowSessionsPath();
    if (fs.existsSync(sessionsPath)) {
      const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        const valid = data.filter(isValidWindowSession);
        if (valid.length > 0) {
          // Cap at 20 windows to guard against corrupted sessions file
          const capped = valid.slice(0, 20);
          logger.info('Loaded window sessions', { count: capped.length, total: valid.length });
          return capped;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load window sessions:', err);
  }
  return null;
}

/**
 * Create a window to restore a saved session.
 * Similar to createWindow() but accepts a specific route and bounds.
 */
function createWindowForSession(session: WindowSession, setAsMain: boolean): void {
  const windowTitle = resolveAppTitle();

  // Resolve icon (same as createWindow)
  let iconPath: string | undefined;
  if (isDev) {
    const iconPngPath = path.join(__dirname, '../../src/assets/icons/icon.png');
    const iconIcoPath = path.join(__dirname, '../../src/assets/icons/icon.ico');
    const iconIcnsPath = path.join(__dirname, '../../src/assets/icons/icon.icns');
    const platformIconPath = process.platform === 'win32' ? iconIcoPath : iconPngPath;
    if (fs.existsSync(platformIconPath)) {
      iconPath = platformIconPath;
    } else if (fs.existsSync(iconPngPath)) {
      iconPath = iconPngPath;
    } else if (fs.existsSync(iconIcoPath)) {
      iconPath = iconIcoPath;
    } else if (fs.existsSync(iconIcnsPath)) {
      iconPath = iconIcnsPath;
    }
    // Set dock icon on macOS
    if (setAsMain && process.platform === 'darwin') {
      const { nativeImage } = require('electron');
      try {
        if (fs.existsSync(iconPngPath)) {
          app.dock.setIcon(nativeImage.createFromPath(iconPngPath));
        } else if (fs.existsSync(iconIcnsPath)) {
          app.dock.setIcon(nativeImage.createFromPath(iconIcnsPath));
        }
      } catch (e) {
        logger.warn('Failed to set dev dock icon:', e);
      }
    }
  }

  const { workArea } = screen.getPrimaryDisplay();

  // Validate saved bounds
  let bounds = session.bounds;
  const minVisibleSize = 100;
  const isReasonable =
    bounds.width >= 800 &&
    bounds.height >= 600 &&
    bounds.x < workArea.x + workArea.width - minVisibleSize &&
    bounds.x > workArea.x - bounds.width + minVisibleSize &&
    bounds.y < workArea.y + workArea.height - minVisibleSize &&
    bounds.y > workArea.y - bounds.height + minVisibleSize;

  if (!isReasonable) {
    bounds = {
      x: workArea.x,
      y: workArea.y,
      width: workArea.width,
      height: workArea.height,
    };
  }

  const isDarkMode = nativeTheme.shouldUseDarkColors;
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    ...(process.platform === 'darwin' && {
      trafficLightPosition: { x: 9, y: 11 },
      tabbingIdentifier: 'intent',
    }),
    title: windowTitle,
    backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff',
    ...(iconPath && { icon: iconPath }),
  };

  const window = new BrowserWindow(windowOptions);

  if (setAsMain) {
    mainWindow = window;
    // Update auto-updater's window reference
    import('../features/auto-update/main/auto-update.ipc')
      .then(({ updateAutoUpdaterWindow }) => updateAutoUpdaterWindow(window))
      .catch(() => {});
  }

  // Clear cache in production to ensure fresh file references after rebuilds
  // (same as createWindow — without this, stale assets can be served after an update)
  // Only clear once for the main window since all windows share the same session.
  if (setAsMain && (!process.env.NODE_ENV || process.env.NODE_ENV === 'production')) {
    window.webContents.session
      .clearCache()
      .then(() => {
        logger.info('Cache cleared for session-restored window');
      })
      .catch((error: unknown) => {
        logger.error('Failed to clear cache for session-restored window:', error as Error);
      });
  }

  // Build URL with the session's route
  let loadUrl: string;
  if (process.env.NODE_ENV === 'development') {
    const devPort = process.env.DEV_PORT || '5177';
    loadUrl = `http://127.0.0.1:${devPort}${session.route}`;
  } else {
    loadUrl = `app://workspaces${session.route}`;
  }

  window.loadURL(loadUrl);

  // Save bounds on resize/move (updates the main window bounds file for backward compat)
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  if (setAsMain) {
    const savedBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
    const saveWindowBounds = () => {
      if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
      saveBoundsTimeout = setTimeout(async () => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        try {
          const currentBounds = window.getBounds();
          await fsAsync.writeFile(savedBoundsPath, JSON.stringify(currentBounds), 'utf-8');
        } catch (err) {
          logger.warn('Failed to save window bounds:', err);
        }
      }, 500);
    };
    window.on('resize', saveWindowBounds);
    window.on('move', saveWindowBounds);
  }

  window.on('closed', () => {
    if (setAsMain) {
      mainWindow = null;
    }
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  });

  logger.info('Restored session window', { route: session.route, isMain: setAsMain });
}

function createWindow() {
  // Support running multiple dev instances with distinct titles
  const windowTitle = resolveAppTitle();

  // Use dev icon (black background) in development mode
  let iconPath: string | undefined;
  if (isDev) {
    const fs = require('fs');
    const iconPngPath = path.join(__dirname, '../../src/assets/icons/icon.png');
    const iconIcoPath = path.join(__dirname, '../../src/assets/icons/icon.ico');
    const iconIcnsPath = path.join(__dirname, '../../src/assets/icons/icon.icns');
    // In dev, use the same icons as production (prefer platform-appropriate formats)
    const platformIconPath = process.platform === 'win32' ? iconIcoPath : iconPngPath;
    if (fs.existsSync(platformIconPath)) {
      iconPath = platformIconPath;
    } else if (fs.existsSync(iconPngPath)) {
      iconPath = iconPngPath;
    } else if (fs.existsSync(iconIcoPath)) {
      iconPath = iconIcoPath;
    } else if (fs.existsSync(iconIcnsPath)) {
      iconPath = iconIcnsPath;
    }
    // Set dock icon on macOS
    if (process.platform === 'darwin') {
      const { nativeImage } = require('electron');
      try {
        // macOS dock icon requires PNG
        if (fs.existsSync(iconPngPath)) {
          app.dock.setIcon(nativeImage.createFromPath(iconPngPath));
        } else if (fs.existsSync(iconIcnsPath)) {
          app.dock.setIcon(nativeImage.createFromPath(iconIcnsPath));
        }
      } catch (e) {
        logger.warn('Failed to set dev dock icon:', e);
      }
    }
  }

  const { workArea } = screen.getPrimaryDisplay();

  // Try to restore saved window bounds, falling back to full workArea
  interface WindowBounds {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }

  // Default to full workArea (maximized but not fullscreen)
  let windowBounds = {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  };

  // Try to load saved bounds synchronously using fs
  const savedBoundsPath = path.join(app.getPath('userData'), 'window-bounds.json');
  try {
    if (fs.existsSync(savedBoundsPath)) {
      const savedBounds = JSON.parse(fs.readFileSync(savedBoundsPath, 'utf-8')) as WindowBounds;
      logger.info('Loaded window bounds from file:', savedBounds);

      if (savedBounds && savedBounds.width && savedBounds.height) {
        // Check if saved bounds are reasonable (at least partially visible)
        const minVisibleSize = 100;
        const isReasonable =
          savedBounds.width >= 800 &&
          savedBounds.height >= 600 &&
          (savedBounds.x === undefined ||
            (savedBounds.x < workArea.x + workArea.width - minVisibleSize &&
              savedBounds.x > workArea.x - savedBounds.width + minVisibleSize)) &&
          (savedBounds.y === undefined ||
            (savedBounds.y < workArea.y + workArea.height - minVisibleSize &&
              savedBounds.y > workArea.y - savedBounds.height + minVisibleSize));

        if (isReasonable) {
          windowBounds = {
            x: savedBounds.x ?? workArea.x,
            y: savedBounds.y ?? workArea.y,
            width: savedBounds.width,
            height: savedBounds.height,
          };
          logger.info('Using saved window bounds:', windowBounds);
        } else {
          logger.info('Saved window bounds not reasonable for current display, using defaults');
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load saved window bounds:', err);
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // Enable <webview> tag for embedded browser
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    ...(process.platform === 'darwin' && {
      trafficLightPosition: { x: 9, y: 11 },
      tabbingIdentifier: 'intent',
    }),
    title: windowTitle,
    ...(iconPath && { icon: iconPath }),
  };

  // Use solid background for better performance (vibrancy disabled)
  // Detect system theme to set appropriate initial background color
  const isDarkMode = nativeTheme.shouldUseDarkColors;
  windowOptions.backgroundColor = isDarkMode ? '#0a0a0a' : '#ffffff';

  const window = new BrowserWindow(windowOptions);

  mainWindow = window;

  // Update auto-updater's window reference so status events go to the current window
  import('../features/auto-update/main/auto-update.ipc')
    .then(({ updateAutoUpdaterWindow }) => updateAutoUpdaterWindow(window))
    .catch(() => {
      // Auto-updater may not be initialized yet during first window creation
    });

  // Save window bounds when resized or moved (debounced)
  let saveBoundsTimeout: NodeJS.Timeout | null = null;
  const saveWindowBounds = () => {
    if (saveBoundsTimeout) {
      clearTimeout(saveBoundsTimeout);
    }
    saveBoundsTimeout = setTimeout(async () => {
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      try {
        const bounds = window.getBounds();
        await fsAsync.writeFile(savedBoundsPath, JSON.stringify(bounds), 'utf-8');
        logger.info('Saved window bounds:', bounds);
      } catch (err) {
        logger.warn('Failed to save window bounds:', err);
      }
    }, 500);
  };

  window.on('resize', saveWindowBounds);
  window.on('move', saveWindowBounds);

  // Log initial bounds after window is shown
  window.once('show', () => {
    logger.info('Window shown with bounds:', window.getBounds());
  });

  // Clear cache in production to ensure fresh file references after rebuilds
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    window.webContents.session
      .clearCache()
      .then(() => {
        logger.info('Cache cleared for fresh build');
      })
      .catch((error: unknown) => {
        logger.error('Failed to clear cache:', error as Error);
      });
  }

  // Check process.argv for intent:// URL on cold start BEFORE loading
  // This handles the case where the app is launched via: electron dist/main "intent://create?repo=..."
  const intentUrl = process.argv.find((arg: string) => arg.startsWith('intent://'));
  let loadUrl: string;
  if (process.env.NODE_ENV === 'development') {
    // Support running multiple dev servers concurrently via DEV_PORT env var
    // Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues on Linux
    const devPort = process.env.DEV_PORT || '5177';
    loadUrl = `http://127.0.0.1:${devPort}`;
  } else {
    // In production, use the custom app:// protocol
    // Use 'workspaces' instead of 'localhost' to avoid any localhost-specific logic
    loadUrl = 'app://workspaces/';
  }

  // Embed deep link in URL if present
  if (intentUrl) {
    const action = deepLinkHandler.parseDeepLink(intentUrl);
    if (action) {
      const encoded = encodeURIComponent(JSON.stringify(action));
      loadUrl += `${loadUrl.includes('?') ? '&' : '?'}deepLink=${encoded}`;
      logger.info('Embedding deep link in load URL for cold start:', { url: intentUrl });
    }
  }

  window.loadURL(loadUrl);

  window.on('closed', () => {
    mainWindow = null;
    if (saveBoundsTimeout) {
      clearTimeout(saveBoundsTimeout);
    }
  });
}

/**
 * Create a new window for a deep link URL
 * This is called when the app receives an intent:// URL from the OS
 * Always creates a NEW window (doesn't reuse existing windows)
 */
async function createWindowForDeepLink(deepLinkUrl: string) {
  logger.info('Creating window for deep link:', { url: deepLinkUrl });

  // Parse the deep link to extract action and params
  const action = deepLinkHandler.parseDeepLink(deepLinkUrl);
  if (!action) {
    logger.warn('Failed to parse deep link URL:', { url: deepLinkUrl });
    return;
  }

  // Create a new window (same configuration as createWindow)
  const windowTitle = resolveAppTitle();

  const { workArea } = screen.getPrimaryDisplay();
  const windowBounds = {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  };

  const isDarkMode = nativeTheme.shouldUseDarkColors;
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    ...(process.platform === 'darwin' && {
      trafficLightPosition: { x: 9, y: 11 },
      tabbingIdentifier: 'intent',
    }),
    title: windowTitle,
    backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff',
  };

  const newWindow = new BrowserWindow(windowOptions);

  // Load the app with deep link embedded in URL query parameter
  const encodedAction = encodeURIComponent(JSON.stringify(action));
  if (isDev) {
    const devPort = process.env.DEV_PORT || '5177';
    newWindow.loadURL(`http://localhost:${devPort}?deepLink=${encodedAction}`);
  } else {
    newWindow.loadURL(`app://workspaces/?deepLink=${encodedAction}`);
  }

  // Focus the new window
  newWindow.focus();

  logger.info('New window created for deep link:', { action: action.type });
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
    copyright: '\u00A9 2026 Augment Code',
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

  // Asynchronously fetch active provider version and update the about panel
  (async () => {
    try {
      const { execAsync } = await import('../shared/main/async-utils.js');
      const { getDefaultProviderConfig } = await import('../shared/config/provider-config.js');
      const defaultProvider = getDefaultProviderConfig();

      // Try to get version from the default provider's CLI
      const { stdout } = await execAsync(`${defaultProvider.command} --version`, {
        timeout: 5000,
      });
      const providerVersion = stdout.trim();
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
    } catch {
      // Provider CLI not installed or not accessible - that's fine
      logger.debug('Could not get provider CLI version for about panel');
    }
  })();

  // Function to build the File menu with recent workspaces
  const buildFileMenu = async (): Promise<Electron.MenuItemConstructorOptions> => {
    // Check if focused window is in a workspace (for enabling/disabling tab menu items)
    const inWorkspace = isFocusedWindowInWorkspace();
    const recentWorkspacesSubmenu: Electron.MenuItemConstructorOptions[] = [];

    // Load recent workspaces
    try {
      const result = await protocolAdapter.listAllWorkspaces();
      if (result.ok && result.data) {
        // Sort by updatedAt descending and take top 5
        type WorkspaceItem = {
          status?: string;
          updatedAt: string;
          title?: string;
          name?: string;
          id: string;
        };
        const recentWorkspaces = (result.data as WorkspaceItem[])
          .filter((w: WorkspaceItem) => w.status !== 'deleted' && w.status !== 'archived')
          .sort(
            (a: WorkspaceItem, b: WorkspaceItem) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )
          .slice(0, 5);

        for (const workspace of recentWorkspaces) {
          const displayName = workspace.title || workspace.name || workspace.id;
          recentWorkspacesSubmenu.push({
            label: displayName,
            click: () => {
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
        label: 'New Space',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow && !focusedWindow.isDestroyed()) {
            focusedWindow.webContents.send('navigate', '/?create=true');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'New Agent',
        accelerator: 'CmdOrCtrl+T',
        enabled: inWorkspace,
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
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('navigate', '/settings');
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
      });
      helpMenuItems.push({
        label: "Install 'intent' command in PATH...",
        click: async () => {
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
          const suggestedFilename = `intent-debug-${dateStr}.zip`;

          // Show save dialog
          const { filePath, canceled } = await dialog.showSaveDialog({
            defaultPath: suggestedFilename,
            filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
          });

          if (canceled || !filePath) {
            // Clean up temp bundle
            try {
              await fs.promises.unlink(bundlePath);
            } catch (e) {
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
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('navigate', '/settings');
              }
            },
          },
          {
            label: "Install 'intent' command in PATH...",
            click: async () => {
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
    rebuildMenu();
  });

  // Set up custom protocol handler for production builds
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      const decodedPath = decodeUrlPath(url.pathname);
      if (decodedPath === null) {
        logger.warn('Rejected protocol request with invalid path encoding', {
          originalPath: url.pathname,
        });
        return new Response('Invalid path', { status: 400 });
      }

      const normalizedPath = decodedPath.replace(/\\/g, '/');
      // Remove all leading slashes for proper path joining
      const filePath = normalizedPath.replace(/^\/+/, '');

      // Get the unpacked path
      const appPath = app.getAppPath();
      const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
      const rendererRoot = path.join(unpackedPath, 'dist', 'renderer');

      // Log the requested file for debugging
      logger.info('Protocol handler requested:', {
        originalPath: url.pathname,
        processedPath: filePath,
        isIndexHtml: filePath === 'index.html',
        isEmpty: filePath === '',
        hasNoExtension: !filePath.includes('.'),
      });

      // Special handling for SvelteKit routes
      // If it's /index.html or any route without an extension, serve index.html
      // This allows SvelteKit's client-side router to handle navigation
      if (
        filePath === 'index.html' ||
        filePath === '' ||
        (!filePath.includes('.') && !filePath.startsWith('app/') && !filePath.startsWith('_app/'))
      ) {
        const indexPath = path.join(rendererRoot, 'index.html');
        logger.info('Serving index.html for route:', filePath);
        try {
          const indexContent = await fs.promises.readFile(indexPath);
          return new Response(new Uint8Array(indexContent), {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              // Prevent caching of index.html to ensure fresh file references
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
              Expires: '0',
            },
          });
        } catch (error) {
          logger.error('Failed to serve index.html:', error);
          return new Response('File not found', { status: 404 });
        }
      }

      // Convert .ts requests to .js (for imports that reference .ts files)
      if (filePath.endsWith('.ts')) {
        logger.warn('TypeScript file requested in production:', filePath);
        // Don't convert .ts to .js, instead return 404
        // These shouldn't be requested in production
        return new Response('TypeScript files should not be loaded in production', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
          },
        });
      }

      // Try multiple paths for resources
      let fullPath: string | null = null;

      const resourceRoots = [
        unpackedPath,
        path.join(unpackedPath, 'src'),
        path.join(unpackedPath, 'dist'),
      ];

      // Special handling for resources folder
      if (filePath.startsWith('resources/')) {
        // In production, resources are unpacked directly in the unpacked directory
        for (const resourceRoot of resourceRoots) {
          const candidate = safeResolvePath(resourceRoot, filePath);
          if (candidate && fs.existsSync(candidate)) {
            fullPath = candidate;
            logger.info('Found resource:', { filePath, fullPath: candidate, root: resourceRoot });
            break;
          }
        }

        if (!fullPath) {
          logger.warn('Resource not found in any location:', {
            requested: filePath,
            tried: resourceRoots,
          });
        }
      }

      if (!fullPath) {
        fullPath = safeResolvePath(rendererRoot, filePath);
      }

      if (!fullPath) {
        logger.warn('Rejected protocol request with unsafe path', {
          filePath,
        });
        return new Response('Invalid path', { status: 400 });
      }

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        // For client-side routing, return index.html only for navigation requests
        // Not for JS/CSS/asset requests
        const ext = path.extname(filePath).toLowerCase();
        if (!ext || ext === '.html') {
          const indexPath = path.join(rendererRoot, 'index.html');
          try {
            const indexContent = await fs.promises.readFile(indexPath);
            return new Response(new Uint8Array(indexContent), {
              status: 200,
              headers: {
                'Content-Type': 'text/html',
              },
            });
          } catch (error) {
            logger.error('Failed to serve index.html:', error);
            return new Response('File not found', { status: 404 });
          }
        } else {
          logger.error('File not found:', { filePath, fullPath });
          return new Response('File not found', {
            status: 404,
            headers: {
              'Content-Type': 'text/plain',
            },
          });
        }
      }

      // Determine MIME type
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      try {
        // Read the file
        const fileContent = await fs.promises.readFile(fullPath);

        // Return a proper Response object with correct MIME type
        return new Response(new Uint8Array(fileContent), {
          status: 200,
          headers: {
            'Content-Type': mimeType,
          },
        });
      } catch (error) {
        logger.error('Failed to serve file:', error);
        return new Response('File not found', { status: 404 });
      }
    });
  }

  // Set up workspace-asset:// protocol handler for serving images in notes
  // This works in both development and production
  protocol.handle('workspace-asset', async (request) => {
    const url = new URL(request.url);
    // URL format: workspace-asset://{workspaceId}/{assetId}
    const workspaceId = url.hostname;
    const decodedPath = decodeUrlPath(url.pathname);
    if (decodedPath === null) {
      logger.warn('Rejected workspace-asset request with invalid path encoding', {
        originalPath: url.pathname,
      });
      return new Response('Invalid asset URL', { status: 400 });
    }

    const assetId = decodedPath.replace(/^\/+/, '');

    if (!workspaceId || !assetId) {
      logger.warn('Invalid workspace-asset URL:', request.url);
      return new Response('Invalid asset URL', { status: 400 });
    }

    if (assetId.includes('/') || assetId.includes('\\')) {
      logger.warn('Rejected workspace-asset request with path separators', {
        workspaceId,
        assetId,
      });
      return new Response('Invalid asset URL', { status: 400 });
    }

    try {
      // Import the assets service dynamically to avoid circular dependencies
      const { assetsService } = await import('../features/notes/main/assets.service');
      const assetPath = assetsService.getAssetPath(workspaceId, assetId);

      // Check if file exists
      if (!fs.existsSync(assetPath)) {
        logger.warn('Asset not found:', { workspaceId, assetId, assetPath });
        return new Response('Asset not found', { status: 404 });
      }

      // Read the file
      const fileContent = await fs.promises.readFile(assetPath);

      // Determine MIME type from extension
      const ext = path.extname(assetId).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      return new Response(new Uint8Array(fileContent), {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'max-age=31536000', // Cache for 1 year (assets are content-addressed)
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.startsWith('Invalid asset')) {
        logger.warn('Rejected workspace-asset request', { workspaceId, assetId, message });
        return new Response('Invalid asset URL', { status: 400 });
      }
      logger.error('Failed to serve asset:', error);
      return new Response('Failed to serve asset', { status: 500 });
    }
  });

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
  setupNotesIPC();
  setupNotesPrimitivesIPC();
  setupFileIPC();
  setupSystemIPC();
  await setupConfigIPC();
  setupFileTrackingIPC(); // Needed for agent components
  setupGitIPC(); // Needed for git operations
  setupGitHubAuthIPC(); // Needed for GitHub device flow auth
  setupLinearAuthIPC(); // Needed for Linear auth via Augment
  setupSentryAuthIPC(); // Needed for Sentry auth via API token
  setupPersistenceIPC(); // Needed for agent persistence
  setupAgentConfigIPC(); // Needed for agent config

  // Initialize unified agent handlers with the backend adapter
  initializeUnifiedAgentHandlers(); // Migrated to unified handler architecture

  registerIDEHandlers(); // Needed for IDE integration
  registerExternalEditorsHandlers(); // Needed for external editor detection and opening
  registerSSHHandlers(); // Needed for SSH operations
  registerWorkspacePRHandlers(); // Needed for PR operations
  registerMissingAgentHandlers(); // Needed for agent context operations
  registerDeepLinkHandlers(); // Needed for deep link and file operations

  // These handlers are called immediately on startup, so register them synchronously
  setupAuggieIPC(); // Needed for auggie:get-models
  setupOpencodeIPC(); // Needed for opencode:get-models
  setupClaudeCodeIPC(); // Needed for claude-code:get-models
  setupCodexIPC(); // Needed for codex:get-models
  setupCortexIPC(); // Needed for cortex:get-models
  setupFeatureCodesIPC(); // Feature codes for gating features like Cortex
  setupProviderAvailabilityIPC(); // Needed for providers:get-availability
  setupThirdPartySourcesIPC(); // Needed for sources:list
  setupEventsIPC(); // Needed for events:query
  registerSetupScriptsHandlers(); // Needed for workspace initializer setup scripts
  registerAcceptChangesHandlers(); // Needed for AcceptChangesPanel on workspace open
  setupEditorIPC(); // Needed for ReferenceBlock "Open in Editor" button
  setupTerminalIPC(); // Needed for CLI blocks in notes (includes get-buffer handler)
  registerChatExportHandlers(); // Needed for chat export functionality
  registerDebugExportHandlers(); // Needed for debug log export functionality

  // Pass the shared ConfigManager to workspace rules service
  const configManager = getConfigManager();
  await setupWorkspaceRulesIPC(configManager || undefined); // Needed for initial agent system prompt
  startupMetrics.end('criticalIPC');

  logger.info('Critical IPC handlers registered, creating window');

  // Setup remaining IPC handlers asynchronously after window is shown
  // Using setImmediate to not block the main thread
  setImmediate(async () => {
    startupMetrics.start('secondaryIPC');
    logger.info('Setting up secondary IPC handlers in background');

    setupFirstVisitStateIPC();
    setupPanelLayoutHistoryIPC();
    setupCommentsIPC();
    setupUserActivityIPC();
    setupLineAttributionIPC();
    setupFileAttributionIPC();
    setupAssetsIPC();

    // Start line attribution service to listen for note updates
    lineAttributionService.start();
    logger.info('Line attribution service started');
    // MINIMAL REFACTOR: Commenting out duplicate IPC handler
    registerAgentContextHandlers();

    // Initialize the agent backend handler
    // WAVE 1 REFACTOR: The backend handler now has all handlers commented out
    // to avoid duplication. The handlers are implemented in the service itself.
    void agentBackendHandler; // Initialize the backend service

    // Note: Unified handlers would need an adapter to work with agentBackendHandler
    // For now, we'll uncomment the handlers in agentBackendHandler until we can
    // properly migrate to the unified handler pattern

    logger.info('Agent backend handler initialized');
    // setupTerminalIPC(); // Already called in critical IPC setup
    // setupEditorIPC(); // Already called in critical IPC setup
    setupDiffsIPC();
    setupLogIPC();
    setupTestingIPC();
    // setupAuggieIPC(); // Already called in critical IPC setup
    setupRemoteFileSystemIPC();
    // setupEventsIPC(); // Already called in critical IPC setup
    setupGitTrackingIPC();
    // registerAcceptChangesHandlers(); // Already called in critical IPC setup
    setupObservabilityIPC();
    setupMemoriesIPC();
    setupRulesIPC();
    setupRepoConfigIPC();
    setupSpecialistsIPC();
    // setupWorkspaceRulesIPC(); // Already called in critical IPC setup
    registerLineChangesIPC();
    // registerSetupScriptsHandlers(); // Already called in critical IPC setup
    // setupThirdPartySourcesIPC(); // Already called in critical IPC setup

    // Setup notification IPC handlers
    setupNotificationIPC();

    // Setup permission IPC handlers for ACP agent tool approvals
    const { setupPermissionIPC } = await import('../features/acp-official/main/permission.ipc');
    setupPermissionIPC();

    // Setup keychain consent IPC handlers for git network operations
    const { setupKeychainIPC } = await import('../features/git/main/keychain.ipc');
    setupKeychainIPC();

    // Setup browser debugger IPC handlers for CDP access to embedded browser tabs
    const { registerBrowserHandlers } = await import('../features/browser/main/browser.ipc');
    registerBrowserHandlers();

    // Setup auto-update IPC handlers and initialize auto-updater in production
    const { setupAutoUpdateIPC, initializeAutoUpdater } =
      await import('../features/auto-update/main/auto-update.ipc');
    setupAutoUpdateIPC();
    if (process.env.NODE_ENV !== 'development' && mainWindow) {
      initializeAutoUpdater(mainWindow);
    }

    // Setup development-only IPC handlers
    if (process.env.NODE_ENV === 'development') {
      setupAgentTestingIPC();
      setupSandboxIPC();

      // Debug tools for testing backend-initiated flows
      const { setupDebugIPC } = await import('../features/debug/main/debug.ipc');
      setupDebugIPC();
    }

    // Initialize event handler registry
    // Register event-triggered agents first, then initialize to start listening
    registerEventTriggeredAgents();
    eventHandlerRegistry.initialize();
    logger.info('Event handler registry initialized');

    // Migrate workspaces from ~/intent/{id} to ~/intent/workspaces/{id}
    try {
      const migrationResult = await protocolAdapter.migrateWorkspacesToCanonicalLocation();
      if (migrationResult.migrated > 0 || migrationResult.errors > 0) {
        logger.info('Workspace migration on startup', migrationResult);
      }
    } catch (error) {
      logger.warn('Error migrating workspaces on startup', { error });
    }

    // Purge deleted workspaces and orphan directories on startup
    try {
      const purgeResult = await protocolAdapter.purgeDeletedWorkspaces();
      if (purgeResult.ok) {
        const { removed, orphans } = purgeResult.data;
        if (removed > 0 || orphans > 0) {
          logger.info('Purged deleted workspaces on startup', { removed, orphans });
        }
      } else {
        logger.warn('Failed to purge deleted workspaces', { error: purgeResult.error });
      }
    } catch (error) {
      logger.warn('Error purging deleted workspaces on startup', { error });
    }

    // Clean up stale temp files from ~/.augment/tmp (from crashed/killed agents)
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

    startupMetrics.end('secondaryIPC');
    logger.info('All secondary IPC handlers registered successfully');

    // PERF: Start memory monitoring to detect and prevent GC pauses
    memoryMonitor.start();

    // Shared cleanup function used by both memory pressure and proactive workspace-switch cleanup
    // skipStreamCleanup: when true, skips cleanupStalledStreams() to avoid killing active streams
    // (cleanupStalledStreams uses a 1.5s inactivity threshold which is too aggressive for workspace switch)
    const performMemoryCleanup = (reason: string, { forceGC = false, skipStreamCleanup = false } = {}) => {
      logger.info('Memory cleanup triggered', { reason, skipStreamCleanup });

      if (!skipStreamCleanup) {
        import('../features/agent/services/stream-manager')
          .then(({ streamManager }) => {
            const beforeMetrics = streamManager.getMetrics();
            logger.info('Stream manager cleanup starting', { beforeMetrics });
            streamManager.cleanupStalledStreams();
            const afterMetrics = streamManager.getMetrics();
            logger.info('Stream manager cleanup complete', { afterMetrics });
          })
          .catch(() => {});
      }

      import('../features/agent/services/message-accumulator.service')
        .then(({ messageAccumulator }) => {
          const beforeStats = messageAccumulator.getStats();
          logger.info('Message accumulator cleanup starting', { beforeStats });
          messageAccumulator.cleanupStale?.();
          const afterStats = messageAccumulator.getStats();
          logger.info('Message accumulator cleanup complete', { afterStats });
        })
        .catch(() => {});

      if (forceGC) {
        const gc = (global as unknown as { gc?: () => void }).gc;
        if (typeof gc === 'function') {
          logger.info('Forcing garbage collection', { reason });
          gc();
        }
      }

      // Hint incremental GC to help reduce heap between workspace loads
      memoryMonitor.hintGC(reason);
    };

    // PERF: Allow renderer to trigger proactive cleanup during workspace switch
    // This avoids waiting for the 30s memory monitor interval to detect pressure
    // NOTE: Skips stream cleanup because active streams must survive workspace switches
    // (stream handlers intentionally persist across workspaces to avoid losing chunks)
    ipcMain.handle('app:trigger-memory-cleanup', () => {
      performMemoryCleanup('workspace-switch', { skipStreamCleanup: true });
    });

    // Listen for memory pressure warnings to trigger cleanup
    memoryMonitor.onPressure((level) => {
      if (level === 'warning' || level === 'critical') {
        logger.warn('Memory pressure detected, triggering cleanup', { level });
        performMemoryCleanup(`memory-pressure-${level}`, { forceGC: level === 'critical' });
      }
    });
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

  // Register intent:// protocol handler in development mode
  // In production, this is registered via electron-builder.yml
  if (isDev) {
    try {
      // In dev mode, we must pass the Electron binary path and the app entry point
      // so macOS launches "electron /path/to/dist/main" instead of just "electron"
      app.setAsDefaultProtocolClient('intent', process.execPath, [path.resolve(app.getAppPath())]);
      logger.info('Registered intent:// protocol handler for development mode', {
        execPath: process.execPath,
        appPath: path.resolve(app.getAppPath()),
      });
    } catch (error) {
      logger.warn('Failed to register intent:// protocol handler:', error);
    }
  }

  // Process any pending deep link URL that was received before the window was ready
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

  // Start HTTP MCP Server immediately - critical for MCP functionality
  (async () => {
    try {
      startupMetrics.start('httpMcpServer');
    } catch (error) {
      logger.warn('Failed to start httpMcpServer metric:', error);
    }

    try {
      if (typeof HttpMcpBridge === 'undefined') {
        throw new Error('HttpMcpBridge class is undefined - import failed');
      }

      httpMcpServer = new HttpMcpBridge();
      await httpMcpServer.start();

      // Start proactive health monitoring for HTTP MCP Bridge
      // Checks every 60 seconds and auto-restarts if unhealthy
      const HTTP_BRIDGE_HEALTH_CHECK_INTERVAL_MS = 60 * 1000;
      httpMcpHealthCheckInterval = setInterval(async () => {
        if (isShuttingDown || !httpMcpServer) {
          return;
        }

        try {
          const healthy = await httpMcpServer.isHealthy();
          if (!healthy) {
            logger.warn('HTTP MCP Bridge health check failed, attempting restart...');
            await httpMcpServer.restart();
            logger.info('HTTP MCP Bridge restarted by health monitor');
          }
        } catch (error) {
          logger.error('HTTP MCP Bridge health monitor error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, HTTP_BRIDGE_HEALTH_CHECK_INTERVAL_MS);

      logger.info('HTTP MCP Bridge health monitor started', {
        intervalMs: HTTP_BRIDGE_HEALTH_CHECK_INTERVAL_MS,
      });
    } catch (error) {
      logger.error(
        'Failed to start HTTP MCP Server:',
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error instanceof Error) {
        logger.error('HTTP MCP Server error stack:', error.stack);
      }
    }

    try {
      startupMetrics.end('httpMcpServer');
    } catch (error) {
      logger.warn('Failed to end httpMcpServer metric:', error);
    }

    // Setup handlers that require the window to exist
    // PERFORMANCE OPTIMIZATION: Run in parallel since they're independent
    try {
      startupMetrics.start('postWindowIPC');
    } catch (error) {
      logger.warn('Failed to start postWindowIPC metric:', error);
    }

    await Promise.all([initializeUnifiedBackend(mainWindow!), setupMCPIPC(mainWindow!)]);

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

app.on('before-quit', async (event: Electron.Event) => {
  logger.info('App before-quit event triggered');

  // Only prevent default and run gracefulShutdown if we're not already shutting down
  if (!isShuttingDown) {
    event.preventDefault();

    // Save window sessions now that quit is prevented.
    // Must be called AFTER event.preventDefault() because saveWindowSessions is async
    // and preventDefault must be called synchronously within the event handler.
    await saveWindowSessions();

    // Check if there are any running agents
    const activeStreams = agentBackendHandler.getActiveStreams();
    if (activeStreams.length > 0) {
      logger.info('Active agents detected during quit attempt', {
        count: activeStreams.length,
        agentIds: activeStreams.map((s) => s.agentId),
      });

      // Show confirmation dialog
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Agents Running',
        message: `${activeStreams.length} agent${activeStreams.length > 1 ? 's are' : ' is'} still running.`,
        detail:
          'Quitting now will stop all running agents and they may lose progress. Are you sure you want to quit?',
        buttons: ['Cancel', 'Quit Anyway'],
        defaultId: 0,
        cancelId: 0,
      });

      if (result.response === 0) {
        // User cancelled - don't quit
        logger.info('User cancelled quit due to running agents');
        return;
      }

      logger.info('User confirmed quit despite running agents');
    }

    await gracefulShutdown();
  }
});

app.on('window-all-closed', async () => {
  // Cleanup terminals gracefully - this properly cleans up PTY processes
  // to prevent Napi::Error crashes during shutdown (AUGMENT-INTENT-8)
  await cleanupTerminals();

  // Stop line attribution service
  lineAttributionService.stop();
  logger.info('Line attribution service stopped');

  // Cleanup IPC debug tracker
  ipcDebugTracker.dispose();

  // Cleanup all IPC handlers
  ipcCleanupManager.cleanupAll();

  // Cleanup observability storage (close SQLite DB) to prevent
  // native crashes from better-sqlite3 during exit (AUGMENT-INTENT-9)
  cleanupObservability();

  // Cleanup agent pool (warm providers)
  try {
    await agentPoolService.disposeAll();
    logger.info('Agent pool disposed');
  } catch (error) {
    logger.error('Failed to dispose agent pool', error as Error);
  }

  // Cleanup agent backend
  try {
    await shutdownUnifiedBackend();
    logger.info('Unified backend shutdown complete');
  } catch (error) {
    logger.error('Failed to shutdown unified backend', error as Error);
  }

  // Stop HTTP MCP Server health check interval
  if (httpMcpHealthCheckInterval) {
    clearInterval(httpMcpHealthCheckInterval);
    httpMcpHealthCheckInterval = null;
  }

  // Stop HTTP MCP Server
  if (httpMcpServer) {
    try {
      await httpMcpServer.stop();
      logger.info('HTTP MCP Server stopped');
    } catch (error) {
      logger.error(
        'Error stopping HTTP MCP Server:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    await createWindowForDeepLink(url);
  } else {
    // App is not ready yet, store the URL for processing after startup
    logger.info('App not ready, storing URL for later processing');
    deepLinkHandler['pendingUrl'] = url;
  }
});

// Handle intent:// protocol URLs on Windows/Linux (second instance)
// This is called when the user tries to open the app again with an intent:// URL
let isSecondInstance = false;

// Support multiple dev instances by using unique userData paths
if (process.env.NODE_ENV === 'development' && process.env.DEV_INSTANCE) {
  const uniqueUserData = path.join(
    app.getPath('userData'),
    `dev-instance-${process.env.DEV_INSTANCE}`,
  );
  app.setPath('userData', uniqueUserData);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running, quit this one
  isSecondInstance = true;
  app.quit();
} else {
  app.on('second-instance', async (_event: Electron.Event, commandLine: string[]) => {
    logger.info('Received second-instance event:', { commandLine });

    // Look for intent:// URL in command line arguments
    const deepLinkUrl = commandLine.find((arg: string) => arg.startsWith('intent://'));

    if (deepLinkUrl) {
      logger.info('Found deep link URL in second instance:', { url: deepLinkUrl });
      if (mainWindow && !mainWindow.isDestroyed()) {
        await createWindowForDeepLink(deepLinkUrl);
      }
    } else {
      // No deep link, just focus the existing window
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
  if (mainWindow === null && !isSecondInstance) {
    // Try to restore saved sessions (e.g., user closed all windows on macOS then clicked dock icon)
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
