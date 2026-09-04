/**
 * Provider Availability Service
 *
 * Aggregates availability status from all ACP providers (auggie, claude-code, codex)
 * to determine if the user has any available provider at startup.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import {
  fetchProviderCatalog,
  getCachedProviderCatalog,
} from '../../../main/utils/provider-catalog-accessor';
import { Logger } from '../../../shared/logger';
import {
  getProviderAuthVerdict,
  getProviderAuthVerdicts,
} from '../../../shared/main/provider-auth-status';
import type { ProviderAuthVerdict } from '../../../shared/provider-auth-status';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { findBinaryStrict, getCommonNpmPaths } from '../../../shared/main/find-binary';
import { findAuggiePathStrict } from '../../auggie/main/auggie-path';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../shared/constants/claude-code';
import { clearCodexCache, isCodexInstalled } from '../../codex/main/codex-resolver';
import { clearCortexCache, isCortexInstalled } from '../../cortex/main/cortex-resolver';
import { clearOpenCodeCache, isOpenCodeInstalled } from '../../opencode/main/opencode-resolver';
import { clearPiCache, isPiInstalled } from '../../pi/main/pi-resolver';
import { clearDroidCache, isDroidInstalled } from '../../droid/main/droid-resolver';
import {
  NPX_ONLY_PATH_OVERRIDE_PROVIDERS,
  type NpxStatus,
  type ProviderAvailabilityResult,
  type ProviderStatus,
} from '$shared/types/provider-availability';
import { m } from '../../../shared/paraglide/messages.js';

export type { ProviderAvailabilityResult };

const logger = new Logger('ProviderAvailability');

/**
 * All check*Availability probes below use the STRICT lookups
 * (`findBinaryStrict` / `findAuggiePathStrict` / the throwing
 * `is*Installed` resolvers) and let probe failures REJECT: a daemon RPC
 * failure/timeout proves nothing about availability, so it must never fold
 * into `available:false`. The IPC handlers catch the rejection and return an
 * explicit failure envelope, which the renderer saga maps to
 * `checkSingleProviderFailure` — preserving the last-known status.
 */

/**
 * Check if auggie is available by asking the daemon (`host.checkAuggie` via
 * `findAuggiePathStrict`). The BE owns the settings precedence and binary
 * discovery — no local file probing or install-path scans here.
 */
async function checkAuggieAvailability(): Promise<ProviderStatus> {
  const auggiePath = await findAuggiePathStrict();
  return { available: auggiePath !== null };
}

/**
 * Check whether the claude CLI resolves on the daemon host
 * (`host.findBinary`) — the prerequisite for the claude-code provider.
 * Rejects when the probe itself fails.
 */
async function isClaudeCliInstalled(): Promise<boolean> {
  return (
    (await findBinaryStrict('claude', {
      commonPaths: getCommonNpmPaths('claude'),
    })) !== null
  );
}

/**
 * Check if claude-code is available by checking if the claude CLI is installed.
 * The ACP adapter itself always runs via npx (intentd pins the package); when
 * the CLI is installed but npx is authoritatively missing, the status carries
 * an explicit warning so the UI can tell the user the adapter cannot run. A
 * FAILED npx probe rejects instead — it must not fabricate the warning.
 */
async function checkClaudeCodeAvailability(): Promise<ProviderStatus> {
  const installed = await isClaudeCliInstalled();
  const status: ProviderStatus = { available: installed };
  const npxPath = installed
    ? await findBinaryStrict('npx', {
        commonPaths: getCommonNpmPaths('npx'),
      })
    : null;
  if (installed && npxPath === null) {
    status.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
  }
  return status;
}

/**
 * Check if codex is available by checking if codex-acp is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCodexAvailability(): Promise<ProviderStatus> {
  const installed = await isCodexInstalled();
  return { available: installed };
}

/**
 * Check if cortex is available by checking if cortex is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCortexAvailability(): Promise<ProviderStatus> {
  const installed = await isCortexInstalled();
  return { available: installed };
}

/**
 * Check if opencode is available by checking if opencode is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkOpenCodeAvailability(): Promise<ProviderStatus> {
  const installed = await isOpenCodeInstalled();
  return { available: installed };
}

/**
 * Check if pi is available by checking if the pi CLI is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkPiAvailability(): Promise<ProviderStatus> {
  const installed = await isPiInstalled();
  return { available: installed };
}

/**
 * Check if droid is available by checking if the droid CLI is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkDroidAvailability(): Promise<ProviderStatus> {
  const installed = await isDroidInstalled();
  return { available: installed };
}

/**
 * Check if grok is available by resolving its binary on the daemon host.
 * Grok has no FE-side resolver/probe module: availability comes from the
 * daemon's provider discovery (aggregate path) and from `host.findBinary`
 * (single-recheck path). Auth comes from `host.providerAuthStatus`, attached
 * by the callers.
 */
async function checkGrokAvailability(): Promise<ProviderStatus> {
  // Every call hits the daemon so a fresh install is picked up on recheck.
  const grokPath = await findBinaryStrict('grok');
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
 * covers the single-recheck path.
 */
async function checkUnslothAvailability(): Promise<ProviderStatus> {
  const [opencodePath, unslothPath] = await Promise.all([
    findBinaryStrict('opencode'),
    findBinaryStrict('unsloth'),
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
    /** True for providers launched via `npx <package>` (claude-code, pi). */
    npxOnly?: boolean;
    /** npx-only providers only: the pinned package spec (e.g. `pkg@1.2.3`). */
    npxPackage?: string;
    /** Dual-binary providers only (unsloth): the required secondary CLI name. */
    secondaryCommand?: string;
    /** Dual-binary providers only: whether the secondary CLI resolved. */
    secondaryResolved?: boolean;
    /** Dual-binary providers only: the secondary CLI's resolved path, present when it resolved. */
    secondaryResolvedPath?: string;
  }>;
  npx: {
    resolvedPath: string | null;
    version: string | null;
    versionOk: boolean;
  };
}

/**
 * Call intentd's host.providerDiscovery to get base availability + npx status.
 * Rejects on RPC failure — the daemon could not answer, so callers must not
 * fabricate an "all unavailable" result from it. `getProviderAvailability`
 * lets the rejection propagate as an explicit failure; `getProviderPaths`
 * (a settings-only path lookup, not an install/not-installed verdict)
 * degrades to empty maps.
 */
async function callProviderDiscovery(): Promise<ProviderDiscoveryResponse> {
  return getBackendClient().request<ProviderDiscoveryResponse>('host.providerDiscovery', {});
}

/**
 * Copy a daemon auth verdict onto an available provider's status: the
 * verdict flag plus the rendered identity line (`authDetails`) when the
 * daemon sent one. A missing verdict reads as unknown.
 */
function applyAuthVerdict(status: ProviderStatus, verdict: ProviderAuthVerdict | undefined): void {
  status.authenticated = verdict?.authenticated;
  if (verdict?.authDetails !== undefined) {
    status.authDetails = verdict.authDetails;
  }
}

/**
 * Get aggregated availability status for all providers
 */
export async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  logger.info('Checking all provider availability');

  // Determine which providers are hidden due to missing env vars or feature
  // codes, from the daemon registry's gating metadata (PROTOCOL §5.38).
  const hiddenProviders: string[] = [];
  let catalog;
  try {
    catalog = await fetchProviderCatalog();
  } catch (error) {
    // Fail closed on the gating decision: fall back to the last cached
    // registry when the fetch fails. When there is no cache either, the
    // gating verdict is UNKNOWN — `hiddenProviders` is omitted from the
    // result (never an empty array, which would read as an authoritative
    // "nothing hidden" verdict) so consumers fall back to the catalog's
    // `visible` flag and gated providers (e.g. mock) cannot flash.
    catalog = getCachedProviderCatalog();
    logger.warn('Provider catalog fetch failed; using cached registry for gating', {
      error,
      hasCachedCatalog: catalog !== undefined,
    });
  }
  for (const entry of catalog?.providers ?? []) {
    // Check legacy env var gating
    if (entry.requiresEnvVar && !process.env[entry.requiresEnvVar]) {
      hiddenProviders.push(entry.id);
      continue;
    }
    // Check feature code gating
    if (
      entry.requiresFeatureCode &&
      !featureCodesService.isFeatureEnabled(entry.requiresFeatureCode)
    ) {
      hiddenProviders.push(entry.id);
    }
  }

  if (hiddenProviders.length > 0) {
    logger.info('Providers hidden due to missing env vars or feature codes', { hiddenProviders });
  }

  // Clear caches to ensure fresh detection (important for refresh button)
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

  // Check all providers in parallel; for hidden providers skip the check
  // entirely. When the gating verdict is unknown (no catalog), fail closed on
  // the registry-gated providers (mock: env var) — the same pre-hydration
  // default-deny the single-provider recheck path applies — so
  // availability-only consumers (e.g. onboarding auto-selection) cannot
  // pick a gated provider on the degraded path.
  const gatingVerdictUnknown = catalog === undefined;
  const isMockHidden = gatingVerdictUnknown || hiddenProviders.includes('mock');
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
    antigravityResult,
    authVerdicts,
  ] = await Promise.all([
    makeProviderStatus('auggie', checkAuggieAvailability),
    makeProviderStatus('claude-code', checkClaudeCodeAvailability),
    makeProviderStatus('codex', checkCodexAvailability),
    makeProviderStatus('cortex', checkCortexAvailability),
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
    // No local probe or npm fallback. The daemon resolves the configured
    // official ACP executable, which is separate from the agy CLI.
    makeProviderStatus('antigravity', async () => ({ available: false })),
    // Auth verdicts from the daemon's `host.providerAuthStatus` sweep
    // (intent-hq/intentd#339): the daemon owns the CLI/ACP probes, marker
    // parsing, and caching. Independent of discovery, so it rides in the
    // same Promise.all.
    getProviderAuthVerdicts(),
  ]);

  // claude-code runs its ACP adapter exclusively via npx (intentd pins the
  // package). On the discovery path the daemon reports "installed" from npx
  // presence alone (npx-only provider), so re-gate availability on the claude
  // CLI prerequisite: without the CLI the provider is unavailable regardless
  // of npx, and with the CLI but no npx surface an explicit warning instead
  // of a silently broken provider. The fallback path already handles both.
  if (discoveryById.has('claude-code')) {
    if (!(await isClaudeCliInstalled())) {
      claudeCodeResult.available = false;
    } else if (!claudeCodeResult.warning && npxStatus?.resolvedPath === null) {
      claudeCodeResult.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
    }
  }

  // The wire's `null` (unknown/uninstalled) folds to `undefined` so no
  // indicator renders; verdicts attach only to providers that are available.
  if (auggieResult.available) applyAuthVerdict(auggieResult, authVerdicts['auggie']);
  if (claudeCodeResult.available) applyAuthVerdict(claudeCodeResult, authVerdicts['claude-code']);
  if (codexResult.available) applyAuthVerdict(codexResult, authVerdicts['codex']);
  if (opencodeResult.available) applyAuthVerdict(opencodeResult, authVerdicts['opencode']);
  if (piResult.available) applyAuthVerdict(piResult, authVerdicts['pi']);
  if (droidResult.available) applyAuthVerdict(droidResult, authVerdicts['droid']);
  if (grokResult.available) applyAuthVerdict(grokResult, authVerdicts['grok']);
  if (antigravityResult.available) applyAuthVerdict(antigravityResult, authVerdicts['antigravity']);
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
      unslothResult.available ||
      antigravityResult.available,
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
      antigravity: antigravityResult,
    },
    // Absent catalog = unknown gating verdict; only a consulted catalog
    // yields an authoritative hidden list (empty = nothing hidden).
    ...(catalog !== undefined ? { hiddenProviders } : {}),
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
 * Daemon-resolved CLI paths per provider, as returned by GET_PATHS.
 * `paths` covers every provider the daemon's discovery reported (null when
 * the binary did not resolve); `secondaryPaths` carries the secondary
 * binary's resolved path for dual-binary providers (today only unsloth's
 * `unsloth` CLI) when it resolved; `npxPackages` carries the pinned npx
 * package spec for npx-only providers whose path override the daemon honors
 * (their `paths` entry is the npx binary, not the adapter).
 */
export interface ProviderPathsResult {
  paths: Record<string, string | null>;
  secondaryPaths: Record<string, string | null>;
  npxPackages: Record<string, string>;
  /** npx status from the same discovery round-trip (PROTOCOL §5.14). */
  npx?: NpxStatus;
}

/**
 * Get resolved CLI paths for all providers from the daemon's
 * host.providerDiscovery snapshot (PROTOCOL §5.14) — the daemon spawns
 * providers, so its resolution is the truth the UI must mirror. No FE-local
 * binary resolution. Degrades to empty maps when the RPC fails.
 *
 * This is the LIGHT discovery path: binary resolution only, no
 * `host.providerAuthStatus` sweep, so callers that only need npx status can
 * avoid the aggregated GET_AVAILABILITY round-trip.
 */
export async function getProviderPaths(): Promise<ProviderPathsResult> {
  let discovery: ProviderDiscoveryResponse | undefined;
  try {
    discovery = await callProviderDiscovery();
  } catch (error) {
    logger.warn('host.providerDiscovery RPC failed; degrading to empty paths', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const paths: Record<string, string | null> = {};
  const secondaryPaths: Record<string, string | null> = {};
  const npxPackages: Record<string, string> = {};
  for (const provider of discovery?.providers ?? []) {
    paths[provider.id] = provider.resolvedPath ?? null;
    if (provider.secondaryCommand !== undefined) {
      secondaryPaths[provider.id] = provider.secondaryResolvedPath ?? null;
    }
    if (
      provider.npxOnly === true &&
      provider.npxPackage &&
      NPX_ONLY_PATH_OVERRIDE_PROVIDERS.has(provider.id)
    ) {
      npxPackages[provider.id] = provider.npxPackage;
    }
  }
  return { paths, secondaryPaths, npxPackages, npx: discovery?.npx };
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
      request: string | { providerId: string; force?: boolean },
    ) => {
      const providerId = typeof request === 'string' ? request : request.providerId;
      // Default `force: true` — single rechecks follow "Login" / "Check
      // again" clicks. Passive bulk loads pass `force: false` explicitly so
      // they ride the daemon's auth cache instead of re-probing every CLI.
      const force = typeof request === 'string' ? true : request.force !== false;
      try {
        let status: ProviderStatus;
        let authenticated: boolean | undefined;
        let authDetails: string | undefined;

        // Auth verdicts come from the daemon (`host.providerAuthStatus`,
        // intent-hq/intentd#339). `force: true` bypasses the daemon's cache.
        // The rendered identity line rides the same verdict (protocol 9.4).
        const checkAuth = async (): Promise<boolean | undefined> => {
          const verdict = await getProviderAuthVerdict(providerId, { force });
          authDetails = verdict?.authDetails;
          return verdict?.authenticated;
        };

        switch (providerId) {
          case 'antigravity': {
            const discovery = await callProviderDiscovery();
            const row = discovery?.providers.find((provider) => provider.id === providerId);
            if (!discovery) throw new Error(m.providers_antigravity_discoveryUnavailable());
            status = { available: row?.installed === true, hasNpxFallback: false };
            if (status.available) authenticated = await checkAuth();
            break;
          }
          case 'auggie':
            status = await checkAuggieAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'claude-code':
            status = await checkClaudeCodeAvailability();
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'codex':
            clearCodexCache();
            status = await checkCodexAvailability();
            // Static registry fact (intent-providers' `fallback_npx_package`
            // is set only for codex) — mirrors the aggregate discovery
            // path's `hasNpxFallback` so the npx-missing/too-old guidance
            // still renders on the single-check path.
            status.hasNpxFallback = true;
            if (status.available) {
              authenticated = await checkAuth();
            }
            break;
          case 'cortex':
            clearCortexCache();
            status = await checkCortexAvailability();
            break;
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
          if (authDetails !== undefined) {
            status.authDetails = authDetails;
          }
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
