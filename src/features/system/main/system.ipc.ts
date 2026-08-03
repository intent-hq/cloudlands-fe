/**
 * System IPC Handlers
 *
 * Handles app-level and system operations.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { spawn } from 'child_process';
import { collectOpenWorkspaceIds, collectWindowIdsForWorkspace } from './window-workspace-tracking';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  AppPathSchema,
  AppSetBadgeSchema,
  AppSetLanguagePreferenceSchema,
  DeepLinkHandleSchema,
  DialogMessageSchema,
  DialogOpenSchema,
  EmptySchema,
  JetbrainsOpenSchema,
  ShellOpenExternalSchema,
  ShellShowItemInFolderSchema,
  SystemExecuteCommandSchema,
  SystemExecuteCommandStreamingSchema,
  SystemWriteClipboardSchema,
  UserMcpCheckAuthSchema,
  UserMcpTestConnectionSchema,
  VscodeOpenDiffSchema,
  VscodeOpenFileSchema,
  VscodeOpenGitDiffSchema,
  WindowCreateSchema,
  WindowOpenNewSchema,
  WindowSetThemeSchema,
  WindowSetTitleSchema,
  WindowSetInWorkspaceSchema,
  WindowSetOpenWorkspaceTabsSchema,
  WindowSetBrowserFocusedSchema,
  WindowSetFullScreenSchema,
  XcodeOpenSchema,
} from '../../../main/ipc-schemas';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { broadcastToBrowserIpcClients } from '../../../main/browser-ipc-broadcast-adapter';
import { execFileAsync } from '../../../shared/git/git-env';
import { findBinary } from '../../../shared/main/find-binary';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { hostExec } from '../../../shared/main/host-exec';
import { hostExecStream } from '../../../shared/main/host-exec-stream';
import {
  APP_CHANNELS,
  DEEP_LINK_CHANNELS,
  DIALOG_CHANNELS,
  JETBRAINS_CHANNELS,
  LEGACY_CHANNELS,
  SHELL_CHANNELS,
  SYSTEM_CHANNELS,
  USER_MCP_CHANNELS,
  VSCODE_CHANNELS,
  WINDOW_CHANNELS,
  XCODE_CHANNELS,
} from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import { MINIMUM_NODE_VERSION } from '../../../shared/constants/auggie';
import { findVSCodeAsync } from '../../../shared/main/async-utils';
import { meetsMinimumVersion } from '../../../shared/utils/version-compare';
import { posixSingleQuote } from '../../../shared/utils/posix-single-quote';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);

const logger = new Logger('SystemIPC');

const CONTENT_BEARING_WORKSPACE_CHANNELS = new Set([
  'file:content-changed',
  'note:created',
  'note:updated',
  'note:content-changed',
  'spec:updated',
  'goal:updated',
  'task:status-changed',
  'task:ready-tasks-changed',
  'comment:added',
  'comment:updated',
  'comment:updated-batch',
]);
const CONTENT_BEARING_WORKSPACE_CHANNEL_PREFIXES = ['note:content-changed:'];

function isContentBearingWorkspaceChannel(channel: string, data?: unknown): boolean {
  if (
    CONTENT_BEARING_WORKSPACE_CHANNELS.has(channel) ||
    CONTENT_BEARING_WORKSPACE_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix))
  ) {
    return true;
  }

  if (channel === 'events:new' && data && typeof data === 'object') {
    const event = (data as { event?: unknown }).event;
    if (event && typeof event === 'object') {
      const eventType = (event as { type?: unknown }).type;
      return typeof eventType === 'string' && isContentBearingWorkspaceChannel(eventType);
    }
  }

  return false;
}

function getPayloadWorkspaceId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const workspaceId = (data as { workspaceId?: unknown }).workspaceId;
  if (typeof workspaceId === 'string' && workspaceId.length > 0) return workspaceId;

  const event = (data as { event?: unknown }).event;
  if (event && typeof event === 'object') {
    const eventWorkspaceId = (event as { workspaceId?: unknown }).workspaceId;
    if (typeof eventWorkspaceId === 'string' && eventWorkspaceId.length > 0) {
      return eventWorkspaceId;
    }
  }

  return undefined;
}

// ============================================================================
// Window Workspace State Tracking
// ============================================================================

/** Track which windows are currently in a workspace (for menu state) */
const windowWorkspaceState = new Map<number, boolean>();
/** Track which workspace ID each window is viewing */
const windowWorkspaceIds = new Map<number, string>();
/** Track which windows have a browser panel as the focused/active panel */
const windowBrowserFocusState = new Map<number, boolean>();
/** Track which workspace tabs are open per window */
const windowOpenWorkspaceTabs = new Map<number, string[]>();

/**
 * Check if the currently focused window is in a workspace.
 * Used by the menu builder to enable/disable workspace-specific menu items.
 */
export function isFocusedWindowInWorkspace(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return false;
  return windowWorkspaceState.get(focusedWindow.id) ?? false;
}

/**
 * Get the workspace ID of the currently focused window.
 * Returns undefined if no window is focused or the window is not viewing a workspace.
 */
export function getFocusedWindowWorkspaceId(): string | undefined {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return undefined;
  return windowWorkspaceIds.get(focusedWindow.id);
}

export function getOpenWorkspaceTabsForFocusedWindow(): string[] {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return [];
  return windowOpenWorkspaceTabs.get(focusedWindow.id) ?? [];
}

/**
 * Get all workspace IDs that have an open Electron window.
 * Includes both the currently viewed workspace per window AND all workspace
 * tabs open in each window. This ensures that workspaces open in background
 * tabs (with running agents) are not treated as orphaned during memory cleanup.
 */
export function getAllOpenWorkspaceIds(): string[] {
  return collectOpenWorkspaceIds(windowWorkspaceIds, windowOpenWorkspaceTabs, {
    isAlive(windowId: number) {
      const win = BrowserWindow.fromId(windowId);
      return !!win && !win.isDestroyed();
    },
  });
}

/**
 * Get the Electron window ID for a given workspace ID.
 * Returns undefined if no window is currently viewing that workspace.
 * NOTE: Returns only the FIRST matching window. Use getWindowIdsForWorkspace()
 * when you need all windows viewing a workspace (e.g., for broadcasting).
 */
export function getWindowIdForWorkspace(workspaceId: string): number | undefined {
  for (const [windowId, wsId] of windowWorkspaceIds) {
    if (wsId === workspaceId) {
      // Verify window still exists
      const win = BrowserWindow.fromId(windowId);
      if (win && !win.isDestroyed()) {
        return windowId;
      }
      // Clean up stale entry
      windowWorkspaceIds.delete(windowId);
    }
  }
  return undefined;
}

/**
 * Get ALL Electron window IDs for a given workspace ID.
 * Multiple windows can view the same workspace simultaneously.
 * Includes windows where the workspace is in background tabs, not just actively viewed.
 * Returns an empty array if no windows have the workspace open.
 */
export function getWindowIdsForWorkspace(workspaceId: string): number[] {
  return collectWindowIdsForWorkspace(workspaceId, windowWorkspaceIds, windowOpenWorkspaceTabs, {
    isAlive(windowId: number) {
      const win = BrowserWindow.fromId(windowId);
      return !!win && !win.isDestroyed();
    },
  });
}

/**
 * Send an IPC message to all windows viewing a specific workspace.
 * Workspace-scoped messages are delivered only to windows that have that
 * workspace active or open in a tab. If no matching windows exist, the Electron
 * renderer delivery is dropped instead of falling back to unrelated windows.
 * Messages without a workspace context remain global broadcasts unless they are
 * content-bearing workspace messages with a recoverable workspaceId in the payload.
 *
 * This is the preferred way to send workspace-scoped IPC messages from the main process.
 * Use this instead of manually calling BrowserWindow.getAllWindows() + webContents.send().
 */
export function sendToWorkspaceWindows(
  workspaceId: string | undefined,
  channel: string,
  data: unknown,
): void {
  let targetWindows: BrowserWindow[];
  const isContentBearing = isContentBearingWorkspaceChannel(channel, data);
  const effectiveWorkspaceId =
    workspaceId ?? (isContentBearing ? getPayloadWorkspaceId(data) : undefined);

  if (effectiveWorkspaceId) {
    const windowIds = getWindowIdsForWorkspace(effectiveWorkspaceId);
    if (windowIds.length > 0) {
      targetWindows = windowIds
        .map((id) => BrowserWindow.fromId(id))
        .filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
    } else {
      // Workspace-scoped events must never fall back to unrelated windows.
      targetWindows = [];
    }
  } else if (isContentBearing) {
    // Without a workspace context there is no safe target for workspace content.
    targetWindows = [];
  } else {
    // No workspace context — broadcast to all windows
    targetWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  }

  for (const window of targetWindows) {
    if (window.webContents && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  }

  // Also broadcast to browser-mode WebSocket clients (if any are connected).
  // The named adapter owns the legacy global hook used by the HTTP MCP bridge.
  try {
    broadcastToBrowserIpcClients(channel, data, effectiveWorkspaceId);
  } catch {
    // Ignore — WebSocket bridge may not be initialized yet
  }
}

/**
 * Check if the currently focused window has a browser panel as the active panel.
 * Used by the menu builder to route zoom shortcuts to the correct webContents.
 */
export function isFocusedWindowBrowserActive(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return false;
  return windowBrowserFocusState.get(focusedWindow.id) ?? false;
}

// Clean up state when windows are closed
app.on('browser-window-created', (_event, window) => {
  window.on('closed', () => {
    windowWorkspaceState.delete(window.id);
    windowWorkspaceIds.delete(window.id);
    windowBrowserFocusState.delete(window.id);
    windowOpenWorkspaceTabs.delete(window.id);
    // A close changes the set of open workspaces: notify listeners (menu
    // rebuild, cache trim, notification-service reconciliation) so services
    // for workspaces no longer open anywhere are torn down.
    app.emit('window-workspace-state-changed');
  });
  // Keep each window's renderer in sync with its native full-screen state,
  // including OS-gesture transitions (green traffic-light, Cmd+Ctrl+F).
  window.on('enter-full-screen', () => {
    if (!window.isDestroyed()) window.webContents.send('window:fullscreen', true);
  });
  window.on('leave-full-screen', () => {
    if (!window.isDestroyed()) window.webContents.send('window:fullscreen', false);
  });
});

// ============================================================================
// Exported Functions (for direct use in main process)
// ============================================================================

/**
 * Install the Intent CLI by creating a symlink at /usr/local/bin/intent
 * pointing to the bundled CLI script.
 *
 * This function can be called directly from the main process (e.g., menu handlers)
 * or via IPC from the renderer process.
 */
export async function installIntentCli(): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    const fs = require('fs');
    const { promises: fsPromises } = require('fs');
    const path = require('path');

    // Resolve the bundled CLI script path
    const isDev = process.env.NODE_ENV === 'development';
    const cliScriptPath = isDev
      ? path.join(app.getAppPath(), '..', '..', 'resources/bin/intent')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', 'intent');

    const symlinkPath = '/usr/local/bin/intent';

    logger.info('Installing CLI', { cliScriptPath, symlinkPath, isDev });

    // Check if the CLI script exists
    if (!fs.existsSync(cliScriptPath)) {
      logger.warn('CLI script not found at resolved path', { cliScriptPath });
    }

    // Check if symlink already exists and points to the correct location
    try {
      const existingTarget = await fsPromises.readlink(symlinkPath);
      if (existingTarget === cliScriptPath) {
        logger.info('CLI already installed at correct location');
        return {
          success: true,
          message: 'CLI is already installed at /usr/local/bin/intent',
        };
      } else {
        logger.warn('Symlink exists but points to different location', {
          existing: existingTarget,
          expected: cliScriptPath,
        });
        // Remove the old symlink so we can create a new one
        try {
          await fsPromises.unlink(symlinkPath);
        } catch (unlinkErr: any) {
          // If unlink fails due to permissions, the osascript fallback will handle it
          if (unlinkErr.code !== 'EACCES') {
            throw unlinkErr;
          }
        }
      }
    } catch (err: any) {
      // ENOENT means symlink doesn't exist, which is expected
      if (err.code !== 'ENOENT') {
        logger.warn('Error checking existing symlink', err);
      }
    }

    // Try to create symlink directly first
    try {
      await fsPromises.symlink(cliScriptPath, symlinkPath);
      logger.info('CLI installed successfully');
      return {
        success: true,
        message: 'CLI installed successfully at /usr/local/bin/intent',
      };
    } catch (err: any) {
      // If we get EACCES (permission denied) or EEXIST (symlink exists), try with osascript for admin privileges
      if (err.code === 'EACCES' || err.code === 'EEXIST') {
        logger.info('Permission denied, attempting with admin privileges');

        try {
          // Use osascript to run ln command with admin privileges.
          // Single-quote the paths so the inner shell takes them literally —
          // no backtick/$() command substitution (monorepo#585).
          const command = `ln -sf ${posixSingleQuote(cliScriptPath)} ${posixSingleQuote(symlinkPath)}`;
          // Escape backslashes first, then double quotes, for AppleScript
          const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const script = `do shell script "${escapedCommand}" with administrator privileges`;

          // LOCAL-GUI: shows the macOS admin-auth prompt on the client host to
          // symlink the Intent CLI into /usr/local/bin; not workspace execution.
          // Argv form (no outer shell) so the AppleScript payload needs no
          // third layer of quoting.
          await execFileAsync('osascript', ['-e', script]);

          logger.info('CLI installed with admin privileges');
          return {
            success: true,
            message: m.system_ipc_cliInstalledAdmin_message(),
          };
        } catch (osascriptErr: any) {
          logger.error('Failed to install CLI with admin privileges', osascriptErr);
          return {
            success: false,
            message: m.system_ipc_cliInstallAdminFailed_message(),
            error: osascriptErr instanceof Error ? osascriptErr.message : String(osascriptErr),
          };
        }
      } else {
        logger.error('Failed to create symlink', err);
        return {
          success: false,
          message: m.system_ipc_symlinkFailed_message(),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  } catch (error) {
    logger.error('Unexpected error in install-cli handler', error as Error);
    return {
      success: false,
      message: m.system_ipc_cliInstallUnexpected_message(),
      error: error instanceof Error ? error.message : m.system_ipc_unknown_error(),
    };
  }
}

/**
 * Auto-repair the CLI symlink on app startup (production only).
 *
 * Silently checks if /usr/local/bin/intent exists and points to the correct location.
 * If it's stale (exists but points to wrong path), auto-repairs it using installIntentCli().
 *
 * Key behaviors:
 * - Only runs in production (not dev mode)
 * - Only runs if the symlink already exists (don't auto-install for users who never installed it)
 * - Only repairs if the symlink target doesn't match the expected path
 * - If the symlink already points to the correct location, does nothing (no admin prompt)
 * - Runs asynchronously after startup — doesn't block window creation
 * - Logs the result but doesn't show UI dialogs (silent repair)
 * - If admin prompt is cancelled/fails, logs a warning and continues (non-fatal)
 */
export async function autoRepairCliSymlink(): Promise<void> {
  try {
    // Only run in production mode
    if (process.env.NODE_ENV === 'development') {
      return;
    }

    const { promises: fsPromises } = require('fs');
    const path = require('path');

    const symlinkPath = '/usr/local/bin/intent';
    const expectedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'resources',
      'bin',
      'intent',
    );

    // Check if symlink exists
    let existingTarget: string;
    try {
      existingTarget = await fsPromises.readlink(symlinkPath);
    } catch (err: any) {
      // ENOENT means symlink doesn't exist - user never installed CLI, so don't auto-install
      if (err.code === 'ENOENT') {
        return;
      }
      // Other errors: log and return silently
      logger.debug('Error checking CLI symlink on startup', { error: err.message });
      return;
    }

    // If symlink already points to the correct location, nothing to do
    if (existingTarget === expectedPath) {
      return;
    }

    // Symlink exists but points to wrong path - repair it
    logger.info('CLI symlink is stale, auto-repairing', {
      existing: existingTarget,
      expected: expectedPath,
    });

    const result = await installIntentCli();
    if (result.success) {
      logger.info('CLI symlink auto-repaired successfully');
    } else {
      logger.warn('Failed to auto-repair CLI symlink', {
        message: result.message,
        error: result.error,
      });
    }
  } catch (error) {
    // Never throw - just log and continue
    logger.debug('Unexpected error in autoRepairCliSymlink', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupSystemIPC() {
  // App info
  ipcMain.handle(
    APP_CHANNELS.VERSION,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({
        success: true,
        data: app.getVersion(),
      }),
      APP_CHANNELS.VERSION,
    ),
  );

  // Get app version (alternative handler)
  ipcMain.handle(
    APP_CHANNELS.GET_VERSION,
    createSafeValidatedHandler(EmptySchema, async () => app.getVersion(), APP_CHANNELS.GET_VERSION),
  );

  ipcMain.handle(
    APP_CHANNELS.NAME,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({
        success: true,
        data: app.getName(),
      }),
      APP_CHANNELS.NAME,
    ),
  );

  // Set dock badge (macOS only)
  ipcMain.handle(
    APP_CHANNELS.SET_BADGE,
    createSafeValidatedHandler(
      AppSetBadgeSchema,
      async (_event, validated) => {
        try {
          if (process.platform === 'darwin' && app.dock) {
            // Set badge to empty string if count is 0, otherwise show the count
            app.dock.setBadge(validated.count > 0 ? validated.count.toString() : '');
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      APP_CHANNELS.SET_BADGE,
    ),
  );

  // Sync the renderer's language preference to the main-process locale service.
  // On change, notify listeners (index.ts rebuilds the application menu).
  ipcMain.handle(
    APP_CHANNELS.SET_LANGUAGE_PREFERENCE,
    createSafeValidatedHandler(
      AppSetLanguagePreferenceSchema,
      async (_event, validated) => {
        try {
          const { setMainLanguagePreference } = await import('../../../main/main-locale');
          const changed = setMainLanguagePreference(validated.preference);
          if (changed) {
            app.emit('main-locale-changed');
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      APP_CHANNELS.SET_LANGUAGE_PREFERENCE,
    ),
  );

  // Get app root directory
  ipcMain.handle(
    APP_CHANNELS.ROOT,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const appPath = app.getAppPath();
          return { success: true, data: appPath };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
      APP_CHANNELS.ROOT,
    ),
  );

  ipcMain.handle(
    APP_CHANNELS.PATH,
    createSafeValidatedHandler(
      AppPathSchema,
      async (_event, validated) => {
        try {
          return { success: true, data: app.getPath(validated.name as any) };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.system_ipc_getPathFailed_error(),
          };
        }
      },
      APP_CHANNELS.PATH,
    ),
  );

  // Window controls
  ipcMain.handle(
    WINDOW_CHANNELS.MINIMIZE,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const window = BrowserWindow.getFocusedWindow();
        if (window) {
          window.minimize();
        }
        return { success: true };
      },
      WINDOW_CHANNELS.MINIMIZE,
    ),
  );

  ipcMain.handle(
    WINDOW_CHANNELS.MAXIMIZE,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const window = BrowserWindow.getFocusedWindow();
        if (window) {
          if (window.isMaximized()) {
            window.unmaximize();
          } else {
            window.maximize();
          }
        }
        return { success: true };
      },
      WINDOW_CHANNELS.MAXIMIZE,
    ),
  );

  ipcMain.handle(
    WINDOW_CHANNELS.CLOSE,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const window = BrowserWindow.getFocusedWindow();
        if (window) {
          window.close();
        }
        return { success: true };
      },
      WINDOW_CHANNELS.CLOSE,
    ),
  );

  // Get current zoom factor
  ipcMain.handle(
    WINDOW_CHANNELS.GET_ZOOM_FACTOR,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
          return { success: true, data: window.webContents.getZoomFactor() };
        }
        return { success: true, data: 1.0 };
      },
      WINDOW_CHANNELS.GET_ZOOM_FACTOR,
    ),
  );

  // Set window theme
  ipcMain.handle(
    WINDOW_CHANNELS.SET_THEME,
    createSafeValidatedHandler(
      WindowSetThemeSchema,
      async (event, validated) => {
        try {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            // Determine the effective theme
            let isDark: boolean;
            if (validated.theme === 'system') {
              // Use native theme detector
              const { nativeTheme } = await import('electron');
              isDark = nativeTheme.shouldUseDarkColors;
            } else {
              isDark = validated.theme === 'dark';
            }

            // Update the window's background color (vibrancy disabled for performance)
            window.setBackgroundColor(isDark ? '#0a0a0a' : '#ffffff');

            logger.info('Window theme updated', { theme: validated.theme, isDark });
          }
          return { success: true };
        } catch (error) {
          logger.error('Failed to set window theme', error as Error);
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.system_ipc_setWindowThemeFailed_error(),
          };
        }
      },
      WINDOW_CHANNELS.SET_THEME,
    ),
  );

  // Set window title
  ipcMain.handle(
    WINDOW_CHANNELS.SET_TITLE,
    createSafeValidatedHandler(
      WindowSetTitleSchema,
      async (event, validated) => {
        try {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.setTitle(validated.title);
          }
          return { success: true };
        } catch (error) {
          logger.error('Failed to set window title', error as Error);
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.system_ipc_setWindowTitleFailed_error(),
          };
        }
      },
      WINDOW_CHANNELS.SET_TITLE,
    ),
  );

  // Set whether window is in a workspace (for menu state)
  ipcMain.handle(
    WINDOW_CHANNELS.SET_IN_WORKSPACE,
    createSafeValidatedHandler(
      WindowSetInWorkspaceSchema,
      async (event, validated) => {
        try {
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window) {
            const windowId = window.id;
            windowWorkspaceState.set(windowId, validated.inWorkspace);
            if (validated.workspaceId) {
              windowWorkspaceIds.set(windowId, validated.workspaceId);
            } else if (!validated.inWorkspace) {
              windowWorkspaceIds.delete(windowId);
            }
            logger.debug('Window workspace state updated', {
              windowId,
              inWorkspace: validated.inWorkspace,
              workspaceId: validated.workspaceId,
            });
            // Emit event to trigger menu rebuild
            app.emit('window-workspace-state-changed');
          }
          return { success: true };
        } catch (error) {
          logger.error('Failed to set window workspace state', error as Error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : m.system_ipc_setWindowWorkspaceStateFailed_error(),
          };
        }
      },
      WINDOW_CHANNELS.SET_IN_WORKSPACE,
    ),
  );

  // Track which workspace tabs are open in this window (for Window menu)
  ipcMain.handle(
    WINDOW_CHANNELS.SET_OPEN_WORKSPACE_TABS,
    createSafeValidatedHandler(
      WindowSetOpenWorkspaceTabsSchema,
      async (event, validated) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
          windowOpenWorkspaceTabs.set(window.id, validated.workspaceIds);
          app.emit('window-workspace-state-changed');
        }
        return { success: true };
      },
      WINDOW_CHANNELS.SET_OPEN_WORKSPACE_TABS,
    ),
  );

  // Set whether the focused panel in this window is a browser panel (for zoom routing)
  ipcMain.handle(
    WINDOW_CHANNELS.SET_BROWSER_FOCUSED,
    createSafeValidatedHandler(
      WindowSetBrowserFocusedSchema,
      async (event, validated) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
          windowBrowserFocusState.set(window.id, validated.browserFocused);
        }
        return { success: true };
      },
      WINDOW_CHANNELS.SET_BROWSER_FOCUSED,
    ),
  );

  /**
   * Create a new BrowserWindow with standard app configuration.
   * All new windows should use this to avoid config drift.
   * Keep in sync with createWindow / createWindowForSession in main/index.ts.
   *
   * The HUD pop-out (`/hud`) is a singleton: when a live HUD window already
   * exists it is restored/focused and returned instead of creating a second
   * one (see main/hud-window.ts).
   */
  async function createAppWindow(route?: string): Promise<BrowserWindow> {
    const { BrowserWindow } = await import('electron');
    const path = await import('path');
    const { forwardRendererConsoleToMainLog } = await import('../../../main/window');
    const { HUD_ROUTE_PREFIX, findExistingHudWindow, focusHudWindow, registerHudWindow } =
      await import('../../../main/hud-window');

    const isHudRoute = typeof route === 'string' && route.startsWith(HUD_ROUTE_PREFIX);
    if (isHudRoute) {
      const existing = findExistingHudWindow();
      if (existing) {
        focusHudWindow(existing);
        logger.info('Reusing existing HUD window (singleton)', { windowId: existing.id });
        return existing;
      }
    }

    const isDarkMode = nativeTheme.shouldUseDarkColors;
    const newWindow = new BrowserWindow({
      width: 1920,
      height: 1080,
      minWidth: 800,
      minHeight: 600,
      show: false, // Don't show until ready to prevent white flash
      webPreferences: {
        // Path from dist/features/system/main/ to dist/preload/
        preload: path.join(__dirname, '../../../preload/index.js'),
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
      title: 'Intent',
      backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff',
    });
    forwardRendererConsoleToMainLog(newWindow);

    // Register BEFORE loadURL so a concurrent HUD-open request reuses this
    // window even while its URL is still about:blank (mid-navigation race).
    if (isHudRoute) {
      registerHudWindow(newWindow);
    }

    newWindow.once('ready-to-show', () => {
      newWindow.show();
    });

    // Load the app with the specified route
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
      const devPort = process.env.DEV_PORT || '5190';
      const baseUrl = `http://127.0.0.1:${devPort}`;
      const url = route ? `${baseUrl}${route}` : baseUrl;
      await newWindow.loadURL(url);
    } else {
      // In production, use the custom app:// protocol (same as main window)
      // The protocol handler in main/index.ts serves files from dist/renderer
      // and handles client-side routing for SvelteKit
      const url = route ? `app://workspaces${route}` : 'app://workspaces/';
      await newWindow.loadURL(url);
    }

    return newWindow;
  }

  // Create new window
  ipcMain.handle(
    WINDOW_CHANNELS.CREATE,
    createSafeValidatedHandler(
      WindowCreateSchema,
      async (_event, validated) => {
        try {
          const newWindow = await createAppWindow(validated.route);
          logger.info('New window created', { route: validated.route });
          return { success: true, windowId: newWindow.id };
        } catch (error) {
          logger.error('Failed to create window', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : m.system_ipc_createWindowFailed_error(),
          };
        }
      },
      WINDOW_CHANNELS.CREATE,
    ),
  );

  // Open new window with specific route
  ipcMain.handle(
    WINDOW_CHANNELS.OPEN_NEW,
    createSafeValidatedHandler(
      WindowOpenNewSchema,
      async (_event, validated) => {
        try {
          const newWindow = await createAppWindow(validated.route);
          return { success: true, windowId: newWindow.id };
        } catch (error) {
          logger.error('Failed to open new window', error as Error);
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.system_ipc_openNewWindowFailed_error(),
          };
        }
      },
      WINDOW_CHANNELS.OPEN_NEW,
    ),
  );

  // Set the calling window's native full-screen state (HUD full-screen toggle)
  ipcMain.handle(
    WINDOW_CHANNELS.SET_FULL_SCREEN,
    createSafeValidatedHandler(
      WindowSetFullScreenSchema,
      async (event, validated) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
          return { success: false, fullScreen: false };
        }
        window.setFullScreen(validated.fullScreen);
        return { success: true, fullScreen: window.isFullScreen() };
      },
      WINDOW_CHANNELS.SET_FULL_SCREEN,
    ),
  );

  // Get the calling window's native full-screen state
  ipcMain.handle(
    WINDOW_CHANNELS.GET_FULL_SCREEN,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        return { success: true, fullScreen: window ? window.isFullScreen() : false };
      },
      WINDOW_CHANNELS.GET_FULL_SCREEN,
    ),
  );

  // Dialog message box
  ipcMain.handle(
    DIALOG_CHANNELS.MESSAGE,
    createSafeValidatedHandler(
      DialogMessageSchema,
      async (event, validated) => {
        const window = BrowserWindow.getFocusedWindow();
        const targetWindow = window || BrowserWindow.fromWebContents(event.sender);

        const options: Electron.MessageBoxOptions = {
          message: validated.message,
          title: validated.title,
          type: validated.type || 'info',
          buttons: validated.buttons || ['OK'],
        };

        const result = await dialog.showMessageBox(targetWindow as any, options);
        // Return the button index (0 = first button, 1 = second button, etc.)
        return result.response;
      },
      DIALOG_CHANNELS.MESSAGE,
    ),
  );

  // Native directory/file picker
  ipcMain.handle(
    DIALOG_CHANNELS.OPEN,
    createSafeValidatedHandler(
      DialogOpenSchema,
      async (event, validated) => {
        const focusedWindow = BrowserWindow.getFocusedWindow();
        const targetWindow = focusedWindow || BrowserWindow.fromWebContents(event.sender);
        const options: Electron.OpenDialogOptions = {
          title: validated.title,
          defaultPath: validated.defaultPath,
          properties:
            validated.mode === 'file' ? ['openFile'] : ['openDirectory', 'createDirectory'],
        };
        const result = targetWindow
          ? await dialog.showOpenDialog(targetWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : result.filePaths;
      },
      DIALOG_CHANNELS.OPEN,
    ),
  );

  // Shell operations
  ipcMain.handle(
    SHELL_CHANNELS.OPEN_EXTERNAL,
    createSafeValidatedHandler(
      ShellOpenExternalSchema,
      async (_event, validated) => {
        try {
          await shell.openExternal(validated.url);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.system_ipc_openUrlFailed_error(),
          };
        }
      },
      SHELL_CHANNELS.OPEN_EXTERNAL,
    ),
  );

  // Clipboard writes must go through Electron's main-process clipboard API.
  // navigator.clipboard can fail when focus is inside an Electron webview.
  ipcMain.handle(
    SYSTEM_CHANNELS.WRITE_CLIPBOARD,
    createSafeValidatedHandler(
      SystemWriteClipboardSchema,
      async (_event, validated) => {
        try {
          clipboard.writeText(validated.text);
          return { success: true };
        } catch (error) {
          logger.error('Failed to write clipboard', { error });
          return {
            success: false,
            error:
              error instanceof Error ? error.message : m.system_ipc_writeClipboardFailed_error(),
          };
        }
      },
      SYSTEM_CHANNELS.WRITE_CLIPBOARD,
    ),
  );

  ipcMain.handle(
    SHELL_CHANNELS.SHOW_ITEM_IN_FOLDER,
    createSafeValidatedHandler(
      ShellShowItemInFolderSchema,
      async (_event, validated) => {
        try {
          shell.showItemInFolder(validated.path);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.system_ipc_showItemFailed_error(),
          };
        }
      },
      SHELL_CHANNELS.SHOW_ITEM_IN_FOLDER,
    ),
  );

  // Shell open path handler
  ipcMain.handle(
    SHELL_CHANNELS.OPEN_PATH,
    createSafeValidatedHandler(
      ShellShowItemInFolderSchema,
      async (_event, validated) => {
        try {
          await shell.openPath(validated.path);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : m.system_ipc_openPathFailed_error(),
          };
        }
      },
      SHELL_CHANNELS.OPEN_PATH,
    ),
  );

  // VS Code git diff view - uses VSCode's native git integration
  ipcMain.handle(
    VSCODE_CHANNELS.OPEN_GIT_DIFF,
    createSafeValidatedHandler(
      VscodeOpenGitDiffSchema,
      async (_event, validated) => {
        try {
          // LOCAL-GUI: launches the user's VSCode on the client host to view a
          // git diff; not workspace execution.
          const { spawn } = require('child_process');

          logger.info('Opening git diff in VSCode:', {
            filePath: validated.filePath,
            workspacePath: validated.workspacePath,
          });

          // VSCode has native git integration that will automatically show diffs
          // We just need to open the workspace/repository and navigate to the file
          // VSCode will show git decorations and allow viewing diffs through:
          // - Gutter indicators (click on the changed line numbers)
          // - Source Control panel (Ctrl+Shift+G)
          // - Command palette > "Git: Open Changes"

          // Build the arguments for VSCode
          let args: string[] = [];

          if (validated.workspacePath) {
            // Open the repository/workspace folder first, then go to the specific file
            // This ensures VSCode loads the git context
            // Note: filePath is already the full absolute path from WorkspaceActionsMenu
            // Using -n and --skip-add-to-recently-opened to prevent GitLens tracking
            args = [
              '-n',
              '--skip-add-to-recently-opened',
              validated.workspacePath,
              '-g',
              validated.filePath,
            ];
          } else {
            // Just open the file (VSCode will try to find the git repo)
            // Using -n and --skip-add-to-recently-opened to prevent GitLens tracking
            args = ['-n', '--skip-add-to-recently-opened', '-g', validated.filePath];
          }

          // PERF: Find VSCode asynchronously to avoid blocking the main thread
          const codeCommand = (await findVSCodeAsync()) || 'code';
          if (!codeCommand || codeCommand === 'code') {
            logger.warn('VSCode not found in common locations, trying PATH');
          }

          // Only use shell: true if we're using 'code' (from PATH), not for full paths
          const useShell = codeCommand === 'code';
          const child = spawn(codeCommand, args, {
            detached: true,
            stdio: 'ignore',
            shell: useShell, // Use shell only when needed for PATH resolution
            windowsHide: true,
          });

          child.on('error', async (err: any) => {
            // If code command fails, try alternative approaches
            logger.warn('Failed to spawn code command, trying alternatives:', err);
            logger.info('Platform:', { platform: process.platform });

            // Check if we're on macOS and try using the full path
            if (process.platform === 'darwin') {
              try {
                logger.info('Trying macOS fallback methods...');

                // Common VSCode paths on macOS
                const commonPaths = [
                  // i18n-ignore (filesystem paths)
                  '/Applications/Visual Studio Code.app',
                  // i18n-ignore (filesystem paths)
                  '/Applications/Visual Studio Code - Insiders.app',
                  // i18n-ignore (filesystem paths)
                  '~/Applications/Visual Studio Code.app',
                  // i18n-ignore (filesystem paths)
                  '~/Applications/Visual Studio Code - Insiders.app',
                ];

                const fs = require('fs');

                // Try each common path
                for (const codePath of commonPaths) {
                  try {
                    const expandedPath = codePath.replace('~', process.env.HOME || '');
                    logger.info(`Checking VSCode at: ${expandedPath}`);

                    if (fs.existsSync(expandedPath)) {
                      logger.info(`Found VSCode at: ${expandedPath}`);

                      // Try to use the VSCode binary directly
                      const vscodeBinary = `${expandedPath}/Contents/Resources/app/bin/code`;

                      if (fs.existsSync(vscodeBinary)) {
                        try {
                          logger.info(`Found VSCode binary at: ${vscodeBinary}`);

                          // Pass arguments directly to execFile — no shell, no escaping needed
                          // Include --skip-add-to-recently-opened to prevent GitLens tracking
                          const vscodeArgs = ['-n', '--skip-add-to-recently-opened'];
                          if (validated.workspacePath) {
                            vscodeArgs.push(validated.workspacePath);
                          }
                          vscodeArgs.push('-g', validated.filePath);

                          logger.info('Executing VSCode command:', {
                            binary: vscodeBinary,
                            args: vscodeArgs,
                          });

                          // LOCAL-GUI: launches the user's VSCode binary on the
                          // client host to open a file; not workspace execution.
                          const { execFile: execFileCommand } = require('child_process');
                          execFileCommand(
                            vscodeBinary,
                            vscodeArgs,
                            { windowsHide: true },
                            (error: any) => {
                              if (error) {
                                logger.error('Failed to execute VSCode binary:', error as Error);
                              } else {
                                logger.info('Successfully launched VSCode via binary');
                              }
                            },
                          );

                          return;
                        } catch (binaryErr) {
                          logger.warn('Failed to use VSCode binary:', binaryErr as Error);
                        }
                      } else {
                        logger.info('VSCode binary not found, trying vscode:// protocol');

                        // Fallback to vscode:// protocol
                        try {
                          const fileUrl = `vscode://file/${validated.filePath}`;
                          logger.info(`Opening via vscode:// protocol: ${fileUrl}`);
                          await shell.openExternal(fileUrl);
                          logger.info('Successfully opened via vscode:// protocol');
                          return;
                        } catch (urlErr) {
                          logger.error('Failed to open via vscode:// protocol:', urlErr as Error);
                        }
                      }
                    }
                  } catch (err) {
                    logger.warn(`Failed to check/open VSCode at ${codePath}:`, err as Error);
                    // Continue to next path
                    continue;
                  }
                }

                logger.warn('VSCode not found in common locations');
              } catch (macOSError) {
                logger.error('Failed to open with macOS fallback:', macOSError as Error);
              }
            } else {
              // Final fallback: use vscode:// protocol
              try {
                logger.info('Trying vscode:// protocol fallback');
                logger.info(`Opening: vscode://file/${validated.filePath}`);
                // filePath is already absolute, don't join it
                await shell.openExternal(`vscode://file/${validated.filePath}`);
                logger.info('Successfully opened via vscode:// protocol');
              } catch (fallbackError) {
                logger.error('All VSCode open methods failed:', fallbackError as Error);
              }
            }
          });

          child.unref();
          return { success: true };
        } catch (error) {
          logger.error('Failed to open git diff in VSCode:', error as Error);

          // Try fallback method - just open the file
          try {
            // filePath is already absolute
            await shell.openExternal(`vscode://file/${validated.filePath}`);
            return { success: true };
          } catch {
            return {
              success: false,
              error: m.system_ipc_openGitDiffVscodeFailed_error({ error: String(error) }),
            };
          }
        }
      },
      VSCODE_CHANNELS.OPEN_GIT_DIFF,
    ),
  );

  // VS Code diff view
  ipcMain.handle(
    VSCODE_CHANNELS.OPEN_DIFF,
    createSafeValidatedHandler(
      VscodeOpenDiffSchema,
      async (_event, validated) => {
        try {
          const { promises: fsPromises } = require('fs');
          const path = require('path');
          const os = require('os');
          // LOCAL-GUI: launches the user's VSCode on the client host to view a
          // diff of two temp files; not workspace execution.
          const { spawn } = require('child_process');

          // Create temp directory (ASYNC)
          const tempDir = path.join(os.tmpdir(), 'vscode-diff');
          await fsPromises.mkdir(tempDir, { recursive: true }).catch(() => {
            // Directory might already exist, that's fine
          });

          // Create temp files with unique names to avoid conflicts
          const timestamp = Date.now();
          const oldFilePath = path.join(tempDir, `${timestamp}-${validated.oldFileName}`);
          const newFilePath = path.join(tempDir, `${timestamp}-${validated.newFileName}`);

          // Write content to temp files (ASYNC)
          await Promise.all([
            fsPromises.writeFile(oldFilePath, validated.oldContent, 'utf-8'),
            fsPromises.writeFile(newFilePath, validated.newContent, 'utf-8'),
          ]);

          // PERF: Find VSCode asynchronously to avoid blocking the main thread
          const codeCommand = (await findVSCodeAsync()) || 'code';

          // Open diff view in VSCode using -d flag
          // Format: code -d <file1> <file2>
          // Include --skip-add-to-recently-opened to prevent GitLens tracking
          // Only use shell: true if we're using 'code' (from PATH), not for full paths
          const useShell = codeCommand === 'code';
          const child = spawn(
            codeCommand,
            ['-n', '--skip-add-to-recently-opened', '-d', oldFilePath, newFilePath],
            {
              detached: true,
              stdio: 'ignore',
              shell: useShell, // Use shell only when needed for PATH resolution
              windowsHide: true,
            },
          );

          // Wait for error or successful spawn
          const spawnResult = await new Promise<boolean>((resolve) => {
            let resolved = false;

            // If error occurs, resolve with false
            child.on('error', (error: any) => {
              if (!resolved) {
                resolved = true;
                logger.error('Failed to spawn code command for diff:', error as Error, { error });
                resolve(false);
              }
            });

            // If spawn succeeds, resolve with true after a short delay
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve(true);
              }
            }, 100);
          });

          if (!spawnResult) {
            // Clean up temp files immediately if spawn failed (ASYNC)
            await Promise.all([
              fsPromises.unlink(oldFilePath).catch(() => {}),
              fsPromises.unlink(newFilePath).catch(() => {}),
            ]);
            throw new Error('code command not found');
          }

          child.unref();

          // Clean up temp files after a delay (VSCode will have read them by then) - ASYNC
          setTimeout(async () => {
            await Promise.all([
              fsPromises.unlink(oldFilePath).catch(() => {}),
              fsPromises.unlink(newFilePath).catch(() => {}),
            ]);
          }, 5000);

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: m.system_ipc_openDiffVscodeFailed_error({ error: String(error) }),
          };
        }
      },
      VSCODE_CHANNELS.OPEN_DIFF,
    ),
  );

  ipcMain.handle(
    VSCODE_CHANNELS.OPEN_FILE,
    createSafeValidatedHandler(
      VscodeOpenFileSchema,
      async (_event, validated) => {
        try {
          // PERF: Find VSCode asynchronously to avoid blocking the main thread
          const codeCommand = await findVSCodeAsync();

          if (!codeCommand) {
            // If we can't find the code command, try using open command on macOS
            if (process.platform === 'darwin') {
              // Argv form (no shell) so the file path stays literal.
              const openArgs = validated.line
                ? [
                    '-a',
                    // i18n-ignore (application name argv for `open -a`)
                    'Visual Studio Code',
                    '--args',
                    '-n',
                    '--skip-add-to-recently-opened',
                    '--goto',
                    `${validated.file}:${validated.line}`,
                  ]
                : [
                    '-a',
                    // i18n-ignore (application name argv for `open -a`)
                    'Visual Studio Code',
                    '--args',
                    '-n',
                    '--skip-add-to-recently-opened',
                    validated.file,
                  ];

              // LOCAL-GUI: launches the user's VSCode via macOS `open` on the
              // client host; not workspace execution.
              await execFileAsync('open', openArgs);
              return { success: true };
            } else {
              throw new Error('VS Code command not found');
            }
          }

          // Open file at specific line
          // Include -n and --skip-add-to-recently-opened to prevent GitLens tracking
          const codeArgs = validated.line
            ? [
                '-n',
                '--skip-add-to-recently-opened',
                '--goto',
                `${validated.file}:${validated.line}`,
              ]
            : ['-n', '--skip-add-to-recently-opened', validated.file];

          // LOCAL-GUI: launches the user's VSCode on the client host to open a
          // file; not workspace execution. Argv form (no shell) so the file
          // path stays literal.
          await execFileAsync(codeCommand, codeArgs);
          return { success: true };
        } catch (error) {
          logger.error('Failed to open file in VS Code:', error as Error);

          // Final fallback: try vscode:// protocol
          try {
            const fileUrl = validated.line
              ? `vscode://file/${validated.file}:${validated.line}`
              : `vscode://file/${validated.file}`;
            await shell.openExternal(fileUrl);
            return { success: true };
          } catch {
            return {
              success: false,
              error: m.system_ipc_openFileVscodeFailed_error(),
            };
          }
        }
      },
      VSCODE_CHANNELS.OPEN_FILE,
    ),
  );

  // JetBrains integration
  ipcMain.handle(
    JETBRAINS_CHANNELS.OPEN,
    createSafeValidatedHandler(
      JetbrainsOpenSchema,
      async (_event, validated) => {
        try {
          // LOCAL-GUI: launches the user's JetBrains IDE on the client host to
          // open a project/file; not workspace execution.
          let args: string[] = [];

          // Handle both string path and object with folder/file
          if (typeof validated === 'string') {
            args = [validated];
          } else {
            // Open folder with file: idea folder --line file
            // JetBrains will open the folder as a project and then open the file
            args = [validated.folder, validated.file];
          }

          // Try to spawn the idea command (IntelliJ IDEA)
          // JetBrains IDEs typically use: idea, pycharm, webstorm, etc.
          // We'll try 'idea' first as it's the most common
          const child = spawn('idea', args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });

          // Wait for error or successful spawn
          const spawnResult = await new Promise<boolean>((resolve) => {
            // If error occurs, resolve with false
            child.on('error', () => {
              resolve(false);
            });

            // If spawn succeeds, resolve with true after a short delay
            setTimeout(() => resolve(true), 100);
          });

          if (spawnResult) {
            // Unref the child process so it doesn't keep the parent alive
            child.unref();
            return { success: true };
          } else {
            // Spawn failed, try fallback with jetbrains toolbox
            throw new Error('idea command not found');
          }
        } catch {
          // Try alternative JetBrains commands
          try {
            // Get the path to open
            const pathToOpen = typeof validated === 'string' ? validated : validated.file;

            // Try common JetBrains IDE commands
            const ideBinaries = ['idea', 'pycharm', 'webstorm', 'clion', 'goland'];

            for (const ideBinary of ideBinaries) {
              try {
                // LOCAL-GUI: launches the user's JetBrains IDE on the client
                // host as a fallback; not workspace execution. Argv form (no
                // shell) so the path stays literal.
                await execFileAsync(ideBinary, [pathToOpen]);
                return { success: true };
              } catch {
                // Continue to next command
                continue;
              }
            }

            return {
              success: false,
              error: m.system_ipc_openJetbrainsFailed_error(),
            };
          } catch {
            return {
              success: false,
              error: m.system_ipc_openJetbrainsFailed_error(),
            };
          }
        }
      },
      JETBRAINS_CHANNELS.OPEN,
    ),
  );

  // Xcode integration
  ipcMain.handle(
    XCODE_CHANNELS.OPEN,
    createSafeValidatedHandler(
      XcodeOpenSchema,
      async (_event, validated) => {
        try {
          // LOCAL-GUI: launches Xcode on the client host via `open -a Xcode`;
          // not workspace execution.
          const { spawn } = require('child_process');
          const fs = require('fs');
          const path = require('path');

          // Get the folder path and optional changed files for smart project detection
          const folderPath = typeof validated === 'string' ? validated : validated.folder;
          const changedFiles: string[] =
            typeof validated === 'object' && validated.changedFiles ? validated.changedFiles : [];

          logger.info('[Xcode] Handler invoked', {
            folderPath,
            changedFilesCount: changedFiles.length,
          });

          /**
           * Check if an .xcodeproj bundle is valid (has project.pbxproj).
           */
          const isValidXcodeproj = (xcodeprojPath: string): boolean => {
            try {
              const pbxprojPath = path.join(xcodeprojPath, 'project.pbxproj');
              return fs.existsSync(pbxprojPath);
            } catch {
              return false;
            }
          };

          /**
           * Check if a directory is a git worktree and return the main repo path.
           */
          const getMainRepoFromWorktree = (worktreePath: string): string | null => {
            try {
              const gitPath = path.join(worktreePath, '.git');
              const stat = fs.statSync(gitPath);

              if (stat.isFile()) {
                const content = fs.readFileSync(gitPath, 'utf-8').trim();
                const match = content.match(/^gitdir:\s*(.+)$/);
                if (match) {
                  const gitDir = match[1];
                  const mainGitDir = path.resolve(gitDir, '../..');
                  const mainRepoPath = path.dirname(mainGitDir);

                  if (fs.existsSync(path.join(mainRepoPath, '.git'))) {
                    return mainRepoPath;
                  }
                }
              }
            } catch {
              // Not a worktree
            }
            return null;
          };

          /**
           * Repair incomplete .xcodeproj bundles by copying project.pbxproj from main repo.
           * This runs BEFORE project detection to ensure projects are valid.
           */
          const repairIncompleteXcodeprojsInWorktree = (
            worktreePath: string,
            mainRepoPath: string,
          ): number => {
            let repairedCount = 0;

            const repairRecursively = (
              worktreeDir: string,
              mainRepoDir: string,
              depth: number = 0,
            ): void => {
              if (depth > 5) return;

              try {
                const entries = fs.readdirSync(worktreeDir, { withFileTypes: true });

                for (const entry of entries) {
                  if (entry.name.endsWith('.xcodeproj') && entry.isDirectory()) {
                    const worktreeXcodeproj = path.join(worktreeDir, entry.name);
                    const worktreePbxproj = path.join(worktreeXcodeproj, 'project.pbxproj');

                    // Check if this .xcodeproj is incomplete
                    if (!fs.existsSync(worktreePbxproj)) {
                      // Find corresponding path in main repo
                      const relativePath = path.relative(worktreePath, worktreeDir);
                      const mainRepoXcodeprojDir = relativePath
                        ? path.join(mainRepoPath, relativePath)
                        : mainRepoPath;
                      const mainRepoXcodeproj = path.join(mainRepoXcodeprojDir, entry.name);
                      const mainRepoPbxproj = path.join(mainRepoXcodeproj, 'project.pbxproj');

                      if (fs.existsSync(mainRepoPbxproj)) {
                        try {
                          fs.copyFileSync(mainRepoPbxproj, worktreePbxproj);
                          repairedCount++;
                          logger.info('[Xcode] Repaired incomplete .xcodeproj', {
                            from: mainRepoPbxproj,
                            to: worktreePbxproj,
                          });
                        } catch (copyErr) {
                          logger.error('[Xcode] Failed to copy project.pbxproj', copyErr as Error);
                        }
                      }
                    }
                  } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    // Recurse into subdirectories (skip hidden, node_modules, etc.)
                    if (
                      entry.name !== 'node_modules' &&
                      entry.name !== 'Pods' &&
                      entry.name !== 'build' &&
                      entry.name !== 'DerivedData' &&
                      !entry.name.endsWith('.xcworkspace')
                    ) {
                      const subWorktree = path.join(worktreeDir, entry.name);
                      const subMainRepo = path.join(mainRepoDir, entry.name);
                      if (fs.existsSync(subMainRepo)) {
                        repairRecursively(subWorktree, subMainRepo, depth + 1);
                      }
                    }
                  }
                }
              } catch {
                // Ignore errors
              }
            };

            repairRecursively(worktreePath, mainRepoPath);
            return repairedCount;
          };

          // FIRST: Check if this is a worktree and repair any incomplete .xcodeproj bundles
          const mainRepoPath = getMainRepoFromWorktree(folderPath);
          if (mainRepoPath) {
            logger.info('[Xcode] Detected git worktree, checking for incomplete projects', {
              worktreePath: folderPath,
              mainRepoPath,
            });
            const repairedCount = repairIncompleteXcodeprojsInWorktree(folderPath, mainRepoPath);
            if (repairedCount > 0) {
              logger.info('[Xcode] Repaired incomplete .xcodeproj bundles', { repairedCount });
            }
          }

          /**
           * Find Xcode project files in a directory (non-recursive).
           * Returns the path to open, or null if no project files found.
           * Priority: .xcworkspace > .xcodeproj > Package.swift (SPM)
           * Only returns .xcodeproj if it's valid (has project.pbxproj).
           */
          const findXcodeProjectInDir = (dir: string): string | null => {
            try {
              const entries = fs.readdirSync(dir);

              // First, look for .xcworkspace files (preferred - used by CocoaPods, etc.)
              const xcworkspace = entries.find((entry: string) => entry.endsWith('.xcworkspace'));
              if (xcworkspace) {
                return path.join(dir, xcworkspace);
              }

              // Second, look for .xcodeproj files (must be valid with project.pbxproj)
              const xcodeproj = entries.find((entry: string) => entry.endsWith('.xcodeproj'));
              if (xcodeproj) {
                const xcodeprojPath = path.join(dir, xcodeproj);
                if (isValidXcodeproj(xcodeprojPath)) {
                  return xcodeprojPath;
                }
                // Invalid .xcodeproj found - log but don't return it
                logger.debug('[Xcode] Found .xcodeproj but missing project.pbxproj', {
                  xcodeprojPath,
                });
              }

              // Third, check for Package.swift (SPM package - Xcode opens these natively)
              const hasPackageSwift = entries.includes('Package.swift');
              if (hasPackageSwift) {
                // For SPM packages, we open the folder - Xcode recognizes it as a package
                return dir;
              }

              return null;
            } catch {
              return null;
            }
          };

          /**
           * Find incomplete .xcodeproj bundles (missing project.pbxproj) in a directory.
           */
          const findIncompleteXcodeprojs = (dir: string): string[] => {
            const incomplete: string[] = [];
            try {
              const entries = fs.readdirSync(dir);
              for (const entry of entries) {
                if (entry.endsWith('.xcodeproj')) {
                  const xcodeprojPath = path.join(dir, entry);
                  if (!isValidXcodeproj(xcodeprojPath)) {
                    incomplete.push(xcodeprojPath);
                  }
                }
              }
            } catch {
              // Ignore errors
            }
            return incomplete;
          };

          interface XcodeProjectInfo {
            projectPath: string; // Path to .xcworkspace, .xcodeproj, or folder (for SPM)
            projectDir: string; // Directory containing the project
            depth: number; // How deep in the folder hierarchy
            matchedFiles: number; // How many changed files are in this project's subtree
          }

          /**
           * Recursively find all Xcode projects in a directory.
           * Returns array of project info with scoring metadata.
           */
          const findAllXcodeProjects = (
            baseDir: string,
            currentDir: string = baseDir,
            depth: number = 0,
            maxDepth: number = 5,
          ): XcodeProjectInfo[] => {
            const projects: XcodeProjectInfo[] = [];

            if (depth > maxDepth) return projects;

            try {
              const entries = fs.readdirSync(currentDir, { withFileTypes: true });

              // Check for Xcode project in this directory
              const projectPath = findXcodeProjectInDir(currentDir);
              if (projectPath) {
                projects.push({
                  projectPath,
                  projectDir: currentDir,
                  depth,
                  matchedFiles: 0, // Will be calculated later
                });
              }

              // Recurse into subdirectories (skip hidden dirs, node_modules, etc.)
              for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue;
                if (entry.name === 'node_modules') continue;
                if (entry.name === 'Pods') continue; // CocoaPods folder
                if (entry.name === 'build') continue;
                if (entry.name === 'DerivedData') continue;
                if (entry.name.endsWith('.xcodeproj')) continue; // .xcodeproj is a directory
                if (entry.name.endsWith('.xcworkspace')) continue; // .xcworkspace is a directory

                const subPath = path.join(currentDir, entry.name);
                projects.push(...findAllXcodeProjects(baseDir, subPath, depth + 1, maxDepth));
              }
            } catch {
              // Ignore permission errors, etc.
            }

            return projects;
          };

          /**
           * Score projects based on changed files.
           * A project gets a point for each changed file that is within its directory subtree.
           */
          const scoreProjectsByChangedFiles = (
            projects: XcodeProjectInfo[],
            baseDir: string,
            changedFilePaths: string[],
          ): XcodeProjectInfo[] => {
            if (changedFilePaths.length === 0) return projects;

            return projects.map((project) => {
              const relativeProjectDir = path.relative(baseDir, project.projectDir);
              let matchedFiles = 0;

              for (const changedFile of changedFilePaths) {
                // Check if the changed file is within this project's directory
                // A file is "in" a project if it starts with the project's relative path
                // For root-level projects (relativeProjectDir === ''), all files match
                if (
                  relativeProjectDir === '' ||
                  changedFile.startsWith(relativeProjectDir + path.sep) ||
                  changedFile === relativeProjectDir
                ) {
                  matchedFiles++;
                }
              }

              return { ...project, matchedFiles };
            });
          };

          /**
           * Select the best Xcode project based on:
           * 1. Most matched changed files (highest priority)
           * 2. Shallowest depth (prefer projects closer to root)
           */
          const selectBestProject = (projects: XcodeProjectInfo[]): XcodeProjectInfo | null => {
            if (projects.length === 0) return null;

            // Sort by: matchedFiles DESC, then depth ASC
            const sorted = [...projects].sort((a, b) => {
              if (b.matchedFiles !== a.matchedFiles) {
                return b.matchedFiles - a.matchedFiles; // More matches = better
              }
              return a.depth - b.depth; // Shallower = better
            });

            return sorted[0];
          };

          /**
           * Check if a directory is a git worktree and return the main repo path.
           * In worktrees, .git is a file (not directory) containing "gitdir: /path/to/.git/worktrees/..."
           */
          const findMainRepoFromWorktree = (worktreePath: string): string | null => {
            try {
              const gitPath = path.join(worktreePath, '.git');
              const stat = fs.statSync(gitPath);

              if (stat.isFile()) {
                // .git is a file in worktrees
                const content = fs.readFileSync(gitPath, 'utf-8').trim();
                const match = content.match(/^gitdir:\s*(.+)$/);
                if (match) {
                  // Navigate from .git/worktrees/xxx back to the main repo
                  // The gitdir points to something like /path/to/main-repo/.git/worktrees/workspace-id
                  const gitDir = match[1];
                  // Go up from worktrees/xxx to .git, then up to the repo root
                  const mainGitDir = path.resolve(gitDir, '../..');
                  const mainRepoPath = path.dirname(mainGitDir);

                  // Verify this looks like a valid repo
                  if (fs.existsSync(path.join(mainRepoPath, '.git'))) {
                    return mainRepoPath;
                  }
                }
              }
            } catch {
              // Not a worktree or error reading - that's fine
            }
            return null;
          };

          let pathToOpen: string | null = null;

          // If we have changed files, use smart monorepo detection
          if (changedFiles.length > 0) {
            logger.info('[Xcode] Using smart project detection with changed files', {
              changedFileCount: changedFiles.length,
              sampleFiles: changedFiles.slice(0, 5),
            });

            // Find all Xcode projects recursively
            const allProjects = findAllXcodeProjects(folderPath);

            if (allProjects.length > 0) {
              // Score projects by how many changed files they contain
              const scoredProjects = scoreProjectsByChangedFiles(
                allProjects,
                folderPath,
                changedFiles,
              );

              // Select the best project
              const bestProject = selectBestProject(scoredProjects);

              if (bestProject) {
                pathToOpen = bestProject.projectPath;
                logger.info('[Xcode] Selected best project based on changed files', {
                  projectPath: bestProject.projectPath,
                  matchedFiles: bestProject.matchedFiles,
                  depth: bestProject.depth,
                  totalProjects: allProjects.length,
                });
              }
            }
          }

          // Fall back to simple top-level search if no project found yet
          if (!pathToOpen) {
            pathToOpen = findXcodeProjectInDir(folderPath);
          }

          // If still no project found, try recursive search without changed files scoring
          if (!pathToOpen) {
            const allProjects = findAllXcodeProjects(folderPath);
            if (allProjects.length > 0) {
              // Just pick the shallowest one
              const sorted = [...allProjects].sort((a, b) => a.depth - b.depth);
              pathToOpen = sorted[0].projectPath;
              logger.info('[Xcode] Using first found project (no diffs to score)', {
                projectPath: pathToOpen,
                totalProjects: allProjects.length,
              });
            }
          }

          // If no project found, check if this is a worktree and try to repair incomplete .xcodeproj
          if (!pathToOpen) {
            const mainRepoPath = findMainRepoFromWorktree(folderPath);

            if (mainRepoPath) {
              logger.info('[Xcode] No valid project in worktree, checking main repo', {
                worktreePath: folderPath,
                mainRepoPath,
              });

              // First, check for incomplete .xcodeproj bundles that we can repair
              // by copying project.pbxproj from the main repo
              const repairIncompleteXcodeproj = (
                worktreeDir: string,
                mainRepoDir: string,
              ): string | null => {
                const incompleteProjects = findIncompleteXcodeprojs(worktreeDir);

                for (const incompleteProject of incompleteProjects) {
                  const projectName = path.basename(incompleteProject);
                  // Calculate relative path from worktree root to find corresponding main repo path
                  const relativePath = path.relative(folderPath, worktreeDir);
                  const mainRepoProjectDir = relativePath
                    ? path.join(mainRepoDir, relativePath)
                    : mainRepoDir;
                  const mainRepoProject = path.join(mainRepoProjectDir, projectName);
                  const mainRepoPbxproj = path.join(mainRepoProject, 'project.pbxproj');

                  if (fs.existsSync(mainRepoPbxproj)) {
                    try {
                      const worktreePbxproj = path.join(incompleteProject, 'project.pbxproj');
                      fs.copyFileSync(mainRepoPbxproj, worktreePbxproj);
                      logger.info('[Xcode] Copied project.pbxproj from main repo to worktree', {
                        from: mainRepoPbxproj,
                        to: worktreePbxproj,
                      });
                      return incompleteProject;
                    } catch (copyError) {
                      logger.error('[Xcode] Failed to copy project.pbxproj', copyError as Error, {
                        from: mainRepoPbxproj,
                        to: incompleteProject,
                      });
                    }
                  }
                }
                return null;
              };

              // Try to repair incomplete projects in the folder and subdirectories
              const tryRepairRecursively = (
                worktreeDir: string,
                mainRepoDir: string,
                depth: number = 0,
                maxDepth: number = 5,
              ): string | null => {
                if (depth > maxDepth) return null;

                // Try to repair in current directory
                const repaired = repairIncompleteXcodeproj(worktreeDir, mainRepoDir);
                if (repaired) return repaired;

                // Recurse into subdirectories
                try {
                  const entries = fs.readdirSync(worktreeDir, { withFileTypes: true });
                  for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    if (entry.name.startsWith('.')) continue;
                    if (entry.name === 'node_modules') continue;
                    if (entry.name === 'Pods') continue;
                    if (entry.name === 'build') continue;
                    if (entry.name === 'DerivedData') continue;
                    if (entry.name.endsWith('.xcodeproj')) continue;
                    if (entry.name.endsWith('.xcworkspace')) continue;

                    const subWorktree = path.join(worktreeDir, entry.name);
                    const subMainRepo = path.join(mainRepoDir, entry.name);

                    if (fs.existsSync(subMainRepo)) {
                      const result = tryRepairRecursively(
                        subWorktree,
                        subMainRepo,
                        depth + 1,
                        maxDepth,
                      );
                      if (result) return result;
                    }
                  }
                } catch {
                  // Ignore errors
                }
                return null;
              };

              // Try to repair incomplete projects
              const repairedProject = tryRepairRecursively(folderPath, mainRepoPath);
              if (repairedProject) {
                pathToOpen = repairedProject;
                logger.info('[Xcode] Using repaired .xcodeproj', { pathToOpen });
              } else {
                // No incomplete projects to repair, check for valid projects in main repo
                const mainRepoProject = findXcodeProjectInDir(mainRepoPath);

                if (mainRepoProject) {
                  // Check if it's an SPM package (main repo has Package.swift)
                  // For SPM, we can still open the worktree folder - Xcode will work with it
                  const worktreeHasPackageSwift = fs.existsSync(
                    path.join(folderPath, 'Package.swift'),
                  );
                  if (worktreeHasPackageSwift || mainRepoProject === mainRepoPath) {
                    // SPM package - open the worktree folder, Xcode handles SPM natively
                    pathToOpen = folderPath;
                    logger.info('[Xcode] Opening worktree as SPM package', { pathToOpen });
                  } else {
                    // .xcodeproj/.xcworkspace exists in main repo but not worktree
                    // This likely means it's gitignored and needs to be regenerated
                    // (e.g., run `pod install` for CocoaPods, `tuist generate` for Tuist)
                    logger.warn(
                      // i18n-ignore (developer log message)
                      '[Xcode] Project file found in main repo but not in worktree. ' +
                        // i18n-ignore (developer log message)
                        'You may need to run project generation (pod install, tuist generate, etc.) in the worktree.',
                      {
                        mainRepoProject,
                        worktreePath: folderPath,
                      },
                    );
                    // Still open the worktree folder - Xcode will show what's there
                    pathToOpen = folderPath;
                  }
                }
              }
            }
          }

          // Default to the folder if nothing else found
          if (!pathToOpen) {
            pathToOpen = folderPath;
          }

          logger.info('[Xcode] Opening path', { pathToOpen, originalFolder: folderPath });

          // Use 'open -a Xcode' to open in Xcode
          const child = spawn('open', ['-a', 'Xcode', pathToOpen], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });

          // Wait for error or successful spawn
          const spawnResult = await new Promise<boolean>((resolve) => {
            child.on('error', () => {
              resolve(false);
            });
            setTimeout(() => resolve(true), 100);
          });

          if (spawnResult) {
            child.unref();
            return { success: true };
          } else {
            throw new Error('Failed to spawn Xcode');
          }
        } catch (error) {
          logger.error('[Xcode] Failed to open', error as Error);
          return {
            success: false,
            error: m.system_ipc_openXcodeFailed_error(),
          };
        }
      },
      XCODE_CHANNELS.OPEN,
    ),
  );

  // Settings (`settings:get/set/update/getAll`) — the main-side
  // electron-store facade is retired (PROTOCOL.md §5.12). The
  // renderer-side mock-IPC bridge (`settings-legacy-bridge-seeder.ts`)
  // routes every legacy `settings:*` call to the daemon settings catalog
  // (or to namespaced localStorage for the FE-only keys); no main-side
  // handler is needed in the daemon-backed build. The `SETTINGS_CHANNELS`
  // constants remain exported for the bridge seeder + its tests.

  // Check MCP server auth requirements
  ipcMain.handle(
    USER_MCP_CHANNELS.CHECK_AUTH,
    createSafeValidatedHandler(
      UserMcpCheckAuthSchema,
      async (_event, validated) => {
        try {
          const { checkMcpAuthRequirement } = await import('../../mcp/main/mcp-auth-providers');
          const result = await checkMcpAuthRequirement(validated.url, validated.name);
          return { success: true, data: result };
        } catch (error) {
          logger.error('Error checking MCP auth requirement:', error);
          return { success: false, error: String(error) };
        }
      },
      USER_MCP_CHANNELS.CHECK_AUTH,
    ),
  );

  // Test connection to HTTP/SSE MCP server
  ipcMain.handle(
    USER_MCP_CHANNELS.TEST_CONNECTION,
    createSafeValidatedHandler(
      UserMcpTestConnectionSchema,
      async (_event, validated) => {
        try {
          const { testMcpConnection } = await import('../../mcp/main/mcp-connection-test');
          const result = await testMcpConnection(validated.url, validated.headers, validated.name);
          return { success: true, data: result };
        } catch (error) {
          logger.error('Error testing MCP connection:', error);
          return { success: false, error: String(error) };
        }
      },
      USER_MCP_CHANNELS.TEST_CONNECTION,
    ),
  );

  // Get home directory
  ipcMain.handle(
    SYSTEM_CHANNELS.HOME_DIRECTORY,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const os = require('os');
        return { success: true, data: os.homedir() };
      },
      SYSTEM_CHANNELS.HOME_DIRECTORY,
    ),
  );

  // Get workspace root directory
  ipcMain.handle(
    SYSTEM_CHANNELS.WORKSPACE_ROOT,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const os = require('os');
        const path = require('path');
        const override =
          process.env.WORKSPACES_BASE_DIR ||
          process.env.INTENT_WORKSPACES_ROOT ||
          process.env.AUGMENT_WORKSPACES_ROOT;
        const workspaceRoot =
          override && override.trim().length > 0 ? override : path.join(os.homedir(), 'intent');
        return { success: true, data: workspaceRoot };
      },
      SYSTEM_CHANNELS.WORKSPACE_ROOT,
    ),
  );

  // Legacy: Get home directory (for backward compatibility)
  ipcMain.handle(
    LEGACY_CHANNELS.GET_HOME_DIRECTORY,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const os = require('os');
        return os.homedir();
      },
      LEGACY_CHANNELS.GET_HOME_DIRECTORY,
    ),
  );

  // Deep links
  ipcMain.handle(
    DEEP_LINK_CHANNELS.HANDLE,
    createSafeValidatedHandler(
      DeepLinkHandleSchema,
      async (_event, validated) => {
        // Parse and return URL components
        // Future: Integrate with DeepLinkHandler service for routing
        try {
          const parsed = new URL(validated.url);
          return {
            success: true,
            data: {
              protocol: parsed.protocol,
              hostname: parsed.hostname,
              pathname: parsed.pathname,
              search: parsed.search,
              hash: parsed.hash,
            },
          };
        } catch {
          return {
            success: false,
            error: m.system_ipc_invalidDeepLink_error(),
          };
        }
      },
      DEEP_LINK_CHANNELS.HANDLE,
    ),
  );

  // Execute command (with security warning) — delegated to the daemon
  // (`host.exec`, PROTOCOL.md §5.14). The wire schema is a shell-form command
  // string, so we wrap it via the host shell (`sh -c` on POSIX / `cmd /c` on
  // Windows) and let the daemon run it on the workspace host. `cwd` is
  // forwarded together with the caller's `workspaceId` so the daemon's
  // within-workspace containment guard (§5.14) can run — cwd-only payloads
  // are rejected by SystemExecuteCommandSchema's cwd⇒workspaceId refinement
  // before this handler runs (monorepo#578), mirroring `host.exec`'s -32602.
  ipcMain.handle(
    SYSTEM_CHANNELS.EXECUTE_COMMAND,
    createSafeValidatedHandler(
      SystemExecuteCommandSchema,
      async (_event, validated) => {
        try {
          const { command, cwd, workspaceId } = validated;

          // SECURITY WARNING: This executes arbitrary commands
          // This should only be used for trusted, internal operations
          logger.warn('Executing command - ensure input is trusted', {
            command: command.substring(0, 100),
            cwd,
          });

          const [shellCmd, shellFlag] =
            process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];
          const result = await hostExec(shellCmd, {
            args: [shellFlag, command],
            cwd,
            workspaceId,
            timeoutMs: 30_000,
          });

          if (result.exitCode === 0) {
            return {
              success: true,
              data: {
                stdout: result.stdout,
                stderr: result.stderr,
                code: 0,
              },
            };
          }
          return {
            success: false,
            error: m.system_ipc_commandExecutionFailed_error(), // Don't expose full error message
            data: {
              stdout: result.stdout,
              stderr: result.stderr,
              code: result.exitCode,
            },
          };
        } catch (error) {
          logger.error('Command execution failed', error as Error, {
            command: validated.command?.substring(0, 100),
          });
          return {
            success: false,
            error: m.system_ipc_commandExecutionFailed_error(), // Don't expose full error message
            data: {
              stdout: '',
              stderr: '',
              code: 1,
            },
          };
        }
      },
      SYSTEM_CHANNELS.EXECUTE_COMMAND,
    ),
  );

  // Execute command with streaming — delegated to the daemon
  // (`host.execStream`, PROTOCOL.md §5.14). The wire schema is a shell-form
  // command string, so we wrap it via the host shell (`sh -c` on POSIX /
  // `cmd /c` on Windows) and stream stdout/stderr/close back to the renderer
  // over the existing `auggie:stream:${sessionId}` channel.
  ipcMain.handle(
    SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING,
    createSafeValidatedHandler(
      SystemExecuteCommandStreamingSchema,
      async (event, validated) => {
        try {
          const { sessionId, command, cwd, workspaceId, stdin } = validated;
          const [shellCmd, shellFlag] =
            process.platform === 'win32' ? ['cmd.exe', '/c'] : ['/bin/sh', '-c'];

          const handle = await hostExecStream(shellCmd, {
            args: [shellFlag, command],
            cwd,
            workspaceId,
            stdin,
            onStdout: (chunk) => {
              event.sender.send(`auggie:stream:${sessionId}`, {
                sessionId,
                type: 'stdout',
                data: chunk.toString('utf8'),
              });
            },
            onStderr: (chunk) => {
              event.sender.send(`auggie:stream:${sessionId}`, {
                sessionId,
                type: 'stderr',
                data: chunk.toString('utf8'),
              });
            },
          });

          // Fire-and-forget: emit terminal `close` frame on exit, and surface
          // wire/transport failures as a `stderr` frame (matches the previous
          // spawn `error` handler shape).
          handle.done
            .then((result) => {
              event.sender.send(`auggie:stream:${sessionId}`, {
                sessionId,
                type: 'close',
                code: typeof result.exitCode === 'number' ? result.exitCode : null,
              });
            })
            .catch((err: Error) => {
              event.sender.send(`auggie:stream:${sessionId}`, {
                sessionId,
                type: 'stderr',
                data: err.message,
              });
              event.sender.send(`auggie:stream:${sessionId}`, {
                sessionId,
                type: 'close',
                code: null,
              });
            });

          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message,
          };
        }
      },
      SYSTEM_CHANNELS.EXECUTE_COMMAND_STREAMING,
    ),
  );

  // Check git availability — delegated to the daemon host so detection
  // matches the machine actually running git (and is consistent across
  // local/remote transports). Mapped back to the existing IPC contract.
  ipcMain.handle(SYSTEM_CHANNELS.CHECK_GIT, async () => {
    try {
      const result = await getBackendClient().request<{ available: boolean; version?: string }>(
        'host.checkGit',
      );
      const available = result?.available === true;
      const version = typeof result?.version === 'string' ? result.version : undefined;
      return {
        success: true,
        data: available ? { available: true, version } : { available: false },
      };
    } catch (error) {
      logger.warn('host.checkGit failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: true, data: { available: false } };
    }
  });

  // Check Node.js availability + minimum version — delegated to the daemon
  // host (host.findBinary best-effort version-probes the resolved binary) so
  // detection matches the runtime agents actually use. Mirrors CHECK_GIT: a
  // missing binary or failed probe folds to available:false, never an error.
  ipcMain.handle(SYSTEM_CHANNELS.CHECK_NODE, async () => {
    try {
      const result = await getBackendClient().request<{ available: boolean; version?: string }>(
        'host.findBinary',
        { name: 'node' },
      );
      if (result?.available !== true) {
        return { success: true, data: { available: false, versionOk: false } };
      }
      const version =
        typeof result.version === 'string' ? result.version.trim().replace(/^v/, '') : undefined;
      return {
        success: true,
        data: {
          available: true,
          version,
          versionOk: version ? meetsMinimumVersion(version, MINIMUM_NODE_VERSION) : false,
        },
      };
    } catch (error) {
      logger.warn('host.findBinary node failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: true, data: { available: false, versionOk: false } };
    }
  });

  // Check rtk availability
  ipcMain.handle(SYSTEM_CHANNELS.CHECK_RTK, async () => {
    try {
      const rtkPath = await findBinary('rtk', { cache: false });
      return { success: true, data: { available: rtkPath !== null } };
    } catch {
      return { success: true, data: { available: false } };
    }
  });

  // List available system fonts using font-list module
  ipcMain.handle(
    SYSTEM_CHANNELS.LIST_FONTS,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        try {
          const fontListModule = await import('font-list');
          // Handle CommonJS module - getFonts may be on default or directly on the module
          const getFonts =
            typeof fontListModule.getFonts === 'function'
              ? fontListModule.getFonts
              : (fontListModule.default?.getFonts ?? fontListModule.default);
          if (typeof getFonts !== 'function') {
            throw new Error('font-list module does not export getFonts function');
          }
          const allFonts = await getFonts();

          // Clean up font names (font-list returns them with quotes)
          const cleanedFonts = allFonts.map((font: string) => font.replace(/^["']|["']$/g, ''));

          // Filter for monospace fonts by checking known patterns
          const monoFonts = cleanedFonts
            .filter((name: string) =>
              /mono|code|consol|courier|terminal|fixed|hack|source.*pro|fira|jetbrains|sf.*mono|menlo|monaco|andale|iosevka|inconsolata|dejavu.*mono|liberation.*mono|ubuntu.*mono|droid.*mono|noto.*mono|roboto.*mono|cascadia|operator|input|pragmata|anonymous|hermit|envy/i.test(
                name,
              ),
            )
            .sort((a: string, b: string) => a.localeCompare(b));

          return { success: true, data: monoFonts };
        } catch (error) {
          logger.error('Failed to list fonts', { error });
          return { success: false, error: m.system_ipc_enumerateFontsFailed_error() };
        }
      },
      SYSTEM_CHANNELS.LIST_FONTS,
    ),
  );

  // Note: File operations (file:read, file:write, etc.) are handled in file.ipc.ts
}
