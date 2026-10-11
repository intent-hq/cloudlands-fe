/**
 * Provider status bridge — routes `providers:get-availability`,
 * `providers:check-single`, `providers:get-paths`, the per-provider
 * `*:check-availability` probes, and the `auggie:install` /
 * `auggie:authenticate` guidance flows to real daemon probes
 * (`host.checkAuggie` / `host.toolAvailability` / `host.findBinary` /
 * `host.providerAuthStatus`, PROTOCOL §5.14) instead of
 * the retired "installed + authenticated mock@example.com" seeding.
 *
 * Per the integration principle BE = source of truth: availability comes
 * from the daemon's binary resolution and auth comes from the daemon's
 * `host.providerAuthStatus` sweep (intent-hq/intentd#339) — the daemon owns
 * every CLI/ACP probe, output-marker parse, and cache; the FE never runs an
 * auth-check command itself. Uninstalled / unauthenticated states surface
 * honestly (`available:false` / `authenticated:false|undefined`) so
 * AuggieSetupGate, ProviderSelector, and AgentGrid render the truth and show
 * their static install/login guidance.
 *
 * Mirrors the main-process semantics in
 * `features/providers/main/provider-availability.service.ts`, which the
 * renderer cannot reach in this mock-router build:
 *  - auggie:      availability via `host.checkAuggie` (settings precedence +
 *                 PATH scan on the daemon).
 *  - claude-code: daemon discovery's installed and gatedOff verdict.
 *  - codex:       `codex` CLI installed (prerequisite for the codex-acp
 *                 adapter). When the CLI is present but neither a local
 *                 `codex-acp` nor npx (the pinned adapter fallback runner)
 *                 resolves, a warning is attached.
 *  - cortex / opencode / pi / droid / grok: binary presence via
 *                 `host.toolAvailability` / `host.findBinary`.
 *  - unsloth:     rides the opencode binary (the daemon injects the managed
 *                 local server's config via OPENCODE_CONFIG_CONTENT) AND the
 *                 daemon-managed server lifecycle shells out to the `unsloth`
 *                 CLI directly — presence requires BOTH `opencode` and
 *                 `unsloth` to resolve; local-only — no login surface, so
 *                 available ⇒ authenticated.
 *  - auth (all):  `host.providerAuthStatus` — `true`/`false` verdicts attach
 *                 to available providers; the wire `null` (unknown) folds to
 *                 undefined so no indicator renders.
 *  - mock:        gated behind env vars only main can read (`TESTING=true`
 *                 + `MOCK_AGENT_SCRIPT_PATH`, `checkMockAvailability`) — the
 *                 `providers:check-single('mock')` probe is forwarded to the
 *                 real preload bridge (`window.electronAPI.invoke`) when
 *                 present so the packaged app gets main's verdict; without
 *                 a bridge (web build) it stays unavailable, matching main's
 *                 default-deny gating. The mock router intercepts every
 *                 renderer `invoke()` in every build, so nothing else would
 *                 ever reach main's handler.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom) so the
 * AuggieSetupGate's onMount probes resolve against the daemon from the very
 * first render.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import {
  AUGGIE_CHANNELS,
  CLAUDE_CODE_CHANNELS,
  CODEX_CHANNELS,
  CORTEX_CHANNELS,
  DROID_CHANNELS,
  OPENCODE_CHANNELS,
  PROVIDERS_CHANNELS,
} from '$shared/ipc/channels';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store as appStore } from '$store/renderer/store';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
} from '../slices/principal/principal-selectors';
import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';
import { m } from '$shared/paraglide/messages.js';
import { backendRequest } from '$lib/client/live/backend-transport';
import { getProviderAuthVerdicts } from '$features/providers/provider-auth-status.client';

import {
  NPX_ONLY_PATH_OVERRIDE_PROVIDERS,
  type NpxStatus,
} from '$shared/types/provider-availability';

import {
  createProviderStatusClient,
  PROVIDER_BINARIES,
  type HostCheckResult,
  type ProviderDiscoveryEntry,
} from '$features/providers/provider-status-client-factory';
const {
  getProviderAvailability,
  checkSingleProvider,
  readProviderStatus,
  fetchProviderDiscovery,
  providerStatusFromDiscovery,
  checkAuggie,
  getAuthVerdicts,
} = createProviderStatusClient({
  backendRequest,
  getProviderAuthVerdicts,
  hostRole: () => selectHostRole.select(appStore.state),
  connectionContext: () => selectPrincipalConnectionContext.select(appStore.state),
  catalogEntries: () => getItems(appStore.state.providerCatalog.providers),
});

registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => {
  try {
    return { success: true, data: await readProviderStatus(getProviderAvailability) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/**
 * providers:get-paths — daemon-resolved CLI paths for every provider's
 * settings path popup, sourced from the daemon's `host.providerDiscovery`
 * snapshot (PROTOCOL §5.14): `paths[id]` is the primary binary's
 * `resolvedPath` (null when unresolved), `secondaryPaths[id]` carries the
 * dual-binary secondary's `secondaryResolvedPath` (unsloth's `unsloth` CLI),
 * and `npxPackages[id]` the pinned package spec of npx-only providers.
 * `npx` rides along from the same round-trip so the onboarding bulk check can
 * fetch it without the aggregated auth sweep.
 * Mirrors main's getProviderPaths; degrades to empty maps on RPC failure.
 */
registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, async () => {
  try {
    const discovery = await backendRequest<{
      providers?: ProviderDiscoveryEntry[];
      npx?: NpxStatus;
    }>('host.providerDiscovery', {}).catch(() => undefined);
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
    return { success: true, data: { paths, secondaryPaths, npxPackages, npx: discovery?.npx } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

registerMockIpcHandler(PROVIDERS_CHANNELS.CHECK_SINGLE, async (arg) => {
  const request = arg as { providerId?: unknown; force?: unknown } | undefined;
  const providerId = typeof arg === 'string' ? arg : (request?.providerId as string) || '';
  // Default force: true (explicit rechecks); passive bulk loads send
  // `force: false` so the daemon's auth cache is used.
  const force = typeof arg === 'string' ? true : request?.force !== false;
  if (!providerId || !getItem(appStore.state.providerCatalog.providers, providerId)) {
    return {
      success: false,
      providerId,
      error: m.providers_bridge_unknownProvider_error({ providerId }),
    };
  }
  try {
    return {
      success: true,
      providerId,
      data: await readProviderStatus(() => checkSingleProvider(providerId, force)),
    };
  } catch (error) {
    return {
      success: false,
      providerId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/**
 * Per-provider `*:check-availability` (the `check<Provider>Availability`
 * model clients) — availability probes against the daemon host, mirroring
 * the main handlers' discovery or binary resolution. Callers read `available`
 * and fold a rejection to `false` with a warning log, so daemon RPC failures propagate
 * instead of being masked as "not installed".
 */
const CHECK_AVAILABILITY_CHANNELS: Record<string, string> = {
  'claude-code': CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY,
  codex: CODEX_CHANNELS.CHECK_AVAILABILITY,
  cortex: CORTEX_CHANNELS.CHECK_AVAILABILITY,
  opencode: OPENCODE_CHANNELS.CHECK_AVAILABILITY,
  droid: DROID_CHANNELS.CHECK_AVAILABILITY,
};

for (const [providerId, channel] of Object.entries(CHECK_AVAILABILITY_CHANNELS)) {
  registerMockIpcHandler(channel, async () => {
    const found = await readProviderStatus(async () => {
      if (selectHostRole.select(appStore.state) === 'member' || providerId === 'claude-code') {
        return providerStatusFromDiscovery(await fetchProviderDiscovery(), providerId);
      }
      return backendRequest<HostCheckResult>('host.findBinary', {
        name: PROVIDER_BINARIES[providerId],
      });
    });
    return { success: true, available: found?.available === true };
  });
}

/** Manual install step surfaced by the INSTALL / AUTHENTICATE instructions. */
const AUGGIE_INSTALL_COMMAND = 'npm install -g @augmentcode/auggie';

/**
 * `auggie:install` — the reference main handler ran an npm/binary install on
 * the local host; the daemon has no interactive install surface, so the
 * bridge returns the manual instructions the callers (ProviderSelector /
 * AgentGrid `applyInstructionResponse`) render, and the user re-probes with
 * "Check again" (`providers:check-single`).
 */
registerMockIpcHandler(AUGGIE_CHANNELS.INSTALL, async () => ({
  success: true,
  data: {
    instructions: [
      m.providers_bridge_auggieInstallOnDaemon_instruction({ version: MINIMUM_NODE_VERSION }),
    ],
    command: AUGGIE_INSTALL_COMMAND,
  },
}));

/**
 * `auggie:authenticate` — probes the real auth state on the daemon host
 * (`host.checkAuggie` + the daemon's `host.providerAuthStatus` verdict).
 * Already-logged-in resolves `authenticated: true` (callers toast +
 * refresh); otherwise the manual `auggie login` instructions render. There
 * is no interactive login arm on the daemon, so no login flow is fabricated.
 */
registerMockIpcHandler(AUGGIE_CHANNELS.AUTHENTICATE, async () => {
  try {
    const check = await checkAuggie();
    if (
      check.available &&
      (await getAuthVerdicts({ providerId: 'auggie', force: true }))['auggie']?.authenticated ===
        true
    ) {
      return { success: true, data: { authenticated: true } };
    }
    if (!check.available) {
      return {
        success: true,
        data: {
          instructions: [m.providers_bridge_auggieNotInstalledOnDaemon_instruction()],
          command: AUGGIE_INSTALL_COMMAND,
        },
      };
    }
    return {
      success: true,
      data: {
        instructions: [m.providers_bridge_auggieLoginOnDaemon_instruction()],
        command: 'auggie login',
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
