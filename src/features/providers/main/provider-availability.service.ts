/**
 * Provider Availability Service
 *
 * Aggregates availability status from all ACP providers (auggie, claude-code, codex)
 * to determine if the user has any available provider at startup.
 */

import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import { ACP_PROVIDERS } from '../../../shared/config/provider-config';
import { Logger } from '../../../shared/logger';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';
import { findAuggiePathAsync } from '../../auggie/main/auggie.ipc';
import {
  clearClaudeCodeCache,
  getClaudeCodePath,
  isClaudeCodeInstalled,
} from '../../claude-code/main/claude-code-resolver';
import {
  clearCodexCache,
  getCodexPath,
  isCodexInstalled,
} from '../../codex/main/codex-resolver';
import {
  clearCortexCache,
  getCortexPath,
  isCortexInstalled,
} from '../../cortex/main/cortex-resolver';
import {
  clearOpenCodeCache,
  getOpenCodePath,
  isOpenCodeInstalled,
} from '../../opencode/main/opencode-resolver';
import {
  clearDroidCache,
  getDroidPath,
  isDroidInstalled,
} from '../../droid/main/droid-resolver';
import { probeDroidAcp } from '../../droid/main/droid-acp-probe';
import type {
  ProviderAvailabilityResult,
  ProviderStatus,
} from '$shared/types/provider-availability';

export type { ProviderAvailabilityResult, ProviderStatus };

const logger = new Logger('ProviderAvailability');

/**
 * Check if auggie is available by checking for saved path or session
 * This is a lightweight check that doesn't spawn processes
 */
async function checkAuggieAvailability(): Promise<ProviderStatus> {
  // Helper to check if a path exists without throwing
  const pathExists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  try {
    const homeDir = os.homedir();

    // Check for saved auggie path (fastest check)
    const savedPathFile = path.join(homeDir, '.augment', 'auggie-path');
    try {
      const savedPath = (await fs.readFile(savedPathFile, 'utf8')).trim();
      if (savedPath && (await pathExists(savedPath))) {
        return { available: true };
      }
    } catch {
      // File doesn't exist or can't be read
    }

    // Check for auggie session file (indicates auggie was used before)
    const sessionPath = path.join(homeDir, '.augment', 'session.json');
    if (await pathExists(sessionPath)) {
      // Session exists, auggie was likely installed and used
      return { available: true };
    }

    // Check common auggie installation paths (comprehensive list matching async-utils.ts)
    const commonPaths =
      process.platform === 'win32'
        ? [
          path.join(process.env.APPDATA || '', 'npm', 'auggie.cmd'),
          path.join(process.env.APPDATA || '', 'npm', 'auggie'),
          path.join(process.env.LOCALAPPDATA || '', 'npm', 'auggie.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'npm', 'auggie'),
          path.join(process.env.APPDATA || '', 'nvm', 'auggie.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'Volta', 'bin', 'auggie.exe'),
        ]
        : [
          '/usr/local/bin/auggie',
          '/usr/bin/auggie',
          '/opt/homebrew/bin/auggie',
          path.join(homeDir, '.npm-global', 'bin', 'auggie'),
          path.join(homeDir, '.npm-packages', 'bin', 'auggie'),
          path.join(homeDir, '.local', 'bin', 'auggie'),
          path.join(homeDir, 'npm', 'bin', 'auggie'),
          path.join(homeDir, '.volta', 'bin', 'auggie'),
          path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', 'auggie'),
          path.join(homeDir, '.asdf', 'shims', 'auggie'),
          path.join(homeDir, 'n', 'bin', 'auggie'),
          '/usr/local/n/bin/auggie',
          '/usr/local/opt/node/bin/auggie',
          '/opt/homebrew/opt/node/bin/auggie',
        ];

    for (const p of commonPaths) {
      if (p && (await pathExists(p))) {
        return { available: true };
      }
    }

    // Dynamically scan nvm directories (file system only, no process spawning)
    try {
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
      const nodeDirs = (await fs.readdir(nvmDir)).filter((d) => d.startsWith('v'));
      for (const dir of nodeDirs) {
        const auggiePath = path.join(nvmDir, dir, 'bin', 'auggie');
        if (await pathExists(auggiePath)) {
          return { available: true };
        }
      }
    } catch {
      // nvm directory doesn't exist or can't be read
    }

    // Dynamically scan fnm directories
    try {
      const fnmDir = path.join(homeDir, '.fnm', 'node-versions');
      const nodeDirs = await fs.readdir(fnmDir);
      for (const dir of nodeDirs) {
        const auggiePath = path.join(fnmDir, dir, 'installation', 'bin', 'auggie');
        if (await pathExists(auggiePath)) {
          return { available: true };
        }
      }
    } catch {
      // fnm directory doesn't exist or can't be read
    }

    return { available: false };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if claude-code is available by checking if the claude CLI is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkClaudeCodeAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isClaudeCodeInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if codex is available by checking if codex-acp is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCodexAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isCodexInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if cortex is available by checking if cortex is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCortexAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isCortexInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if opencode is available by checking if opencode is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkOpenCodeAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isOpenCodeInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if droid is available by checking if the droid CLI is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkDroidAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isDroidInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if the mock ACP agent is available for test runs.
 */
async function checkMockAvailability(): Promise<ProviderStatus> {
  if (process.env.TESTING !== 'true') {
    return { available: false, error: 'Mock provider requires TESTING=true' };
  }
  const scriptPath = process.env.MOCK_AGENT_SCRIPT_PATH;
  if (!scriptPath) {
    return { available: false, error: 'MOCK_AGENT_SCRIPT_PATH not set' };
  }

  try {
    await fs.access(scriptPath);
    // Mock provider is always authenticated when available — no login required
    return { available: true, authenticated: true };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/** Auth check timeout in ms */
const AUTH_CHECK_TIMEOUT_MS = 5000;

async function checkAuggieAuth(cliPath: string | null): Promise<boolean | undefined> {
  if (!cliPath) return undefined;

  return new Promise((resolve) => {
    try {
      let settled = false;
      const settle = (value: boolean | undefined) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      const child = spawn(cliPath, ['model', 'list'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: AUTH_CHECK_TIMEOUT_MS,
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may have already exited
        }
        settle(undefined);
      }, AUTH_CHECK_TIMEOUT_MS);

      child.on('error', () => {
        clearTimeout(timeoutId);
        settle(undefined);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const output = `${stdout}\n${stderr}`;
        const isUnauthenticated =
          /not currently logged in|not logged in|not authenticated|login required|please log in/i.test(
            output,
          );
        if (isUnauthenticated) {
          settle(false);
          return;
        }
        if (code === 0) {
          settle(true);
          return;
        }
        settle(undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * OpenCode has no single "am I logged in" signal: credentials may come from
 * `opencode auth login`, env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, AWS_PROFILE, etc.),
 * or a project .env file. `opencode models` is the readiness gate — it returns
 * a non-empty list of `provider/model` lines only when at least one provider
 * is credentialed from any of those sources.
 *
 * Timeout matches the existing OPENCODE_CHANNELS.GET_MODELS IPC (10s), since
 * `opencode models` can be slower than a simple auth file read.
 */
const OPENCODE_READY_TIMEOUT_MS = 10000;

async function checkOpenCodeReady(cliPath: string | null): Promise<boolean | undefined> {
  if (!cliPath) return undefined;

  return new Promise((resolve) => {
    try {
      let settled = false;
      const settle = (value: boolean | undefined) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      const child = spawn(cliPath, ['models'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: OPENCODE_READY_TIMEOUT_MS,
      });

      let stdout = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      // Drain stderr to prevent backpressure from blocking the process
      child.stderr.resume();

      const timeoutId = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may have already exited
        }
        settle(undefined);
      }, OPENCODE_READY_TIMEOUT_MS);

      child.on('error', () => {
        clearTimeout(timeoutId);
        settle(undefined);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        // code is null when terminated by signal — treat as unknown
        if (code === null) {
          settle(undefined);
          return;
        }
        if (code !== 0) {
          settle(false);
          return;
        }
        // Ready iff at least one line matches the `provider/model` format
        const hasModel = stdout.split('\n').some((line) => {
          const trimmed = line.trim();
          return trimmed.length > 0 && trimmed.includes('/') && !trimmed.startsWith('#');
        });
        settle(hasModel);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Droid has no `models`/`auth status` CLI subcommand, so readiness is gauged
 * via an ACP probe (initialize + session/new over stdio JSON-RPC):
 * - session/new succeeding with a non-empty model list → authenticated
 * - an explicit auth-required error from the agent → not authenticated
 * - timeout/spawn error → undefined (unknown, no indicator)
 */
async function checkDroidReady(cliPath: string | null): Promise<boolean | undefined> {
  if (!cliPath) return undefined;

  try {
    const result = await probeDroidAcp(cliPath);
    if (result.ok && result.models.length > 0) {
      return true;
    }
    if (result.authRequired) {
      return false;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if a provider's CLI is authenticated by running its auth check command.
 * Returns true if authenticated, false if not, undefined if check failed/timed out.
 *
 * @param requireNonEmptyOutput - If true, also requires non-empty stdout.
 * @param validateOutput - Optional custom validator for stdout. Overrides requireNonEmptyOutput.
 */
async function checkProviderAuth(
  cliPath: string | null,
  authCheckArgs: string[],
  requireNonEmptyOutput = false,
  validateOutput?: (stdout: string) => boolean,
): Promise<boolean | undefined> {
  if (!cliPath || authCheckArgs.length === 0) {
    return undefined;
  }

  return new Promise((resolve) => {
    try {
      let settled = false;
      const settle = (value: boolean | undefined) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      // On Windows, .cmd/.bat files need shell: true to be executed via spawn.
      const useShell = process.platform === 'win32';
      // On Windows with shell: true, quote the command path to handle spaces (e.g. C:\Users\John Doe\...)
      const spawnCommand = useShell ? `"${cliPath}"` : cliPath;

      const child = spawn(spawnCommand, authCheckArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: AUTH_CHECK_TIMEOUT_MS,
        shell: useShell,
      });

      let stdout = '';
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      // Drain stderr to prevent backpressure from blocking the process
      child.stderr.resume();

      const timeoutId = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may have already exited
        }
        settle(undefined);
      }, AUTH_CHECK_TIMEOUT_MS);

      child.on('error', () => {
        clearTimeout(timeoutId);
        settle(undefined);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        // code is null when terminated by signal — treat as unknown, not unauthenticated
        if (code === null) {
          settle(undefined);
          return;
        }
        if (code !== 0) {
          settle(false);
          return;
        }

        if (validateOutput) {
          settle(validateOutput(stdout));
        } else if (requireNonEmptyOutput) {
          settle(stdout.trim().length > 0);
        } else {
          settle(true);
        }
      });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Get aggregated availability status for all providers
 */
export async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  logger.info('Checking all provider availability');

  // Determine which providers are hidden due to missing env vars or feature codes
  const hiddenProviders: string[] = [];
  for (const [providerId, config] of Object.entries(ACP_PROVIDERS)) {
    // Check legacy env var gating
    if (config.requiresEnvVar && !process.env[config.requiresEnvVar]) {
      hiddenProviders.push(providerId);
      continue;
    }
    // Check feature code gating
    if (
      config.requiresFeatureCode &&
      !featureCodesService.isFeatureEnabled(config.requiresFeatureCode)
    ) {
      hiddenProviders.push(providerId);
    }
  }

  if (hiddenProviders.length > 0) {
    logger.info('Providers hidden due to missing env vars or feature codes', { hiddenProviders });
  }

  // Clear caches to ensure fresh detection (important for refresh button)
  clearClaudeCodeCache();
  clearCodexCache();
  clearCortexCache();
  clearOpenCodeCache();
  clearDroidCache();

  // Check all providers in parallel for faster startup
  // For hidden providers, skip the actual check and return unavailable
  const isCortexHidden = hiddenProviders.includes('cortex');
  const isMockHidden = hiddenProviders.includes('mock');
  const [
    auggieResult,
    claudeCodeResult,
    codexResult,
    cortexResult,
    mockResult,
    opencodeResult,
    droidResult,
  ] = await Promise.all([
    checkAuggieAvailability(),
    checkClaudeCodeAvailability(),
    checkCodexAvailability(),
    isCortexHidden
      ? Promise.resolve({ available: false } as ProviderStatus)
      : checkCortexAvailability(),
    isMockHidden
      ? Promise.resolve({ available: false } as ProviderStatus)
      : checkMockAvailability(),
    checkOpenCodeAvailability(),
    checkDroidAvailability(),
  ]);

  // Run auth checks in parallel for available providers.
  // Auggie uses `model list`; model listing is the stable auth gate.
  if (
    auggieResult.available ||
    claudeCodeResult.available ||
    codexResult.available ||
    opencodeResult.available ||
    droidResult.available
  ) {
    const [auggiePath, claudeCodePath, codexPath, opencodePath, droidPath] = await Promise.all([
      auggieResult.available ? findAuggiePathAsync() : Promise.resolve(null),
      claudeCodeResult.available ? getClaudeCodePath() : Promise.resolve(null),
      codexResult.available ? getCodexPath() : Promise.resolve(null),
      opencodeResult.available ? getOpenCodePath() : Promise.resolve(null),
      droidResult.available ? getDroidPath() : Promise.resolve(null),
    ]);

    const [auggieAuth, claudeAuth, codexAuth, opencodeAuth, droidAuth] = await Promise.all([
      auggieResult.available ? checkAuggieAuth(auggiePath) : Promise.resolve(undefined),
      claudeCodeResult.available
        ? checkProviderAuth(claudeCodePath, ACP_PROVIDERS['claude-code'].authCheckArgs ?? [])
        : Promise.resolve(undefined),
      codexResult.available
        ? checkProviderAuth(codexPath, ACP_PROVIDERS.codex.authCheckArgs ?? [])
        : Promise.resolve(undefined),
      // OpenCode has no stable `am I logged in?` signal — credentials can come
      // from auth.json, env vars, or a project .env. `opencode models` is the
      // readiness gate: it returns at least one `provider/model` line only when
      // some provider is usable. On failure we return undefined (no indicator).
      opencodeResult.available ? checkOpenCodeReady(opencodePath) : Promise.resolve(undefined),
      // Droid has no auth CLI subcommand — the ACP probe is the readiness gate.
      droidResult.available ? checkDroidReady(droidPath) : Promise.resolve(undefined),
    ]);

    auggieResult.authenticated = auggieAuth;
    claudeCodeResult.authenticated = claudeAuth;
    codexResult.authenticated = codexAuth;
    opencodeResult.authenticated = opencodeAuth;
    droidResult.authenticated = droidAuth;
  }

  const result: ProviderAvailabilityResult = {
    hasAnyProvider:
      auggieResult.available ||
      claudeCodeResult.available ||
      codexResult.available ||
      cortexResult.available ||
      mockResult.available ||
      opencodeResult.available ||
      droidResult.available,
    providers: {
      auggie: auggieResult,
      claudeCode: claudeCodeResult,
      codex: codexResult,
      cortex: cortexResult,
      mock: mockResult,
      opencode: opencodeResult,
      droid: droidResult,
    },
    hiddenProviders,
  };

  logger.info('Provider availability check complete', {
    hasAnyProvider: result.hasAnyProvider,
    auggie: auggieResult.available,
    claudeCode: claudeCodeResult.available,
    codex: codexResult.available,
    cortex: cortexResult.available,
    mock: mockResult.available,
    opencode: opencodeResult.available,
    droid: droidResult.available,
    auggieAuth: auggieResult.authenticated,
    claudeCodeAuth: claudeCodeResult.authenticated,
    codexAuth: codexResult.authenticated,
    opencodeAuth: opencodeResult.authenticated,
    droidAuth: droidResult.authenticated,
    hiddenProviders,
  });

  return result;
}

/**
 * Get resolved CLI paths for all providers
 */
export async function getProviderPaths(): Promise<{
  auggie: string | null;
  'claude-code': string | null;
  codex: string | null;
  cortex: string | null;
  opencode: string | null;
  droid: string | null;
}> {
  const [auggiePath, claudeCodePath, codexPath, cortexPath, opencodePath, droidPath] =
    await Promise.all([
      findAuggiePathAsync(),
      getClaudeCodePath(),
      getCodexPath(),
      getCortexPath(),
      getOpenCodePath(),
      getDroidPath(),
    ]);

  return {
    auggie: auggiePath,
    'claude-code': claudeCodePath,
    codex: codexPath,
    cortex: cortexPath,
    opencode: opencodePath,
    droid: droidPath,
  };
}

/**
 * Setup IPC handlers for provider availability
 */
export function setupProviderAvailabilityIPC(): void {
  ipcMain.handle(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => {
    try {
      const result = await getProviderAvailability();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Failed to get provider availability', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  ipcMain.handle(
    PROVIDERS_CHANNELS.CHECK_SINGLE,
    async (
      _event: Electron.IpcMainInvokeEvent,
      request: string | { providerId: string },
    ) => {
      const providerId = typeof request === 'string' ? request : request.providerId;
      try {
        let status: ProviderStatus;
        let authenticated: boolean | undefined;

        switch (providerId) {
          case 'auggie':
            status = await checkAuggieAvailability();
            if (status.available) {
              const auggiePath = await findAuggiePathAsync();
              authenticated = await checkAuggieAuth(auggiePath);
            }
            break;
          case 'claude-code':
            clearClaudeCodeCache();
            status = await checkClaudeCodeAvailability();
            if (status.available) {
              const claudePath = await getClaudeCodePath();
              authenticated = await checkProviderAuth(
                claudePath,
                ACP_PROVIDERS['claude-code'].authCheckArgs ?? [],
              );
            }
            break;
          case 'codex':
            clearCodexCache();
            status = await checkCodexAvailability();
            if (status.available) {
              const codexPath = await getCodexPath();
              authenticated = await checkProviderAuth(
                codexPath,
                ACP_PROVIDERS.codex.authCheckArgs ?? [],
              );
            }
            break;
          case 'cortex': {
            const isHidden =
              ACP_PROVIDERS.cortex.requiresFeatureCode &&
              !featureCodesService.isFeatureEnabled(ACP_PROVIDERS.cortex.requiresFeatureCode);
            if (isHidden) {
              status = { available: false };
            } else {
              clearCortexCache();
              status = await checkCortexAvailability();
            }
            break;
          }
          case 'opencode':
            clearOpenCodeCache();
            status = await checkOpenCodeAvailability();
            if (status.available) {
              const opencodePath = await getOpenCodePath();
              authenticated = await checkOpenCodeReady(opencodePath);
            }
            break;
          case 'droid':
            clearDroidCache();
            status = await checkDroidAvailability();
            if (status.available) {
              const droidPath = await getDroidPath();
              authenticated = await checkDroidReady(droidPath);
            }
            break;
          case 'mock':
            status = await checkMockAvailability();
            break;
          default:
            return { success: false, providerId, error: `Unknown provider: ${providerId}` };
        }

        if (status.available) {
          status.authenticated = status.authenticated ?? authenticated;
        }

        return { success: true, providerId, data: status };
      } catch (error) {
        logger.error(`Failed to check single provider ${providerId}`, {
          error: (error as Error).message,
        });
        return { success: false, providerId, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(PROVIDERS_CHANNELS.GET_PATHS, async () => {
    try {
      const paths = await getProviderPaths();
      return {
        success: true,
        data: paths,
      };
    } catch (error) {
      logger.error('Failed to get provider paths', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  logger.info('Provider availability IPC handlers registered');
}
