/**
 * Codex IPC Handlers
 *
 * IPC handlers for Codex ACP adapter integration.
 * Models are fetched dynamically via the ACP protocol when possible,
 * falling back to a static list.
 */

import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import * as os from 'os';
import {
  CODEX_REASONING_EFFORTS,
  getCodexModelList,
  supportedReasoningEfforts,
} from '../../../shared/config/open-ai-codex-models';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { killChildProcessTree } from '../../../shared/main/process-tree-kill';
import { resolveCodexCommand } from './codex-resolver';

const logger = new Logger('CodexIPC');

// Cache for model listing results to avoid spawning a new process on every call
type CodexModel = { value: string; label: string; description?: string };
let cachedModels: CodexModel[] | null = null;
let cacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Base models that get expanded into reasoning-effort variants */
const EFFORT_VARIANT_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

/**
 * Parse raw model entries from the ACP response into our UI model format.
 * Models in EFFORT_VARIANT_MODELS are expanded into {model}/{effort} variants.
 */
function parseModelsFromAcpResponse(raw: any): CodexModel[] {
  // Try multiple shapes the response might take
  const candidates: any[] =
    raw?.models?.available ??
    raw?.models?.availableModels ??
    (Array.isArray(raw?.models) ? raw.models : []);

  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const models: CodexModel[] = [];
  for (const m of candidates) {
    const modelId = (m?.modelId || m?.id || m?.value || '').toString().trim();
    if (!modelId) continue;
    const baseName = (m?.name || m?.displayName || m?.label || modelId).toString().trim();
    const baseDesc = m?.description ? String(m.description) : undefined;

    if (EFFORT_VARIANT_MODELS.has(modelId)) {
      for (const effort of supportedReasoningEfforts) {
        const effortMeta = CODEX_REASONING_EFFORTS[effort];
        const effortLabel = effort.charAt(0).toUpperCase() + effort.slice(1);
        models.push({
          value: `${modelId}/${effort}`,
          label: `${baseName} (${effortLabel})`,
          description: baseDesc
            ? `${baseDesc} — ${effortMeta.description.toLowerCase()}`
            : effortMeta.description,
        });
      }
    } else {
      models.push({ value: modelId, label: baseName, description: baseDesc });
    }
  }
  return models;
}

/**
 * Dynamically fetch available models from codex-acp.
 *
 * Spawns a short-lived codex-acp process, sends initialize + session/new,
 * and parses models from the session/new response (codex-acp returns models
 * in the response, not via a notification like Claude Code).
 */
async function listCodexModelsViaAcp(): Promise<CodexModel[]> {
  // Return cached results if still valid
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached Codex models', { count: cachedModels.length });
    return cachedModels;
  }

  const resolved = await resolveCodexCommand();
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

    let requestId = 0;
    let done = false;

    const finish = (models: CodexModel[]) => {
      if (done) return;
      done = true;
      // CRITICAL: Kill the entire process tree, not just the parent npx/npm-exec process.
      // child.kill() only sends SIGTERM to the direct child (npx), but the actual
      // codex-acp adapter runs as a grandchild and is left orphaned.
      killChildProcessTree(child);
      // Cache successful results
      if (models.length > 0) {
        cachedModels = models;
        cacheTimestamp = Date.now();
      }
      resolve(models);
    };

    const timeoutId = setTimeout(() => {
      logger.warn('Timed out waiting for Codex models via ACP');
      finish([]);
    }, 15000);

    const sendRequest = (method: string, params?: any, timeoutMs: number = 8000) =>
      new Promise<any>((resolveRequest, rejectRequest) => {
        const id = ++requestId;
        const payload = { jsonrpc: '2.0', id, method, params };

        const perRequestTimeout = setTimeout(() => {
          rejectRequest(new Error(`Codex ACP request timed out: ${method}`));
        }, timeoutMs);

        const onStdoutChunk = (data: Buffer) => {
          const text = data.toString();
          for (const l of text.split('\n')) {
            const trimmed = l.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg?.id === id) {
                clearTimeout(perRequestTimeout);
                child.stdout.off('data', onStdoutChunk as any);
                resolveRequest(msg);
              }
            } catch {
              // ignore non-JSON lines
            }
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
        logger.debug('Codex ACP stderr', { stderr });
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

    (async () => {
      try {
        await sendRequest(
          'initialize',
          {
            protocolVersion: 1,
            clientInfo: { name: 'Intent', version: '1.0.0' },
          },
          4000,
        );

        // codex-acp returns models in the session/new response directly
        const sessionResponse = await sendRequest(
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

        const models = parseModelsFromAcpResponse(sessionResponse?.result);
        if (models.length > 0) {
          clearTimeout(timeoutId);
          finish(models);
          return;
        }

        // If no models in the response, let the overall timeout handle it
        logger.debug('No models found in Codex ACP session/new response');
        clearTimeout(timeoutId);
        finish([]);
      } catch (e) {
        logger.debug('Codex ACP model probe failed', { error: (e as Error).message });
        clearTimeout(timeoutId);
        finish([]);
      }
    })();
  });
}

export function setupCodexIPC() {
  // Check if codex-acp is available
  ipcMain.handle(CODEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking codex-acp availability');
      const resolved = await resolveCodexCommand();
      const isAvailable = !!resolved;
      logger.info('Codex availability check', {
        isAvailable,
        command: resolved?.command,
        usesNpx: resolved?.usesNpx,
      });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('Codex not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models for Codex — try dynamic ACP listing first, fall back to static list
  ipcMain.handle(CODEX_CHANNELS.GET_MODELS, async () => {
    try {
      const resolved = await resolveCodexCommand();

      if (resolved) {
        const dynamicModels = await listCodexModelsViaAcp();
        if (dynamicModels.length > 0) {
          logger.info('Returning dynamic Codex model list', { count: dynamicModels.length });
          return { success: true, data: dynamicModels };
        }
      }

      // Fall back to static list when codex is not installed or ACP probe returned no models
      const staticModels = getCodexModelList();
      logger.info('Falling back to static Codex model list', { count: staticModels.length });
      return {
        success: true,
        data: staticModels,
        warning: resolved
          ? 'Codex ACP model list unavailable; using static model list'
          : 'Codex not installed; using static model list',
      };
    } catch (error) {
      logger.warn('Could not get models for Codex', { error: (error as Error).message });
      const staticModels = getCodexModelList();
      return {
        success: true,
        data: staticModels,
        warning: 'Failed to query Codex models; using static model list',
      };
    }
  });
}
