/**
 * External Editors IPC Handlers
 *
 * Handles detecting installed editors and opening files/folders in them.
 */

import { Logger } from '$lib/utils/logger';
import {
  EDITOR_REGISTRY,
  type EditorDefinition,
} from '$shared/editors/editor-registry';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { spawn } from 'child_process';
import os from 'os';
import { ipcMain } from 'electron';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { findBinary } from '../../../shared/main/find-binary';

const logger = new Logger({ category: 'ExternalEditors-IPC' });

/** Detected editor with installation info */
export interface DetectedEditor extends EditorDefinition {
  installed: boolean;
  /** Base64-encoded PNG icon extracted from the app bundle */
  iconBase64?: string;
}

// Cache for detected editors (refreshed on demand)
let cachedEditors: DetectedEditor[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache - editors don't change often

/**
 * Get the Linux binary names for an editor from the registry.
 */
function getLinuxBinaries(editorId: string): string[] {
  const editor = EDITOR_REGISTRY.find((e) => e.id === editorId);
  return editor?.platforms?.linux?.binaries ?? [];
}

/**
 * Get the Flatpak application IDs for an editor from the registry.
 */
function getLinuxFlatpakIds(editorId: string): string[] {
  const editor = EDITOR_REGISTRY.find((e) => e.id === editorId);
  return editor?.platforms?.linux?.flatpakIds ?? [];
}

/** Editor entry shape returned by `host.listInstalledEditors` (PROTOCOL.md §5.14). */
interface HostInstalledEditor {
  id: string;
  installed: boolean;
  path?: string;
  source?: 'macAppBundle' | 'binary' | 'flatpak';
  flatpakId?: string;
}

interface HostListInstalledEditorsResult {
  editors: HostInstalledEditor[];
}

interface HostFindAppResult {
  installed: boolean;
  path?: string;
  source?: string;
}

// Cache for installed Flatpak app IDs (derived from host.listInstalledEditors)
let flatpakInstalledCache: Set<string> | null = null;
let flatpakCacheTimestamp = 0;
const FLATPAK_CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Get the set of installed Flatpak application IDs, sourced verbatim from the
 * daemon's `host.listInstalledEditors` enumeration (PROTOCOL.md §5.14). Flatpak
 * detection runs on the daemon host — never on the local laptop — so remote
 * workspaces report the BE host's flatpak inventory. On RPC failure we degrade
 * to an empty set rather than fall back to a local probe.
 */
export async function getInstalledFlatpakApps(): Promise<Set<string>> {
  const now = Date.now();
  if (flatpakInstalledCache && now - flatpakCacheTimestamp < FLATPAK_CACHE_TTL_MS) {
    return flatpakInstalledCache;
  }

  try {
    const result = await getBackendClient().request<HostListInstalledEditorsResult>(
      'host.listInstalledEditors',
    );
    const appIds = new Set<string>();
    for (const editor of result?.editors ?? []) {
      if (editor.installed && editor.source === 'flatpak' && editor.flatpakId) {
        appIds.add(editor.flatpakId);
      }
    }
    logger.info(`[ExternalEditors] Flatpak (host.listInstalledEditors): found ${appIds.size} installed apps`);
    flatpakInstalledCache = appIds;
    flatpakCacheTimestamp = now;
    return appIds;
  } catch (error) {
    logger.info('[ExternalEditors] host.listInstalledEditors failed; treating Flatpak as unavailable', error as Error);
    flatpakInstalledCache = new Set();
    flatpakCacheTimestamp = now;
    return flatpakInstalledCache;
  }
}

/**
 * Check if an editor is installed via Flatpak
 * Returns the Flatpak app ID if found, null otherwise
 */
async function findFlatpakAppId(editorId: string): Promise<string | null> {
  const flatpakIds = getLinuxFlatpakIds(editorId);
  if (flatpakIds.length === 0) return null;

  const installedApps = await getInstalledFlatpakApps();
  for (const appId of flatpakIds) {
    if (installedApps.has(appId)) {
      logger.info(`[ExternalEditors] Flatpak: found ${editorId} as ${appId}`);
      return appId;
    }
  }
  return null;
}

/**
 * Check if a macOS GUI app is installed by asking the daemon (PROTOCOL.md §5.14
 * `host.findApp`). The daemon performs the `.app` bundle probe on its own host
 * (`/Applications/<name>.app` then `~/Applications/<name>.app`), so remote
 * workspaces report the BE host's installed apps — not the laptop's. The
 * daemon's `installed` flag is consumed verbatim; on RPC failure we degrade to
 * `false` rather than fall back to a local probe.
 */
export async function isAppInstalledMacOS(appName: string): Promise<boolean> {
  try {
    const result = await getBackendClient().request<HostFindAppResult>('host.findApp', {
      name: appName,
    });
    return result?.installed === true;
  } catch (error) {
    logger.debug(`[ExternalEditors] host.findApp failed for ${appName}`, error as Error);
    return false;
  }
}

/**
 * Search common Linux paths for an executable binary matching the given editor ID.
 * Returns the full path to the first found executable, or null if none found.
 */
async function findExecutableBinary(editorId: string): Promise<string | null> {
  const binaries = getLinuxBinaries(editorId);
  if (binaries.length === 0) {
    logger.debug(`[ExternalEditors] No Linux binary mapping for editor: ${editorId}`);
    return null;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const searchPaths = [
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    homeDir ? `${homeDir}/.local/bin` : null,
    homeDir ? `${homeDir}/.local/share/flatpak/exports/bin` : null,
    // JetBrains Toolbox installs
    homeDir ? `${homeDir}/.local/share/JetBrains/Toolbox/scripts` : null,
  ].filter(Boolean) as string[];

  logger.debug(`[ExternalEditors] Searching for ${editorId} binaries: [${binaries.join(', ')}] in paths: [${searchPaths.join(', ')}]`);

  for (const binary of binaries) {
    const resolvedPath = await findBinary(binary, {
      commonPaths: searchPaths.map((searchPath) => `${searchPath}/${binary}`),
      cache: false,
      preferExtensions: [],
      useEnhancedPath: false,
      useLoginShell: false,
    });

    if (!resolvedPath) {
      continue;
    }

    try {
      await access(resolvedPath, constants.X_OK);
      logger.info(`[ExternalEditors] Found ${editorId} at ${resolvedPath}`);
      return resolvedPath;
    } catch {
      logger.debug(`[ExternalEditors] Candidate for ${editorId} is not executable`, {
        binary,
        path: resolvedPath,
      });
    }
  }

  logger.debug(`[ExternalEditors] No binary found for ${editorId}`);
  return null;
}

/**
 * Check if an app is installed on Linux by looking for binaries in common locations
 * and checking Flatpak installations
 */
async function isAppInstalledLinux(editorId: string): Promise<boolean> {
  // First check for native binaries
  const binaryPath = await findExecutableBinary(editorId);
  if (binaryPath) {
    return true;
  }

  // Then check Flatpak
  const flatpakAppId = await findFlatpakAppId(editorId);
  if (flatpakAppId) {
    logger.info(`[ExternalEditors] Found ${editorId} via Flatpak: ${flatpakAppId}`);
    return true;
  }

  logger.debug(`[ExternalEditors] ${editorId} not found (native binary or Flatpak)`);
  return false;
}

/**
 * Find the first available Windows binary for an editor using shared binary lookup.
 * Returns the binary name if found, null otherwise.
 */
async function findWindowsBinary(editorId: string): Promise<string | null> {
  const editor = EDITOR_REGISTRY.find((e) => e.id === editorId);
  if (!editor?.platforms?.win32?.binaries) return null;

  for (const binary of editor.platforms.win32.binaries) {
    const resolvedPath = await findBinary(binary, { cache: false });
    if (resolvedPath) {
      return binary;
    }
  }
  return null;
}

/**
 * Check if an app is installed on Windows by looking for binaries on PATH.
 */
async function isAppInstalledWindows(editorId: string): Promise<boolean> {
  return (await findWindowsBinary(editorId)) !== null;
}

/**
 * Check if an app is installed (cross-platform)
 */
async function isAppInstalled(appName: string, editorId: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    return isAppInstalledMacOS(appName);
  } else if (process.platform === 'linux') {
    return isAppInstalledLinux(editorId);
  } else if (process.platform === 'win32') {
    return isAppInstalledWindows(editorId);
  }
  return false;
}

/**
 * Get the proper arguments for opening a directory in a Linux terminal emulator
 * Different terminals use different flags for setting the working directory
 */
function getLinuxTerminalArgs(binaryName: string, path: string): string[] {
  // Extract just the binary name without path
  const baseName = binaryName.split('/').pop() || binaryName;

  switch (baseName) {
    case 'gnome-terminal':
      return ['--working-directory', path];
    case 'konsole':
      return ['--workdir', path];
    case 'xfce4-terminal':
      return ['--working-directory', path];
    case 'xterm':
      // xterm doesn't have a working directory flag, use -e with cd
      // Pass path as $1 to avoid shell-injection from directory names with quotes/special chars
      return ['-e', 'bash', '-c', 'cd -- "$1" && exec bash', 'bash', path];
    default:
      // Fallback: try --working-directory (works for many terminals)
      return ['--working-directory', path];
  }
}

/**
 * Find the path to a Linux binary for an editor
 * Returns the first found binary path, or null if not found
 */
async function findLinuxBinaryPath(editorId: string): Promise<string | null> {
  return findExecutableBinary(editorId);
}

/**
 * Get the icon for an app as a base64-encoded PNG
 * Uses the file-icon package to extract icons from macOS app bundles
 * Only works on macOS - returns null on other platforms
 */
async function getAppIconBase64(appName: string): Promise<string | null> {
  // file-icon only works on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // file-icon accepts app name or bundle ID
    // Dynamic import since it's an ESM module
    const { fileIconToBuffer } = await import('file-icon');

    // Get icon as PNG buffer (size 64 is good for menu icons)
    const buffer = await fileIconToBuffer(appName, { size: 64 });
    // Convert Uint8Array to base64
    return Buffer.from(buffer).toString('base64');
  } catch (error) {
    logger.warn(`[ExternalEditors] Failed to get icon for ${appName}:`, error as Error);
    return null;
  }
}

/**
 * Detect all installed editors from the registry
 */
async function detectInstalledEditors(forceRefresh = false): Promise<DetectedEditor[]> {
  const now = Date.now();

  // Return cached result if valid
  if (!forceRefresh && cachedEditors && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedEditors;
  }

  logger.info(`[ExternalEditors] Detecting installed editors... (platform=${process.platform}, forceRefresh=${forceRefresh})`);

  const isMacOS = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const isWindows = process.platform === 'win32';

  // PERF: Filter first, then check all editors in parallel instead of sequentially.
  // This reduces detection time from ~3s to ~0.3s on macOS with 27 editors.
  const editorsToCheck = EDITOR_REGISTRY.filter((editor) => {
    if (editor.macOSOnly && !isMacOS) {
      return false;
    }
    if (editor.win32Only && !isWindows) {
      return false;
    }
    return true;
  });

  logger.info(`[ExternalEditors] Registry has ${editorsToCheck.length} editors to check`);

  const results: DetectedEditor[] = await Promise.all(
    editorsToCheck.map(async (editor) => {
      let installed = false;

      if (editor.id === 'finder') {
        if (isMacOS || isLinux || isWindows) {
          installed = true;
        }
      } else if (editor.id === 'terminal') {
        if (isMacOS || isWindows) {
          installed = true;
        } else if (isLinux) {
          installed = await isAppInstalled(editor.appName, editor.id);
        }
      } else if (editor.id === 'powershell') {
        // PowerShell is always available on Windows
        if (isWindows) {
          installed = true;
        }
      } else {
        installed = await isAppInstalled(editor.appName, editor.id);
      }

      logger.info(`[ExternalEditors] Editor ${editor.id} (${editor.name}): installed=${installed}, handlerType=${editor.handlerType}`);

      // Get icon for installed apps (only works on macOS)
      let iconBase64: string | null = null;
      if (installed) {
        iconBase64 = await getAppIconBase64(editor.appName);
      }

      // Apply platform-specific display name overrides on Windows
      const name = (isWindows && editor.platforms?.win32?.name) ? editor.platforms.win32.name : editor.name;
      const shortLabel = (isWindows && editor.platforms?.win32?.shortLabel) ? editor.platforms.win32.shortLabel : editor.shortLabel;

      return {
        ...editor,
        name,
        shortLabel,
        installed,
        iconBase64: iconBase64 || undefined,
      } as DetectedEditor;
    }),
  );

  // Sort by priority, then filter to only installed
  results.sort((a, b) => a.priority - b.priority);

  cachedEditors = results;
  cacheTimestamp = now;

  const installedCount = results.filter((e) => e.installed).length;
  const installedNames = results.filter((e) => e.installed).map((e) => `${e.id}(${e.handlerType})`);
  logger.info(`[ExternalEditors] Detected ${installedCount} installed editors: [${installedNames.join(', ')}]`);

  return results;
}

// Validation schemas
const DetectInstalledSchema = z
  .object({
    forceRefresh: z.boolean().optional(),
  })
  .optional();

const OpenEditorSchema = z.object({
  editorId: z.string(),
  path: z.string(),
  file: z.string().optional(),
});

const OpenWithOtherSchema = z.object({
  path: z.string(),
});

/**
 * Register external editors IPC handlers
 */
export function registerExternalEditorsHandlers(): void {
  // Remove existing handlers
  const channels = [
    IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
    IPC_CHANNELS.EXTERNAL_EDITORS.OPEN,
    IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER,
  ];

  for (const channel of channels) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist
    }
  }

  // Detect installed editors
  ipcMain.handle(
    IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
    createSafeValidatedHandler(
      DetectInstalledSchema,
      async (_event, input) => {
        const forceRefresh = input?.forceRefresh ?? false;
        const editors = await detectInstalledEditors(forceRefresh);
        // Return only installed editors to frontend
        return { success: true, data: editors.filter((e) => e.installed) };
      },
      IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
    ),
  );

  // Open path in editor (generic handler for 'generic' type editors)
  ipcMain.handle(
    IPC_CHANNELS.EXTERNAL_EDITORS.OPEN,
    createSafeValidatedHandler(
      OpenEditorSchema,
      async (_event, { editorId, path, file }) => {
        logger.info('[ExternalEditors] OPEN handler called', { editorId, path, file });

        const editor = EDITOR_REGISTRY.find((e) => e.id === editorId);

        if (!editor) {
          logger.error(`[ExternalEditors] OPEN: Unknown editor ID: ${editorId}`);
          return { success: false, error: `Unknown editor: ${editorId}` };
        }

        logger.info(`[ExternalEditors] OPEN: Found editor ${editor.name}, handlerType=${editor.handlerType}`);

        // For special handlers, delegate to existing IPC channels
        // The frontend should call those directly for better control
        if (editor.handlerType !== 'generic') {
          logger.warn(`[ExternalEditors] OPEN: Editor ${editor.id} has non-generic handlerType=${editor.handlerType}, rejecting`);
          return {
            success: false,
            error: `Use dedicated handler for ${editor.handlerType} editors`,
          };
        }

        try {
          let command: string;
          let args: string[];

          if (process.platform === 'darwin') {
            // macOS: use `open -a "AppName" path`
            command = 'open';
            args = ['-a', editor.appName];
            if (file) {
              args.push(path, file);
            } else {
              args.push(path);
            }
          } else if (process.platform === 'linux') {
            // Linux: find the binary and run it directly, or fall back to Flatpak
            logger.info(`[ExternalEditors] OPEN: Linux platform, looking up binary for ${editorId}`);
            const binaryPath = await findLinuxBinaryPath(editorId);

            if (binaryPath) {
              command = binaryPath;

              // Special handling for terminal emulators
              if (editorId === 'terminal') {
                // Terminals need special flags to set working directory
                args = getLinuxTerminalArgs(binaryPath, path);
                logger.info(`[ExternalEditors] OPEN: Using terminal args for ${binaryPath}`, { args });
              } else {
                // Regular editors: pass path and optional file as arguments
                args = file ? [path, file] : [path];
              }
            } else {
              // No native binary found, try Flatpak
              const flatpakAppId = await findFlatpakAppId(editorId);
              if (flatpakAppId) {
                logger.info(`[ExternalEditors] OPEN: Using Flatpak to launch ${editorId} (${flatpakAppId})`);
                command = 'flatpak';
                args = ['run', flatpakAppId];
                if (file) {
                  args.push(path, file);
                } else {
                  args.push(path);
                }
              } else {
                logger.error(`[ExternalEditors] OPEN: Could not find binary or Flatpak for ${editor.name} (${editorId})`);
                return { success: false, error: `Could not find binary for ${editor.name}` };
              }
            }
          } else if (process.platform === 'win32') {
            // Windows: find the first available binary via shared binary lookup
            const binary = (await findWindowsBinary(editorId)) ?? editor.platforms?.win32?.binaries?.[0];
            if (binary) {
              command = binary;
              if (editorId === 'terminal') {
                // CMD: use start /D to set working directory directly (avoids cd /d mangling through multiple cmd layers)
                const nativePath = path.replace(/\//g, '\\');
                command = 'cmd';
                args = ['/c', 'start', '""', '/D', nativePath, binary];
              } else if (editorId === 'powershell') {
                // PowerShell: use start /D to set working directory directly
                const nativePath = path.replace(/\//g, '\\');
                command = 'cmd';
                args = ['/c', 'start', '""', '/D', nativePath, binary];
              } else if (editorId === 'windows-terminal') {
                // Windows Terminal: GUI app, just use -d flag
                args = ['-d', path];
              } else {
                args = file ? [path, file] : [path];
              }
            } else {
              // Fallback: use explorer to open
              command = 'explorer';
              args = [path];
            }
          } else {
            logger.error(`[ExternalEditors] OPEN: Unsupported platform: ${process.platform}`);
            return { success: false, error: `Unsupported platform: ${process.platform}` };
          }

          logger.info('[ExternalEditors] OPEN: Spawning process', {
            editor: editor.id,
            command,
            args,
            platform: process.platform,
          });

          const isWindowsGuiTerminal = process.platform === 'win32' && editorId === 'windows-terminal';
          const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            ...(process.platform === 'win32' ? { windowsHide: !isWindowsGuiTerminal } : {}),
          });

          // Wait briefly to catch immediate spawn errors (ENOENT, EACCES, etc.)
          const spawnError = await new Promise<Error | null>((resolve) => {
            child.once('error', (err) => resolve(err));
            child.once('spawn', () => resolve(null));
            // Fallback timeout in case neither event fires
            setTimeout(() => resolve(null), 100);
          });

          if (spawnError) {
            logger.error(`[ExternalEditors] OPEN: Spawn failed - ${spawnError.message} (code=${(spawnError as NodeJS.ErrnoException).code}, command=${command}, args=${JSON.stringify(args)})`, spawnError);
            return { success: false, error: spawnError.message };
          }

          child.unref();

          logger.info(`[ExternalEditors] OPEN: Successfully spawned ${command} (pid=${child.pid})`);
          return { success: true };
        } catch (error) {
          logger.error('[ExternalEditors] Failed to open', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      IPC_CHANNELS.EXTERNAL_EDITORS.OPEN,
    ),
  );

  // Open with user-selected app (shows file picker dialog)
  ipcMain.handle(
    IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER,
    createSafeValidatedHandler(
      OpenWithOtherSchema,
      async (_event, { path }) => {
        try {
          // Import dialog here to avoid issues with module loading
          const { dialog: electronDialog } = await import('electron');

          // Platform-specific dialog configuration
          let dialogOptions: Electron.OpenDialogOptions;

          if (process.platform === 'darwin') {
            // macOS: Show file picker for .app bundles
            dialogOptions = {
              title: 'Choose Application',
              defaultPath: '/Applications',
              properties: ['openFile'],
              filters: [{ name: 'Applications', extensions: ['app'] }],
            };
          } else if (process.platform === 'linux') {
            // Linux: Show file picker for executables in common locations
            dialogOptions = {
              title: 'Choose Application',
              defaultPath: '/usr/bin',
              properties: ['openFile'],
              // No extension filter on Linux - executables don't have extensions
            };
          } else if (process.platform === 'win32') {
            // Windows: Show file picker for .exe files in Program Files
            dialogOptions = {
              title: 'Choose Application',
              defaultPath: process.env.PROGRAMFILES || 'C:\\Program Files',
              properties: ['openFile'],
              filters: [{ name: 'Applications', extensions: ['exe', 'cmd', 'bat'] }],
            };
          } else {
            return { success: false, error: `Unsupported platform: ${process.platform}` };
          }

          const result = await electronDialog.showOpenDialog(dialogOptions);

          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'No application selected' };
          }

          const appPath = result.filePaths[0];
          // Extract app name from path (handle both forward and backslash separators)
          let appName: string;
          if (process.platform === 'darwin') {
            // macOS: "/Applications/MyApp.app" -> "MyApp"
            appName = appPath.split('/').pop()?.replace('.app', '') || '';
          } else if (process.platform === 'win32') {
            // Windows: "C:\Program Files\App\app.exe" -> "app.exe"
            appName = appPath.split(/[/\\]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '') || '';
          } else {
            // Linux: "/usr/bin/code" -> "code"
            appName = appPath.split('/').pop() || '';
          }

          logger.info('[ExternalEditors] Opening with custom app', {
            appName,
            appPath,
            targetPath: path,
          });

          let child;
          if (process.platform === 'darwin') {
            child = spawn('open', ['-a', appPath, path], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
          } else if (process.platform === 'win32') {
            // Windows: run the binary directly
            child = spawn(appPath, [path], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
          } else {
            // Linux: run the binary directly
            child = spawn(appPath, [path], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
          }

          // Wait briefly to catch immediate spawn errors (ENOENT, EACCES, etc.)
          const spawnError = await new Promise<Error | null>((resolve) => {
            child.once('error', (err) => resolve(err));
            child.once('spawn', () => resolve(null));
            // Fallback timeout in case neither event fires
            setTimeout(() => resolve(null), 100);
          });

          if (spawnError) {
            logger.error('[ExternalEditors] Spawn failed for custom app', spawnError);
            return { success: false, error: spawnError.message };
          }

          child.unref();

          return { success: true, appName };
        } catch (error) {
          logger.error('[ExternalEditors] Failed to open with custom app', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER,
    ),
  );

  logger.info('[ExternalEditors] IPC handlers registered');
}
