import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AUGGIE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { findAuggiePathAsync } from './auggie-path';
import { hostExec } from '../../../shared/main/host-exec';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';
import { m } from '../../../shared/paraglide/messages.js';

// Re-export path helpers for backwards compatibility with existing consumers.

const logger = new Logger('AuggieIPC');

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

  // Get available models for auggie — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    AUGGIE_CHANNELS.GET_MODELS,
    async (event, params?: { forceRefresh?: boolean; workspaceId?: string }) =>
      getProviderModelsEnvelope('auggie', params, event),
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

      const { findBinary, getCommonNpmPaths } = await import('../../../shared/main/find-binary');
      const claudePath = await findBinary('claude', {
        commonPaths: getCommonNpmPaths('claude'),
      });

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
