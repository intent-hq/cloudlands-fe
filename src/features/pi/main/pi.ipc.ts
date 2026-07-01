/**
 * Pi IPC Handlers
 *
 * IPC handlers for the Pi ACP adapter integration.
 *
 * Pi exposes its model list through the ACP session (`models.availableModels`),
 * not via a CLI subcommand. So model listing spawns the `pi-acp` adapter,
 * performs a minimal ACP handshake (initialize + session/new), and reads the
 * available models from the session update / result — mirroring the Claude Code
 * model-listing path.
 */

import { ipcMain } from 'electron';
import * as os from 'os';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { spawn } from 'child_process';

/**
 * AUDIT-R1b: honest-degradation stub that stands in for the deleted
 * `child_process.spawn(...)` in listPiModelsViaAcp. Kept as a standalone
 * declaration (rather than an inline throwing IIFE) so TypeScript does not
 * narrow `child` to `never` at the call site — the enclosing Promise
 * executor still needs to type-check even though the sync throw makes it
 * unreachable at runtime.
 */
function throwR1bSpawnGap(): ChildProcessWithoutNullStreams {
  throw new Error(
    'Pi ACP model-list probe removed (AUDIT-R1b): FE spawn deleted; awaiting daemon-side ACP handshake seam.',
  );
}
import { PI_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { killChildProcessTree } from '../../../shared/main/process-tree-kill';
import {
  installPiMcpAdapter,
  isPiMcpAdapterInstalled,
  resolvePiCommand,
} from './pi-resolver';

const logger = new Logger('PiIPC');

// Cache for model listing results to avoid spawning a new process on every call
let cachedModels: PiModel[] | null = null;
let cacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_MODELS = [
  {
    value: 'default',
    label: 'Default (Pi)',
    description: 'Use Pi default model',
  },
];

type PiModel = {
  value: string;
  label: string;
  description?: string;
};

type PiSessionUpdate = {
  // We keep this intentionally loose because adapters differ slightly.
  models?: {
    availableModels?: Array<{ modelId: string; name?: string; description?: string }>;
    available?: Array<{ modelId: string; name?: string; description?: string }>;
    currentModelId?: string;
  };
  availableModels?: Array<{ modelId: string; name?: string; description?: string }>;
};

/**
 * Extract the raw availableModels array from any ACP session-update shape.
 *
 * Mirrors acp-provider.ts (~5715-5720): the payload may be the bare update,
 * or wrapped under `params.update` / `params.sessionUpdate`, and the model
 * list may live under `models.availableModels`, `availableModels`, or
 * `models.available`. This single helper normalizes all of those.
 */
export function extractAvailableModels(payload: any): Array<any> {
  const update = payload?.update ?? payload?.sessionUpdate ?? payload;
  const p = update as PiSessionUpdate | undefined;
  const candidates =
    p?.models?.availableModels ??
    p?.availableModels ??
    p?.models?.available ??
    [];
  return Array.isArray(candidates) ? candidates : [];
}

export function parseModelsFromSessionUpdate(params: any): PiModel[] {
  const candidates = extractAvailableModels(params);

  const models: PiModel[] = [];
  for (const m of candidates) {
    const value = (m?.modelId || m?.id || m?.value || '').toString().trim();
    if (!value) continue;
    const label = (m?.name || m?.displayName || m?.label || value).toString().trim();
    const description = m?.description ? String(m.description) : undefined;
    models.push({ value, label, description });
  }

  return models;
}

async function listPiModelsViaAcp(): Promise<PiModel[]> {
  // Return cached results if still valid to avoid spawning a new process
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached Pi models', { count: cachedModels.length });
    return cachedModels;
  }

  const resolved = await resolvePiCommand();
  if (!resolved) return [];

  const args = [...resolved.argsPrefix];
  const command = resolved.command;

  // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
  const useShell = process.platform === 'win32';
  // On Windows with shell: true, quote the command path to handle spaces (e.g. C:\Users\John Doe\...)
  const spawnCommand = useShell ? `"${command}"` : command;
  void spawnCommand;
  void args;

  // AUDIT-R1b: preserve the never-throws contract by catching the R1b probe
  // rejection at the outer boundary — the GET_MODELS handler and
  // getCachedPiModels both rely on this function resolving with `[]` on probe
  // failure so they can fall through to DEFAULT_MODELS (see AUDIT-P0-2).
  return await new Promise<PiModel[]>((resolve) => {
    // AUDIT-R1b: FE spawn deleted. The pi-acp probe requires a bidirectional
    // stdio JSON-RPC handshake (initialize + session/new) which the daemon's
    // `host.exec` (one-shot argv, no stdin) cannot host and which has no
    // dedicated seam today. Mirrors AUDIT-P2-12b's self-throwing IIFE pattern;
    // the enclosing `.catch(() => [])` converts the rejection back to the
    // pre-refactor empty-list resolution so callers stay on their fallback
    // paths (DEFAULT_MODELS).
    //
    // BE-GAP: needs a daemon-side `provider.listModelsViaAcp` (or equivalent)
    // that owns the ACP JSON-RPC handshake and returns models.
    const child = throwR1bSpawnGap();

    let buffer = '';
    let requestId = 0;
    let done = false;

    const finish = (models: PiModel[]) => {
      if (done) return;
      done = true;
      // CRITICAL: Kill the entire process tree, not just the parent npx/npm-exec process.
      // child.kill() only sends SIGTERM to the direct child (npx), but the actual
      // pi-acp adapter (and the `pi --mode rpc` engine it spawns) runs as a
      // grandchild and would be left orphaned, leaking memory.
      killChildProcessTree(child);
      // Cache successful results to avoid spawning processes on every call
      if (models.length > 0) {
        cachedModels = models;
        cacheTimestamp = Date.now();
      }
      resolve(models);
    };

    const timeoutId = setTimeout(() => {
      logger.warn('Timed out waiting for Pi models via ACP');
      finish([]);
    }, 12000);

    const sendRequest = (method: string, params?: any, timeoutMs: number = 8000) =>
      new Promise<any>((resolveRequest, rejectRequest) => {
        const id = ++requestId;
        const payload = { jsonrpc: '2.0', id, method, params };

        const perRequestTimeout = setTimeout(() => {
          rejectRequest(new Error(`Pi ACP request timed out: ${method}`));
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
        logger.debug('Pi ACP stderr', { stderr });
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

        // The adapter publishes available models via a session update notification.
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
        if (msg?.result) {
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
        logger.debug('Pi ACP model probe failed', { error: (e as Error).message });
        clearTimeout(timeoutId);
        finish([]);
      }
    })();
  }).catch((error) => {
    // AUDIT-R1b: the retired FE spawn now throws synchronously in the Promise
    // executor. Convert that rejection back to the pre-refactor empty-list
    // resolution so callers stay on their DEFAULT_MODELS fallback path.
    logger.debug('Pi ACP model probe seam unavailable', {
      error: (error as Error).message,
    });
    return [] as PiModel[];
  });
}

export function setupPiIPC() {
  ipcMain.handle(PI_CHANNELS.CHECK_MCP_ADAPTER, async () => isPiMcpAdapterInstalled());

  ipcMain.handle(PI_CHANNELS.INSTALL_MCP_ADAPTER, async () => installPiMcpAdapter());

  // Get available models for Pi
  ipcMain.handle(PI_CHANNELS.GET_MODELS, async () => {
    try {
      const resolved = await resolvePiCommand();
      if (!resolved) {
        return {
          success: true,
          data: DEFAULT_MODELS,
          warning: 'Pi command unavailable; using default model',
        };
      }

      const models = await listPiModelsViaAcp();
      if (models.length > 0) {
        return { success: true, data: models };
      }

      logger.info('Falling back to Pi default model list', {
        command: resolved.command,
        usesNpx: resolved.usesNpx,
      });
      return {
        success: true,
        data: DEFAULT_MODELS,
        warning: 'Pi model list unavailable; using default model',
      };
    } catch (error) {
      // Surface the failure to the renderer (AUDIT-P0-2). Previously this
      // returned `success: true` with DEFAULT_MODELS + a warning, which hid
      // hard probe failures from the FE error state.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Could not get models for Pi', { error: message });
      return {
        success: false,
        error: `Failed to query Pi models: ${message}`,
      };
    }
  });
}

/**
 * Main-side accessor for the cached Pi model list.
 *
 * Returns the bare model IDs (the `value` field of each model entry) as
 * `string[]`, or `null` if the live list is unavailable (Pi/`pi-acp` not
 * installed or probe failed). Used by the model-override validator so it can
 * check overrides against the provider's real model set without going through
 * the IPC layer.
 *
 * Shares the module-level 5-minute TTL cache with the IPC handler.
 */
export async function getCachedPiModels(): Promise<string[] | null> {
  // AUDIT-P0-2: do not swallow errors here. Returning `null` is reserved for
  // the documented "live list unavailable" sentinel — `resolvePiCommand()`
  // returning null (Pi not installed) or the probe yielding zero results.
  // A genuine error must propagate so the dispatcher in `model-pool.ts` can
  // log it instead of being masked as "unknown / skip validation".
  const resolved = await resolvePiCommand();
  if (!resolved) return null;
  const models = await listPiModelsViaAcp();
  if (models.length === 0) return null;
  // Merge the curated DEFAULT_MODELS aliases (notably `default`) into the
  // live list so validators treat them as valid overrides even when the
  // ACP probe does not emit them. De-duplicated in case the live list
  // eventually begins reporting one of the aliases.
  const liveValues = models.map((m) => m.value);
  const defaultValues = DEFAULT_MODELS.map((m) => m.value);
  return Array.from(new Set([...liveValues, ...defaultValues]));
}
