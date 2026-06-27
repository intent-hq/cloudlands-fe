/**
 * Terminal IPC Handler
 *
 * This handles IPC communication between the main and renderer processes
 * for the terminal implementation.
 */

import { ipcMain } from 'electron';
import { TerminalManager } from '../MainProcessTerminalManager';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  terminalProfessionalData,
  terminalProfessionalExit,
  terminalProfessionalCommandStart,
  terminalProfessionalCommandExecuted,
  terminalProfessionalCommandFinished,
  terminalProfessionalCwdChanged,
  terminalDisposed,
  terminalCreated,
} from '../../../store/main/slices/terminal-events/terminal-events-slice';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import { TERMINAL_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  TerminalProfessionalCreateSchema,
  TerminalProfessionalListSchema,
  TerminalProfessionalWriteSchema,
  TerminalProfessionalResizeSchema,
  TerminalProfessionalInfoSchema,
  TerminalProfessionalRefreshSchema,
  TerminalProfessionalDisposeSchema,
  TerminalProfessionalGetBufferSchema,
  TerminalCreateWithCommandSchema,
} from '../../../main/ipc-schemas';
import {
  sshManager,
  type SSHConnectionConfig,
} from '$shared/main/ssh-manager';
import { workspaceService } from '$features/workspace/main/workspace.service';
import { WorkspaceConfig } from '$shared/main/config';
import { createWorkspaceId } from '$shared/types/branded-ids';

const logger = new Logger('Terminal-IPC');

// Centralized git environment to prevent credential prompts
import { createShellEnv } from '../../../shared/git/git-env';

// Store for remote shell sessions
interface RemoteShellSession {
  terminalId: string;
  workspaceId: string;
  connectionId: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  isAlive: () => boolean;
}

const remoteShellSessions = new Map<string, RemoteShellSession>();

async function cleanupRemoteShellSession(
  terminalId: string,
  reason: string,
  options: { closeSession?: boolean } = {},
): Promise<void> {
  const session = remoteShellSessions.get(terminalId);
  if (!session) return;

  remoteShellSessions.delete(terminalId);

  if (options.closeSession !== false) {
    try {
      session.close();
    } catch (error) {
      logger.warn(`[Terminal] Failed to close remote terminal ${terminalId} during ${reason}:`, error);
    }
  }

  try {
    await sshManager.disconnect(session.connectionId);
  } catch (error) {
    logger.warn(`[Terminal] Failed to disconnect SSH for terminal ${terminalId} during ${reason}:`, error);
  }
}

function cleanupRemoteShellSessionInBackground(
  terminalId: string,
  reason: string,
  options: { closeSession?: boolean } = {},
): void {
  cleanupRemoteShellSession(terminalId, reason, options).catch((error) => {
    logger.warn(`[Terminal] Failed remote terminal cleanup for ${terminalId} during ${reason}:`, error);
  });
}

// Constants for workspace info retry logic
const WORKSPACE_INFO_RETRY_DELAY_MS = 300;
const WORKSPACE_INFO_MAX_RETRIES = 5;

/**
 * Helper to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get workspace info including path and remote status.
 * Includes retry logic for cases where workspace is still being created.
 */
async function getWorkspaceInfo(
  workspaceId: string,
  options?: { retryCount?: number },
): Promise<{
  isRemote: boolean;
  sshConfig?: SSHConnectionConfig;
  workspacePath?: string;
  scope?: string;
}> {
  const maxRetries = options?.retryCount ?? WORKSPACE_INFO_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const workspace = await workspaceService.getWorkspace(createWorkspaceId(workspaceId));

      if (!workspace.ok) {
        // Workspace not found - may still be creating
        if (attempt < maxRetries) {
          logger.info(
            `[Terminal] Workspace ${workspaceId} not ready (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
          );
          await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
          continue;
        }
        logger.warn(
          `[Terminal] Could not get workspace ${workspaceId} after ${maxRetries + 1} attempts: ${workspace.error}`,
        );
        return { isRemote: false };
      }

      const data = workspace.data;
      const isRemote = data.isRemote === true;
      // Prefer worktreePath (the actual git worktree), then repositoryPath, then path
      const workspacePath = data.worktreePath || data.repositoryPath || data.path;

      // If we got a workspace but it has no path, it might still be initializing
      if (!workspacePath && attempt < maxRetries) {
        logger.info(
          `[Terminal] Workspace ${workspaceId} found but no path yet (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
        );
        await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
        continue;
      }

      logger.info('[Terminal] Got workspace info', {
        workspaceId,
        isRemote,
        workspacePath,
        scope: data.scope,
        worktreePath: data.worktreePath,
        repositoryPath: data.repositoryPath,
        hasScope: !!data.scope,
        scopeLength: data.scope?.length,
        attempts: attempt + 1,
      });

      if (isRemote && data.environmentConfig?.ssh) {
        const ssh = data.environmentConfig.ssh;
        return {
          isRemote: true,
          sshConfig: {
            host: ssh.host,
            port: ssh.port || 22,
            username: ssh.user,
            password: ssh.password,
            privateKeyPath: ssh.key_path,
            useAgent: ssh.use_agent,
            transport: ssh.transport,
            wsUrl: ssh.ws_url,
          },
          workspacePath,
          scope: data.scope,
        };
      }

      return { isRemote: false, workspacePath, scope: data.scope };
    } catch (error) {
      if (attempt < maxRetries) {
        logger.info(
          `[Terminal] Error getting workspace ${workspaceId} (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
          error as Error,
        );
        await delay(WORKSPACE_INFO_RETRY_DELAY_MS);
        continue;
      }
      logger.error(
        `[Terminal] Failed to get workspace info after ${maxRetries + 1} attempts`,
        error as Error,
      );
      return { isRemote: false };
    }
  }

  // This should not be reached, but TypeScript needs it
  return { isRemote: false };
}

/**
 * Create isolated shell environment that prevents user's rc files from overriding history settings.
 * This ensures terminal history is isolated per-terminal.
 */
async function createIsolatedShellEnv(
  shell: string,
  terminalId: string,
  baseEnv: Record<string, string | undefined>,
): Promise<{ env: Record<string, string | undefined>; historyFile: string }> {
  // Create a unique history file for this terminal
  const historyDir = path.join(os.homedir(), 'intent', '.history');
  await fsPromises.mkdir(historyDir, { recursive: true }).catch(() => {
    // Directory might already exist
  });

  const historyFile = path.join(historyDir, `terminal-${terminalId}`);

  // Create empty history file if it doesn't exist to ensure shell uses it
  await fsPromises.writeFile(historyFile, '', { flag: 'a' }).catch(() => {
    // File might already exist
  });

  // Detect shell type
  const shellName = path.basename(shell).toLowerCase();
  const isZsh = shellName === 'zsh';
  const isBash = shellName === 'bash' || shellName === 'sh';

  const env: Record<string, string | undefined> = {
    ...baseEnv,
    // Set history file for all shells
    HISTFILE: historyFile,
  };

  if (isZsh) {
    // For zsh: Create a custom ZDOTDIR with a .zshrc that enforces our history settings
    // This runs AFTER the user's .zshrc, ensuring our settings take precedence
    const zdotdir = path.join(historyDir, `zdotdir-${terminalId}`);
    await fsPromises.mkdir(zdotdir, { recursive: true }).catch(() => {});

    // Create a .zshenv file that sets HISTFILE early (before .zshrc)
    // .zshenv is sourced first for all zsh invocations
    const zshenvContent = `
# Workspaces terminal - isolated history
export HISTFILE="${historyFile}"
export SAVEHIST=1000
export HISTSIZE=1000
# Source user's zshenv if it exists
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
# Re-enforce our HISTFILE in case user's zshenv changed it
export HISTFILE="${historyFile}"
`;

    // Create .zshrc that sources user's config but enforces history at the end
    const zshrcContent = `
# Source user's zshrc
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Enforce isolated history settings (after user's .zshrc)
export HISTFILE="${historyFile}"
export SAVEHIST=1000
export HISTSIZE=1000
# Reload history from our file
fc -R
`;

    await Promise.all([
      fsPromises.writeFile(path.join(zdotdir, '.zshenv'), zshenvContent),
      fsPromises.writeFile(path.join(zdotdir, '.zshrc'), zshrcContent),
    ]);

    env.ZDOTDIR = zdotdir;
    logger.info(`[Terminal] Created isolated zsh config at ${zdotdir}`);
  } else if (isBash) {
    // For bash: Use BASH_ENV to source a script that enforces history settings
    const bashEnvFile = path.join(historyDir, `bashenv-${terminalId}`);
    const bashEnvContent = `
# Workspaces terminal - isolated history
export HISTFILE="${historyFile}"
export HISTFILESIZE=1000
export HISTSIZE=1000
`;
    await fsPromises.writeFile(bashEnvFile, bashEnvContent);

    // Bash respects HISTFILE set before it starts for interactive shells
    env.HISTFILE = historyFile;
    env.HISTFILESIZE = '1000';
    env.HISTSIZE = '1000';
  }

  return { env, historyFile };
}

// Try to load node-pty, but don't fail if it's not available
let pty: any;
(async () => {
  try {
    const module = await import('node-pty');
    pty = module;
    logger.info('[Terminal] node-pty loaded successfully');
  } catch (error) {
    logger.error('[Terminal] Failed to load node-pty:', error as Error);
    logger.info('[Terminal] Will use fallback terminal implementation');
  }
})();

// Global terminal manager - exported for use by other terminal handlers
export const terminalManager = new TerminalManager();

/**
 * Check if a shell exists and is executable on the system.
 * Handles both absolute paths and command names in PATH.
 *
 * @param shellPath - Path to shell executable or command name
 * @returns True if the shell exists and is executable
 * @example
 * ```typescript
 * if (shellExists('/bin/bash')) {
 *   // Use bash
 * }
 * if (shellExists('zsh')) {
 *   // zsh is in PATH
 * }
 * ```
 */
function shellExists(shellPath: string): boolean {
  try {
    // For Windows, just check if file exists (X_OK doesn't work reliably on Windows)
    if (process.platform === 'win32') {
      fs.accessSync(shellPath, fs.constants.F_OK);
      return true;
    } else {
      // For Unix-like systems, check if file exists and is executable
      fs.accessSync(shellPath, fs.constants.F_OK | fs.constants.X_OK);
      return true;
    }
  } catch {
    // If it's just a command name (not a path), try to find it in PATH
    if (!path.isAbsolute(shellPath) && !shellPath.includes(path.sep)) {
      const pathEnv = process.env.PATH || '';
      const pathDirs = pathEnv.split(process.platform === 'win32' ? ';' : ':');

      for (const dir of pathDirs) {
        const fullPath = path.join(dir, shellPath);
        try {
          if (process.platform === 'win32') {
            // On Windows, try with common extensions
            const extensions = ['', '.exe', '.cmd', '.bat'];
            for (const ext of extensions) {
              try {
                fs.accessSync(fullPath + ext, fs.constants.F_OK);
                return true;
              } catch {
                // Continue to next extension
              }
            }
          } else {
            fs.accessSync(fullPath, fs.constants.F_OK | fs.constants.X_OK);
            return true;
          }
        } catch {
          // Continue to next directory in PATH
        }
      }
    }
    return false;
  }
}

/**
 * Find a valid shell for the current platform.
 * Tries multiple shell options in order of preference.
 *
 * @returns Path to a valid shell executable
 * @throws Error if no valid shell is found
 * @example
 * ```typescript
 * const shell = findValidShell();
 * // Returns: '/bin/bash' on macOS/Linux or 'cmd.exe' on Windows
 * ```
 */
function findValidShell(): string {
  // Platform-specific shell detection
  if (process.platform === 'win32') {
    // Windows shells
    const windowsShells = [
      process.env.COMSPEC, // Usually cmd.exe
      'powershell.exe',
      'cmd.exe',
      path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe'),
    ].filter(Boolean) as string[];

    for (const shell of windowsShells) {
      if (shellExists(shell)) {
        logger.info(`[Terminal] Found valid Windows shell: ${shell}`);
        return shell;
      }
    }

    // Fallback for Windows
    return 'cmd.exe';
  } else {
    // Unix-like systems (macOS, Linux)
    const shells = [
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
      '/usr/bin/zsh',
      '/usr/bin/bash',
      'zsh',
      'bash',
      'sh',
    ].filter(Boolean) as string[];

    for (const shell of shells) {
      if (shellExists(shell)) {
        logger.info(`[Terminal] Found valid shell: ${shell}`);
        return shell;
      }
    }

    // Fallback to sh if nothing else works
    logger.warn('[Terminal] No preferred shell found, falling back to /bin/sh');
    return '/bin/sh';
  }
}

/**
 * Helper function to ensure directory exists.
 * Returns null if the directory cannot be accessed or created, instead of falling back to process.cwd().
 * This prevents the terminal from silently opening in the wrong directory.
 */
function ensureDirectoryExists(dirPath: string): string | null {
  try {
    // Check if directory exists
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      logger.warn(`[Terminal] Path exists but is not a directory: ${dirPath}`);
      return null;
    }
    return dirPath;
  } catch {
    // Directory doesn't exist, try to create it
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`[Terminal] Created directory: ${dirPath}`);
      return dirPath;
    } catch (createError) {
      logger.error(`[Terminal] Failed to create directory ${dirPath}:`, createError as Error);
      return null;
    }
  }
}

/**
 * Register all terminal IPC handlers
 */
export function registerTerminalHandlers() {
  logger.info('[Terminal] Registering terminal IPC handlers...');
  logger.info('[Terminal] CREATE_WITH_COMMAND channel:', TERMINAL_CHANNELS.CREATE_WITH_COMMAND);

  /**
   * Create a new terminal
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_CREATE,
    createSafeValidatedHandler(
      TerminalProfessionalCreateSchema,
      async (_, validated) => {
        try {
          const { terminalId: providedId, workspaceId, cwd, cols = 80, rows = 24 } = validated;

          logger.info(
            `[Terminal] Create/reconnect terminal for workspace: ${workspaceId}, id: ${providedId}`,
          );

          // Check if terminal already exists (reconnecting after page reload)
          if (providedId) {
            const existingTerminal = terminalManager.getTerminal(providedId);
            if (existingTerminal && !existingTerminal.disposed) {
              // Verify the terminal belongs to the requested workspace
              const existingWorkspaceId = existingTerminal.getInfo().workspaceId;
              if (existingWorkspaceId !== workspaceId) {
                logger.warn(
                  `[Terminal] Terminal ${providedId} belongs to workspace ${existingWorkspaceId}, not ${workspaceId}. Creating new terminal.`,
                );
                // Don't reconnect to a terminal from a different workspace
                // Fall through to create a new terminal
              } else {
                logger.info(`[Terminal] Reconnecting to existing terminal: ${providedId}`);

                // Resize if dimensions changed
                existingTerminal.resize(cols, rows);

                return {
                  success: true,
                  terminalId: providedId,
                  reconnected: true,
                };
              }
            }
          }

          logger.info(`[Terminal] Creating new terminal for workspace: ${workspaceId}`);

          // Special handling for root context terminal (not tied to a workspace)
          // The __root__ ID is used by the root quake terminal overlay on non-workspace pages
          if (workspaceId === '__root__') {
            const workingDir = cwd || os.homedir();
            logger.info(`[Terminal] Creating root context terminal in ${workingDir}`);

            // Find a valid shell
            const shell = findValidShell();
            logger.info(`[Terminal] Using shell for root context: ${shell}`);

            // Create the terminal instance
            const terminal = terminalManager.createTerminal({
              id: providedId,
              workspaceId,
              cwd: workingDir,
              shell,
              cols,
              rows,
            });

            const terminalId = terminal.getInfo().id;

            // Check if node-pty is available
            if (!pty) {
              logger.error('[Terminal] node-pty is not available for root context terminal');
              throw new Error(
                'node-pty is required for terminal functionality but is not available',
              );
            }

            // Create isolated shell environment
            const { env: isolatedEnv, historyFile } = await createIsolatedShellEnv(
              shell,
              terminalId,
              createShellEnv({
                HOME: process.env.HOME || os.homedir(),
                USER: process.env.USER || process.env.USERNAME || os.userInfo().username || 'user',
                SHELL: shell,
                TERM: 'xterm-256color',
                LANG: process.env.LANG || 'en_US.UTF-8',
                PROMPT_EOL_MARK: '',
              }),
            );

            try {
              logger.info(
                `[Terminal] Spawning root context terminal with isolated env and history: ${historyFile}`,
              );

              const ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: workingDir,
                env: isolatedEnv as Record<string, string>,
              });

              logger.info(`[Terminal] Root context terminal spawned with PID: ${ptyProcess.pid}`);

              // Initialize terminal with PTY
              await terminal.initialize(ptyProcess);

              // Set up event forwarding
              terminal.on('data', (data: string) => {
                mainDispatch(terminalProfessionalData({ terminalId, data }));
              });

              terminal.on('exit', ({ exitCode }: { exitCode: number }) => {
                mainDispatch(
                  terminalProfessionalExit({
                    terminalId,
                    exitCode,
                    signal: null,
                  }),
                );
              });

              terminal.on('error', (error: Error) => {
                logger.error(`[Terminal] Root context terminal error: ${error.message}`);
              });

              return {
                success: true,
                terminalId,
                cwd: workingDir,
              };
            } catch (spawnError) {
              logger.error(
                '[Terminal] Failed to spawn root context terminal:',
                spawnError as Error,
              );
              throw spawnError;
            }
          }

          // Get workspace info (includes remote status and workspace path)
          const workspaceInfo = await getWorkspaceInfo(workspaceId);

          if (workspaceInfo.isRemote && workspaceInfo.sshConfig) {
            logger.info(`[Terminal] Creating remote terminal for workspace: ${workspaceId}`);

            // Check if we already have a remote session for this terminal
            const existingSession = providedId ? remoteShellSessions.get(providedId) : undefined;
            if (providedId && existingSession) {
              // Verify the session belongs to the requested workspace
              if (existingSession.workspaceId !== workspaceId) {
                logger.warn(
                  `[Terminal] Remote terminal ${providedId} belongs to workspace ${existingSession.workspaceId}, not ${workspaceId}. Creating new terminal.`,
                );
                await cleanupRemoteShellSession(providedId, 'workspace mismatch replacement');
              } else if (existingSession.isAlive()) {
                logger.info(`[Terminal] Reconnecting to existing remote terminal: ${providedId}`);
                existingSession.resize(cols, rows);
                return {
                  success: true,
                  terminalId: providedId,
                  reconnected: true,
                  isRemote: true,
                };
              } else {
                // Clean up dead session
                await cleanupRemoteShellSession(providedId, 'dead session replacement');
              }
            }

            // Create SSH connection
            const connectionId = `terminal-${workspaceId}-${providedId || Date.now()}`;
            try {
              await sshManager.connect(connectionId, workspaceInfo.sshConfig);
            } catch (sshError) {
              logger.error('[Terminal] Failed to connect via SSH:', sshError as Error);
              return {
                success: false,
                error: `Failed to connect to remote server: ${sshError instanceof Error ? sshError.message : 'Unknown error'}`,
              };
            }

            // Generate terminal ID if not provided
            const terminalId = providedId || `remote-terminal-${Date.now()}`;

            // Open interactive shell
            try {
              const shell = await sshManager.openInteractiveShell(connectionId, {
                cwd: workspaceInfo.workspacePath,
                cols,
                rows,
                onData: (data: string) => {
                  logger.info(
                    `[Terminal] Remote data for terminal ${terminalId}: ${data.length} bytes`,
                  );
                  mainDispatch(
                    terminalProfessionalData({
                      terminalId,
                      data,
                    }),
                  );
                },
                onExit: (code: number) => {
                  logger.info(`[Terminal] Remote terminal ${terminalId} exited with code ${code}`);
                  mainDispatch(
                    terminalProfessionalExit({
                      terminalId,
                      exitCode: code,
                      signal: null,
                    }),
                  );
                  cleanupRemoteShellSessionInBackground(terminalId, 'remote terminal exit', {
                    closeSession: false,
                  });
                },
                onError: (error: Error) => {
                  logger.error(`[Terminal] Remote terminal ${terminalId} error:`, error);
                  cleanupRemoteShellSessionInBackground(terminalId, 'remote terminal error', {
                    closeSession: false,
                  });
                },
              });

              // Store the session
              remoteShellSessions.set(terminalId, {
                terminalId,
                workspaceId,
                connectionId,
                write: shell.write,
                resize: shell.resize,
                close: shell.close,
                isAlive: shell.isAlive,
              });

              logger.info(`[Terminal] Remote terminal created with ID: ${terminalId}`);

              return {
                success: true,
                terminalId,
                isRemote: true,
                info: {
                  id: terminalId,
                  workspaceId,
                  cwd: workspaceInfo.workspacePath || '~',
                  shell: 'remote-shell',
                  cols,
                  rows,
                },
              };
            } catch (shellError) {
              logger.error('[Terminal] Failed to open remote shell:', shellError as Error);
              // Clean up SSH connection
              await sshManager.disconnect(connectionId);
              return {
                success: false,
                error: `Failed to open remote shell: ${shellError instanceof Error ? shellError.message : 'Unknown error'}`,
              };
            }
          }

          // Local terminal creation
          // Use workspace path from workspace service (already fetched above)
          let workingDir = cwd;

          // DEBUG: Log the cwd and workspaceInfo before path resolution
          logger.info('[Terminal] Starting path resolution', {
            providedCwd: cwd,
            workspacePath: workspaceInfo.workspacePath,
            scope: workspaceInfo.scope,
            hasScope: !!workspaceInfo.scope,
          });

          if (!workingDir && workspaceInfo.workspacePath) {
            // Use the path from workspace service - this is authoritative
            let basePath = workspaceInfo.workspacePath;

            // Apply scope if present
            if (workspaceInfo.scope) {
              const scopedPath = path.join(basePath, workspaceInfo.scope);
              logger.info('[Terminal] Applying scope to path', {
                basePath,
                scope: workspaceInfo.scope,
                scopedPath,
              });
              basePath = scopedPath;
            }

            const exists = await fsPromises
              .access(basePath)
              .then(() => true)
              .catch(() => false);

            logger.info('[Terminal] Checked path existence', {
              basePath,
              exists,
            });

            if (exists) {
              workingDir = basePath;
              logger.info(`[Terminal] Using workspace path from service: ${workingDir}`, {
                scope: workspaceInfo.scope,
              });
            } else {
              logger.warn('[Terminal] Scoped path does not exist, will try fallbacks', {
                basePath,
                scope: workspaceInfo.scope,
              });
            }
          }

          // Fallback: check for git worktree in workspace folder
          if (!workingDir) {
            const workspacePath = WorkspaceConfig.paths.workspace(workspaceId);

            try {
              const entries = await fsPromises.readdir(workspacePath);

              for (const entry of entries) {
                if (!entry.startsWith('.')) {
                  const fullPath = path.join(workspacePath, entry);
                  const stat = await fsPromises.stat(fullPath);

                  if (stat.isDirectory()) {
                    // Check if it's a git repository
                    const gitPath = path.join(fullPath, '.git');
                    const gitExists = await fsPromises
                      .access(gitPath)
                      .then(() => true)
                      .catch(() => false);
                    if (gitExists) {
                      // Apply scope if present (same logic as primary path)
                      let scopedPath = fullPath;
                      if (workspaceInfo.scope) {
                        const potentialScopedPath = path.join(fullPath, workspaceInfo.scope);
                        const scopedExists = await fsPromises
                          .access(potentialScopedPath)
                          .then(() => true)
                          .catch(() => false);
                        if (scopedExists) {
                          scopedPath = potentialScopedPath;
                        }
                      }
                      workingDir = scopedPath;
                      logger.info(`[Terminal] Found git worktree: ${workingDir}`, {
                        gitRoot: fullPath,
                        scope: workspaceInfo.scope,
                      });
                      break;
                    }
                  }
                }
              }
            } catch {
              // Directory doesn't exist or can't be read
            }
          }

          // Final fallback to workspace directory
          if (!workingDir) {
            let fallbackPath = WorkspaceConfig.paths.workspace(workspaceId);

            // Apply scope to fallback path if present
            if (workspaceInfo.scope) {
              const potentialScopedPath = path.join(fallbackPath, workspaceInfo.scope);
              const scopedExists = await fsPromises
                .access(potentialScopedPath)
                .then(() => true)
                .catch(() => false);
              if (scopedExists) {
                fallbackPath = potentialScopedPath;
                logger.info(
                  `[Terminal] Using fallback workspace directory with scope: ${fallbackPath}`,
                  {
                    scope: workspaceInfo.scope,
                  },
                );
              } else {
                logger.info(
                  `[Terminal] Using fallback workspace directory (scope path not found): ${fallbackPath}`,
                  {
                    scope: workspaceInfo.scope,
                    attemptedScopedPath: potentialScopedPath,
                  },
                );
              }
            } else {
              logger.info(`[Terminal] Using fallback workspace directory: ${fallbackPath}`);
            }

            workingDir = fallbackPath;
          }

          // Ensure the working directory exists
          const validatedWorkingDir = ensureDirectoryExists(workingDir);

          // If directory is not valid after all attempts, return an error
          // This prevents the terminal from silently opening in the wrong directory
          if (validatedWorkingDir === null) {
            logger.error('[Terminal] Workspace directory not ready', {
              workspaceId,
              attemptedPath: workingDir,
              workspacePath: workspaceInfo.workspacePath,
            });
            return {
              success: false,
              error:
                'WORKSPACE_NOT_READY: The workspace directory does not exist yet. Please wait for workspace initialization to complete.',
            };
          }

          workingDir = validatedWorkingDir;
          logger.info(`[Terminal] Final working directory: ${workingDir}`);

          // Find a valid shell
          const shell = findValidShell();
          logger.info(`[Terminal] Using shell: ${shell}`);

          // Create the terminal instance with provided or generated ID
          const terminal = terminalManager.createTerminal({
            id: providedId, // Use the provided terminal ID if available
            workspaceId,
            cwd: workingDir,
            shell,
            cols,
            rows,
          });

          // Log environment details for debugging
          logger.info('[Terminal] Environment details:', {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            shell,
            workingDir,
            PATH: process.env.PATH?.substring(0, 200), // Log first 200 chars of PATH
          });

          // Create the PTY instance with error handling
          let ptyProcess: any;

          // Check if node-pty is available
          if (!pty) {
            logger.error(
              '[Terminal] node-pty is not available - terminal functionality will not work',
            );
            throw new Error('node-pty is required for terminal functionality but is not available');
          } else {
            // Create isolated shell environment that prevents history leakage
            const terminalId = terminal.getInfo().id;
            const { env: isolatedEnv, historyFile } = await createIsolatedShellEnv(
              shell,
              terminalId,
              createShellEnv({
                HOME: process.env.HOME || os.homedir(),
                USER: process.env.USER || process.env.USERNAME || os.userInfo().username || 'user',
                SHELL: shell,
                TERM: 'xterm-256color',
                LANG: process.env.LANG || 'en_US.UTF-8',
                // Suppress the % character that zsh shows for incomplete lines
                PROMPT_EOL_MARK: '',
              }),
            );

            try {
              logger.info(
                `[Terminal] Attempting to spawn with isolated shell env and history: ${historyFile}`,
              );

              ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: workingDir,
                env: isolatedEnv as Record<string, string>,
              });

              logger.info(
                `[Terminal] Successfully spawned PTY process with PID: ${ptyProcess.pid}`,
              );
            } catch (spawnError) {
              logger.error(
                '[Terminal] Failed to spawn PTY process with isolated env:',
                spawnError as Error,
              );

              // Try with full environment plus isolated shell settings
              try {
                logger.info('[Terminal] Attempting with full process environment');

                const { env: fullIsolatedEnv } = await createIsolatedShellEnv(
                  shell,
                  terminalId,
                  createShellEnv({
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    TERM_PROGRAM: 'Augment',
                    PROMPT_EOL_MARK: '',
                  }),
                );

                ptyProcess = pty.spawn(shell, [], {
                  name: 'xterm-256color',
                  cols,
                  rows,
                  cwd: workingDir,
                  env: fullIsolatedEnv as Record<string, string>,
                });
              } catch (fullEnvError) {
                logger.error('[Terminal] Failed with full env:', fullEnvError as Error);

                // Use child_process fallback
                logger.info(
                  '[Terminal] All node-pty attempts failed, using child_process fallback',
                );

                const childProcess = spawn(shell, [], {
                  cwd: workingDir,
                  env: createShellEnv({
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    TERM_PROGRAM: 'Augment',
                  }),
                  shell: false,
                  stdio: ['pipe', 'pipe', 'pipe'],
                  windowsHide: true,
                });

                // Handle stdin EPIPE errors (child process may exit before consuming all input)
                if (childProcess.stdin) {
                  childProcess.stdin.on('error', (error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    if (msg.includes('EPIPE')) {
                      // Benign: child process exited before reading all stdin data
                      logger.debug('[Terminal] Stdin EPIPE (child exited before consuming input)');
                    } else {
                      logger.error('[Terminal] Stdin error in fallback mode:', error);
                    }
                  });
                }

                // Create a PTY-like wrapper for the child process
                ptyProcess = {
                  write: (data: string) => {
                    if (childProcess.stdin && childProcess.stdin.writable) {
                      childProcess.stdin.write(data);
                    }
                  },
                  resize: (cols: number, rows: number) => {
                    logger.info(
                      `[Terminal] Resize requested: ${cols}x${rows} (not supported in fallback mode)`,
                    );
                  },
                  kill: (signal?: string) => {
                    childProcess.kill(signal as any);
                  },
                  onData: (callback: (data: string) => void) => {
                    if (childProcess.stdout) {
                      childProcess.stdout.on('data', (data) => callback(data.toString()));
                    }
                    if (childProcess.stderr) {
                      childProcess.stderr.on('data', (data) => callback(data.toString()));
                    }
                  },
                  onExit: (callback: (exitInfo: { exitCode: number; signal?: number }) => void) => {
                    childProcess.on('exit', (code, signal) => {
                      callback({ exitCode: code || 0, signal: signal as any });
                    });
                  },
                };

                logger.info('[Terminal] Created fallback terminal using child_process');
              }
            }
          }

          // Initialize the terminal with the PTY
          await terminal.initialize(ptyProcess);

          const terminalId = terminal.getInfo().id;

          logger.info(`[Terminal] Terminal ${terminalId} initialized with PTY process`);

          // Set up event forwarding to renderer
          terminal.on('data', (data: string) => {
            // Broadcast terminal data to renderer via Redux dispatch
            logger.info(
              `[Terminal] Sending data to renderer for terminal ${terminalId}: ${data.length} bytes, first 50 chars: ${data.substring(0, 50).replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`,
            );
            mainDispatch(
              terminalProfessionalData({
                terminalId,
                data,
              }),
            );
          });

          // The shell will automatically show its prompt when it starts
          // No need to send an initial newline

          terminal.on('exit', ({ exitCode, signal }: any) => {
            mainDispatch(
              terminalProfessionalExit({
                terminalId,
                exitCode,
                signal,
              }),
            );
          });

          terminal.on('command:start', () => {
            mainDispatch(
              terminalProfessionalCommandStart({
                terminalId,
              }),
            );
          });

          terminal.on('command:executed', (command: string) => {
            mainDispatch(
              terminalProfessionalCommandExecuted({
                terminalId,
                command,
              }),
            );
          });

          terminal.on('command:finished', () => {
            mainDispatch(
              terminalProfessionalCommandFinished({
                terminalId,
              }),
            );
          });

          terminal.on('cwd:changed', (cwd: string) => {
            mainDispatch(
              terminalProfessionalCwdChanged({
                terminalId,
                cwd,
              }),
            );
          });

          logger.info(`[Terminal] Terminal created with ID: ${terminalId}`);

          return {
            success: true,
            terminalId,
            info: terminal.getInfo(),
          };
        } catch (error) {
          logger.error('[Terminal] Error creating terminal:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_CREATE,
    ),
  );

  /**
   * List terminals for a workspace
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_LIST,
    createSafeValidatedHandler(
      TerminalProfessionalListSchema,
      async (_, validated) => {
        try {
          const { workspaceId } = validated;
          const terminals = terminalManager.getWorkspaceTerminals(workspaceId);

          return {
            success: true,
            terminals: terminals.map((t) => ({
              id: t.getInfo().id,
              workspaceId: t.getInfo().workspaceId,
              cwd: t.getInfo().cwd,
              isExecuting: t.getInfo().isExecutingCommand,
            })),
          };
        } catch (error) {
          logger.error('[Terminal] Error listing terminals:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list terminals',
            terminals: [],
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_LIST,
    ),
  );

  /**
   * Write data to a terminal (user input)
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_WRITE,
    createSafeValidatedHandler(
      TerminalProfessionalWriteSchema,
      async (_, validated) => {
        try {
          const { terminalId, data } = validated;

          // Check for remote terminal first
          const remoteSession = remoteShellSessions.get(terminalId);
          if (remoteSession) {
            if (!remoteSession.isAlive()) {
              logger.error(`[Terminal] Remote terminal ${terminalId} is no longer alive`);
              await cleanupRemoteShellSession(terminalId, 'dead session write');
              throw new Error(`Remote terminal is no longer connected: ${terminalId}`);
            }
            remoteSession.write(data);
            return { success: true };
          }

          // Fall back to local terminal
          const terminal = terminalManager.getTerminal(terminalId);

          if (!terminal) {
            logger.error(`[Terminal] Terminal ${terminalId} not found for write operation`);
            throw new Error(`Terminal not found: ${terminalId}`);
          }

          // Guard: skip write if terminal is disposed or being disposed (AUGMENT-INTENT-9)
          if (!terminal.isAlive) {
            logger.warn(
              `[Terminal] Skipping write to terminal ${terminalId} - terminal is disposed or disposing`,
            );
            return { success: false, error: 'Terminal is disposed or disposing' };
          }

          try {
            terminal.write(data);
            return { success: true };
          } catch (writeError) {
            logger.error(`[Terminal] Failed to write to terminal ${terminalId}:`, writeError);
            // Return error instead of throwing to prevent crash propagation (AUGMENT-INTENT-9)
            return {
              success: false,
              error: `Failed to write to terminal: ${writeError instanceof Error ? writeError.message : 'Unknown error'}`,
            };
          }
        } catch (error) {
          logger.error('[Terminal] Error writing to terminal:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_WRITE,
    ),
  );

  /**
   * Resize a terminal
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_RESIZE,
    createSafeValidatedHandler(
      TerminalProfessionalResizeSchema,
      async (_, validated) => {
        try {
          const { terminalId, cols, rows } = validated;

          // Check for remote terminal first
          const remoteSession = remoteShellSessions.get(terminalId);
          if (remoteSession) {
            if (!remoteSession.isAlive()) {
              await cleanupRemoteShellSession(terminalId, 'dead session resize');
              return { success: false, error: 'Remote terminal is no longer connected' };
            }
            if (remoteSession.isAlive()) {
              remoteSession.resize(cols, rows);
            }
            return { success: true };
          }

          // Fall back to local terminal
          const terminal = terminalManager.getTerminal(terminalId);

          if (!terminal) {
            throw new Error(`Terminal not found: ${terminalId}`);
          }

          // Guard: skip resize if terminal is disposed or being disposed (AUGMENT-INTENT-9)
          if (!terminal.isAlive) {
            logger.warn(
              `[Terminal] Skipping resize for terminal ${terminalId} - terminal is disposed or disposing`,
            );
            return { success: false, error: 'Terminal is disposed or disposing' };
          }

          terminal.resize(cols, rows);

          return { success: true };
        } catch (error) {
          logger.error('[Terminal] Error resizing terminal:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_RESIZE,
    ),
  );

  /**
   * Get terminal info
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_INFO,
    createSafeValidatedHandler(
      TerminalProfessionalInfoSchema,
      async (_, validated) => {
        try {
          const { terminalId } = validated;

          // Check for remote terminal first
          const remoteSession = remoteShellSessions.get(terminalId);
          if (remoteSession) {
            if (!remoteSession.isAlive()) {
              await cleanupRemoteShellSession(terminalId, 'dead session info');
              return {
                success: false,
                error: `Terminal not found: ${terminalId}`,
              };
            }
            return {
              success: true,
              info: {
                id: terminalId,
                workspaceId: remoteSession.workspaceId,
                cwd: '~',
                shell: 'remote-shell',
                isRemote: true,
                isAlive: remoteSession.isAlive(),
              },
            };
          }

          // Fall back to local terminal
          const terminal = terminalManager.getTerminal(terminalId);

          if (!terminal) {
            return {
              success: false,
              error: `Terminal not found: ${terminalId}`,
            };
          }

          return {
            success: true,
            info: terminal.getInfo(),
          };
        } catch (error) {
          logger.error('[Terminal] Error getting terminal info:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_INFO,
    ),
  );

  /**
   * Get buffered output for replay when renderer connects to existing terminal
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_GET_BUFFER,
    createSafeValidatedHandler(
      TerminalProfessionalGetBufferSchema,
      async (_, validated) => {
        try {
          const { terminalId } = validated;

          const terminal = terminalManager.getTerminal(terminalId);

          if (!terminal) {
            logger.debug(`[Terminal] Terminal not found for buffer retrieval: ${terminalId}`);
            return {
              success: false,
              error: 'Terminal not found',
            };
          }

          const buffer = terminal.getBufferedOutput();
          logger.debug(
            `[Terminal] Retrieved terminal buffer for ${terminalId}: ${buffer.length} bytes`,
          );

          return {
            success: true,
            buffer,
          };
        } catch (error) {
          logger.error('[Terminal] Error getting terminal buffer:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_GET_BUFFER,
    ),
  );

  /**
   * Refresh terminal (trigger prompt redraw)
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_REFRESH,
    createSafeValidatedHandler(
      TerminalProfessionalRefreshSchema,
      async (_, validated) => {
        try {
          const { terminalId } = validated;

          // Check for remote terminal first
          const remoteSession = remoteShellSessions.get(terminalId);
          if (remoteSession) {
            if (!remoteSession.isAlive()) {
              await cleanupRemoteShellSession(terminalId, 'dead session refresh');
              return { success: false, error: 'Remote terminal is no longer connected' };
            }
            if (remoteSession.isAlive()) {
              // Send a carriage return to trigger prompt display
              remoteSession.write('\r');
            }
            return { success: true };
          }

          // Fall back to local terminal
          const terminal = terminalManager.getTerminal(terminalId);

          if (!terminal) {
            return {
              success: false,
              error: 'Terminal not found',
            };
          }

          // Guard: skip refresh if terminal is disposed or being disposed (AUGMENT-INTENT-9)
          if (!terminal.isAlive) {
            logger.warn(
              `[Terminal] Skipping refresh for terminal ${terminalId} - terminal is disposed or disposing`,
            );
            return { success: false, error: 'Terminal is disposed or disposing' };
          }

          // Send a carriage return to trigger prompt display
          terminal.write('\r');

          return { success: true };
        } catch (error) {
          logger.error('[Terminal] Error refreshing terminal:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_REFRESH,
    ),
  );

  /**
   * Dispose a terminal
   */
  ipcMain.handle(
    TERMINAL_CHANNELS.PROFESSIONAL_DISPOSE,
    createSafeValidatedHandler(
      TerminalProfessionalDisposeSchema,
      async (_, validated) => {
        try {
          const { terminalId } = validated;

          // Check for remote terminal first
          const remoteSession = remoteShellSessions.get(terminalId);
          if (remoteSession) {
            logger.info(`[Terminal] Disposing remote terminal: ${terminalId}`);
            await cleanupRemoteShellSession(terminalId, 'explicit dispose');
            return { success: true };
          }

          // Fall back to local terminal - use disposeTerminal to both dispose and remove from manager
          await terminalManager.disposeTerminal(terminalId);

          return { success: true };
        } catch (error) {
          logger.error('[Terminal] Error disposing terminal:', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TERMINAL_CHANNELS.PROFESSIONAL_DISPOSE,
    ),
  );

  // Removed duplicate handler for "terminal:professional:list" - already defined above at line 476

  // ---------------------------------------------------------------------------
  // Create terminal with command (for CLI blocks in notes)
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
    createSafeValidatedHandler(
      TerminalCreateWithCommandSchema,
      async (_, validated) => {
        try {
          const { workspaceId, command, cwd, title, env: customEnv, pasteOnly } = validated;

          // Get workspace path and scope info
          let workingDir = cwd;
          if (!workingDir) {
            if (workspaceId === '__root__') {
              // Root-context terminals (e.g., from the onboarding / welcome
              // screen before any workspace exists) are not tied to a
              // workspace record. Use the user's home directory as the
              // working directory and skip the workspace lookup entirely —
              // getWorkspaceInfo() would retry for several seconds before
              // returning an empty result.
              workingDir = os.homedir();
            } else {
              // Try to get workspace path from workspace service
              const workspaceInfo = await getWorkspaceInfo(workspaceId);
              if (workspaceInfo.workspacePath) {
                workingDir = workspaceInfo.workspacePath;
                // Apply scope if present
                if (workspaceInfo.scope) {
                  workingDir = path.join(workingDir, workspaceInfo.scope);
                }
              }
              if (!workingDir) {
                workingDir = WorkspaceConfig.paths.workspace(workspaceId);
              }
            }
          }
          const validatedWorkingDir = ensureDirectoryExists(workingDir);

          // If directory is not valid, return an error
          if (validatedWorkingDir === null) {
            logger.error('[Terminal] Workspace directory not ready for command', {
              workspaceId,
              command,
              attemptedPath: workingDir,
            });
            return {
              ok: false,
              error:
                'WORKSPACE_NOT_READY: The workspace directory does not exist yet. Please wait for workspace initialization to complete.',
            };
          }

          // Use createTerminalFromBackend which handles all the setup
          const result = await createTerminalFromBackend({
            workspaceId: workspaceId as WorkspaceId,
            cwd: validatedWorkingDir,
            title: title || `Command: ${command.substring(0, 30)}`,
            initialCommand: command,
            pasteOnly,
            env: customEnv,
          });

          return {
            ok: result.success,
            terminalId: result.terminalId,
            error: result.error,
          };
        } catch (error) {
          logger.error('[Terminal] Error in terminal:createWithCommand:', error as Error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      TERMINAL_CHANNELS.CREATE_WITH_COMMAND,
    ),
  );
  logger.info('[Terminal] IPC handlers registered');
}

/**
 * Clean up all terminals on app quit (async, graceful).
 * This properly cleans up PTY processes to prevent Napi::Error crashes
 * during Electron shutdown (see AUGMENT-INTENT-8).
 */
export async function cleanupTerminals(): Promise<void> {
  logger.info('[Terminal] Starting graceful terminal cleanup');

  // Clean up local terminals gracefully
  await terminalManager.disposeAll();

  // Clean up remote terminal sessions
  const remoteCleanupPromises: Promise<void>[] = [];
  for (const [terminalId, session] of remoteShellSessions) {
    logger.info(`[Terminal] Cleaning up remote terminal: ${terminalId}`);
    session.close();
    remoteCleanupPromises.push(
      sshManager.disconnect(session.connectionId).catch((err) => {
        logger.warn(`[Terminal] Failed to disconnect SSH for terminal ${terminalId}:`, err);
      }),
    );
  }

  // Wait for remote sessions to disconnect
  if (remoteCleanupPromises.length > 0) {
    await Promise.all(remoteCleanupPromises);
  }

  remoteShellSessions.clear();
  logger.info('[Terminal] Terminal cleanup complete');
}

/**
 * Synchronous cleanup for emergency shutdown (less safe).
 * Use cleanupTerminals() when possible.
 */
export function cleanupTerminalsSync(): void {
  logger.info('[Terminal] Performing synchronous terminal cleanup');

  // Clean up local terminals
  terminalManager.disposeAllSync();

  // Clean up remote terminal sessions
  for (const [terminalId, session] of remoteShellSessions) {
    logger.info(`[Terminal] Cleaning up remote terminal: ${terminalId}`);
    session.close();
    sshManager.disconnect(session.connectionId).catch((err) => {
      logger.warn(`[Terminal] Failed to disconnect SSH for terminal ${terminalId}:`, err);
    });
  }
  remoteShellSessions.clear();
}

/**
 * Clean up all terminals for a specific workspace.
 * Called when a workspace is deleted or archived to properly dispose of terminal resources
 * and notify the renderer to close terminal tabs.
 */
export async function cleanupWorkspaceTerminals(workspaceId: WorkspaceId): Promise<void> {
  const localTerminals = terminalManager.getWorkspaceTerminals(workspaceId);
  const remoteTerminals = Array.from(remoteShellSessions.entries()).filter(
    ([, session]) => session.workspaceId === workspaceId,
  );

  if (localTerminals.length === 0 && remoteTerminals.length === 0) {
    logger.debug('[Terminal] No terminals to clean up for workspace', { workspaceId });
    return;
  }

  logger.info('[Terminal] Cleaning up terminals for workspace', {
    workspaceId,
    localCount: localTerminals.length,
    remoteCount: remoteTerminals.length,
  });

  let cleaned = 0;
  let failed = 0;

  // Clean up local terminals
  for (const terminal of localTerminals) {
    try {
      const terminalId = terminal.getInfo().id;
      await terminalManager.disposeTerminal(terminalId);
      mainDispatch(
        terminalDisposed({
          terminalId,
          workspaceId,
        }),
      );
      cleaned++;
    } catch (error) {
      failed++;
      logger.warn('[Terminal] Failed to dispose terminal', {
        terminalId: terminal.getInfo().id,
        error,
      });
    }
  }

  // Clean up remote terminals
  for (const [terminalId, session] of remoteTerminals) {
    try {
      session.close();
      await sshManager.disconnect(session.connectionId);
      remoteShellSessions.delete(terminalId);
      mainDispatch(
        terminalDisposed({
          terminalId,
          workspaceId,
        }),
      );
      cleaned++;
    } catch (error) {
      failed++;
      logger.warn('[Terminal] Failed to dispose remote terminal', { terminalId, error });
    }
  }

  logger.info('[Terminal] Workspace terminal cleanup complete', { workspaceId, cleaned, failed });
}

/**
 * Create a terminal from the backend and notify the frontend.
 * This allows backend code (like workspace creation) to spawn terminals
 * that appear in the UI's terminal list.
 */
export async function createTerminalFromBackend(options: {
  workspaceId: WorkspaceId;
  cwd: string;
  title?: string;
  initialCommand?: string;
  /**
   * When `true`, the `initialCommand` is typed into the PTY prompt but
   * NOT executed — no trailing carriage return is sent. Used by the
   * onboarding provider cards so users can review the command (e.g.
   * `npm install -g …`) before pressing Enter.
   */
  pasteOnly?: boolean;
  env?: Record<string, string>;
}): Promise<{ terminalId: string; success: boolean; error?: string }> {
  const { workspaceId, cwd, title, initialCommand, pasteOnly, env: customEnv } = options;

  try {
    // Generate terminal ID
    const terminalId = `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Get workspace info (includes remote status and workspace path).
    // Root-context terminals (workspaceId === '__root__') are never tied to
    // a workspace record and are never remote, so skip the lookup — otherwise
    // getWorkspaceInfo() would spend several seconds retrying before returning
    // an empty result.
    const workspaceInfo: {
      isRemote: boolean;
      sshConfig?: SSHConnectionConfig;
      workspacePath?: string;
      scope?: string;
    } = workspaceId === '__root__' ? { isRemote: false } : await getWorkspaceInfo(workspaceId);

    if (workspaceInfo.isRemote && workspaceInfo.sshConfig) {
      // Create remote terminal
      logger.info(`[Terminal] Backend creating remote terminal for workspace: ${workspaceId}`);

      const connectionId = `backend-terminal-${workspaceId}-${terminalId}`;
      try {
        await sshManager.connect(connectionId, workspaceInfo.sshConfig);
      } catch (sshError) {
        logger.error('[Terminal] Failed to connect via SSH:', sshError as Error);
        return {
          terminalId: '',
          success: false,
          error: `Failed to connect to remote server: ${sshError instanceof Error ? sshError.message : 'Unknown error'}`,
        };
      }

      try {
        // Apply scope to working directory if present
        let terminalCwd = workspaceInfo.workspacePath || cwd;
        if (workspaceInfo.scope && workspaceInfo.workspacePath) {
          terminalCwd = path.join(workspaceInfo.workspacePath, workspaceInfo.scope);
        }

        const shell = await sshManager.openInteractiveShell(connectionId, {
          cwd: terminalCwd,
          env: customEnv,
          cols: 80,
          rows: 24,
          onData: (data: string) => {
            mainDispatch(terminalProfessionalData({ terminalId, data }));
          },
          onExit: (code: number) => {
            mainDispatch(
              terminalProfessionalExit({
                terminalId,
                exitCode: code,
                signal: null,
              }),
            );
            cleanupRemoteShellSessionInBackground(terminalId, 'backend remote terminal exit', {
              closeSession: false,
            });
          },
          onError: (error: Error) => {
            logger.error(`[Terminal] Remote terminal ${terminalId} error:`, error);
            cleanupRemoteShellSessionInBackground(terminalId, 'backend remote terminal error', {
              closeSession: false,
            });
          },
        });

        // Store the session
        remoteShellSessions.set(terminalId, {
          terminalId,
          workspaceId,
          connectionId,
          write: shell.write,
          resize: shell.resize,
          close: shell.close,
          isAlive: shell.isAlive,
        });

        // Emit event to notify frontend about the new terminal
        mainDispatch(
          terminalCreated({
            terminalId,
            workspaceId,
            title: title || 'Remote Terminal',
            cwd: terminalCwd,
            createdAt: new Date().toISOString(),
            background: !!initialCommand,
          }),
        );

        logger.info('[Terminal] Backend remote terminal created', {
          terminalId,
          workspaceId,
          cwd: workspaceInfo.workspacePath || cwd,
        });

        // If there's an initial command, execute it via exec channel (non-interactive)
        // to avoid issues with tmux/profile scripts in the interactive shell.
        // See: acp-provider.ts launchRemoteAgent() for the same exec channel pattern.
        if (initialCommand) {
          const remoteTmpScript = `/tmp/intent-setup-${terminalId}.sh`;

          // Run setup asynchronously via exec channel — don't block terminal creation
          (async () => {
            try {
              // Write setup script to a temp file on the remote via heredoc
              // Generate unique delimiter to avoid collision with command content
              const heredocDelimiter = `INTENT_SETUP_EOF_${Date.now().toString(36)}`;
              await sshManager.executeCommand(
                connectionId,
                `cat > "${remoteTmpScript}" << '${heredocDelimiter}'\n#!/bin/bash\n${initialCommand}\n${heredocDelimiter}`,
                { timeout: 10000 },
              );
              await sshManager.executeCommand(connectionId, `chmod +x "${remoteTmpScript}"`, {
                timeout: 5000,
              });

              // Execute via exec channel (bypasses .bashrc/tmux entirely)
              const result = await sshManager.executeCommand(
                connectionId,
                `bash "${remoteTmpScript}"`,
                { timeout: 120000 }, // Allow up to 2 minutes for setup scripts
              );

              logger.info('[Terminal] Remote setup script completed via exec channel', {
                terminalId,
                exitCode: result.exitCode,
                stdout: result.stdout.substring(0, 500),
                stderr: result.stderr.substring(0, 500),
              });

              if (result.exitCode !== 0) {
                logger.warn('[Terminal] Remote setup script exited with non-zero code', {
                  terminalId,
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                });
              }

              mainDispatch(
                terminalProfessionalCommandExecuted({
                  terminalId,
                  command: 'Setup script (installing dependencies)',
                }),
              );
            } catch (error) {
              logger.error('[Terminal] Failed to execute remote setup script via exec channel', {
                terminalId,
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              // Clean up temp script
              sshManager
                .executeCommand(connectionId, `rm -f "${remoteTmpScript}"`, { timeout: 5000 })
                .catch(() => {});
            }
          })();
        }

        return { terminalId, success: true };
      } catch (shellError) {
        await sshManager.disconnect(connectionId);
        throw shellError;
      }
    }

    // Local terminal creation
    // Find a valid shell
    const shell = findValidShell();
    logger.info(`[Terminal] Backend creating terminal with shell: ${shell}`);

    // Apply scope to working directory if present
    let terminalCwd = cwd;
    if (workspaceInfo.scope && workspaceInfo.workspacePath) {
      terminalCwd = path.join(workspaceInfo.workspacePath, workspaceInfo.scope);
    }

    // Ensure working directory exists
    const workingDir = ensureDirectoryExists(terminalCwd);

    // If directory is not valid, return an error
    if (workingDir === null) {
      logger.error('[Terminal] Workspace directory not ready for backend terminal', {
        workspaceId,
        attemptedPath: terminalCwd,
      });
      return {
        terminalId: '',
        success: false,
        error:
          'WORKSPACE_NOT_READY: The workspace directory does not exist yet. Please wait for workspace initialization to complete.',
      };
    }

    // Create the terminal instance
    const terminal = terminalManager.createTerminal({
      id: terminalId,
      workspaceId,
      cwd: workingDir,
      shell,
      cols: 80,
      rows: 24,
      title: title || 'Terminal',
    });

    // Check if node-pty is available
    if (!pty) {
      throw new Error('node-pty is required for terminal functionality but is not available');
    }

    // Create a unique history file for this terminal
    const historyDir = path.join(os.homedir(), 'intent', '.history');
    await fsPromises.mkdir(historyDir, { recursive: true }).catch(() => {});
    const historyFile = path.join(historyDir, `terminal-${terminalId}`);

    // Spawn the PTY with merged environment
    const minimalEnv = createShellEnv({
      HOME: process.env.HOME || os.homedir(),
      USER: process.env.USER || os.userInfo().username,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SHELL: shell,
      LANG: process.env.LANG || 'en_US.UTF-8',
      // Use isolated history file
      HISTFILE: historyFile,
      HISTSIZE: '1000',
      HISTFILESIZE: '2000',
      // Suppress the % character that zsh shows for incomplete lines
      PROMPT_EOL_MARK: '',
      // Disable save/restore for this terminal to prevent interference
      HISTCONTROL: 'ignoreboth',
      // Merge custom environment variables (e.g., setup script variables)
      ...customEnv,
    });

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: minimalEnv,
    });

    // Initialize the terminal with the PTY
    await terminal.initialize(ptyProcess);

    // Set up event forwarding - use professional terminal events so TerminalAdapter can receive them
    terminal.on('data', (data: string) => {
      mainDispatch(terminalProfessionalData({ terminalId, data }));
    });

    terminal.on('exit', ({ exitCode }: { exitCode: number }) => {
      mainDispatch(
        terminalProfessionalExit({
          terminalId,
          exitCode,
          signal: null,
        }),
      );
    });

    // Forward shell-integration command lifecycle events so consumers like
    // the onboarding AgentGrid can auto-refresh provider availability when
    // an install command finishes. Mirrors the forwarding set up in the
    // `terminal:professional:create` handler. Requires the user's shell to
    // emit OSC 633 markers — otherwise these silently never fire.
    terminal.on('command:start', () => {
      mainDispatch(
        terminalProfessionalCommandStart({
          terminalId,
        }),
      );
    });

    terminal.on('command:executed', (command: string) => {
      mainDispatch(
        terminalProfessionalCommandExecuted({
          terminalId,
          command,
        }),
      );
    });

    terminal.on('command:finished', () => {
      mainDispatch(
        terminalProfessionalCommandFinished({
          terminalId,
        }),
      );
    });

    terminal.on('cwd:changed', (cwd: string) => {
      mainDispatch(
        terminalProfessionalCwdChanged({
          terminalId,
          cwd,
        }),
      );
    });

    // Emit event to notify frontend about the new terminal
    mainDispatch(
      terminalCreated({
        terminalId,
        workspaceId,
        title: title || 'Terminal',
        cwd: workingDir,
        createdAt: new Date().toISOString(),
        background: !!initialCommand,
      }),
    );

    logger.info('[Terminal] Backend terminal created', {
      terminalId,
      workspaceId,
      cwd: workingDir,
    });

    // If there's an initial command, either type it at the prompt
    // (`pasteOnly`) or save it to a temp script file and execute it.
    if (initialCommand) {
      if (pasteOnly) {
        // Paste-only mode: write the command text to the PTY WITHOUT a
        // trailing carriage return so it appears at the shell prompt and
        // the user must press Enter themselves. Used by the onboarding
        // provider cards so users can review install commands before
        // running them. We still wait briefly for the shell to render
        // its initial prompt, otherwise the text can end up ahead of it.
        setTimeout(() => {
          try {
            terminal.write(initialCommand);
            logger.info('[Terminal] Pasted command at prompt (not executed)', {
              terminalId,
              length: initialCommand.length,
            });
          } catch (error) {
            logger.error('[Terminal] Failed to paste command:', error as Error);
          }
        }, 500);
      } else {
        setTimeout(async () => {
          try {
            const isWindows = process.platform === 'win32';
            // Create a temporary script file
            const scriptDir = path.join(os.tmpdir(), 'workspaces-scripts');
            await fsPromises.mkdir(scriptDir, { recursive: true }).catch(() => {});
            const scriptExt = isWindows ? '.ps1' : '.sh';
            const scriptPath = path.join(scriptDir, `setup-${terminalId}${scriptExt}`);

            // Write the script to the file (skip mode on Windows — irrelevant)
            if (isWindows) {
              await fsPromises.writeFile(scriptPath, initialCommand);
            } else {
              await fsPromises.writeFile(scriptPath, initialCommand, { mode: 0o755 });
            }

            // Execute the script with the platform-appropriate shell
            const command = isWindows
              ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
              : `bash "${scriptPath}"`;
            terminal.write(`${command}\r`);
            logger.info('[Terminal] Executing setup script', { terminalId, scriptPath });

            // Notify frontend that a command was executed so it can track it
            mainDispatch(
              terminalProfessionalCommandExecuted({
                terminalId,
                command: 'Setup script (installing dependencies)',
              }),
            );

            // Clean up the script file after a delay (give it time to execute)
            setTimeout(async () => {
              try {
                await fsPromises.unlink(scriptPath);
              } catch {
                // Ignore cleanup errors
              }
            }, 60000); // Clean up after 1 minute
          } catch (error) {
            logger.error('[Terminal] Failed to execute setup script:', error as Error);
            // Fallback: try to execute inline
            if (process.platform === 'win32') {
              // Pipe the script to PowerShell via stdin
              terminal.write(
                `powershell -ExecutionPolicy Bypass -Command "${initialCommand.replace(/"/g, '\\"')}"\r`,
              );
            } else {
              // Fallback: try to execute inline with heredoc
              terminal.write(`bash << 'SETUP_SCRIPT_EOF'\n${initialCommand}\nSETUP_SCRIPT_EOF\r`);
            }
          }
        }, 500);
      }
    }

    return { terminalId, success: true };
  } catch (error) {
    logger.error('[Terminal] Backend terminal creation failed:', error as Error);
    return {
      terminalId: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Alias for registerTerminalHandlers (used by main/index.ts)
 */
export const setupTerminalIPC = registerTerminalHandlers;
