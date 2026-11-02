/**
 * Provider Availability Service
 *
 * Main-process single-provider recheck (`providers:check-single`) and the
 * onboarding adapter-preparation hook. The renderer seeder
 * (`provider-status-bridge-seeder.ts`) serves the aggregate
 * `providers:get-availability` / `providers:get-paths` reads from the daemon
 * and forwards only the env-gated `mock` recheck here, since only main can
 * read `TESTING` / `MOCK_AGENT_SCRIPT_PATH`.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderAuthVerdict } from '../../../shared/main/provider-auth-status';
import { getBackendClient, getBackendClientForIpcEvent } from '../../backend/main/backend.ipc';
import { createProviderAdapterPreparer } from '../../../shared/provider-adapter-preparation';
import { findBinaryStrict } from '../../../shared/main/find-binary';
import { findAuggiePathStrict } from '../../auggie/main/auggie-path';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../shared/constants/claude-code';
import { clearCodexCache, isCodexInstalled } from '../../codex/main/codex-resolver';
import { clearCortexCache, isCortexInstalled } from '../../cortex/main/cortex-resolver';
import { clearOpenCodeCache, isOpenCodeInstalled } from '../../opencode/main/opencode-resolver';
import { clearPiCache, isPiInstalled } from '../../pi/main/pi-resolver';
import { clearDroidCache, isDroidInstalled } from '../../droid/main/droid-resolver';
import type { ProviderStatus } from '$shared/types/provider-availability';
import { m } from '../../../shared/paraglide/messages.js';

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
 * Claude's adapter runtime and overrides are resolved by daemon discovery.
 * Reuse the aggregate snapshot; single checks fetch their own fresh snapshot.
 */
function claudeCodeStatusFromDiscovery(discovery: ProviderDiscoveryResponse): ProviderStatus {
  const row = discovery.providers.find((provider) => provider.id === 'claude-code');
  const status: ProviderStatus = {
    available: row?.installed === true && !row.gatedOff,
    hasNpxFallback: row?.hasNpxFallback ?? false,
  };
  if (row && !row.installed && !row.gatedOff && discovery.npx?.resolvedPath === null) {
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
 * fabricate an "all unavailable" result from it; the single-check handler
 * returns an explicit failure envelope instead.
 */
async function callProviderDiscovery(): Promise<ProviderDiscoveryResponse> {
  return getBackendClient().request<ProviderDiscoveryResponse>('host.providerDiscovery', {});
}

/**
 * Setup IPC handlers for provider availability
 */
export function setupProviderAvailabilityIPC(): void {
  const prepareAdapters = createProviderAdapterPreparer();
  ipcMain.handle(PROVIDERS_CHANNELS.PREPARE_ADAPTERS, async (event, context: unknown) => {
    if (typeof context !== 'string' || !context) return;
    try {
      const { client } = getBackendClientForIpcEvent(event);
      await prepareAdapters(client, context);
    } catch {
      // A missing/disconnected captured route is not an onboarding failure.
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
        // The rendered identity line rides the same verdict's `identity` object.
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
            status = claudeCodeStatusFromDiscovery(await callProviderDiscovery());
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

  logger.info('Provider availability IPC handlers registered');
}
