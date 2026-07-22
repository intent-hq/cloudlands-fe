/**
 * Wire-contract tests for the provider status bridge seeder.
 *
 * Asserts `providers:get-availability`, `providers:check-single`, and
 * `auggie:status` forward to the canonical daemon probes (`host.checkAuggie`,
 * `host.toolAvailability`, `host.findBinary`, `host.checkGit`,
 * `host.providerAuthStatus` — PROTOCOL §5.14 / intent-hq/intentd#339) and
 * derive HONEST status from the responses: uninstalled / unauthenticated
 * states surface as-is, no mock@example.com fake positives, and the FE never
 * runs an auth-check command via `host.exec` itself.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";
import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { MINIMUM_AUGGIE_VERSION } from "$shared/constants/auggie";
import { CLAUDE_CODE_NPX_MISSING_WARNING } from "$shared/constants/claude-code";
import { CODEX_ADAPTER_MISSING_WARNING } from "$shared/constants/codex";
import type { ProviderAvailabilityResult } from "$shared/types/provider-availability";

const mockedRequest = vi.mocked(backendRequest);

/** Route daemon methods to canned PROTOCOL-shaped responses. */
type MethodResponses = Record<string, unknown | ((params: unknown) => unknown)>;
function routeDaemon(responses: MethodResponses): void {
  mockedRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (!(method in responses)) throw new Error(`unexpected daemon method: ${method}`);
    const entry = responses[method];
    return typeof entry === "function" ? (entry as (p: unknown) => unknown)(params) : entry;
  });
}

/** All-tools-unavailable `host.toolAvailability` body. */
const NO_TOOLS = {
  tools: {
    claude: { available: false },
    codex: { available: false },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
    grok: { available: false },
    "codex-acp": { available: false },
    npx: { available: false },
  },
};

/** Provider ids the daemon's providerAuthStatus sweep covers. */
const AUTH_PROVIDER_IDS = [
  "auggie",
  "claude-code",
  "codex",
  "opencode",
  "pi",
  "droid",
  "grok",
] as const;

/**
 * PROTOCOL-shaped `host.providerAuthStatus` sweep response: every provider
 * defaults to the wire's `null` (unknown) unless overridden.
 */
function authSweep(
  verdicts: Partial<Record<(typeof AUTH_PROVIDER_IDS)[number], boolean | null>> = {},
) {
  return {
    providers: AUTH_PROVIDER_IDS.map((id) => ({
      id,
      authenticated: verdicts[id] ?? null,
    })),
  };
}

/** Single-provider `host.providerAuthStatus` response. */
function authOne(id: string, authenticated: boolean | null) {
  return { providers: [{ id, authenticated }] };
}

type Envelope<T> = { success: boolean; data?: T; error?: string };

describe("provider-status-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./provider-status-bridge-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("providers:get-availability → host.checkAuggie + host.toolAvailability + host.providerAuthStatus", () => {
    it("reports nothing installed honestly — no fake mock@example.com positives", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": NO_TOOLS,
        "host.providerAuthStatus": authSweep(),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.checkAuggie");
      expect(mockedRequest).toHaveBeenCalledWith("host.toolAvailability", {
        tools: ["claude", "codex", "opencode", "pi", "droid", "grok", "codex-acp", "npx"],
      });
      // The auth sweep carries no providerId / force — the daemon's cache
      // is respected on the aggregate path.
      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {});
      expect(response.success).toBe(true);
      expect(response.data?.hasAnyProvider).toBe(false);
      expect(response.data?.providers.auggie).toEqual({ available: false });
      expect(response.data?.providers.mock).toEqual({ available: false });
      // Feature-code / env-var gated providers stay hidden (default-deny).
      expect(response.data?.hiddenProviders).toEqual(
        expect.arrayContaining(["cortex", "mock"]),
      );
      // The FE never runs auth-check commands itself.
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
    });

    it("derives auggie auth from the daemon's providerAuthStatus sweep when installed", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.toolAvailability": NO_TOOLS,
        "host.providerAuthStatus": authSweep({ auggie: true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {});
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
      expect(response.data?.hasAnyProvider).toBe(true);
      expect(response.data?.providers.auggie).toEqual({ available: true, authenticated: true });
    });

    it("surfaces a logged-out auggie as authenticated:false (actionable, not fake-positive)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.toolAvailability": NO_TOOLS,
        "host.providerAuthStatus": authSweep({ auggie: false }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.auggie).toEqual({
        available: true,
        authenticated: false,
      });
    });

    it("folds daemon RPC failures to all-unavailable (honest degradation, never an error banner)", async () => {
      mockedRequest.mockRejectedValue(new Error("transport down"));

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.success).toBe(true);
      expect(response.data?.hasAnyProvider).toBe(false);
    });

    it("attaches per-provider verdicts from one sweep — claude-code in, codex out", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            claude: { available: true, path: "/usr/local/bin/claude" },
            "codex-acp": { available: true, path: "/usr/local/bin/codex-acp" },
            codex: { available: true, path: "/usr/local/bin/codex" },
            npx: { available: true, path: "/usr/local/bin/npx" },
          },
        },
        "host.providerAuthStatus": authSweep({ "claude-code": true, codex: false }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {});
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
      expect(response.data?.providers.claudeCode).toEqual({
        available: true,
        authenticated: true,
      });
      expect(response.data?.providers.codex).toEqual({ available: true, authenticated: false });
    });

    it("attaches droid / grok / pi verdicts (previously unprobed FE-side)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            pi: { available: true, path: "/usr/local/bin/pi" },
            droid: { available: true, path: "/usr/local/bin/droid" },
            grok: { available: true, path: "/usr/local/bin/grok" },
          },
        },
        "host.providerAuthStatus": authSweep({ pi: true, droid: false, grok: null }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.pi).toEqual({ available: true, authenticated: true });
      expect(response.data?.providers.droid).toEqual({ available: true, authenticated: false });
      // Wire `null` = unknown → no authenticated field (no indicator).
      expect(response.data?.providers.grok).toEqual({ available: true });
    });

    it("does not attach verdicts to unavailable providers", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": NO_TOOLS,
        "host.providerAuthStatus": authSweep({ codex: true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.codex).toEqual({ available: false });
    });

    it("degrades auth to unknown when only the providerAuthStatus RPC fails", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.toolAvailability": NO_TOOLS,
        "host.providerAuthStatus": () => {
          throw new Error("transport down");
        },
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.success).toBe(true);
      expect(response.data?.providers.auggie).toEqual({ available: true });
    });

    it("warns when the claude CLI is installed but npx is missing (adapter runs via npx)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            claude: { available: true, path: "/usr/local/bin/claude" },
          },
        },
        "host.providerAuthStatus": authSweep({ "claude-code": true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.claudeCode).toEqual({
        available: true,
        authenticated: true,
        warning: CLAUDE_CODE_NPX_MISSING_WARNING,
      });
    });

    it("reports codex available on the real CLI alone (no local adapter needed)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            codex: { available: true, path: "/usr/local/bin/codex" },
            npx: { available: true, path: "/usr/local/bin/npx" },
          },
        },
        "host.providerAuthStatus": authSweep({ codex: true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      // npx can run the pinned codex-acp fallback — no warning.
      expect(response.data?.providers.codex).toEqual({
        available: true,
        authenticated: true,
      });
    });

    it("warns when the codex CLI is installed but neither codex-acp nor npx can run the adapter", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            codex: { available: true, path: "/usr/local/bin/codex" },
          },
        },
        "host.providerAuthStatus": authSweep({ codex: true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.codex).toEqual({
        available: true,
        authenticated: true,
        warning: CODEX_ADAPTER_MISSING_WARNING,
      });
    });

    it("does not warn on codex when a local codex-acp is present even without npx", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            codex: { available: true, path: "/usr/local/bin/codex" },
            "codex-acp": { available: true, path: "/usr/local/bin/codex-acp" },
          },
        },
        "host.providerAuthStatus": authSweep({ codex: true }),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      // A local adapter alone suppresses the warning — npx is only the fallback.
      expect(response.data?.providers.codex).toEqual({
        available: true,
        authenticated: true,
      });
    });

    it("keeps codex unavailable when only the codex-acp adapter is installed (CLI missing)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            "codex-acp": { available: true, path: "/usr/local/bin/codex-acp" },
          },
        },
        "host.providerAuthStatus": authSweep(),
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.codex).toEqual({ available: false });
      expect(response.data?.hasAnyProvider).toBe(false);
      // The FE never runs auth-check commands itself.
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
    });
  });

  describe("providers:check-single → host.checkAuggie / host.findBinary + host.providerAuthStatus", () => {
    it("rechecks auggie (string arg) with a forced single-provider auth verdict", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.providerAuthStatus": authOne("auggie", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "auggie");

      // Single rechecks follow "Login" / "Check again" clicks — force
      // bypasses the daemon's auth cache.
      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "auggie",
        force: true,
      });
      expect(response).toEqual({
        success: true,
        providerId: "auggie",
        data: { available: true, authenticated: true },
      });
    });

    it("rechecks claude-code with an npx probe — warning set when npx is missing", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          return name === "claude"
            ? { available: true, path: "/usr/local/bin/claude" }
            : { available: false };
        },
        "host.providerAuthStatus": authOne("claude-code", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "claude-code");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "npx" });
      expect(response).toEqual({
        success: true,
        providerId: "claude-code",
        data: {
          available: true,
          authenticated: true,
          warning: CLAUDE_CODE_NPX_MISSING_WARNING,
        },
      });
    });

    it("does not warn when the npx probe itself fails (unknown, not confirmed absence)", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "claude") return { available: true, path: "/usr/local/bin/claude" };
          throw new Error("transport down");
        },
        "host.providerAuthStatus": authOne("claude-code", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "claude-code");

      expect(response).toEqual({
        success: true,
        providerId: "claude-code",
        data: { available: true, authenticated: true },
      });
    });

    it("rechecks claude-code without a warning when npx is present", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "claude") return { available: true, path: "/usr/local/bin/claude" };
          if (name === "npx") return { available: true, path: "/usr/local/bin/npx" };
          return { available: false };
        },
        "host.providerAuthStatus": authOne("claude-code", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "claude-code");

      expect(response).toEqual({
        success: true,
        providerId: "claude-code",
        data: { available: true, authenticated: true },
      });
    });

    it("rechecks codex against the real CLI — warning when neither codex-acp nor npx resolves", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          return name === "codex"
            ? { available: true, path: "/usr/local/bin/codex" }
            : { available: false };
        },
        "host.providerAuthStatus": authOne("codex", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex-acp" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "npx" });
      // Auth comes from the daemon's forced single-provider verdict.
      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "codex",
        force: true,
      });
      expect(response).toEqual({
        success: true,
        providerId: "codex",
        data: {
          available: true,
          authenticated: true,
          warning: CODEX_ADAPTER_MISSING_WARNING,
        },
      });
    });

    it("rechecks codex without a warning when npx can run the pinned adapter fallback", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "codex") return { available: true, path: "/usr/local/bin/codex" };
          if (name === "npx") return { available: true, path: "/usr/local/bin/npx" };
          return { available: false };
        },
        "host.providerAuthStatus": authOne("codex", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      expect(response).toEqual({
        success: true,
        providerId: "codex",
        data: { available: true, authenticated: true },
      });
    });

    it("rechecks codex without a warning when a local codex-acp is present even without npx", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "codex") return { available: true, path: "/usr/local/bin/codex" };
          if (name === "codex-acp") return { available: true, path: "/usr/local/bin/codex-acp" };
          return { available: false };
        },
        "host.providerAuthStatus": authOne("codex", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      // A local adapter alone suppresses the warning — npx is only the fallback.
      expect(response).toEqual({
        success: true,
        providerId: "codex",
        data: { available: true, authenticated: true },
      });
    });

    it("does not warn on codex when the adapter probes fail (unknown, not confirmed absence)", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "codex") return { available: true, path: "/usr/local/bin/codex" };
          throw new Error("transport down");
        },
        "host.providerAuthStatus": authOne("codex", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      expect(response).toEqual({
        success: true,
        providerId: "codex",
        data: { available: true, authenticated: true },
      });
    });

    it("reports codex unavailable when the real CLI is missing even if codex-acp is installed", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          return name === "codex-acp"
            ? { available: true, path: "/usr/local/bin/codex-acp" }
            : { available: false };
        },
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(response).toEqual({
        success: true,
        providerId: "codex",
        data: { available: false },
      });
      // No auth verdict is fetched for an uninstalled CLI.
      expect(mockedRequest).not.toHaveBeenCalledWith(
        "host.providerAuthStatus",
        expect.anything(),
      );
    });

    it("rechecks pi with a forced auth verdict (daemon owns the probe)", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/pi" },
        "host.providerAuthStatus": authOne("pi", true),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "pi");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "pi" });
      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "pi",
        force: true,
      });
      expect(response).toEqual({
        success: true,
        providerId: "pi",
        data: { available: true, authenticated: true },
      });
    });

    it("rechecks droid with the daemon verdict — logged-out surfaces as false", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/droid" },
        "host.providerAuthStatus": authOne("droid", false),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "droid");

      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "droid",
        force: true,
      });
      expect(response).toEqual({
        success: true,
        providerId: "droid",
        data: { available: true, authenticated: false },
      });
    });

    it("folds a wire null verdict to no authenticated field (unknown, no indicator)", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/grok" },
        "host.providerAuthStatus": authOne("grok", null),
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "grok");

      expect(response).toEqual({
        success: true,
        providerId: "grok",
        data: { available: true },
      });
    });

    it("degrades auth to unknown when the providerAuthStatus RPC fails", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/opencode" },
        "host.providerAuthStatus": () => {
          throw new Error("transport down");
        },
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "opencode");

      expect(response).toEqual({
        success: true,
        providerId: "opencode",
        data: { available: true },
      });
    });

    it("rejects unknown providers without touching the daemon", async () => {
      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "not-a-provider");

      expect(response).toEqual({
        success: false,
        providerId: "not-a-provider",
        error: "Unknown provider: not-a-provider",
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe("providers:get-paths → host.checkAuggie + host.findBinary", () => {
    it("resolves auggie via host.checkAuggie and the other CLIs via host.findBinary", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          if (name === "claude") return { available: true, path: "/opt/homebrew/bin/claude" };
          if (name === "codex") return { available: true, path: "/opt/homebrew/bin/codex" };
          return { available: false };
        },
      });

      const response = await mockInvoke<
        Envelope<{ auggie: string | null; "claude-code": string | null; codex: string | null }>
      >(PROVIDERS_CHANNELS.GET_PATHS);

      expect(mockedRequest).toHaveBeenCalledWith("host.checkAuggie");
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "claude" });
      // codex resolves the real CLI (mirrors main's getCodexPath), not codex-acp.
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(response).toEqual({
        success: true,
        data: {
          auggie: "/usr/local/bin/auggie",
          "claude-code": "/opt/homebrew/bin/claude",
          codex: "/opt/homebrew/bin/codex",
        },
      });
    });

    it("folds per-binary daemon failures to null instead of failing the read", async () => {
      mockedRequest.mockRejectedValue(new Error("transport down"));

      const response = await mockInvoke(PROVIDERS_CHANNELS.GET_PATHS);

      expect(response).toEqual({
        success: true,
        data: { auggie: null, "claude-code": null, codex: null },
      });
    });
  });

  describe("auggie:status → host.checkAuggie + host.findBinary(node) + host.checkGit + host.providerAuthStatus", () => {
    type AuggieStatus = {
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
    };

    it("reports uninstalled auggie honestly while still surfacing node/git host facts", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.findBinary": { available: true, path: "/usr/local/bin/node", version: "v22.4.1" },
        "host.checkGit": { available: true, version: "git version 2.43.0", path: "/usr/bin/git" },
      });

      const response = await mockInvoke<Envelope<AuggieStatus>>(AUGGIE_CHANNELS.STATUS);

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "node" });
      expect(mockedRequest).toHaveBeenCalledWith("host.checkGit");
      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        installed: false,
        authenticated: false,
        versionOk: false,
        minimumVersion: MINIMUM_AUGGIE_VERSION,
        nodeVersion: "22.4.1",
        nodeVersionOk: true,
        gitInstalled: true,
        gitVersion: "git version 2.43.0",
        binaryInstallAvailable: false,
        managedBinaryInstalled: false,
      });
      // No auth verdict is fetched for an uninstalled CLI.
      expect(mockedRequest).not.toHaveBeenCalledWith(
        "host.providerAuthStatus",
        expect.anything(),
      );
    });

    it("marks below-minimum versions versionOk:false and skips the auth verdict", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.10.0" },
        "host.findBinary": { available: false },
        "host.checkGit": { available: false },
      });

      const response = await mockInvoke<Envelope<AuggieStatus>>(AUGGIE_CHANNELS.STATUS);

      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        installed: true,
        version: "0.10.0",
        versionOk: false,
        authenticated: false,
      });
      expect(mockedRequest).not.toHaveBeenCalledWith(
        "host.providerAuthStatus",
        expect.anything(),
      );
    });

    it("derives authenticated:true from the daemon verdict WITHOUT fabricating authDetails", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.findBinary": { available: true, path: "/usr/local/bin/node", version: "v22.4.1" },
        "host.checkGit": { available: true, version: "git version 2.43.0" },
        "host.providerAuthStatus": authOne("auggie", true),
      });

      const response = await mockInvoke<Envelope<AuggieStatus>>(AUGGIE_CHANNELS.STATUS);

      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "auggie",
        force: true,
      });
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
      expect(response.data).toMatchObject({
        installed: true,
        version: "0.14.0",
        versionOk: true,
        authenticated: true,
      });
      // No daemon user-info surface — never invent an identity string.
      expect(response.data?.authDetails).toBeUndefined();
    });

    it("surfaces a checkAuggie RPC failure as success:false WITH the partial status payload", async () => {
      routeDaemon({
        "host.checkAuggie": () => {
          throw new Error("transport down");
        },
        "host.findBinary": { available: true, path: "/usr/local/bin/node", version: "v22.4.1" },
        "host.checkGit": { available: true, version: "git version 2.43.0" },
      });

      const response = await mockInvoke<Envelope<AuggieStatus>>(AUGGIE_CHANNELS.STATUS);

      expect(response.success).toBe(false);
      expect(response.error).toContain("transport down");
      // ProviderSelector reads `data` regardless of success so node/git
      // warnings still render.
      expect(response.data).toMatchObject({ installed: false, nodeVersionOk: true });
    });
  });

  describe("*:check-availability → host.findBinary", () => {
    it("resolves each provider's binary and reports presence honestly", async () => {
      routeDaemon({
        "host.findBinary": (params: unknown) => ({
          available: (params as { name: string }).name === "codex",
          path: "/usr/local/bin/codex",
        }),
      });

      await expect(mockInvoke("codex:check-availability")).resolves.toEqual({
        success: true,
        available: true,
      });
      await expect(mockInvoke("claude-code:check-availability")).resolves.toEqual({
        success: true,
        available: false,
      });
      // codex keys off the real CLI, not the codex-acp adapter.
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "claude" });
    });

    it("default-denies cortex (feature-code gated) without touching the daemon", async () => {
      await expect(mockInvoke("cortex:check-availability")).resolves.toEqual({
        success: true,
        available: false,
      });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it("propagates daemon RPC failures (callers fold the rejection to false + warn)", async () => {
      routeDaemon({
        "host.findBinary": () => {
          throw new Error("transport down");
        },
      });
      await expect(mockInvoke("droid:check-availability")).rejects.toThrow("transport down");
    });
  });

  describe("auggie:install / auggie:authenticate → manual guidance + daemon auth verdict", () => {
    it("returns the manual npm install instructions (no fabricated install flow)", async () => {
      const response = await mockInvoke<
        Envelope<{ instructions?: string[]; command?: string }>
      >(AUGGIE_CHANNELS.INSTALL);
      expect(response.success).toBe(true);
      expect(response.data?.instructions?.[0]).toContain("Install the Auggie CLI");
      expect(response.data?.command).toBe("npm install -g @augmentcode/auggie");
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it("resolves authenticated:true when the daemon verdict passes", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.providerAuthStatus": authOne("auggie", true),
      });
      const response = await mockInvoke<Envelope<{ authenticated?: boolean }>>(
        AUGGIE_CHANNELS.AUTHENTICATE,
        { action: "start" },
      );
      expect(response).toEqual({ success: true, data: { authenticated: true } });
      expect(mockedRequest).toHaveBeenCalledWith("host.providerAuthStatus", {
        providerId: "auggie",
        force: true,
      });
    });

    it("returns `auggie login` instructions when installed but logged out", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.providerAuthStatus": authOne("auggie", false),
      });
      const response = await mockInvoke<
        Envelope<{ instructions?: string[]; command?: string; authenticated?: boolean }>
      >(AUGGIE_CHANNELS.AUTHENTICATE, { action: "start" });
      expect(response.success).toBe(true);
      expect(response.data?.authenticated).toBeUndefined();
      expect(response.data?.command).toBe("auggie login");
    });

    it("points at the install step when the CLI is missing entirely", async () => {
      routeDaemon({ "host.checkAuggie": { available: false } });
      const response = await mockInvoke<
        Envelope<{ instructions?: string[]; command?: string }>
      >(AUGGIE_CHANNELS.AUTHENTICATE, { action: "start" });
      expect(response.success).toBe(true);
      expect(response.data?.instructions?.[0]).toContain("not installed");
      expect(response.data?.command).toBe("npm install -g @augmentcode/auggie");
    });

    it("folds a checkAuggie RPC failure into a failure envelope (renders as guidance)", async () => {
      routeDaemon({
        "host.checkAuggie": () => {
          throw new Error("transport down");
        },
      });
      const response = await mockInvoke<Envelope<never>>(AUGGIE_CHANNELS.AUTHENTICATE, {
        action: "start",
      });
      expect(response).toEqual({ success: false, error: "transport down" });
    });
  });
});
