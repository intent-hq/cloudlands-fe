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
import {
  getProviderAuthVerdict,
  getProviderAuthVerdicts,
} from '../../../shared/main/provider-auth-status';
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
import { clearCodexCache, getCodexPath, isCodexInstalled } from '../../codex/main/codex-resolver';
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
import { clearPiCache, getPiPath, isPiInstalled } from '../../pi/main/pi-resolver';
import { clearDroidCache, getDroidPath, isDroidInstalled } from '../../droid/main/droid-resolver';
import type {
  NpxStatus,
  ProviderAvailabilityResult,
  ProviderStatus,
} from '$shared/types/provider-availability';
import { m } from '../../../shared/paraglide/messages.js';

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
 * (single-recheck path). Auth comes from `host.providerAuthStatus`, attached
 * by the callers.
 */
async function checkGrokAvailability(): Promise<ProviderStatus> {
  // findBinary never throws (it folds RPC errors to null), so no try/catch;
  // skip its local cache so a fresh install is picked up on recheck.
  const grokPath = await findBinary('grok', { cache: false });
  return { available: grokPath !== null };
}

/**
 * Check if unsloth is available. Unsloth rides the opencode binary as its
 * ACP runtime (the daemon injects the managed local server's config via
 * OPENCODE_CONFIG_CONTENT), but the daemon-managed server lifecycle also
 * shells out to the `unsloth` CLI directly (`unsloth run`, `unsloth start
 * opencode`) — so availability requires BOTH binaries to resolve on the
 * daemon host. Like grok, there is no FE-side resolver module — the
 * aggregate path uses the daemon's provider discovery and this fallback
 * covers the RPC-degraded / single-recheck path.
 */
async function checkUnslothAvailability(): Promise<ProviderStatus> {
  const [opencodePath, unslothPath] = await Promise.all([
    findBinary('opencode', { cache: false }),
    findBinary('unsloth', { cache: false }),
  ]);
  return { available: opencodePath !== null && unslothPath !== null };
}

/**
 * Check if the mock ACP agent is available for test runs.
 */
async function checkMockAvailability(): Promise<ProviderStatus> {
  if (process.env.TESTING !== 'true') {
    // i18n-ignore (test-only mock provider diagnostic)
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
    unslothResult,
    authVerdicts,
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
    // host.findBinary fallback covers the RPC-degraded path.
    makeProviderStatus('grok', checkGrokAvailability),
    // Unsloth rides the opencode binary (discovery reports it installed from
    // opencode presence); same fallback pattern as grok.
    makeProviderStatus('unsloth', checkUnslothAvailability),
    // Auth verdicts from the daemon's `host.providerAuthStatus` sweep
    // (intent-hq/intentd#339): the daemon owns the CLI/ACP probes, marker
    // parsing, and caching. Independent of discovery, so it rides in the
    // same Promise.all.
    getProviderAuthVerdicts(),
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

  // The wire's `null` (unknown/uninstalled) folds to `undefined` so no
  // indicator renders; verdicts attach only to providers that are available.
  if (auggieResult.available) auggieResult.authenticated = authVerdicts['auggie'];
  if (claudeCodeResult.available) claudeCodeResult.authenticated = authVerdicts['claude-code'];
  if (codexResult.available) codexResult.authenticated = authVerdicts['codex'];
  if (opencodeResult.available) opencodeResult.authenticated = authVerdicts['opencode'];
  if (piResult.available) piResult.authenticated = authVerdicts['pi'];
  if (droidResult.available) droidResult.authenticated = authVerdicts['droid'];
  if (grokResult.available) grokResult.authenticated = authVerdicts['grok'];
  // Unsloth is local-only: the daemon's managed server generates its own API
  // key, there is no login surface, so available ⇒ authenticated.
  if (unslothResult.available) unslothResult.authenticated = true;

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
      grokResult.available ||
      unslothResult.available,
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
      unsloth: unslothResult,
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
    unsloth: unslothResult.available,
    auggieAuth: auggieResult.authenticated,
    claudeCodeAuth: claudeCodeResult.authenticated,
    codexAuth: codexResult.authenticated,
    opencodeAuth: opencodeResult.authenticated,
    piAuth: piResult.authenticated,
    droidAuth: droidResult.authenticated,
    grokAuth: grokResult.authenticated,
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
    async (_event: Electron.IpcMainInvokeEvent, request: string | { providerId: string }) => {
      const providerId = typeof request === 'string' ? request : request.providerId;
      try {
        let status: ProviderStatus;
        let authenticated: boolean | undefined;

        // Auth verdicts come from the daemon (`host.providerAuthStatus`,
        // intent-hq/intentd#339). `force: true` bypasses the daemon's cache —
        // single rechecks follow "Login" / "Check again" clicks, so a login
        // that just completed must be picked up.
        const checkAuth = (): Promise<boolean | undefined> =>
          getProviderAuthVerdict(providerId, { force: true });

        switch (providerId) {
          case 'auggie':
            status = await checkAuggieAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'claude-code':
            clearClaudeCodeCache();
            status = await checkClaudeCodeAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'codex':
            clearCodexCache();
            status = await checkCodexAvailability();
            if (status.available) {
              authenticated = await checkAuth();
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
              authenticated = await checkAuth();
            }
            break;
          case 'pi':
            clearPiCache();
            status = await checkPiAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'droid':
            clearDroidCache();
            status = await checkDroidAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'grok':
            status = await checkGrokAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'unsloth':
            // Local-only provider — no login surface, so available ⇒
            // authenticated (the managed server injects its own API key).
            status = await checkUnslothAvailability();
            if (status.available) {
              authenticated = true;
            }
            break;
          case 'mock':
            status = await checkMockAvailability();
            break;
          default:
            return {
              success: false,
              providerId,
              error: m.providers_availability_unknownProvider_error({ id: providerId }),
            };
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
