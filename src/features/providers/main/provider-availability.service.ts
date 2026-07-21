/**
 * Provider Availability Service
 *
 * Aggregates availability status from all ACP providers (auggie, claude-code, codex)
 * to determine if the user has any available provider at startup.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import { ACP_PROVIDERS } from '../../../shared/config/provider-config';
import { Logger } from '../../../shared/logger';
import { hostExec } from '../../../shared/main/host-exec';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { findBinary } from '../../../shared/main/find-binary';
import { findAuggiePathAsync } from '../../auggie/main/auggie.ipc';
import {
  CLAUDE_CODE_NPX_MISSING_WARNING,
  clearClaudeCodeCache,
  getClaudeCodePath,
  isClaudeCodeInstalled,
  isNpxAvailableForClaudeCode,
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
  clearPiCache,
  getPiPath,
  isPiInstalled,
} from '../../pi/main/pi-resolver';
import {
  clearDroidCache,
  getDroidPath,
  isDroidInstalled,
} from '../../droid/main/droid-resolver';
import { probeDroidAcp } from '../../droid/main/droid-acp-probe';
import type {
  NpxStatus,
  ProviderAvailabilityResult,
  ProviderStatus,
} from '$shared/types/provider-availability';

export type { NpxStatus, ProviderAvailabilityResult, ProviderStatus };

const logger = new Logger('ProviderAvailability');

/**
 * Check if auggie is available by asking the daemon (`host.checkAuggie` via
 * `findAuggiePathAsync`). The BE owns the settings precedence and binary
 * discovery — no local file probing or install-path scans here.
 */
async function checkAuggieAvailability(): Promise<ProviderStatus> {
  try {
    const auggiePath = await findAuggiePathAsync();
    return { available: auggiePath !== null };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if claude-code is available by checking if the claude CLI is installed.
 * The ACP adapter itself always runs via npx (pinned version); when the CLI is
 * installed but npx is missing, the status carries an explicit warning so the
 * UI can tell the user the adapter cannot run.
 */
async function checkClaudeCodeAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isClaudeCodeInstalled();
    const status: ProviderStatus = { available: installed };
    if (installed && !(await isNpxAvailableForClaudeCode())) {
      status.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
    }
    return status;
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
 * Check if pi is available by checking if the pi CLI is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkPiAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isPiInstalled();
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
 * Check if grok is available by resolving its binary on the daemon host.
 * Grok has no FE-side resolver/probe module: availability comes from the
 * daemon's provider discovery (aggregate path) and from `host.findBinary`
 * (single-recheck path). Readiness is owned by the daemon, so auth stays
 * undefined here.
 */
async function checkGrokAvailability(): Promise<ProviderStatus> {
  // findBinary never throws (it folds RPC errors to null), so no try/catch;
  // skip its local cache so a fresh install is picked up on recheck.
  const grokPath = await findBinary('grok', { cache: false });
  return { available: grokPath !== null };
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

  try {
    const result = await hostExec(cliPath, {
      args: ['model', 'list'],
      timeoutMs: AUTH_CHECK_TIMEOUT_MS,
    });
    if (result.timedOut) return undefined;
    const output = `${result.stdout}\n${result.stderr}`;
    const isUnauthenticated =
      /not currently logged in|not logged in|not authenticated|login required|please log in/i.test(
        output,
      );
    if (isUnauthenticated) return false;
    if (result.exitCode === 0) return true;
    return undefined;
  } catch {
    return undefined;
  }
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

  try {
    const result = await hostExec(cliPath, {
      args: ['models'],
      timeoutMs: OPENCODE_READY_TIMEOUT_MS,
    });
    if (result.timedOut) return undefined;
    if (result.exitCode !== 0) return false;
    // Ready iff at least one line matches the `provider/model` format
    const hasModel = result.stdout.split('\n').some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && trimmed.includes('/') && !trimmed.startsWith('#');
    });
    return hasModel;
  } catch {
    return undefined;
  }
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

  try {
    const result = await hostExec(cliPath, {
      args: authCheckArgs,
      timeoutMs: AUTH_CHECK_TIMEOUT_MS,
    });
    if (result.timedOut) return undefined;
    if (result.exitCode !== 0) return false;

    if (validateOutput) {
      return validateOutput(result.stdout);
    }
    if (requireNonEmptyOutput) {
      return result.stdout.trim().length > 0;
    }
    return true;
  } catch {
    return undefined;
  }
}

/**
 * Discovery response from intentd's host.providerDiscovery (PROTOCOL §5.14)
 */
interface ProviderDiscoveryResponse {
  providers: Array<{
    id: string;
    displayName: string;
    command: string;
    installed: boolean;
    resolvedPath?: string | null;
    gatedOff?: string | null;
    hasNpxFallback: boolean;
  }>;
  npx: {
    resolvedPath: string | null;
    version: string | null;
    versionOk: boolean;
  };
}

/**
 * Call intentd's host.providerDiscovery to get base availability + npx status.
 * Returns null on RPC failure (the caller degrades to empty/unavailable state).
 */
async function callProviderDiscovery(): Promise<ProviderDiscoveryResponse | null> {
  try {
    const result = await getBackendClient().request<ProviderDiscoveryResponse>(
      'host.providerDiscovery',
      {},
    );
    return result;
  } catch (error) {
    logger.warn('host.providerDiscovery RPC failed; degrading to empty availability', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  clearPiCache();
  clearDroidCache();

  // Call host.providerDiscovery for base availability + npx status
  const discoveryResponse = await callProviderDiscovery();
  const npxStatus: NpxStatus | undefined = discoveryResponse?.npx;

  // Map discovery providers by ID for quick lookup
  const discoveryById = new Map<string, ProviderDiscoveryResponse['providers'][0]>();
  if (discoveryResponse?.providers) {
    for (const p of discoveryResponse.providers) {
      discoveryById.set(p.id, p);
    }
  }

  // Helper to build ProviderStatus from discovery + supplement with local checks
  const makeProviderStatus = (
    providerId: string,
    fallback: () => Promise<ProviderStatus>,
  ): Promise<ProviderStatus> => {
    const disc = discoveryById.get(providerId);
    if (!disc) {
      return fallback();
    }
    // hasNpxFallback from daemon's discovery response
    return Promise.resolve({
      available: disc.installed,
      hasNpxFallback: disc.hasNpxFallback,
    });
  };

  // Check all providers in parallel; for hidden providers skip the check entirely
  const isCortexHidden = hiddenProviders.includes('cortex');
  const isMockHidden = hiddenProviders.includes('mock');
  const [
    auggieResult,
    claudeCodeResult,
    codexResult,
    cortexResult,
    mockResult,
    opencodeResult,
    piResult,
    droidResult,
    grokResult,
  ] = await Promise.all([
    makeProviderStatus('auggie', checkAuggieAvailability),
    makeProviderStatus('claude-code', checkClaudeCodeAvailability),
    makeProviderStatus('codex', checkCodexAvailability),
    isCortexHidden
      ? Promise.resolve({ available: false } as ProviderStatus)
      : makeProviderStatus('cortex', checkCortexAvailability),
    isMockHidden
      ? Promise.resolve({ available: false } as ProviderStatus)
      : checkMockAvailability(), // mock stays local
    makeProviderStatus('opencode', checkOpenCodeAvailability),
    makeProviderStatus('pi', checkPiAvailability),
    makeProviderStatus('droid', checkDroidAvailability),
    // Grok availability comes from the daemon's provider discovery; the
    // host.findBinary fallback covers the RPC-degraded path. Readiness is
    // not probed FE-side (no grok-acp-probe here), so auth stays undefined.
    makeProviderStatus('grok', checkGrokAvailability),
  ]);

  // claude-code runs its ACP adapter exclusively via npx (pinned version).
  // On the discovery path the daemon reports "installed" from npx presence
  // alone (npx-only provider), so re-gate availability on the claude CLI
  // prerequisite: without the CLI the provider is unavailable regardless of
  // npx, and with the CLI but no npx surface an explicit warning instead of
  // a silently broken provider. The local fallback already handles both.
  if (discoveryById.has('claude-code')) {
    if (!(await isClaudeCodeInstalled())) {
      claudeCodeResult.available = false;
    } else if (!claudeCodeResult.warning && npxStatus?.resolvedPath === null) {
      claudeCodeResult.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
    }
  }

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
      piResult.available ||
      droidResult.available ||
      grokResult.available,
    providers: {
      auggie: auggieResult,
      claudeCode: claudeCodeResult,
      codex: codexResult,
      cortex: cortexResult,
      mock: mockResult,
      opencode: opencodeResult,
      pi: piResult,
      droid: droidResult,
      grok: grokResult,
    },
    hiddenProviders,
    npx: npxStatus,
  };

  logger.info('Provider availability check complete', {
    hasAnyProvider: result.hasAnyProvider,
    auggie: auggieResult.available,
    claudeCode: claudeCodeResult.available,
    codex: codexResult.available,
    cortex: cortexResult.available,
    mock: mockResult.available,
    opencode: opencodeResult.available,
    pi: piResult.available,
    droid: droidResult.available,
    grok: grokResult.available,
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
  pi: string | null;
  droid: string | null;
}> {
  const [auggiePath, claudeCodePath, codexPath, cortexPath, opencodePath, piPath, droidPath] =
    await Promise.all([
      findAuggiePathAsync(),
      getClaudeCodePath(),
      getCodexPath(),
      getCortexPath(),
      getOpenCodePath(),
      getPiPath(),
      getDroidPath(),
    ]);

  return {
    auggie: auggiePath,
    'claude-code': claudeCodePath,
    codex: codexPath,
    cortex: cortexPath,
    opencode: opencodePath,
    pi: piPath,
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
          case 'pi':
            // pi has no stable "am I logged in" signal — availability is based
            // solely on whether the binary is installed; authenticated stays undefined.
            clearPiCache();
            status = await checkPiAvailability();
            break;
          case 'droid':
            clearDroidCache();
            status = await checkDroidAvailability();
            if (status.available) {
              const droidPath = await getDroidPath();
              authenticated = await checkDroidReady(droidPath);
            }
            break;
          case 'grok':
            // Grok readiness is owned by the daemon; the FE only surfaces
            // installed/not-installed here (auth stays undefined).
            status = await checkGrokAvailability();
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
