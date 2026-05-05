/**
 * Codex IPC Handlers
 *
 * IPC handlers for Codex ACP adapter integration.
 * Models are fetched dynamically via the ACP protocol when possible,
 * falling back to a static list.
 */

import { spawn } from 'child_process';
import { BrowserWindow, ipcMain } from 'electron';
import * as os from 'os';
import {
  CODEX_REASONING_EFFORTS,
  getCodexModelList,
  supportedReasoningEfforts,
} from '../../../shared/config/open-ai-codex-models';
import { CODEX_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { killChildProcessTree } from '../../../shared/main/process-tree-kill';
import {
  resolveCodexModelListCommands,
  type CodexResolvedModelListCommand,
} from './codex-resolver';
import { getManagedCodexAcpStatus, type ManagedCodexAcpStatus } from './codex-acp-manager';

const logger = new Logger('CodexIPC');

// Cache for model listing results to avoid spawning a new process on every call
export type CodexModel = { value: string; label: string; description?: string };
type CodexModelListSource = 'codex-acp';
type CodexModelListProbeResult = {
  models: CodexModel[];
  source: CodexModelListSource | null;
  attemptedSources: CodexResolvedModelListCommand['source'][];
};
type CodexManagedInstallState = 'not_installed' | 'installing' | 'installed' | 'failed' | 'unsupported';
type CodexManagedInstallStatusPayload = {
  managedInstallState: CodexManagedInstallState;
  version?: string;
  downloadProgress?: number;
  error?: string;
  usingFallback?: boolean;
};
let cachedModels: CodexModel[] | null = null;
let cacheTimestamp = 0;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Base models that get expanded into reasoning-effort variants */
const EFFORT_VARIANT_MODELS = new Set(['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max']);

function toManagedInstallStatusPayload(
  status: ManagedCodexAcpStatus,
  overrides: Partial<CodexManagedInstallStatusPayload> = {},
): CodexManagedInstallStatusPayload {
  const stateMap: Record<ManagedCodexAcpStatus['state'], CodexManagedInstallState> = {
    not_installed: 'not_installed',
    installing: 'installing',
    ready: 'installed',
    error: 'failed',
    unsupported: 'unsupported',
  };
  return {
    managedInstallState: stateMap[status.state],
    version: status.version,
    error: status.error,
    ...overrides,
  };
}

function sendManagedInstallEvent(
  channel: string,
  payload: CodexManagedInstallStatusPayload,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function publishManagedInstallStatus(
  overrides: Partial<CodexManagedInstallStatusPayload> = {},
): CodexManagedInstallStatusPayload {
  const payload = toManagedInstallStatusPayload(getManagedCodexAcpStatus(), overrides);
  sendManagedInstallEvent(CODEX_CHANNELS.MANAGED_INSTALL_STATUS, payload);
  return payload;
}

function publishManagedInstallProgress(
  payload: CodexManagedInstallStatusPayload,
): void {
  sendManagedInstallEvent(CODEX_CHANNELS.MANAGED_INSTALL_PROGRESS, payload);
}

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

function formatEffortLabel(effort: string): string {
  return effort
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

export function parseModelsFromCodexCliResponse(raw: unknown): CodexModel[] {
  let response = raw;
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response);
    } catch {
      return [];
    }
  }

  const payload = response && typeof response === 'object' && 'result' in response ? (response as any).result : response;
  const candidates: any[] = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray((payload as any)?.models)
      ? (payload as any).models
      : [];

  if (candidates.length === 0) return [];

  const models: CodexModel[] = [];
  for (const m of candidates) {
    if (m?.hidden === true) continue;

    const modelId = (m?.model || m?.id || m?.value || '').toString().trim();
    if (!modelId) continue;

    const baseName = (m?.displayName || m?.name || m?.label || modelId).toString().trim();
    const baseDesc = m?.description ? String(m.description) : undefined;
    const efforts = Array.isArray(m?.supportedReasoningEfforts)
      ? m.supportedReasoningEfforts
          .map((effort: any) => ({
            value: (effort?.reasoningEffort || effort?.effort || effort || '').toString().trim(),
            description: effort?.description ? String(effort.description) : undefined,
          }))
          .filter((effort: { value: string }) => effort.value.length > 0)
      : [];

    if (efforts.length > 0) {
      for (const effort of efforts) {
        models.push({
          value: `${modelId}/${effort.value}`,
          label: `${baseName} (${formatEffortLabel(effort.value)})`,
          description:
            baseDesc && effort.description ? `${baseDesc} — ${effort.description}` : baseDesc,
        });
      }
    } else {
      models.push({ value: modelId, label: baseName, description: baseDesc });
    }
  }

  return models;
}

function createJsonRpcRequester(child: ReturnType<typeof spawn>, label: string) {
  let requestId = 0;
  let stdoutBuffer = '';
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  const onStdoutChunk = (data: Buffer) => {
    stdoutBuffer += data.toString();
    let newlineIndex = stdoutBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf('\n');

      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        const request = pending.get(msg?.id);
        if (!request) continue;

        clearTimeout(request.timeout);
        pending.delete(msg.id);
        request.resolve(msg);
      } catch {
        logger.debug(`${label} emitted non-JSON stdout`, { line });
      }
    }
  };

  child.stdout?.on('data', onStdoutChunk as any);

  return {
    sendRequest(method: string, params?: any, timeoutMs: number = 8000) {
      return new Promise<any>((resolveRequest, rejectRequest) => {
        const id = ++requestId;
        const payload = { jsonrpc: '2.0', id, method, params };
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`${label} request timed out: ${method}`));
        }, timeoutMs);

        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });

        try {
          child.stdin?.write(`${JSON.stringify(payload)}\n`);
        } catch (e) {
          clearTimeout(timeout);
          pending.delete(id);
          rejectRequest(e as Error);
        }
      });
    },
    dispose() {
      child.stdout?.off('data', onStdoutChunk as any);
      for (const [id, request] of pending) {
        clearTimeout(request.timeout);
        pending.delete(id);
      }
    },
  };
}

function spawnCodexProbe(command: string, args: string[], env?: Record<string, string>) {
  // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
  const useShell = process.platform === 'win32';
  // On Windows with shell: true, quote the command path to handle spaces (e.g. C:\Users\John Doe\...)
  const spawnCommand = useShell ? `"${command}"` : command;

  return spawn(spawnCommand, args, {
    cwd: os.homedir(),
    env: { ...process.env, ...(env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true,
  });
}

async function probeCodexModelsViaAcp(
  resolved: CodexResolvedModelListCommand,
): Promise<CodexModel[]> {
  const child = spawnCodexProbe(resolved.command, resolved.argsPrefix, resolved.env);
  const rpc = createJsonRpcRequester(child, 'Codex ACP');

  return await new Promise((resolve) => {
    let done = false;

    const finish = (models: CodexModel[]) => {
      if (done) return;
      done = true;
      rpc.dispose();
      // CRITICAL: Kill the entire process tree, not just the parent npx/npm-exec process.
      // child.kill() only sends SIGTERM to the direct child (npx), but the actual
      // codex-acp adapter runs as a grandchild and is left orphaned.
      killChildProcessTree(child);
      resolve(models);
    };

    const timeoutId = setTimeout(() => {
      logger.warn('Timed out waiting for Codex models via ACP');
      finish([]);
    }, 15000);

    child.stderr?.on('data', (data: Buffer) => {
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
        await rpc.sendRequest(
          'initialize',
          {
            protocolVersion: 1,
            clientInfo: { name: 'Intent', version: '1.0.0' },
          },
          4000,
        );

        // codex-acp returns models in the session/new response directly
        const sessionResponse = await rpc.sendRequest(
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
        if (models.length === 0) {
          logger.debug('No models found in Codex ACP session/new response');
        }

        clearTimeout(timeoutId);
        finish(models);
      } catch (e) {
        logger.debug('Codex ACP model probe failed', { error: (e as Error).message });
        clearTimeout(timeoutId);
        finish([]);
      }
    })();
  });
}

/**
 * Dynamically fetch available models from codex-acp.
 */
async function listCodexModelsDynamically(): Promise<CodexModelListProbeResult> {
  // Return cached results if still valid
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached Codex models', { count: cachedModels.length });
    return { models: cachedModels, source: null, attemptedSources: [] };
  }

  const startingStatus = getManagedCodexAcpStatus();
  if (startingStatus.state !== 'ready' && startingStatus.state !== 'unsupported') {
    publishManagedInstallProgress(
      toManagedInstallStatusPayload(startingStatus, {
        managedInstallState: 'installing',
        downloadProgress: 0,
        usingFallback: false,
      }),
    );
  }

  const candidates = await resolveCodexModelListCommands();
  publishManagedInstallStatus({ downloadProgress: getManagedCodexAcpStatus().state === 'ready' ? 1 : undefined });
  const attemptedSources = candidates.map((candidate) => candidate.source);

  for (const candidate of candidates) {
    const source: CodexModelListSource = 'codex-acp';
    logger.info('Querying dynamic Codex model list', {
      source,
      command: candidate.command,
      usesNpx: candidate.usesNpx,
    });

    const models = await probeCodexModelsViaAcp(candidate);

    if (models.length > 0) {
      cachedModels = models;
      cacheTimestamp = Date.now();
      logger.info('Using dynamic Codex model list', { source, count: models.length });
      publishManagedInstallStatus({ downloadProgress: 1, usingFallback: false });
      return { models, source, attemptedSources };
    }
  }

  return { models: [], source: null, attemptedSources };
}

export function setupCodexIPC() {
  ipcMain.handle(CODEX_CHANNELS.MANAGED_INSTALL_STATUS, async () => ({
    success: true,
    data: toManagedInstallStatusPayload(getManagedCodexAcpStatus()),
  }));

  // Check if a Codex model-listing path is available
  ipcMain.handle(CODEX_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking Codex availability');
      const candidates = await resolveCodexModelListCommands();
      const isAvailable = candidates.length > 0;
      logger.info('Codex availability check', {
        isAvailable,
        sources: candidates.map((candidate) => candidate.source),
        command: candidates[0]?.command,
        usesNpx: candidates[0]?.usesNpx,
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
      const dynamicResult = await listCodexModelsDynamically();
      if (dynamicResult.models.length > 0) {
        logger.info('Returning dynamic Codex model list', {
          source: dynamicResult.source ?? 'cache',
          count: dynamicResult.models.length,
        });
        return { success: true, data: dynamicResult.models };
      }

      // Fall back to static list when codex is not installed or dynamic probes returned no models
      const staticModels = getCodexModelList();
      logger.info('Using static Codex model list', {
        source: 'static',
        attemptedSources: dynamicResult.attemptedSources,
        count: staticModels.length,
      });
      publishManagedInstallStatus({ usingFallback: true });
      return {
        success: true,
        data: staticModels,
        warning:
          dynamicResult.attemptedSources.length > 0
            ? 'Codex dynamic model list unavailable; using static model list'
            : 'Codex not installed; using static model list',
      };
    } catch (error) {
      logger.warn('Could not get models for Codex', { error: (error as Error).message });
      const staticModels = getCodexModelList();
      publishManagedInstallStatus({ usingFallback: true });
      return {
        success: true,
        data: staticModels,
        warning: 'Failed to query Codex models; using static model list',
      };
    }
  });
}

/**
 * Main-side accessor for the cached Codex model list.
 *
 * Returns the bare model IDs (the `value` field of each model entry, e.g.
 * `gpt-5.3-codex/high`) as `string[]`, falling back to the static list when
 * the live ACP probe returns empty. Returns `null` only on hard failure.
 *
 * Shares the module-level 5-minute TTL cache with the IPC handler.
 */
export async function getCachedCodexModels(): Promise<string[] | null> {
  try {
    const dynamic = await listCodexModelsDynamically();
    if (dynamic.models.length > 0) {
      return dynamic.models.map((m) => m.value);
    }

    const staticModels = getCodexModelList();
    if (staticModels.length === 0) return null;
    return staticModels.map((m) => m.value);
  } catch (error) {
    logger.debug('getCachedCodexModels failed', { error: (error as Error).message });
    return null;
  }
}
