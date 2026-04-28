/**
 * OpenCode IPC Handlers
 *
 * IPC handlers for OpenCode CLI integration
 */

import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { OPENCODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';

const logger = new Logger('OpenCodeIPC');

// Common paths to look for opencode
const OPENCODE_PATHS = [
  path.join(os.homedir(), '.opencode/bin/opencode'),
  '/usr/local/bin/opencode',
  '/usr/bin/opencode',
  '/opt/homebrew/bin/opencode',
  path.join(os.homedir(), '.local/bin/opencode'),
  path.join(os.homedir(), '.bun/bin/opencode'),
  path.join(os.homedir(), '.npm-global/bin/opencode'),
  // Windows paths
  ...(process.platform === 'win32'
    ? [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencode'),
        path.join(os.homedir(), 'AppData', 'Local', 'Volta', 'bin', 'opencode.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'opencode.exe'),
      ]
    : []),
];

let cachedOpencodePath: string | null = null;

// Model list cache — avoids re-shelling to `opencode models` on every call.
type OpencodeModel = { value: string; label: string; provider?: string };
let cachedOpencodeModels: OpencodeModel[] | null = null;
let opencodeModelCacheTimestamp = 0;
const OPENCODE_MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  const now = Date.now();
  if (cachedOpencodeModels && now - opencodeModelCacheTimestamp < OPENCODE_MODEL_CACHE_TTL_MS) {
    logger.debug('Returning cached opencode models', { count: cachedOpencodeModels.length });
    return cachedOpencodeModels;
  }
  try {
    const opencodePath = await findOpencodePath();
    logger.info('Getting models from opencode CLI', { opencodePath });
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

    cachedOpencodeModels = models;
    opencodeModelCacheTimestamp = Date.now();
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
 * Shares the module-level 5-minute TTL cache with the IPC handler.
 */
export async function getCachedOpencodeModels(): Promise<string[] | null> {
  const models = await getOpencodeModelsWithCache();
  if (!models) return null;
  return models.map((m) => m.value);
}

/**
 * Find the opencode executable path
 */
async function findOpencodePath(): Promise<string | null> {
  if (cachedOpencodePath) {
    return cachedOpencodePath;
  }

  const { existsSync } = await import('fs');

  for (const p of OPENCODE_PATHS) {
    if (existsSync(p)) {
      cachedOpencodePath = p;
      return p;
    }
  }

  // Fall back to just 'opencode' and hope it's in PATH
  return 'opencode';
}

/**
 * Execute an opencode command and return the output
 */
async function executeOpencodeCommand(
  args: string[],
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? 30000;
  const opencodePath = await findOpencodePath();

  return new Promise((resolve, reject) => {
    const enhancedEnv = {
      ...process.env,
      PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin:${path.join(os.homedir(), '.local/bin')}`,
    };

    // Debug: Log environment variables that might affect opencode behavior
    const envRecord = enhancedEnv as Record<string, string | undefined>;
    const envKeys = Object.keys(envRecord).filter(
      (k) =>
        k.startsWith('OPENCODE') ||
        k.startsWith('OPENAI') ||
        k.startsWith('ANTHROPIC') ||
        k.includes('API') ||
        k.includes('KEY') ||
        k === 'HOME' ||
        k === 'USER',
    );
    logger.debug('OpenCode execution environment', {
      opencodePath,
      args,
      relevantEnvVars: envKeys.reduce(
        (acc, k) => {
          // Mask API keys for security
          const val = envRecord[k] || '';
          acc[k] =
            val.length > 8 ? `${val.substring(0, 4)}...${val.substring(val.length - 4)}` : val;
          return acc;
        },
        {} as Record<string, string>,
      ),
    });

    // Run from user's home directory to ensure config files are found
    const cwd = os.homedir();

    // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
    const useShell = process.platform === 'win32';
    const rawCommand = opencodePath || 'opencode';
    // On Windows with shell: true, quote the command path to handle spaces (e.g. C:\Users\John Doe\...)
    const spawnCommand = useShell ? `"${rawCommand}"` : rawCommand;

    logger.debug('OpenCode spawn details', {
      opencodePath,
      cwd,
    });

    const child = spawn(spawnCommand, args, {
      env: enhancedEnv,
      cwd,
      shell: useShell,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Command exited with code ${code}`));
      }
    });

    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
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
