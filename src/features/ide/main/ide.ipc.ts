/**
 * IDE Integration IPC Handlers
 *
 * Handles opening files and projects in external IDEs like VSCode and JetBrains
 */

import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import { unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { Logger } from '$lib/utils/logger';
import { m } from '$shared/paraglide/messages.js';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { execFileAsync } from '../../../shared/git/git-env';
import { findVSCodeAsync } from '../../../shared/main/async-utils';
import { findBinary } from '../../../shared/main/find-binary';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger({ category: 'IDE-IPC' });

/**
 * Editor entry shape returned by `host.listInstalledEditors` (PROTOCOL.md §5.14).
 * Consumed verbatim — no client-side aliasing or normalization.
 */
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

/**
 * Fetch the daemon's editor catalog (PROTOCOL.md §5.14 `host.listInstalledEditors`).
 * Detection runs on the daemon host, not the local laptop, so remote workspaces
 * report the BE host's inventory. On RPC failure we degrade to an empty list
 * rather than fall back to a local probe (no `which`/`flatpak info`/`.app` access).
 */
async function fetchHostInstalledEditors(): Promise<HostInstalledEditor[]> {
  try {
    const result = await getBackendClient().request<HostListInstalledEditorsResult>(
      'host.listInstalledEditors',
    );
    return result?.editors ?? [];
  } catch (error) {
    logger.debug('[IDE-IPC] host.listInstalledEditors failed', error as Error);
    return [];
  }
}

// Validation schemas
const OpenPathSchema = z.union([
  z.string(),
  z.object({
    folder: z.string(),
    file: z.string().optional(),
  }),
  z.object({
    filePath: z.string(),
  }),
]);

const OpenDiffSchema = z.object({
  oldContent: z.string(),
  newContent: z.string(),
  oldFileName: z.string(),
  newFileName: z.string(),
  filePath: z.string(),
});

const OpenGitDiffSchema = z.object({
  filePath: z.string(),
  workspacePath: z.string().optional(),
});

/**
 * Open a path in VSCode. Exported for wire-contract tests.
 */
export async function openInVSCode(
  pathOrPaths: string | { folder: string; file?: string } | { filePath: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[VSCode] openInVSCode called', { pathOrPaths, platform: process.platform });

    // Prepare arguments for VSCode
    let args: string[] = [];

    if (typeof pathOrPaths === 'string') {
      // Open file in a new window
      args = ['-n', '--skip-add-to-recently-opened', pathOrPaths];
    } else if ('filePath' in pathOrPaths) {
      // Open file in a new window
      args = ['-n', '--skip-add-to-recently-opened', pathOrPaths.filePath];
    } else {
      // Open folder with optional file
      // When opening both folder and file, VSCode expects: code -n folder file
      // This opens the folder as a workspace and then opens the file
      if (pathOrPaths.file) {
        args = ['-n', '--skip-add-to-recently-opened', pathOrPaths.folder, pathOrPaths.file];
      } else {
        args = ['-n', '--skip-add-to-recently-opened', pathOrPaths.folder];
      }
    }

    logger.info('[VSCode] Prepared args', { args });

    // Try to find the code command
    let codeCommand: string | null = null;

    const commonCodePaths = [
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      // i18n-ignore (filesystem path)
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      // Linux paths
      '/usr/bin/code',
      '/snap/bin/code',
      // Windows paths
      ...(process.platform === 'win32'
        ? [
            // i18n-ignore (filesystem path)
            join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
            // i18n-ignore (filesystem path)
            join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
            'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
            'C:\\Program Files\\Microsoft VS Code\\Code.exe',
            join(homedir(), 'scoop', 'apps', 'vscode', 'current', 'bin', 'code.cmd'),
          ]
        : []),
    ];

    logger.info('[VSCode] Checking shared binary lookup', { commonCodePaths });
    codeCommand = await findBinary('code', { commonPaths: commonCodePaths, cache: false });

    if (codeCommand) {
      logger.info('[VSCode] Found code via shared binary lookup', { codeCommand });
    }

    if (!codeCommand) {
      logger.warn('[VSCode] No code command found via PATH or common locations');
    }

    if (codeCommand) {
      logger.info('Attempting to spawn VSCode', { command: codeCommand, args });

      // Try to spawn VSCode with the found command
      // Use shell for PATH-style invocations and Windows .cmd launchers
      const useShell =
        codeCommand === 'code' || (process.platform === 'win32' && codeCommand.endsWith('.cmd'));
      // LOCAL-GUI: launches the user's editor on the client host; not workspace execution
      const child = spawn(codeCommand, args, {
        detached: true,
        stdio: 'ignore',
        shell: useShell,
        windowsHide: true,
      });

      // Wait briefly to see if spawn succeeds
      try {
        await new Promise<void>((resolve, reject) => {
          let resolved = false;

          child.on('error', (error: any) => {
            if (!resolved) {
              resolved = true;
              logger.error('Failed to spawn VSCode', error);
              reject(error);
            }
          });

          child.on('exit', (code: number | null, signal: string | null) => {
            if (!resolved && code !== null) {
              logger.info('VSCode process exited', { code, signal });
            }
          });

          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              child.unref();
              resolve();
            }
          }, 100);
        });

        logger.info('Opened in VSCode', { path: pathOrPaths });
        return { success: true };
      } catch (spawnError) {
        logger.error('Failed to spawn VSCode, trying next method', spawnError as Error);
      }
    }

    // If code command not found, try Flatpak on Linux — detection sourced from
    // the daemon (PROTOCOL.md §5.14 `host.listInstalledEditors`). Launch remains
    // local via `flatpak run <flatpakId>` using the id the daemon reported.
    if (!codeCommand && process.platform === 'linux') {
      logger.info('[VSCode] Trying Flatpak fallback on Linux (host.listInstalledEditors)');
      const editors = await fetchHostInstalledEditors();
      const vscodeEntry = editors.find((e) => e.id === 'vscode');
      if (
        vscodeEntry?.installed === true &&
        vscodeEntry.source === 'flatpak' &&
        vscodeEntry.flatpakId
      ) {
        const appId = vscodeEntry.flatpakId;
        logger.info(`[VSCode] host reports vscode installed via Flatpak: ${appId}`);

        const flatpakArgs = ['run', appId, ...args];
        logger.info('[VSCode] Spawning via Flatpak', { command: 'flatpak', args: flatpakArgs });

        // LOCAL-GUI: launches the user's Flatpak-packaged editor on the client host; not workspace execution
        const child = spawn('flatpak', flatpakArgs, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        try {
          await new Promise<void>((resolve, reject) => {
            let resolved = false;

            child.on('error', (error: Error) => {
              if (!resolved) {
                resolved = true;
                logger.error('Failed to spawn VSCode via Flatpak', error);
                reject(error);
              }
            });

            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                child.unref();
                resolve();
              }
            }, 100);
          });

          logger.info('Opened in VSCode via Flatpak', { path: pathOrPaths, appId });
          return { success: true };
        } catch (spawnError) {
          logger.error('Failed to spawn VSCode via Flatpak', spawnError as Error);
        }
      } else {
        logger.info('[VSCode] host.listInstalledEditors reports no flatpak vscode');
      }
    }

    // If code command not found, try macOS-specific approach
    if (process.platform !== 'darwin') {
      logger.info(`[VSCode] Skipping macOS-specific fallback (platform=${process.platform})`);
    }
    if (process.platform === 'darwin') {
      logger.info('Trying macOS open command');
      // i18n-ignore (application name argv for `open -a`)
      const openArgs = ['-n', '-a', 'Visual Studio Code'];

      if (typeof pathOrPaths === 'string') {
        openArgs.push('--args', '-n', '--skip-add-to-recently-opened', pathOrPaths);
      } else if ('filePath' in pathOrPaths) {
        openArgs.push('--args', '-n', '--skip-add-to-recently-opened', pathOrPaths.filePath);
      } else {
        openArgs.push('--args', '-n', '--skip-add-to-recently-opened', pathOrPaths.folder);
        if (pathOrPaths.file) {
          openArgs.push(pathOrPaths.file);
        }
      }

      logger.info('Spawning open command', { openArgs });

      try {
        // LOCAL-GUI: launches the user's editor via macOS `open` on the client host; not workspace execution
        const child = spawn('open', openArgs, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        // Wait a bit to see if it starts successfully
        await new Promise<void>((resolve, reject) => {
          let resolved = false;

          child.on('error', (error: any) => {
            if (!resolved) {
              resolved = true;
              logger.error('Failed to spawn open command', error);
              reject(error);
            }
          });

          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              child.unref();
              resolve();
            }
          }, 200);
        });

        logger.info('Opened in VSCode using macOS open command', { path: pathOrPaths });
        return { success: true };
      } catch (openError) {
        logger.error('Failed to use macOS open command', openError as Error);
      }
    }

    // Final fallback: use vscode:// protocol
    logger.info('[VSCode] Trying vscode:// protocol handler as final fallback');
    let pathToOpen: string;
    if (typeof pathOrPaths === 'string') {
      pathToOpen = pathOrPaths;
    } else if ('filePath' in pathOrPaths) {
      pathToOpen = pathOrPaths.filePath;
    } else {
      pathToOpen = pathOrPaths.file || pathOrPaths.folder;
    }

    // LOCAL-GUI: hands the vscode:// URL to the client OS handler to launch the user's editor; not workspace execution
    await shell.openExternal(`vscode://file/${pathToOpen}`);
    logger.info('Opened in VSCode using protocol handler', { path: pathOrPaths });
    return { success: true };
  } catch (error) {
    logger.error('Failed to open in VSCode', error as Error);

    // Last resort: try to open in default application
    try {
      let pathToOpen: string;
      if (typeof pathOrPaths === 'string') {
        pathToOpen = pathOrPaths;
      } else if ('filePath' in pathOrPaths) {
        pathToOpen = pathOrPaths.filePath;
      } else {
        pathToOpen = pathOrPaths.file || pathOrPaths.folder;
      }

      // LOCAL-GUI: fall back to the client OS default handler for the file; not workspace execution
      await shell.openPath(pathToOpen);
      return {
        success: true,
        error: m.ide_ipc_openedDefaultApp_message(),
      };
    } catch {
      return {
        success: false,
        error: m.ide_ipc_openVscodeFailed_error(),
      };
    }
  }
}

/**
 * Open a path in JetBrains IDE. Exported for wire-contract tests.
 */
export async function openInJetBrains(
  pathOrPaths: string | { folder: string; file?: string } | { filePath: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[JetBrains] openInJetBrains called', { pathOrPaths, platform: process.platform });

    // Detect which JetBrains IDE is installed via the daemon (PROTOCOL.md §5.14
    // `host.listInstalledEditors`). Detection runs on the daemon host — never on
    // the local laptop — so remote workspaces see the BE host's inventory. The
    // launch itself (spawn / `open -a` / `flatpak run`) still happens locally.
    const ideCommands = ['idea', 'webstorm', 'pycharm', 'rubymine', 'goland', 'phpstorm'];
    // Map IDE command names to editor-registry IDs (including community editions).
    const ideToRegistryIds: Record<string, string[]> = {
      idea: ['intellij', 'intellij-ce'],
      webstorm: ['webstorm'],
      pycharm: ['pycharm', 'pycharm-ce'],
      rubymine: ['rubymine'],
      goland: ['goland'],
      phpstorm: ['phpstorm'],
    };
    // Map IDE command names to macOS `.app` bundle display names (for `open -a`).
    const ideAppNames: Record<string, string> = {
      // i18n-ignore (application name for `open -a`)
      idea: 'IntelliJ IDEA',
      webstorm: 'WebStorm',
      pycharm: 'PyCharm',
      rubymine: 'RubyMine',
      goland: 'GoLand',
      phpstorm: 'PhpStorm',
    };

    const editors = await fetchHostInstalledEditors();

    // Launcher argv (binary + fixed flags); target paths are appended as
    // separate argv entries so they can never be shell-interpreted.
    let command: string[] | null = null;
    let selectedIde: string | null = null;
    let selectedEntry: HostInstalledEditor | null = null;

    for (const ide of ideCommands) {
      const registryIds = ideToRegistryIds[ide] ?? [];
      for (const regId of registryIds) {
        const entry = editors.find((e) => e.id === regId);
        if (!entry || entry.installed !== true) continue;
        if (entry.source === 'binary' && entry.path) {
          command = [entry.path];
        } else if (entry.source === 'flatpak' && entry.flatpakId) {
          command = ['flatpak', 'run', entry.flatpakId];
        } else if (entry.source === 'macAppBundle' && ideAppNames[ide]) {
          command = ['open', '-a', ideAppNames[ide]];
        } else {
          continue;
        }
        selectedIde = ide;
        selectedEntry = entry;
        logger.info(`[JetBrains] Selected ${ide} (${regId}) via host.listInstalledEditors`, {
          source: entry.source,
          path: entry.path,
          flatpakId: entry.flatpakId,
        });
        break;
      }
      if (command) break;
    }

    if (!command) {
      logger.error('[JetBrains] host.listInstalledEditors reports no JetBrains IDE installed');
      return {
        success: false,
        error: m.ide_ipc_noJetbrainsIde_error(),
      };
    }

    logger.info('[JetBrains] Using command', { command });

    // Prepare the path(s) to open
    let execArgv: string[];
    if (typeof pathOrPaths === 'string') {
      // Single path (file or folder)
      execArgv = [...command, pathOrPaths];
    } else if ('filePath' in pathOrPaths) {
      // Single file path
      execArgv = [...command, pathOrPaths.filePath];
    } else {
      // Folder with optional file
      if (pathOrPaths.file) {
        // Open folder as project, then open the file
        if (command[0] === 'open') {
          // For 'open' command, open the folder first
          // LOCAL-GUI: launches the user's JetBrains IDE on the client host; not workspace execution
          await execFileAsync(command[0], [...command.slice(1), pathOrPaths.folder]);
          // Wait a bit for the IDE to open, then try to open the file using the
          // IDE's inner command-line tool. The `.app` bundle path comes from the
          // daemon (host.listInstalledEditors) — no local `access()` probe.
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (selectedEntry?.source === 'macAppBundle' && selectedEntry.path && selectedIde) {
            const toolPath = `${selectedEntry.path}/Contents/MacOS/${selectedIde}`;
            try {
              // LOCAL-GUI: invokes the IDE's inner CLI to open the file on the client host; not workspace execution
              await execFileAsync(toolPath, [pathOrPaths.file]);
            } catch {
              logger.info('Opened folder in JetBrains, file should be opened manually', {
                folder: pathOrPaths.folder,
                file: pathOrPaths.file,
              });
            }
          }
          logger.info('Opened in JetBrains IDE', {
            ide: command,
            folder: pathOrPaths.folder,
            file: pathOrPaths.file,
          });
          return { success: true };
        } else {
          execArgv = [...command, pathOrPaths.folder, pathOrPaths.file];
        }
      } else {
        // Just open the folder
        execArgv = [...command, pathOrPaths.folder];
      }
    }

    logger.info('[JetBrains] Executing command', { execArgv });
    // LOCAL-GUI: launches the user's JetBrains IDE on the client host; not workspace execution
    await execFileAsync(execArgv[0], execArgv.slice(1));
    logger.info('[JetBrains] Successfully opened in JetBrains IDE', {
      ide: command,
      path: pathOrPaths,
    });

    return { success: true };
  } catch (error) {
    logger.error('[JetBrains] Failed to open in JetBrains IDE', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : m.ide_ipc_unknown_error(),
    };
  }
}

/**
 * Register IDE IPC handlers
 */
export function registerIDEHandlers(): void {
  // Remove any existing handlers before registering to prevent duplicates
  const handlers = [
    IPC_CHANNELS.VSCODE.OPEN,
    IPC_CHANNELS.VSCODE.OPEN_DIFF,
    IPC_CHANNELS.VSCODE.OPEN_GIT_DIFF,
    IPC_CHANNELS.JETBRAINS.OPEN,
  ];

  // Remove existing handlers
  for (const channel of handlers) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Handler might not exist, that's ok
    }
  }

  // VSCode handlers
  ipcMain.handle(
    IPC_CHANNELS.VSCODE.OPEN,
    createSafeValidatedHandler(
      OpenPathSchema,
      async (_event, pathOrPaths) => await openInVSCode(pathOrPaths),
      IPC_CHANNELS.VSCODE.OPEN,
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.VSCODE.OPEN_DIFF,
    createSafeValidatedHandler(
      OpenDiffSchema,
      async (_event, { oldContent, newContent, oldFileName, newFileName, filePath }) => {
        // Create temporary files for diff view
        const tempDir = tmpdir();
        const oldFilePath = join(tempDir, oldFileName);
        const newFilePath = join(tempDir, newFileName);

        try {
          // PERF: Write content to temp files asynchronously
          await Promise.all([
            writeFile(oldFilePath, oldContent, 'utf-8'),
            writeFile(newFilePath, newContent, 'utf-8'),
          ]);

          const { spawn: spawnProcess } = await import('child_process');

          // PERF: Find VSCode asynchronously to avoid blocking main thread
          const codeCommand = (await findVSCodeAsync()) || 'code';

          // Spawn the process
          const useShell = codeCommand === 'code';
          // LOCAL-GUI: launches the user's editor to view a diff on the client host; not workspace execution
          const child = spawnProcess(
            codeCommand,
            ['-n', '--skip-add-to-recently-opened', '-d', oldFilePath, newFilePath],
            {
              detached: true,
              stdio: 'ignore',
              shell: useShell,
            },
          );

          child.unref();
          logger.info('Opened diff in VSCode', { filePath, oldFileName, newFileName });

          // Clean up temp files after a delay (VSCode will have read them by then)
          setTimeout(() => {
            try {
              unlinkSync(oldFilePath);
              unlinkSync(newFilePath);
            } catch (e) {
              logger.warn('Failed to clean up temp diff files', e as Error);
            }
          }, 5000);

          return { success: true };
        } catch (error) {
          logger.error('Failed to open diff in VSCode', error as Error);
          // Clean up on error
          try {
            unlinkSync(oldFilePath);
            unlinkSync(newFilePath);
          } catch {
            // Ignore cleanup errors
          }
          return {
            success: false,
            error: error instanceof Error ? error.message : m.ide_ipc_unknown_error(),
          };
        }
      },
      IPC_CHANNELS.VSCODE.OPEN_DIFF,
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.VSCODE.OPEN_GIT_DIFF,
    createSafeValidatedHandler(
      OpenGitDiffSchema,
      async (_event, { filePath, workspacePath }) => {
        // Open git diff in VSCode
        // This opens the file with git diff view in the repository context
        try {
          const { spawn: spawnProcess } = await import('child_process');

          // PERF: Find VSCode asynchronously to avoid blocking main thread
          const codeCommand = (await findVSCodeAsync()) || 'code';

          // Build args
          const args: string[] = ['-n', '--skip-add-to-recently-opened'];
          if (workspacePath) {
            args.push(workspacePath, '-g', filePath);
          } else {
            args.push('-g', filePath);
          }

          // Spawn the process
          const useShell = codeCommand === 'code';
          // LOCAL-GUI: launches the user's editor to view a git diff on the client host; not workspace execution
          const child = spawnProcess(codeCommand, args, {
            detached: true,
            stdio: 'ignore',
            shell: useShell,
          });

          child.unref();
          logger.info('Opened git diff in VSCode', { filePath, workspacePath });
          return { success: true };
        } catch (error) {
          logger.error('Failed to open git diff in VSCode', error as Error);

          // Try fallback: open via vscode:// URL
          try {
            const { shell } = await import('electron');
            // LOCAL-GUI: hands the vscode:// URL to the client OS handler to launch the user's editor; not workspace execution
            await shell.openExternal(`vscode://file/${filePath}`);
            return { success: true };
          } catch {
            return {
              success: false,
              error: error instanceof Error ? error.message : m.ide_ipc_unknown_error(),
            };
          }
        }
      },
      IPC_CHANNELS.VSCODE.OPEN_GIT_DIFF,
    ),
  );

  // JetBrains handlers
  ipcMain.handle(
    IPC_CHANNELS.JETBRAINS.OPEN,
    createSafeValidatedHandler(
      OpenPathSchema,
      async (_event, pathOrPaths) => await openInJetBrains(pathOrPaths),
      IPC_CHANNELS.JETBRAINS.OPEN,
    ),
  );

  logger.info('IDE IPC handlers registered');
}
