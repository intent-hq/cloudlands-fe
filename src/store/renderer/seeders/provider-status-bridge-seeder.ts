/**
 * Provider status bridge — routes `providers:get-availability`,
 * `providers:check-single`, and `auggie:status` to real daemon probes
 * (`host.checkAuggie` / `host.toolAvailability` / `host.findBinary` /
 * `host.checkGit` / `host.exec`, PROTOCOL §5.14) instead of the retired
 * "installed + authenticated mock@example.com" seeding.
 *
 * Per the integration principle BE = source of truth: availability comes from
 * the daemon's binary resolution and auth comes from CLI probes executed on
 * the daemon host — never synthesized. Uninstalled / unauthenticated states
 * surface honestly (`available:false` / `authenticated:false|undefined`) so
 * AuggieSetupGate, ProviderSelector, and AgentGrid render the truth and show
 * their static install/login guidance.
 *
 * Mirrors the main-process semantics in
 * `features/providers/main/provider-availability.service.ts` and
 * `features/auggie/main/auggie.ipc.ts` (STATUS), which the renderer cannot
 * reach in this mock-router build:
 *  - auggie:      `host.checkAuggie` (settings precedence + PATH scan on the
 *                 daemon), auth via `auggie model list` (`host.exec`).
 *  - claude-code: `claude` CLI installed (prerequisite for claude-agent-acp),
 *                 auth via `claude auth status` exit code.
 *  - codex:       `codex-acp` installed, auth via `codex login status`.
 *  - opencode:    `opencode` installed, readiness via `opencode models`
 *                 returning at least one `provider/model` line.
 *  - pi:          binary presence only (no stable auth signal).
 *  - droid:       binary presence only; the main-process ACP stdio probe is
 *                 not portable to the renderer, so auth stays undefined
 *                 (honest unknown, never a fake positive).
 *  - cortex/mock: gated behind a feature code / env var the renderer cannot
 *                 verify — hidden and unavailable, matching main's
 *                 default-deny gating.
 *
 * Handlers are registered at import time (host-bridge-seeder idiom) so the
 * AuggieSetupGate's onMount probes resolve against the daemon from the very
 * first render.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { ACP_PROVIDERS } from "$shared/config/provider-config";
import { MINIMUM_AUGGIE_VERSION, MINIMUM_NODE_VERSION } from "$shared/constants/auggie";
import { backendRequest } from "$lib/client/live/backend-transport";
import type {
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

/** Daemon `host.exec` result shape (PROTOCOL §5.14). */
interface HostExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

/** Auth probe timeout — matches provider-availability.service.ts. */
const AUTH_CHECK_TIMEOUT_MS = 5000;
/** `opencode models` can be slower than a simple auth read (main uses 10s). */
const OPENCODE_READY_TIMEOUT_MS = 10000;
/** Stable "not logged in" markers in auggie CLI output. */
const NOT_LOGGED_IN_RE =
  /not currently logged in|not logged in|not authenticated|login required|please log in/i;

/** Availability binary per provider (mirrors the main-process resolvers). */
const PROVIDER_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  codex: "codex-acp",
  opencode: "opencode",
  pi: "pi",
  droid: "droid",
};

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

/** One-shot exec on the daemon host (argv-based, no shell — PROTOCOL §5.14). */
async function hostExec(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<HostExecResult> {
  return await backendRequest<HostExecResult>("host.exec", { command, args, timeoutMs });
}

/**
 * Auggie auth probe: `auggie model list` is fast and its output carries a
 * stable "not logged in" marker. true = authenticated, false = explicitly
 * logged out, undefined = probe failed/timed out (unknown, no indicator).
 */
async function probeAuggieAuth(cliPath: string): Promise<boolean | undefined> {
  try {
    const result = await hostExec(cliPath, ["model", "list"], AUTH_CHECK_TIMEOUT_MS);
    if (result.timedOut) return undefined;
    if (NOT_LOGGED_IN_RE.test(`${result.stdout}\n${result.stderr}`)) return false;
    if (result.exitCode === 0) return true;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exit-code auth probe (`claude auth status` / `codex login status`).
 * Exit 0 = authenticated, non-zero = not, undefined on timeout/RPC failure.
 */
async function probeExitCodeAuth(
  cliPath: string | undefined,
  authCheckArgs: string[],
): Promise<boolean | undefined> {
  if (!cliPath || authCheckArgs.length === 0) return undefined;
  try {
    const result = await hostExec(cliPath, authCheckArgs, AUTH_CHECK_TIMEOUT_MS);
    if (result.timedOut) return undefined;
    return result.exitCode === 0;
  } catch {
    return undefined;
  }
}

/**
 * OpenCode readiness: `opencode models` returns at least one `provider/model`
 * line only when some provider is credentialed (auth.json, env vars, or a
 * project .env) — mirrors checkOpenCodeReady in the main service.
 */
async function probeOpenCodeReady(cliPath: string | undefined): Promise<boolean | undefined> {
  if (!cliPath) return undefined;
  try {
    const result = await hostExec(cliPath, ["models"], OPENCODE_READY_TIMEOUT_MS);
    if (result.timedOut) return undefined;
    if (result.exitCode !== 0) return false;
    return result.stdout.split("\n").some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && trimmed.includes("/") && !trimmed.startsWith("#");
    });
  } catch {
    return undefined;
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
  return Object.values(ACP_PROVIDERS)
    .filter((config) => config.requiresEnvVar || config.requiresFeatureCode)
    .map((config) => config.id);
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
 * in one `host.toolAvailability` round-trip, then auth probes run in parallel
 * for the providers that are installed.
 */
async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  const hiddenProviders = computeHiddenProviders();
  const [auggieCheck, toolsResult] = await Promise.all([
    checkAuggie().catch(() => ({ available: false }) as HostCheckResult),
    backendRequest<HostToolAvailabilityResult>("host.toolAvailability", {
      // `codex` (the real CLI) rides along for the codex auth probe —
      // availability itself keys off the `codex-acp` adapter.
      tools: [...Object.values(PROVIDER_BINARIES), "codex"],
    }).catch(() => ({ tools: {} }) as HostToolAvailabilityResult),
  ]);
  const tools = toolsResult?.tools ?? {};
  const tool = (name: string): HostCheckResult => tools[name] ?? { available: false };

  const auggie: ProviderStatus = { available: auggieCheck.available === true };
  const claudeCode: ProviderStatus = {
    available: tool(PROVIDER_BINARIES["claude-code"]).available === true,
  };
  const codex: ProviderStatus = { available: tool(PROVIDER_BINARIES.codex).available === true };
  const opencode: ProviderStatus = {
    available: tool(PROVIDER_BINARIES.opencode).available === true,
  };
  const pi: ProviderStatus = { available: tool(PROVIDER_BINARIES.pi).available === true };
  const droid: ProviderStatus = { available: tool(PROVIDER_BINARIES.droid).available === true };
  const cortex: ProviderStatus = { available: false };
  const mock: ProviderStatus = { available: false };

  const [auggieAuth, claudeAuth, codexAuth, opencodeAuth] = await Promise.all([
    auggie.available && auggieCheck.path
      ? probeAuggieAuth(auggieCheck.path)
      : Promise.resolve(undefined),
    claudeCode.available
      ? probeExitCodeAuth(
          tool(PROVIDER_BINARIES["claude-code"]).path,
          ACP_PROVIDERS["claude-code"].authCheckArgs ?? [],
        )
      : Promise.resolve(undefined),
    codex.available
      ? probeExitCodeAuth(tool("codex").path, ACP_PROVIDERS.codex.authCheckArgs ?? [])
      : Promise.resolve(undefined),
    opencode.available
      ? probeOpenCodeReady(tool(PROVIDER_BINARIES.opencode).path)
      : Promise.resolve(undefined),
  ]);
  withAuth(auggie, auggieAuth);
  withAuth(claudeCode, claudeAuth);
  withAuth(codex, codexAuth);
  withAuth(opencode, opencodeAuth);

  return {
    hasAnyProvider:
      auggie.available ||
      claudeCode.available ||
      codex.available ||
      opencode.available ||
      pi.available ||
      droid.available,
    providers: { auggie, claudeCode, codex, cortex, mock, opencode, pi, droid },
    hiddenProviders,
  };
}

/** Single-provider recheck (AgentGrid card refresh) — same probes as above. */
async function checkSingleProvider(providerId: string): Promise<ProviderStatus> {
  if (providerId === "auggie") {
    const check = await checkAuggie();
    const status: ProviderStatus = { available: check.available === true };
    if (status.available && check.path) {
      return withAuth(status, await probeAuggieAuth(check.path));
    }
    return status;
  }
  if (providerId === "cortex" || providerId === "mock") {
    // Feature-code / env-var gated — the renderer cannot verify either, so
    // they stay unavailable (main's default-deny gating).
    return { available: false };
  }

  const binary = PROVIDER_BINARIES[providerId];
  const found = await backendRequest<HostCheckResult>("host.findBinary", { name: binary });
  const status: ProviderStatus = { available: found?.available === true };
  if (!status.available) return status;

  if (providerId === "claude-code") {
    return withAuth(
      status,
      await probeExitCodeAuth(found?.path, ACP_PROVIDERS["claude-code"].authCheckArgs ?? []),
    );
  }
  if (providerId === "codex") {
    // Auth runs against the real `codex` CLI, not the codex-acp adapter.
    const codexCli = await backendRequest<HostCheckResult>("host.findBinary", {
      name: "codex",
    }).catch(() => undefined);
    return withAuth(
      status,
      await probeExitCodeAuth(codexCli?.path, ACP_PROVIDERS.codex.authCheckArgs ?? []),
    );
  }
  if (providerId === "opencode") {
    return withAuth(status, await probeOpenCodeReady(found?.path));
  }
  // pi (no stable auth signal) / droid (ACP probe not portable): presence only.
  return status;
}

registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => {
  try {
    return { success: true, data: await getProviderAvailability() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

registerMockIpcHandler(PROVIDERS_CHANNELS.CHECK_SINGLE, async (arg) => {
  const providerId =
    typeof arg === "string"
      ? arg
      : ((arg as { providerId?: unknown } | undefined)?.providerId as string) || "";
  if (!providerId || !(providerId in ACP_PROVIDERS)) {
    return { success: false, providerId, error: `Unknown provider: ${providerId}` };
  }
  try {
    return { success: true, providerId, data: await checkSingleProvider(providerId) };
  } catch (error) {
    return {
      success: false,
      providerId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

/** `auggie:status` payload consumed by AuggieSetupGate / ProviderSelector /
 * AgentGrid / PromotionalBanner. `binaryInstallAvailable` /
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
      error: `Auggie CLI check failed: ${
        error instanceof Error ? error.message : String(error)
      }. Please try again.`,
      data: status,
    };
  }

  if (!status.installed || !status.versionOk || !auggiePath) {
    return { success: true, data: status };
  }

  // Auth probe via `host.exec`. No identity is fabricated: authDetails stays
  // undefined (the daemon has no user-info surface), so consumers render
  // their generic "Authenticated" state instead of a fake email.
  if ((await probeAuggieAuth(auggiePath)) === true) {
    status.authenticated = true;
  }
  return { success: true, data: status };
});
