/**
 * IDE Integration IPC Handlers
 *
 * Handles opening files and projects in external IDEs like VSCode and JetBrains
 */

import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import { unlinkSync } from 'fs';
import { writeFile, access } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { Logger } from '$lib/utils/logger';
import { EDITOR_REGISTRY } from '$shared/editors/editor-registry';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { z } from 'zod';
import { execAsync } from '../../../shared/git/git-env';
import { findVSCodeAsync } from '../../../shared/main/async-utils';

const logger = new Logger({ category: 'IDE-IPC' });

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
 * Open a path in VSCode
 */
async function openInVSCode(
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

    // First check if code is in PATH
    try {
      const whichCommand = process.platform === 'win32' ? 'where' : 'which';
      const result = await execAsync(`${whichCommand} code`);
      codeCommand = 'code';
      logger.info('[VSCode] Found code in PATH', { result: result.stdout.trim() });
    } catch (error) {
      logger.info('[VSCode] code not in PATH, checking common locations');
      // Not in PATH, try common locations
      const commonCodePaths = [
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        // Linux paths
        '/usr/bin/code',
        '/snap/bin/code',
        // Windows paths
        ...(process.platform === 'win32' ? [
          join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
          join(homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
          'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
          'C:\\Program Files\\Microsoft VS Code\\Code.exe',
          join(homedir(), 'scoop', 'apps', 'vscode', 'current', 'bin', 'code.cmd'),
        ] : []),
      ];

      logger.info('[VSCode] Checking common paths', { commonCodePaths });

      for (const path of commonCodePaths) {
        try {
          await access(path);
          codeCommand = path;
          logger.info('[VSCode] Found code at common path', { path });
          break;
        } catch {
          logger.info(`[VSCode] code not found at ${path}`);
        }
      }
    }

    if (!codeCommand) {
      logger.warn('[VSCode] No code command found via PATH or common locations');
    }

    if (codeCommand) {
      logger.info('Attempting to spawn VSCode', { command: codeCommand, args });

      // Try to spawn VSCode with the found command
      // Only use shell: true if we're using 'code' (from PATH), not for full paths
      const useShell = codeCommand === 'code' || (process.platform === 'win32' && codeCommand.endsWith('.cmd'));
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

    // If code command not found, try Flatpak on Linux
    if (!codeCommand && process.platform === 'linux') {
      logger.info('[VSCode] Trying Flatpak fallback on Linux');
      const vscodeEntry = EDITOR_REGISTRY.find((e) => e.id === 'vscode');
      const flatpakAppIds = vscodeEntry?.platforms?.linux?.flatpakIds ?? [];
      for (const appId of flatpakAppIds) {
        try {
          await execAsync(`flatpak info ${appId}`, { timeout: 5000 });
          logger.info(`[VSCode] Found VS Code via Flatpak: ${appId}`);

          const flatpakArgs = ['run', appId, ...args];
          logger.info('[VSCode] Spawning via Flatpak', { command: 'flatpak', args: flatpakArgs });

          const child = spawn('flatpak', flatpakArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });

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
        } catch {
          logger.info(`[VSCode] Flatpak app ${appId} not found`);
        }
      }
    }

    // If code command not found, try macOS-specific approach
    if (process.platform !== 'darwin') {
      logger.info(`[VSCode] Skipping macOS-specific fallback (platform=${process.platform})`);
    }
    if (process.platform === 'darwin') {
      logger.info('Trying macOS open command');
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

      await shell.openPath(pathToOpen);
      return {
        success: true,
        error: 'Opened in default application (VSCode not found)',
      };
    } catch (fallbackError) {
      return {
        success: false,
        error:
          'Failed to open in VS Code. Please ensure VS Code is installed and the "code" command is available in your PATH.',
      };
    }
  }
}

/**
 * Open a path in JetBrains IDE
 */
async function openInJetBrains(
  pathOrPaths: string | { folder: string; file?: string } | { filePath: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[JetBrains] openInJetBrains called', { pathOrPaths, platform: process.platform });

    // Try to detect which JetBrains IDE is installed
    const ideCommands = ['idea', 'webstorm', 'pycharm', 'rubymine', 'goland', 'phpstorm'];
    let command: string | null = null;

    // First, check if any JetBrains command is in PATH
    logger.info('[JetBrains] Checking PATH for IDE commands', { ideCommands });
    for (const ide of ideCommands) {
      try {
        const result = await execAsync(`which ${ide}`);
        command = ide;
        logger.info(`[JetBrains] Found ${ide} in PATH`, { path: result.stdout.trim() });
        break;
      } catch {
        logger.info(`[JetBrains] ${ide} not found in PATH`);
      }
    }

    // If not found in PATH, try Flatpak on Linux
    if (!command && process.platform === 'linux') {
      logger.info('[JetBrains] Trying Flatpak fallback on Linux');
      // Map IDE command names to registry IDs (including community editions)
      const ideToRegistryIds: Record<string, string[]> = {
        idea: ['intellij', 'intellij-ce'],
        webstorm: ['webstorm'],
        pycharm: ['pycharm', 'pycharm-ce'],
        rubymine: ['rubymine'],
        goland: ['goland'],
        phpstorm: ['phpstorm'],
      };

      for (const ide of ideCommands) {
        const registryIds = ideToRegistryIds[ide] ?? [];
        const appIds = registryIds.flatMap((regId) => {
          const entry = EDITOR_REGISTRY.find((e) => e.id === regId);
          return entry?.platforms?.linux?.flatpakIds ?? [];
        });
        for (const appId of appIds) {
          try {
            await execAsync(`flatpak info ${appId}`, { timeout: 5000 });
            command = `flatpak run ${appId}`;
            logger.info(`[JetBrains] Found ${ide} via Flatpak: ${appId}`);
            break;
          } catch {
            logger.info(`[JetBrains] Flatpak app ${appId} not found`);
          }
        }
        if (command) break;
      }
    }

    // If not found in PATH or Flatpak, check for macOS Applications
    if (!command && process.platform !== 'darwin') {
      logger.info(`[JetBrains] No IDE found in PATH or Flatpak, platform=${process.platform}`);
    }
    if (!command && process.platform === 'darwin') {
      const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
      const appLocations = [
        '/Applications',
        homeDir ? `${homeDir}/Applications` : null,
      ].filter(Boolean) as string[];

      // Map command names to app bundle names
      const ideAppNames: Record<string, string> = {
        idea: 'IntelliJ IDEA',
        webstorm: 'WebStorm',
        pycharm: 'PyCharm',
        rubymine: 'RubyMine',
        goland: 'GoLand',
        phpstorm: 'PhpStorm',
      };

      // Check for each IDE in common locations
      for (const ide of ideCommands) {
        const appName = ideAppNames[ide];
        if (!appName) continue;

        for (const appLocation of appLocations) {
          const appPath = `${appLocation}/${appName}.app`;
          try {
            await access(appPath);
            // Found the app, use 'open' command to launch it
            command = `open -a "${appName}"`;
            logger.info('Found JetBrains IDE app', { appPath, ide });
            break;
          } catch {
            // Continue checking
          }
        }
        if (command) break;
      }
    }

    if (!command) {
      logger.error('[JetBrains] No JetBrains IDE found on this system');
      return {
        success: false,
        error: 'No JetBrains IDE found. Please install IntelliJ IDEA, WebStorm, PyCharm, or another JetBrains IDE.',
      };
    }

    logger.info('[JetBrains] Using command', { command });

    // Prepare the path(s) to open
    let execCommand: string;
    if (typeof pathOrPaths === 'string') {
      // Single path (file or folder)
      execCommand = command.startsWith('open -a')
        ? `${command} "${pathOrPaths}"`
        : `${command} "${pathOrPaths}"`;
    } else if ('filePath' in pathOrPaths) {
      // Single file path
      execCommand = command.startsWith('open -a')
        ? `${command} "${pathOrPaths.filePath}"`
        : `${command} "${pathOrPaths.filePath}"`;
    } else {
      // Folder with optional file
      if (pathOrPaths.file) {
        // Open folder as project, then open the file
        if (command.startsWith('open -a')) {
          // For 'open' command, open the folder first
          execCommand = `${command} "${pathOrPaths.folder}"`;
          await execAsync(execCommand);
          // Wait a bit for the IDE to open, then try to open the file
          await new Promise((resolve) => setTimeout(resolve, 1000));
          // Try to open the file using the IDE's command-line tool
          const appName = command.match(/open -a "([^"]+)"/)?.[1];
          if (appName) {
            const ideAppNames: Record<string, string> = {
              idea: 'IntelliJ IDEA',
              webstorm: 'WebStorm',
              pycharm: 'PyCharm',
              rubymine: 'RubyMine',
              goland: 'GoLand',
              phpstorm: 'PhpStorm',
            };
            const ideKey = Object.entries(ideAppNames).find(([, name]) => name === appName)?.[0];
            if (ideKey) {
              try {
                const toolPath = `/Applications/${appName}.app/Contents/MacOS/${ideKey}`;
                await access(toolPath);
                await execAsync(`"${toolPath}" "${pathOrPaths.file}"`);
              } catch {
                logger.info('Opened folder in JetBrains, file should be opened manually', {
                  folder: pathOrPaths.folder,
                  file: pathOrPaths.file,
                });
              }
            }
          }
          logger.info('Opened in JetBrains IDE', { ide: command, folder: pathOrPaths.folder, file: pathOrPaths.file });
          return { success: true };
        } else {
          execCommand = `${command} "${pathOrPaths.folder}" "${pathOrPaths.file}"`;
        }
      } else {
        // Just open the folder
        execCommand = command.startsWith('open -a')
          ? `${command} "${pathOrPaths.folder}"`
          : `${command} "${pathOrPaths.folder}"`;
      }
    }

    logger.info('[JetBrains] Executing command', { execCommand });
    await execAsync(execCommand);
    logger.info('[JetBrains] Successfully opened in JetBrains IDE', { ide: command, path: pathOrPaths });

    return { success: true };
  } catch (error) {
    logger.error('[JetBrains] Failed to open in JetBrains IDE', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
          } catch (e) {
            // Ignore cleanup errors
          }
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
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
            await shell.openExternal(`vscode://file/${filePath}`);
            return { success: true };
          } catch (fallbackError) {
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
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
