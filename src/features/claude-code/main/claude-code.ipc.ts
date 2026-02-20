/**
 * Claude Code IPC Handlers
 *
 * IPC handlers for Claude Code ACP adapter integration
 */

import { ipcMain } from 'electron';
import * as os from 'os';
import { spawn } from 'child_process';
import { CLAUDE_CODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { killChildProcessTree } from '../../../shared/main/process-tree-kill';
import { resolveClaudeCodeCommand } from './claude-code-resolver';

const logger = new Logger('ClaudeCodeIPC');

// Cache for model listing results to avoid spawning a new process on every call
let cachedModels: ClaudeCodeModel[] | null = null;
let cacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_MODELS = [
  {
    value: 'default',
    label: 'Default (Claude Code)',
    description: 'Use Claude Code default model',
  },
];

type ClaudeCodeModel = {
  value: string;
  label: string;
  description?: string;
};

type ClaudeCodeSessionUpdate = {
  // We keep this intentionally loose because adapters differ slightly.
  models?: {
    availableModels?: Array<{ modelId: string; name?: string; description?: string }>;
    currentModelId?: string;
  };
};

function parseModelsFromSessionUpdate(params: any): ClaudeCodeModel[] {
  const p = params as ClaudeCodeSessionUpdate | undefined;

  const candidates =
    p?.models?.availableModels ??
    (params?.availableModels as Array<any> | undefined) ??
    (params?.models?.availableModels as Array<any> | undefined) ??
    [];

  const models: ClaudeCodeModel[] = [];
  for (const m of candidates) {
    const value = (m?.modelId || m?.id || m?.value || '').toString().trim();
    if (!value) continue;
    const label = (m?.name || m?.displayName || m?.label || value).toString().trim();
    const description = m?.description ? String(m.description) : undefined;
    models.push({ value, label, description });
  }

  return models;
}

async function listClaudeCodeModelsViaAcp(): Promise<ClaudeCodeModel[]> {
  // Return cached results if still valid to avoid spawning a new process
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached Claude Code models', { count: cachedModels.length });
    return cachedModels;
  }

  const resolved = await resolveClaudeCodeCommand();
  if (!resolved) return [];

  const args = [...resolved.argsPrefix];
  const command = resolved.command;

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: os.homedir(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let buffer = '';
    let requestId = 0;
    let done = false;

    const finish = (models: ClaudeCodeModel[]) => {
      if (done) return;
      done = true;
      // CRITICAL: Kill the entire process tree, not just the parent npx/npm-exec process.
      // child.kill() only sends SIGTERM to the direct child (npx), but the actual
      // claude-code-acp adapter runs as a grandchild and is left orphaned.
      // This was causing massive memory leaks (80GB+) from accumulated orphan processes.
      killChildProcessTree(child);
      // Cache successful results to avoid spawning processes on every call
      if (models.length > 0) {
        cachedModels = models;
        cacheTimestamp = Date.now();
      }
      resolve(models);
    };

    const timeoutId = setTimeout(() => {
      logger.warn('Timed out waiting for Claude Code models via ACP');
      finish([]);
    }, 12000);

    const sendRequest = (method: string, params?: any, timeoutMs: number = 8000) =>
      new Promise<any>((resolveRequest, rejectRequest) => {
        const id = ++requestId;
        const payload = { jsonrpc: '2.0', id, method, params };

        const perRequestTimeout = setTimeout(() => {
          rejectRequest(new Error(`Claude Code ACP request timed out: ${method}`));
        }, timeoutMs);

        const onLine = (line: string) => {
          try {
            const msg = JSON.parse(line);
            if (msg?.id === id) {
              clearTimeout(perRequestTimeout);
              child.stdout.off('data', onStdoutChunk as any);
              resolveRequest(msg);
            }
          } catch {
            // ignore
          }
        };

        const onStdoutChunk = (data: Buffer) => {
          const text = data.toString();
          for (const l of text.split('\n')) {
            const trimmed = l.trim();
            if (!trimmed) continue;
            onLine(trimmed);
          }
        };

        child.stdout.on('data', onStdoutChunk as any);

        try {
          child.stdin?.write(`${JSON.stringify(payload)}\n`);
        } catch (e) {
          clearTimeout(perRequestTimeout);
          rejectRequest(e as Error);
        }
      });

    child.stderr.on('data', (data: Buffer) => {
      const stderr = data.toString().trim();
      if (stderr) {
        logger.debug('Claude Code ACP stderr', { stderr });
      }
    });

    child.on('error', () => {
      clearTimeout(timeoutId);
      finish([]);
    });

    child.on('close', () => {
      clearTimeout(timeoutId);
      if (!done) finish([]);
    });

    const tryParseJsonLine = (line: string) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const msg = tryParseJsonLine(trimmed);
        if (!msg) continue;

        // Claude Code adapter publishes available models via a session update notification.
        // The method name varies across adapters; accept common variants.
        const method = String(msg.method || '');
        if (method === 'sessionUpdate' || method === 'session/update' || method === 'session/updateModels') {
          const models = parseModelsFromSessionUpdate(msg.params);
          if (models.length > 0) {
            clearTimeout(timeoutId);
            finish(models);
            return;
          }
        }

        // Some implementations may include models in the session/new result.
        if (msg?.result?.models?.availableModels) {
          const models = parseModelsFromSessionUpdate(msg.result);
          if (models.length > 0) {
            clearTimeout(timeoutId);
            finish(models);
            return;
          }
        }
      }
    });

    (async () => {
      try {
        await sendRequest('initialize', {
          protocolVersion: 1,
          clientInfo: { name: 'Intent', version: '1.0.0' },
        }, 4000);

        // Most adapters don't need authenticate; send session/new immediately.
        await sendRequest(
          'session/new',
          {
            cwd: os.homedir(),
            mcpServers: [],
            metadata: {
              workspaceId: 'local',
              userId: 'user',
              workspacePath: os.homedir(),
            },
          },
          8000,
        );
      } catch (e) {
        logger.debug('Claude Code ACP model probe failed', { error: (e as Error).message });
        clearTimeout(timeoutId);
        finish([]);
      }
    })();
  });
}

export function setupClaudeCodeIPC() {
  // Check if claude-code-acp is available
  ipcMain.handle(CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking claude-code-acp availability');
      const resolved = await resolveClaudeCodeCommand();
      const isAvailable = !!resolved;
      logger.info('Claude Code availability check', {
        isAvailable,
        command: resolved?.command,
        usesNpx: resolved?.usesNpx,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Claude Code not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Claude Code
  ipcMain.handle(CLAUDE_CODE_CHANNELS.GET_MODELS, async () => {
    try {
      const resolved = await resolveClaudeCodeCommand();
      if (!resolved) {
        return { success: true, data: [], warning: 'Claude Code not available' };
      }

      const models = await listClaudeCodeModelsViaAcp();
      if (models.length > 0) {
        return { success: true, data: models };
      }

      logger.info('Falling back to Claude Code default model list', {
        command: resolved.command,
        usesNpx: resolved.usesNpx,
      });
      return {
        success: true,
        data: DEFAULT_MODELS,
        warning: 'Claude Code model list unavailable; using default model',
      };
    } catch (error) {
      logger.warn('Could not get models for Claude Code', { error: (error as Error).message });
      return {
        success: true,
        data: DEFAULT_MODELS,
        warning: 'Failed to query Claude Code models; using default model',
      };
    }
  });
}
