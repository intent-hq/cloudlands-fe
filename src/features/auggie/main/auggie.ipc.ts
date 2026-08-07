import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MINIMUM_NODE_VERSION } from '../../../shared/constants/auggie';
import { AUGGIE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { findAuggiePathAsync, getEnhancedPath } from './auggie-path';
import { hostExec } from '../../../shared/main/host-exec';
import { getProviderAuthVerdict } from '../../../shared/main/provider-auth-status';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { m } from '../../../shared/paraglide/messages.js';

// Re-export path helpers for backwards compatibility with existing consumers.
export { findAuggiePathAsync, getEnhancedPath };

const logger = new Logger('AuggieIPC');

// ============================================================================
// Node.js Version Requirements
// ============================================================================

/**
 * Parse a semver version string into its components.
 * Prerelease suffixes (e.g., -beta.1, -rc.1) are ignored for comparison purposes.
 * Returns null if the version string is invalid.
 */
function parseVersion(
  versionString: string,
): { major: number; minor: number; patch: number } | null {
  // Extract version number from strings like "auggie version 0.14.0-beta.1 (commit abc123)"
  // The regex captures major.minor.patch, ignoring any prerelease suffix
  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/**
 * Compare two version strings.
 * Returns:
 *   -1 if version1 < version2
 *    0 if version1 === version2
 *    1 if version1 > version2
 *   null if either version is invalid
 */
function compareVersions(version1: string, version2: string): number | null {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (!v1 || !v2) return null;

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  return 0;
}

/**
 * Check if a version meets the minimum required version.
 */
function meetsMinimumVersion(version: string, minimum: string): boolean {
  const comparison = compareVersions(version, minimum);
  // If comparison is null (invalid version), assume it doesn't meet requirements
  return comparison !== null && comparison >= 0;
}

/**
 * Check the installed Node.js version via the daemon's `host.exec`
 * (PROTOCOL §5.14).
 *
 * Post-P2 the daemon owns agent spawning (`agent.create` → `spawn.rs`) and
 * PATH resolution (`host.env`), so the `node` that `host.exec` resolves —
 * with the daemon's PATH-enriched env — is exactly the runtime the agent
 * will use. The earlier `rawExec(process.env)` workaround (which avoided
 * the app's enhanced PATH to match the launcher's PATH) is obsolete.
 */
async function checkNodeVersion(): Promise<{
  nodeVersion?: string;
  nodeVersionOk: boolean;
}> {
  try {
    const result = await hostExec('node', {
      args: ['--version'],
      timeoutMs: 5000,
    });
    if (result.timedOut) {
      logger.warn('Node version probe (host.exec) timed out');
      return { nodeVersionOk: false };
    }
    if (result.exitCode !== 0) {
      logger.warn('Node not found on PATH (host.exec)', {
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
      return { nodeVersionOk: false };
    }
    const version = (result.stdout || '').trim();
    if (!version) {
      return { nodeVersionOk: false };
    }
    const versionOk = meetsMinimumVersion(version, MINIMUM_NODE_VERSION);
    logger.info('Node.js version check (host.exec)', { version, versionOk });
    return { nodeVersion: version, nodeVersionOk: versionOk };
  } catch (err) {
    logger.warn('Node version probe (host.exec) failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { nodeVersionOk: false };
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupAuggieIPC() {
  // Get the resolved auggie path (for displaying in settings)
  ipcMain.handle(AUGGIE_CHANNELS.GET_PATH, async () => {
    try {
      const resolvedPath = await findAuggiePathAsync();
      return {
        success: true,
        path: resolvedPath,
      };
    } catch (error) {
      logger.error('Failed to get auggie path', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Install auggie. Local install (npm-install / binary download / codesign)
  // is retired per Decision 3: the FE returns platform-specific instructions
  // for the user to run in their own terminal. The envelope shape
  // ({ success, error, errorType, data }) is preserved so existing renderers
  // keep functioning; `data.instructions` / `data.command` carry the
  // actionable payload for callers that render the new UX.
  ipcMain.handle(AUGGIE_CHANNELS.INSTALL, async () => {
    const platform = process.platform;
    const command =
      platform === 'win32'
        ? 'npm install -g @augmentcode/auggie'
        : 'npm install -g @augmentcode/auggie';
    const nodeCheck = await checkNodeVersion();

    const instructions: string[] = [];
    if (!nodeCheck.nodeVersionOk) {
      const major = MINIMUM_NODE_VERSION.split('.')[0];
      instructions.push(
        nodeCheck.nodeVersion
          ? m.auggie_ipc_installNodeFound_instruction({ major, version: nodeCheck.nodeVersion })
          : m.auggie_ipc_installNodeNotFound_instruction({ major }),
      );
    }
    instructions.push(
      m.auggie_ipc_runInstall_instruction({ command }),
      m.auggie_ipc_verifyInstall_instruction(),
    );

    const errorMessage = instructions.join(' ');
    logger.info('Auggie install: returning manual-install instructions', {
      platform,
      nodeVersionOk: nodeCheck.nodeVersionOk,
    });

    return {
      success: false,
      error: errorMessage,
      errorType: 'manual_install_required' as const,
      data: {
        instructions,
        command,
        platform,
        minimumNodeVersion: MINIMUM_NODE_VERSION,
      },
    };
  });

  // Authenticate with Augment. The FE-side interactive OAuth flow
  // (spawning `auggie login`, stdout scraping, JSON paste, direct token
  // exchange) is retired per Decision 3. The FE now detects auth via
  // `host.checkAuggie` + `host.providerAuthStatus` and returns instructions
  // for the user to run `auggie login` themselves.
  //
  // The `{ action }` param is preserved for renderer compat: `start` and
  // `complete` return the instruction payload; `poll` re-runs detection so
  // the setup UI can show "logged in" once the user finishes the flow.
  ipcMain.handle(
    AUGGIE_CHANNELS.AUTHENTICATE,
    async (_, _params?: { action?: 'start' | 'complete' | 'poll'; authResponse?: string }) => {
      // Re-check via the daemon so callers get the current install state.
      let auggiePath: string | null = null;
      let installed = false;
      try {
        const check = await getBackendClient().request<{
          available: boolean;
          path?: string;
        }>('host.checkAuggie');
        installed = Boolean(check?.available);
        if (typeof check?.path === 'string' && check.path.trim()) {
          auggiePath = check.path.trim();
        }
      } catch (error) {
        logger.warn('host.checkAuggie failed during authenticate', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: m.auggie_ipc_daemonUnreachable_error(),
        };
      }

      if (!installed || !auggiePath) {
        return {
          success: false,
          error: m.auggie_ipc_notInstalled_error(),
          errorType: 'not_installed' as const,
          data: {
            instructions: [
              m.auggie_ipc_installFirst_instruction(),
              m.auggie_ipc_thenLogin_instruction(),
            ],
            command: 'auggie login',
          },
        };
      }

      // Auth verdict via the daemon (`host.providerAuthStatus`, force to
      // bypass the daemon's cache — the user may have just logged in). If
      // already logged in, tell the renderer so it can skip the login step.
      // Otherwise return the instruction to run `auggie login` interactively
      // (the daemon cannot host the OAuth interactive TTY session; the user
      // runs it in their own terminal).
      const authenticated = (await getProviderAuthVerdict('auggie', { force: true })) === true;

      if (authenticated) {
        return {
          success: true,
          data: { authenticated: true, completed: true },
        };
      }

      return {
        success: false,
        error: m.auggie_ipc_loginRequired_error(),
        errorType: 'manual_login_required' as const,
        data: {
          authenticated: false,
          instructions: [
            m.auggie_ipc_runLogin_instruction({ path: auggiePath }),
            m.auggie_ipc_completeBrowserFlow_instruction(),
          ],
          command: 'auggie login',
          auggiePath,
        },
      };
    },
  );

  // Get available models for auggie — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(AUGGIE_CHANNELS.GET_MODELS, async (_event, params?: { forceRefresh?: boolean }) =>
    getProviderModelsEnvelope('auggie', params),
  );

  // Get the latest session file
  ipcMain.handle(AUGGIE_CHANNELS.GET_LATEST_SESSION, async () => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');

      // Check if sessions directory exists
      try {
        await fs.access(sessionsDir);
      } catch {
        return {
          success: false,
          error: m.auggie_ipc_sessionsDirNotFound_error(),
        };
      }

      // Read all session files
      const files = await fs.readdir(sessionsDir);
      if (files.length === 0) {
        return {
          success: false,
          error: m.auggie_ipc_noSessionFiles_error(),
        };
      }

      // Get the most recent session file
      let latestFile = files[0];
      let latestTime = 0;

      for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestFile = file;
        }
      }

      // Extract session ID from filename (format: session-{id}.json)
      const sessionId = latestFile.replace('session-', '').replace('.json', '');

      return {
        success: true,
        data: {
          sessionId,
          filePath: path.join(sessionsDir, latestFile),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || m.auggie_ipc_latestSessionFailed_error(),
      };
    }
  });

  // Extract file changes from a session
  ipcMain.handle(AUGGIE_CHANNELS.EXTRACT_FILE_CHANGES, async (_, { sessionId }) => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');
      const sessionFile = path.join(sessionsDir, `session-${sessionId}.json`);

      // Check if session file exists
      try {
        await fs.access(sessionFile);
      } catch {
        return {
          success: true,
          data: [], // Return empty array if session file doesn't exist yet
        };
      }

      // Read session file
      const content = await fs.readFile(sessionFile, 'utf-8');
      const sessionData = JSON.parse(content);

      // Extract file changes from the session
      const fileChanges: any[] = [];

      // Look for file changes in the session data
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
        for (const message of sessionData.messages) {
          if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
            for (const block of message.contentBlocks) {
              // Look for tool use blocks that indicate file changes
              if (block.type === 'tool_use' && block.name === 'edit_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.old_str || '',
                  newContent: input.new_str || '',
                  type: 'edit',
                });
              } else if (block.type === 'tool_use' && block.name === 'create_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: '',
                  newContent: input.content || '',
                  type: 'create',
                });
              } else if (block.type === 'tool_use' && block.name === 'delete_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.content || '',
                  newContent: '',
                  type: 'delete',
                });
              }
            }
          }
        }
      }

      return {
        success: true,
        data: fileChanges,
      };
    } catch (error) {
      logger.error('Error extracting file changes', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || m.auggie_ipc_extractChangesFailed_error(),
      };
    }
  });

  // Get the current user, derived from the daemon's GitHub identity.
  // The login is surfaced as `id` for the existing analytics consumer.
  // email/tenantId/tenantName have no GitHub equivalent and are null (see
  // BE hand-off note d1df7466).
  ipcMain.handle(AUGGIE_CHANNELS.GET_USER_INFO, async () => {
    try {
      const response = await getBackendClient().request<{
        user?: { login?: string; avatarUrl?: string; htmlUrl?: string } | null;
      }>('github.getUser');
      const user = response?.user;
      if (user?.login) {
        return {
          success: true,
          data: {
            id: user.login,
            email: null,
            tenantId: null,
            tenantName: null,
            login: user.login,
            avatarUrl: user.avatarUrl ?? null,
            htmlUrl: user.htmlUrl ?? null,
          },
        };
      }
      return {
        success: false,
        error: m.auggie_ipc_noUserInfo_error(),
      };
    } catch (error) {
      // Daemon not configured / method missing: treat as no user, not a crash.
      if (error instanceof JsonRpcError && error.rpcCode === -32601) {
        return {
          success: false,
          error: m.auggie_ipc_noUserInfo_error(),
        };
      }
      logger.error('Error getting user info', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || m.auggie_ipc_userInfoFailed_error(),
      };
    }
  });

  // Uninstall MCP from Claude Code
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CLAUDE_CODE, async () => {
    try {
      logger.info('Uninstalling MCP from Claude Code');

      const { getClaudeCodePath } =
        await import('../../../features/claude-code/main/claude-code-resolver');
      const claudePath = await getClaudeCodePath();

      if (!claudePath) {
        return {
          success: false,
          error: m.auggie_ipc_claudeCliNotFound_error(),
        };
      }

      const command = `${claudePath} mcp remove auggie --scope user`;

      logger.info('Executing Claude Code MCP uninstall', { command });

      const uninstallResult = await hostExec(claudePath, {
        args: ['mcp', 'remove', 'auggie', '--scope', 'user'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Claude Code MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from Claude Code', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Codex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CODEX, async () => {
    try {
      logger.info('Uninstalling MCP from Codex');

      const { getCodexPath } = await import('../../../features/codex/main/codex-resolver');
      const codexPath = await getCodexPath();

      if (!codexPath) {
        return {
          success: false,
          error: m.auggie_ipc_codexCliNotFound_error(),
        };
      }

      const command = `${codexPath} mcp remove codebase-retrieval`;

      logger.info('Executing Codex MCP uninstall', { command });

      const uninstallResult = await hostExec(codexPath, {
        args: ['mcp', 'remove', 'codebase-retrieval'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Codex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from Codex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Cortex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CORTEX, async () => {
    try {
      logger.info('Uninstalling MCP from Cortex');

      const { getCortexPath } = await import('../../../features/cortex/main/cortex-resolver');
      const cortexPath = await getCortexPath();

      if (!cortexPath) {
        return {
          success: false,
          error: m.auggie_ipc_cortexCliNotFound_error(),
        };
      }

      const command = `${cortexPath} mcp remove augment-context-engine`;

      logger.info('Executing Cortex MCP uninstall', { command });

      const uninstallResult = await hostExec(cortexPath, {
        args: ['mcp', 'remove', 'augment-context-engine'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Cortex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from Cortex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from OpenCode
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_OPENCODE, async () => {
    try {
      logger.info('Uninstalling MCP from OpenCode');

      const configFile = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcp && config.mcp['augment-context-engine']) {
          delete config.mcp['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('OpenCode MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in OpenCode config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('OpenCode config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse OpenCode config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: m.auggie_ipc_parseOpencodeConfigFailed_error({
            error: (readOrParseError as Error).message,
          }),
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from OpenCode', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Pi
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_PI, async () => {
    try {
      logger.info('Uninstalling MCP from Pi');

      const configFile = path.join(os.homedir(), '.pi', 'agent', 'mcp.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcpServers && config.mcpServers['augment-context-engine']) {
          delete config.mcpServers['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('Pi MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in Pi config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('Pi MCP config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse Pi MCP config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: m.auggie_ipc_parsePiConfigFailed_error({
            error: (readOrParseError as Error).message,
          }),
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from Pi', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Droid
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_DROID, async () => {
    try {
      logger.info('Uninstalling MCP from Droid');

      const configFile = path.join(os.homedir(), '.factory', 'mcp.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcpServers && config.mcpServers['augment-context-engine']) {
          delete config.mcpServers['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('Droid MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in Droid config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('Droid MCP config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse Droid MCP config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: m.auggie_ipc_parseDroidConfigFailed_error({
            error: (readOrParseError as Error).message,
          }),
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || m.auggie_ipc_unknown_error();
      logger.error('Failed to uninstall MCP from Droid', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });
}
