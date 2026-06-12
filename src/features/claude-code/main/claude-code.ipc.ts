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
import { createProviderModelCache } from '../../../main/utils/provider-model-cache';

const logger = new Logger('ClaudeCodeIPC');

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

// Cache for model listing results to avoid spawning a new process on every call
const claudeCodeModelCache = createProviderModelCache<ClaudeCodeModel>({
  providerId: 'claude-code',
  // Must never throw: failures resolve to null so the cache only stores
  // successful, non-empty probe results.
  fetch: async () => {
    try {
      const models = await fetchClaudeCodeModelsViaAcp();
      return models.length > 0 ? models : null;
    } catch (error) {
      logger.debug('Claude Code model fetch failed', { error: (error as Error).message });
      return null;
    }
  },
});

async function listClaudeCodeModelsViaAcp(): Promise<ClaudeCodeModel[]> {
  return (await claudeCodeModelCache.get()) ?? [];
}

export async function hydrateClaudeCodeModelCacheFromDisk(): Promise<void> {
  await claudeCodeModelCache.hydrateFromDisk();
}

async function fetchClaudeCodeModelsViaAcp(): Promise<ClaudeCodeModel[]> {
  const resolved = await resolveClaudeCodeCommand();
  if (!resolved) return [];

  const args = [...resolved.argsPrefix];
  const command = resolved.command;

  // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
  const useShell = process.platform === 'win32';
  // On Windows with shell: true, quote the command path to handle spaces (e.g. C:\Users\John Doe\...)
  const spawnCommand = useShell ? `"${command}"` : command;

  return await new Promise((resolve) => {
    const child = spawn(spawnCommand, args, {
      cwd: os.homedir(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: useShell,
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
      // claude-agent-acp adapter runs as a grandchild and is left orphaned.
      // This was causing massive memory leaks (80GB+) from accumulated orphan processes.
      killChildProcessTree(child);
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
  // Check if claude-agent-acp is available
  ipcMain.handle(CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking claude-agent-acp availability');
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
      const models = await listClaudeCodeModelsViaAcp();
      if (models.length > 0) {
        return { success: true, data: models };
      }

      const resolved = await resolveClaudeCodeCommand();
      if (!resolved) {
        return { success: true, data: [], warning: 'Claude Code not available' };
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

/**
 * Main-side accessor for the cached Claude Code model list.
 *
 * Returns the bare model IDs (the `value` field of each model entry) as
 * `string[]`, or `null` if the live list is unavailable (Claude Code CLI not
 * installed or probe failed). Used by the model-override validator so it can
 * check overrides against the provider's real model set without going through
 * the IPC layer.
 *
 * Shares the central provider model cache (5-minute TTL) with the IPC handler.
 */
export async function getCachedClaudeCodeModels(): Promise<string[] | null> {
  try {
    const models = await listClaudeCodeModelsViaAcp();
    if (models.length === 0) return null;
    // Merge the curated DEFAULT_MODELS aliases (notably `default`) into the
    // live list so validators treat them as valid overrides even when the
    // ACP probe does not emit them. De-duplicated in case the live list
    // eventually begins reporting one of the aliases.
    const liveValues = models.map((m) => m.value);
    const defaultValues = DEFAULT_MODELS.map((m) => m.value);
    return Array.from(new Set([...liveValues, ...defaultValues]));
  } catch (error) {
    logger.debug('getCachedClaudeCodeModels failed', { error: (error as Error).message });
    return null;
  }
}
