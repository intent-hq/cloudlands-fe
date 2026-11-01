/**
 * External Editors IPC Handlers
 *
 * Handles the native "Open with…" application chooser. Editor detection and
 * launching run on the daemon host (`host.listInstalledEditors` /
 * `host.openInEditor`, PROTOCOL §5.14) through the renderer host-bridge
 * seeder; only the OS-native chooser dialog lives in main.
 */

import { Logger } from '$lib/utils/logger';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';

const logger = new Logger({ category: 'ExternalEditors-IPC' });

const OpenWithOtherSchema = z.object({
  path: z.string(),
});

/**
 * Register external editors IPC handlers
 */
export function registerExternalEditorsHandlers(): void {
  try {
    ipcMain.removeHandler(IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER);
  } catch {
    // Handler might not exist
  }

  // Open with user-selected app (shows file picker dialog)
  ipcMain.handle(
    IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER,
    createSafeValidatedHandler(
      OpenWithOtherSchema,
      async (event, { path }) => {
        try {
          // Import dialog here to avoid issues with module loading
          const { BrowserWindow, dialog: electronDialog } = await import('electron');

          // Platform-specific dialog configuration
          let dialogOptions: Electron.OpenDialogOptions;

          if (process.platform === 'darwin') {
            // macOS: Show file picker for .app bundles
            dialogOptions = {
              title: m.externalEditors_ipc_chooseApplication_title(),
              defaultPath: '/Applications',
              properties: ['openFile'],
              filters: [
                { name: m.externalEditors_ipc_applications_filterName(), extensions: ['app'] },
              ],
            };
          } else if (process.platform === 'linux') {
            // Linux: Show file picker for executables in common locations
            dialogOptions = {
              title: m.externalEditors_ipc_chooseApplication_title(),
              defaultPath: '/usr/bin',
              properties: ['openFile'],
              // No extension filter on Linux - executables don't have extensions
            };
          } else if (process.platform === 'win32') {
            // Windows: Show file picker for .exe files in Program Files
            dialogOptions = {
              title: m.externalEditors_ipc_chooseApplication_title(),
              defaultPath: process.env.PROGRAMFILES || 'C:\\Program Files',
              properties: ['openFile'],
              filters: [
                {
                  name: m.externalEditors_ipc_applications_filterName(),
                  extensions: ['exe', 'cmd', 'bat'],
                },
              ],
            };
          } else {
            return {
              success: false,
              error: m.externalEditors_ipc_unsupportedPlatform_error({
                platform: process.platform,
              }),
            };
          }

          const ownerWindow = BrowserWindow.fromWebContents(event.sender);
          const result = ownerWindow
            ? await electronDialog.showOpenDialog(ownerWindow, dialogOptions)
            : await electronDialog.showOpenDialog(dialogOptions);

          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: m.externalEditors_ipc_noApplicationSelected_error() };
          }

          const appPath = result.filePaths[0];
          // Extract app name from path (handle both forward and backslash separators)
          let appName: string;
          if (process.platform === 'darwin') {
            // macOS: "/Applications/MyApp.app" -> "MyApp"
            appName = appPath.split('/').pop()?.replace('.app', '') || '';
          } else if (process.platform === 'win32') {
            // Windows: "C:\Program Files\App\app.exe" -> "app.exe"
            appName =
              appPath
                .split(/[/\\]/)
                .pop()
                ?.replace(/\.(exe|cmd|bat)$/i, '') || '';
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
            // LOCAL-GUI: launches the user's chosen app on the client host; not workspace execution
            child = spawn('open', ['-a', appPath, path], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
          } else if (process.platform === 'win32') {
            // LOCAL-GUI: launches the user's chosen app on the client host; not workspace execution
            child = spawn(appPath, [path], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
          } else {
            // LOCAL-GUI: launches the user's chosen app on the client host; not workspace execution
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
            error: error instanceof Error ? error.message : m.externalEditors_ipc_unknown_error(),
          };
        }
      },
      IPC_CHANNELS.EXTERNAL_EDITORS.OPEN_WITH_OTHER,
    ),
  );

  logger.info('[ExternalEditors] IPC handlers registered');
}
