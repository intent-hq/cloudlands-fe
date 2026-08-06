/**
 * Provider status bridge — routes `providers:get-availability`,
 * `providers:check-single`, `providers:get-paths`, `auggie:status`, the
 * per-provider `*:check-availability` probes, and the `auggie:install` /
 * `auggie:authenticate` guidance flows to real daemon probes
 * (`host.checkAuggie` / `host.toolAvailability` / `host.findBinary` /
 * `host.checkGit` / `host.providerAuthStatus`, PROTOCOL §5.14) instead of
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
 * `features/providers/main/provider-availability.service.ts` and
 * `features/auggie/main/auggie.ipc.ts` (STATUS), which the renderer cannot
 * reach in this mock-router build:
 *  - auggie:      availability via `host.checkAuggie` (settings precedence +
 *                 PATH scan on the daemon).
 *  - claude-code: `claude` CLI installed (prerequisite for claude-agent-acp).
 *                 When the CLI is present but npx (the adapter's only runner)
 *                 does not resolve, a warning is attached.
 *  - codex:       `codex` CLI installed (prerequisite for the codex-acp
 *                 adapter). When the CLI is present but neither a local
 *                 `codex-acp` nor npx (the pinned adapter fallback runner)
 *                 resolves, a warning is attached.
 *  - opencode / pi / droid / grok: binary presence via
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
 *  - cortex/mock: gated behind a feature code / env var the renderer cannot
 *                 verify — hidden and unavailable, matching main's
 *                 default-deny gating.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom) so the
 * AuggieSetupGate's onMount probes resolve against the daemon from the very
 * first render.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import {
  AUGGIE_CHANNELS,
  CLAUDE_CODE_CHANNELS,
  CODEX_CHANNELS,
  CORTEX_CHANNELS,
  DROID_CHANNELS,
  OPENCODE_CHANNELS,
  PROVIDERS_CHANNELS,
} from "$shared/ipc/channels";
import { getItem, getItems } from "$lib/store-shim/utils/collections/collection-utils";
import { store as appStore } from "$store/renderer/store";
import { MINIMUM_AUGGIE_VERSION, MINIMUM_NODE_VERSION } from "$shared/constants/auggie";
import { CLAUDE_CODE_NPX_MISSING_WARNING } from "$shared/constants/claude-code";
import { CODEX_ADAPTER_MISSING_WARNING } from "$shared/constants/codex";
import { m } from "$shared/paraglide/messages.js";
import { backendRequest } from "$lib/client/live/backend-transport";
import {
  PROVIDER_AUTH_STATUS_METHOD,
  buildProviderAuthStatusParams,
  toAuthVerdictMap,
  type ProviderAuthStatusParams,
  type ProviderAuthStatusResponse,
} from "$shared/provider-auth-status";
import type {
  NpxStatus,
  ProviderAvailabilityResult,
  ProviderStatus,
} from "$shared/types/provider-availability";

/** Daemon `host.checkAuggie` / `host.checkGit` / `host.findBinary` shape. */
interface HostCheckResult {
  available: boolean;
  version?: string;
  path?: string;
}

/** Daemon `host.toolAvailability` result shape (host_ops.rs §host). */
interface HostToolAvailabilityResult {
  tools?: Record<string, HostCheckResult>;
}

/**
 * Availability binary per provider (mirrors the main-process resolvers).
 * codex keys off the real `codex` CLI — the codex-acp adapter is a
 * launch-time detail (local binary or pinned npx fallback), not the
 * "is codex installed" signal (mirrors isCodexInstalled in codex-resolver).
 */
const PROVIDER_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
  droid: "droid",
  grok: "grok",
  unsloth: "unsloth",
};

/** The codex ACP adapter binary — only consulted for the codex warning. */
const CODEX_ACP_BINARY = "codex-acp";

/**
 * Compare a probed version against a minimum. Extracts the first
 * `major.minor.patch` triple so prerelease suffixes and prefixes (`v22.1.0`,
 * `auggie 0.13.4`) are tolerated — mirrors the main-process check that treats
 * `0.13.0-beta.1` as meeting a `0.13.0` requirement.
 */
function meetsMinimumVersion(version: string, minimum: string): boolean {
  const parse = (raw: string): number[] | null => {
    const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const current = parse(version);
  const required = parse(minimum);
  if (!current || !required) return false;
  for (let i = 0; i < 3; i++) {
    if (current[i] !== required[i]) return current[i] > required[i];
  }
  return true;
}

/**
 * Auth verdicts from the daemon's `host.providerAuthStatus`
 * (intent-hq/intentd#339) as an id → verdict map. The daemon owns the
 * CLI/ACP probes and their caching; the wire `null` (unknown) folds to
 * undefined and an RPC failure folds to an empty map (every provider reads
 * as unknown, no indicator — honest degradation).
 */
async function getAuthVerdicts(
  options: ProviderAuthStatusParams = {},
): Promise<Record<string, boolean | undefined>> {
  try {
    const response = await backendRequest<ProviderAuthStatusResponse>(
      PROVIDER_AUTH_STATUS_METHOD,
      buildProviderAuthStatusParams(options),
    );
    return toAuthVerdictMap(response);
  } catch {
    return {};
  }
}

/** Daemon `host.checkAuggie` — `available:false` on RPC failure is NOT folded
 * here; callers decide between degrading (availability aggregate) and
 * surfacing the error (auggie:status). */
async function checkAuggie(): Promise<HostCheckResult> {
  const result = await backendRequest<HostCheckResult>("host.checkAuggie");
  return result ?? { available: false };
}

/**
 * Providers gated behind an env var or feature code the renderer cannot
 * verify (featureCodesService / process.env are main-side) stay hidden —
 * matching the main service's default-deny gating.
 */
function computeHiddenProviders(): string[] {
  return getItems(appStore.state.providerCatalog.providers)
    .filter((entry) => entry.requiresEnvVar || entry.requiresFeatureCode)
    .map((entry) => entry.id);
}

/** Attach an auth verdict only when the provider is actually available. */
function withAuth(status: ProviderStatus, authenticated: boolean | undefined): ProviderStatus {
  if (status.available && authenticated !== undefined) {
    status.authenticated = authenticated;
  }
  return status;
}

/**
 * Aggregate availability for all providers — the daemon resolves every binary
 * in one `host.toolAvailability` round-trip and the auth verdicts arrive in
 * one `host.providerAuthStatus` sweep.
 */
async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  const hiddenProviders = computeHiddenProviders();
  const [auggieCheck, toolsResult, authVerdicts] = await Promise.all([
    checkAuggie().catch(() => ({ available: false }) as HostCheckResult),
    backendRequest<HostToolAvailabilityResult>("host.toolAvailability", {
      // `codex-acp` (the adapter) rides along for the codex warning —
      // availability itself keys off the real `codex` CLI. `npx` rides
      // along for the claude-code adapter check (it always runs via npx)
      // and as the codex adapter's pinned fallback runner.
      tools: [...Object.values(PROVIDER_BINARIES), CODEX_ACP_BINARY, "npx"],
    }).catch(() => ({ tools: {} }) as HostToolAvailabilityResult),
    getAuthVerdicts(),
  ]);
  const tools = toolsResult?.tools ?? {};
  const tool = (name: string): HostCheckResult => tools[name] ?? { available: false };

  const auggie: ProviderStatus = { available: auggieCheck.available === true };
  const claudeCode: ProviderStatus = {
    available: tool(PROVIDER_BINARIES["claude-code"]).available === true,
  };
  // claude-code's ACP adapter always runs via npx (pinned version) — mirror
  // main's warning when the claude CLI is present but npx is not.
  if (claudeCode.available && tool("npx").available !== true) {
    claudeCode.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
  }
  const codex: ProviderStatus = { available: tool(PROVIDER_BINARIES.codex).available === true };
  // codex's ACP adapter is a local codex-acp binary or the pinned npx
  // fallback — warn when the CLI is present but neither can run.
  if (
    codex.available &&
    tool(CODEX_ACP_BINARY).available !== true &&
    tool("npx").available !== true
  ) {
    codex.warning = CODEX_ADAPTER_MISSING_WARNING;
  }
  const opencode: ProviderStatus = {
    available: tool(PROVIDER_BINARIES.opencode).available === true,
  };
  const pi: ProviderStatus = { available: tool(PROVIDER_BINARIES.pi).available === true };
  const droid: ProviderStatus = { available: tool(PROVIDER_BINARIES.droid).available === true };
  const grok: ProviderStatus = { available: tool(PROVIDER_BINARIES.grok).available === true };
  // unsloth rides the opencode binary AND requires the unsloth CLI itself
  // (the daemon-managed server lifecycle shells out to `unsloth run`
  // directly); local-only, so available ⇒ authenticated (the daemon's
  // managed server injects its own API key).
  const unsloth: ProviderStatus = {
    available: opencode.available && tool(PROVIDER_BINARIES.unsloth).available === true,
  };
  if (unsloth.available) unsloth.authenticated = true;
  const cortex: ProviderStatus = { available: false };
  const mock: ProviderStatus = { available: false };

  withAuth(auggie, authVerdicts["auggie"]);
  withAuth(claudeCode, authVerdicts["claude-code"]);
  withAuth(codex, authVerdicts["codex"]);
  withAuth(opencode, authVerdicts["opencode"]);
  withAuth(pi, authVerdicts["pi"]);
  withAuth(droid, authVerdicts["droid"]);
  withAuth(grok, authVerdicts["grok"]);

  return {
    hasAnyProvider:
      auggie.available ||
      claudeCode.available ||
      codex.available ||
      opencode.available ||
      pi.available ||
      droid.available ||
      grok.available ||
      unsloth.available,
    providers: { auggie, claudeCode, codex, cortex, mock, opencode, pi, droid, grok, unsloth },
    hiddenProviders,
  };
}

/** Single-provider recheck (AgentGrid card refresh) — same verdicts as
 * above, defaulting to `force: true` so a login that just completed bypasses
 * the daemon's auth cache. Passive bulk loads pass `force: false` and ride
 * the daemon's cache instead. */
async function checkSingleProvider(providerId: string, force = true): Promise<ProviderStatus> {
  const checkAuth = async (): Promise<boolean | undefined> =>
    (await getAuthVerdicts({ providerId, force }))[providerId];

  if (providerId === "auggie") {
    const check = await checkAuggie();
    const status: ProviderStatus = { available: check.available === true };
    if (status.available) {
      return withAuth(status, await checkAuth());
    }
    return status;
  }
  if (providerId === "cortex" || providerId === "mock") {
    // Feature-code / env-var gated — the renderer cannot verify either, so
    // they stay unavailable (main's default-deny gating).
    return { available: false };
  }
  if (providerId === "unsloth") {
    // Rides the opencode binary AND requires the unsloth CLI itself;
    // local-only so available ⇒ authenticated.
    const [opencodeFound, unslothFound] = await Promise.all([
      backendRequest<HostCheckResult>("host.findBinary", { name: PROVIDER_BINARIES.opencode }),
      backendRequest<HostCheckResult>("host.findBinary", { name: PROVIDER_BINARIES.unsloth }),
    ]);
    const status: ProviderStatus = {
      available: opencodeFound?.available === true && unslothFound?.available === true,
    };
    if (status.available) status.authenticated = true;
    return status;
  }

  const binary = PROVIDER_BINARIES[providerId];
  const found = await backendRequest<HostCheckResult>("host.findBinary", { name: binary });
  const status: ProviderStatus = { available: found?.available === true };
  if (providerId === "codex") {
    // Static registry fact (intent-providers' `fallback_npx_package` is set
    // only for codex) — mirrors the aggregate path's `hasNpxFallback` so the
    // npx-missing/too-old guidance still renders when codex is unavailable
    // (the UI gates that guidance on `hasNpxFallback && !available`).
    status.hasNpxFallback = true;
  }
  if (!status.available) return status;

  if (providerId === "claude-code") {
    // Adapter runs exclusively via npx — surface the same warning as main
    // when the claude CLI is installed but npx is missing. A failed probe
    // (RPC error) is an unknown, not a confirmed absence — no warning then.
    const npx = await backendRequest<HostCheckResult>("host.findBinary", { name: "npx" }).catch(
      () => undefined,
    );
    if (npx && npx.available !== true) {
      status.warning = CLAUDE_CODE_NPX_MISSING_WARNING;
    }
    return withAuth(status, await checkAuth());
  }
  if (providerId === "codex") {
    // Availability (and auth) key off the real `codex` CLI; the codex-acp
    // adapter (local binary or pinned npx fallback) is only probed for the
    // warning. Failed probes are unknowns, not confirmed absences — no
    // warning then (same rule as claude-code above).
    const [acp, npx] = await Promise.all([
      backendRequest<HostCheckResult>("host.findBinary", { name: CODEX_ACP_BINARY }).catch(
        () => undefined,
      ),
      backendRequest<HostCheckResult>("host.findBinary", { name: "npx" }).catch(() => undefined),
    ]);
    if (acp && acp.available !== true && npx && npx.available !== true) {
      status.warning = CODEX_ADAPTER_MISSING_WARNING;
    }
    return withAuth(status, await checkAuth());
  }
  // opencode / pi / droid / grok: presence via host.findBinary, auth from
  // the daemon's providerAuthStatus verdict.
  return withAuth(status, await checkAuth());
}

registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => {
  try {
    return { success: true, data: await getProviderAvailability() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Daemon `host.providerDiscovery` provider entry (PROTOCOL §5.14). */
interface ProviderDiscoveryEntry {
  id: string;
  installed: boolean;
  resolvedPath?: string | null;
  secondaryCommand?: string;
  secondaryResolved?: boolean;
  secondaryResolvedPath?: string;
}

/**
 * providers:get-paths — daemon-resolved CLI paths for every provider's
 * settings path popup, sourced from the daemon's `host.providerDiscovery`
 * snapshot (PROTOCOL §5.14): `paths[id]` is the primary binary's
 * `resolvedPath` (null when unresolved) and `secondaryPaths[id]` carries the
 * dual-binary secondary's `secondaryResolvedPath` (unsloth's `unsloth` CLI).
 * `npx` rides along from the same round-trip so the onboarding bulk check can
 * fetch it without the aggregated auth sweep.
 * Mirrors main's getProviderPaths; degrades to empty maps on RPC failure.
 */
registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, async () => {
  try {
    const discovery = await backendRequest<{
      providers?: ProviderDiscoveryEntry[];
      npx?: NpxStatus;
    }>("host.providerDiscovery", {}).catch(() => undefined);
    const paths: Record<string, string | null> = {};
    const secondaryPaths: Record<string, string | null> = {};
    for (const provider of discovery?.providers ?? []) {
      paths[provider.id] = provider.resolvedPath ?? null;
      if (provider.secondaryCommand !== undefined) {
        secondaryPaths[provider.id] = provider.secondaryResolvedPath ?? null;
      }
    }
    return { success: true, data: { paths, secondaryPaths, npx: discovery?.npx } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

registerMockIpcHandler(PROVIDERS_CHANNELS.CHECK_SINGLE, async (arg) => {
  const request = arg as { providerId?: unknown; force?: unknown } | undefined;
  const providerId =
    typeof arg === "string" ? arg : ((request?.providerId as string) || "");
  // Default force: true (explicit rechecks); passive bulk loads send
  // `force: false` so the daemon's auth cache is used.
  const force = typeof arg === "string" ? true : request?.force !== false;
  if (!providerId || !getItem(appStore.state.providerCatalog.providers, providerId)) {
    return { success: false, providerId, error: m.providers_bridge_unknownProvider_error({ providerId }) };
  }
  try {
    return { success: true, providerId, data: await checkSingleProvider(providerId, force) };
  } catch (error) {
    return {
      success: false,
      providerId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** `auggie:status` payload consumed by AuggieSetupGate / ProviderSelector /
 * AgentGrid. `binaryInstallAvailable` /
 * `managedBinaryInstalled` remain for renderer compatibility but are always
 * false — install is a manual step (AUGGIE_CHANNELS.INSTALL instructions). */
interface AuggieStatusPayload {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  versionOk: boolean;
  minimumVersion: string;
  authDetails?: string;
  nodeVersion?: string;
  nodeVersionOk: boolean;
  gitInstalled: boolean;
  gitVersion?: string;
  binaryInstallAvailable: boolean;
  managedBinaryInstalled: boolean;
}

registerMockIpcHandler(AUGGIE_CHANNELS.STATUS, async () => {
  const status: AuggieStatusPayload = {
    installed: false,
    authenticated: false,
    versionOk: false,
    minimumVersion: MINIMUM_AUGGIE_VERSION,
    nodeVersionOk: false,
    gitInstalled: false,
    binaryInstallAvailable: false,
    managedBinaryInstalled: false,
  };

  // Node + git describe the daemon host (the host that runs auggie); they
  // feed the setup UI's platform-support instructions. Best-effort.
  const [nodeSettled, gitSettled] = await Promise.allSettled([
    backendRequest<HostCheckResult>("host.findBinary", { name: "node" }),
    backendRequest<HostCheckResult>("host.checkGit"),
  ]);
  if (nodeSettled.status === "fulfilled" && nodeSettled.value?.available) {
    const raw = nodeSettled.value.version?.trim().replace(/^v/, "");
    if (raw) {
      status.nodeVersion = raw;
      status.nodeVersionOk = meetsMinimumVersion(raw, MINIMUM_NODE_VERSION);
    }
  }
  if (gitSettled.status === "fulfilled" && gitSettled.value?.available) {
    status.gitInstalled = true;
    const gitVersion = gitSettled.value.version?.trim();
    if (gitVersion) status.gitVersion = gitVersion;
  }

  // Install + version detection via the daemon (settings precedence + PATH
  // scan). An RPC failure surfaces as success:false WITH the partial status —
  // ProviderSelector reads `data` regardless of `success` so the node/git
  // warnings still render.
  let auggiePath: string | null = null;
  try {
    const check = await checkAuggie();
    status.installed = check.available === true;
    if (typeof check.version === "string" && check.version.trim()) {
      status.version = check.version.trim();
    }
    if (typeof check.path === "string" && check.path.trim()) {
      auggiePath = check.path.trim();
    }
    if (status.installed && status.version) {
      status.versionOk = meetsMinimumVersion(status.version, MINIMUM_AUGGIE_VERSION);
    }
  } catch (error) {
    return {
      success: false,
      error: m.providers_bridge_auggieCheckFailed_error({
        details: error instanceof Error ? error.message : String(error),
      }),
      data: status,
    };
  }

  if (!status.installed || !status.versionOk || !auggiePath) {
    return { success: true, data: status };
  }

  // Auth verdict from the daemon (`host.providerAuthStatus`, force to pick
  // up a login that just completed). No identity is fabricated: authDetails
  // stays undefined (the daemon has no user-info surface), so consumers
  // render their generic "Authenticated" state instead of a fake email.
  if ((await getAuthVerdicts({ providerId: "auggie", force: true }))["auggie"] === true) {
    status.authenticated = true;
  }
  return { success: true, data: status };
});

/**
 * Per-provider `*:check-availability` (the `check<Provider>Availability`
 * model clients) — presence-only probes against the daemon host, mirroring
 * the main handlers' binary resolution. Callers read `available` and fold a
 * rejection to `false` with a warning log, so daemon RPC failures propagate
 * instead of being masked as "not installed".
 */
const CHECK_AVAILABILITY_CHANNELS: Record<string, string> = {
  "claude-code": CLAUDE_CODE_CHANNELS.CHECK_AVAILABILITY,
  codex: CODEX_CHANNELS.CHECK_AVAILABILITY,
  opencode: OPENCODE_CHANNELS.CHECK_AVAILABILITY,
  droid: DROID_CHANNELS.CHECK_AVAILABILITY,
};

for (const [providerId, channel] of Object.entries(CHECK_AVAILABILITY_CHANNELS)) {
  registerMockIpcHandler(channel, async () => {
    const found = await backendRequest<HostCheckResult>("host.findBinary", {
      name: PROVIDER_BINARIES[providerId],
    });
    return { success: true, available: found?.available === true };
  });
}

// Cortex is feature-code gated (renderer cannot verify the gate) — default
// deny, matching the status probes above.
registerMockIpcHandler(CORTEX_CHANNELS.CHECK_AVAILABILITY, async () => ({
  success: true,
  available: false,
}));

/** Manual install step surfaced by the INSTALL / AUTHENTICATE instructions. */
const AUGGIE_INSTALL_COMMAND = "npm install -g @augmentcode/auggie";

/**
 * `auggie:install` — the reference main handler ran an npm/binary install on
 * the local host; the daemon has no interactive install surface, so the
 * bridge returns the manual instructions the callers (ProviderSelector /
 * AgentGrid `applyInstructionResponse`) render, and the user re-probes with
 * "Check again" (`providers:check-single` / `auggie:status`).
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
      (await getAuthVerdicts({ providerId: "auggie", force: true }))["auggie"] === true
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
        command: "auggie login",
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
