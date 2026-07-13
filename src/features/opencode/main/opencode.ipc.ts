/**
 * OpenCode IPC Handlers
 *
 * IPC handlers for OpenCode CLI integration
 */

import { ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { OPENCODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { createProviderModelCache } from '../../../main/utils/provider-model-cache';
import { hostExec } from '../../../shared/main/host-exec';
import { resolveOpenCodeCommand } from './opencode-resolver';

const logger = new Logger('OpenCodeIPC');

// Model list cache — avoids re-shelling to `opencode models` on every call.
type OpencodeModel = { value: string; label: string; provider?: string };
const opencodeModelCache = createProviderModelCache<OpencodeModel>({
  providerId: 'opencode',
  fetch: () => fetchOpencodeModels(),
});

// Optional hidden provider prefixes (e.g., "bedrock", "meta") to filter noisy entries.
// Controlled via OPENCODE_HIDDEN_PROVIDERS env var; by default, show everything.
function getHiddenProviders(): Set<string> {
  const envValue = process.env.OPENCODE_HIDDEN_PROVIDERS;
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Internal: fetch (or return cached) opencode model list.
 * Returns `null` on hard failure (spawn error, parse error). Successful
 * empty results (no credentialed providers) cache as `[]`.
 */
async function getOpencodeModelsWithCache(): Promise<OpencodeModel[] | null> {
  return await opencodeModelCache.get();
}

export async function hydrateOpencodeModelCacheFromDisk(): Promise<void> {
  await opencodeModelCache.hydrateFromDisk();
}

async function fetchOpencodeModels(): Promise<OpencodeModel[] | null> {
  try {
    const { stdout, stderr } = await executeOpencodeCommand(['models', '--log-level', 'DEBUG'], {
      timeout: 10000,
    });
    if (stderr) {
      logger.warn('OpenCode stderr output', { stderr });
    }

    // Debug file write (enabled via OPENCODE_DEBUG_FILE env var)
    if (process.env.OPENCODE_DEBUG_FILE) {
      const fs = await import('fs');
      const debugPath = path.join(os.homedir(), 'opencode-models-debug.txt');
      fs.writeFileSync(debugPath, JSON.stringify({ stdout, stderr }, null, 2));
      logger.info(`Debug output written to ${debugPath}`);
    }

    const hiddenProviders = getHiddenProviders();
    const models: OpencodeModel[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.includes('/')) {
        const [provider, ...modelParts] = trimmed.split('/');
        if (hiddenProviders.has(provider)) continue;
        const modelId = modelParts.join('/');
        const label = formatModelLabel(provider, modelId);
        models.push({ value: trimmed, label, provider });
      }
    }

    return models;
  } catch (error) {
    logger.warn('Could not get models from opencode CLI', { error: (error as Error).message });
    return null;
  }
}

/**
 * Main-side accessor for the cached OpenCode model list.
 *
 * Returns bare model value strings (e.g. `openai/gpt-5.2`,
 * `anthropic/claude-sonnet-4`) or `null` when the live list is unavailable.
 * Shares the central 5-minute TTL provider model cache with the IPC handler.
 */
export async function getCachedOpencodeModels(): Promise<string[] | null> {
  const models = await getOpencodeModelsWithCache();
  if (!models) return null;
  return models.map((m) => m.value);
}

/**
 * Execute an opencode command via the daemon's `host.exec` seam (PROTOCOL §5.14).
 * Routing here (AUDIT-R1b) replaces the previous local `spawn(...)` — the daemon
 * owns argv-based one-shot exec on the workspace's target host and returns
 * captured stdout/stderr/exit code. Rejects with the RPC error on transport
 * failure; a non-zero exit is surfaced by rejecting with a stderr-derived
 * message, matching the pre-refactor contract observed by callers.
 */
async function executeOpencodeCommand(
  args: string[],
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? 30000;
  const resolved = await resolveOpenCodeCommand();
  if (!resolved) {
    throw new Error('opencode binary not available (host.findBinary returned no result)');
  }

  // Run from user's home directory to ensure config files are found.
  const cwd = os.homedir();

  logger.debug('OpenCode host.exec details', {
    opencodePath: resolved.command,
    usesNpx: resolved.usesNpx,
    cwd,
    args,
  });

  const result = await hostExec(resolved.command, {
    args: [...resolved.argsPrefix, ...args],
    cwd,
    timeoutMs: timeout,
  });

  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeout}ms`);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Command exited with code ${result.exitCode}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export function setupOpencodeIPC() {
  // Check if opencode is available
  ipcMain.handle(OPENCODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking opencode availability');
      const { stdout } = await executeOpencodeCommand(['--version'], { timeout: 5000 });
      const isAvailable = stdout.length > 0;
      logger.info('OpenCode availability check', { isAvailable, stdout: stdout.trim() });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('OpenCode not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models from opencode. Caching + parsing live in
  // getOpencodeModelsWithCache() at module scope so that the main-side
  // model-override validator can reuse the same cache without re-shelling.
  ipcMain.handle(OPENCODE_CHANNELS.GET_MODELS, async () => {
    const models = await getOpencodeModelsWithCache();
    if (models === null) {
      return {
        success: false,
        error: 'Failed to query opencode CLI for models',
        data: [],
      };
    }
    if (models.length > 0) {
      logger.info(`Returning ${models.length} models from opencode`, {
        modelValues: models.map((m) => m.value),
      });
      return { success: true, data: models };
    }
    logger.warn('OpenCode models command returned no models');
    return { success: true, data: [], warning: 'No models found' };
  });
}

/**
 * Format a model label for display
 */
function formatModelLabel(provider: string, modelId: string): string {
  // Capitalize provider name
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  // Clean up model ID for display
  const modelLabel = modelId.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  return `${providerLabel} ${modelLabel}`;
}
