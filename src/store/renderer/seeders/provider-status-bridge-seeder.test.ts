/**
 * Wire-contract tests for the provider status bridge seeder.
 *
 * Asserts `providers:get-availability`, `providers:check-single`, and
 * `auggie:status` forward to the canonical daemon probes (`host.checkAuggie`,
 * `host.toolAvailability`, `host.findBinary`, `host.checkGit`, `host.exec` —
 * PROTOCOL §5.14) and derive HONEST status from the responses: uninstalled /
 * unauthenticated states surface as-is, no mock@example.com fake positives.
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
    "codex-acp": { available: false },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
    codex: { available: false },
  },
};

type Envelope<T> = { success: boolean; data?: T; error?: string };

describe("provider-status-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./provider-status-bridge-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("providers:get-availability → host.checkAuggie + host.toolAvailability", () => {
    it("reports nothing installed honestly — no fake mock@example.com positives", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": NO_TOOLS,
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.checkAuggie");
      expect(mockedRequest).toHaveBeenCalledWith("host.toolAvailability", {
        tools: ["claude", "codex-acp", "opencode", "pi", "droid", "codex"],
      });
      expect(response.success).toBe(true);
      expect(response.data?.hasAnyProvider).toBe(false);
      expect(response.data?.providers.auggie).toEqual({ available: false });
      expect(response.data?.providers.mock).toEqual({ available: false });
      // Feature-code / env-var gated providers stay hidden (default-deny).
      expect(response.data?.hiddenProviders).toEqual(
        expect.arrayContaining(["cortex", "mock"]),
      );
      // No auth probes fire when nothing is installed.
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
    });

    it("probes auggie auth via `auggie model list` (host.exec) when installed", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.toolAvailability": NO_TOOLS,
        "host.exec": { stdout: "claude-sonnet-4\n", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/auggie",
        args: ["model", "list"],
        timeoutMs: 5000,
      });
      expect(response.data?.hasAnyProvider).toBe(true);
      expect(response.data?.providers.auggie).toEqual({ available: true, authenticated: true });
    });

    it("surfaces a logged-out auggie as authenticated:false (actionable, not fake-positive)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.toolAvailability": NO_TOOLS,
        "host.exec": {
          stdout: "",
          stderr: "You are not currently logged in. Run `auggie login`.",
          exitCode: 1,
        },
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

    it("runs the claude-code / codex exit-code auth probes against the right CLIs", async () => {
      // Availability keys: claude (prerequisite CLI) and codex-acp (adapter);
      // auth runs `claude auth status` and `codex login status` (real CLI).
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            claude: { available: true, path: "/usr/local/bin/claude" },
            "codex-acp": { available: true, path: "/usr/local/bin/codex-acp" },
            codex: { available: true, path: "/usr/local/bin/codex" },
          },
        },
        "host.exec": (params: unknown) => {
          const { command } = params as { command: string };
          // claude authenticated, codex not.
          return command.endsWith("/claude")
            ? { stdout: "Logged in", stderr: "", exitCode: 0 }
            : { stdout: "", stderr: "Not logged in", exitCode: 1 };
        },
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/claude",
        args: ["auth", "status"],
        timeoutMs: 5000,
      });
      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/codex",
        args: ["login", "status"],
        timeoutMs: 5000,
      });
      expect(response.data?.providers.claudeCode).toEqual({
        available: true,
        authenticated: true,
      });
      expect(response.data?.providers.codex).toEqual({ available: true, authenticated: false });
    });
  });

  describe("providers:check-single → host.checkAuggie / host.findBinary", () => {
    it("rechecks auggie (string arg) with the same availability + auth probes", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.exec": { stdout: "claude-sonnet-4\n", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "auggie");

      expect(response).toEqual({
        success: true,
        providerId: "auggie",
        data: { available: true, authenticated: true },
      });
    });

    it("reports pi presence-only (no auth signal → authenticated stays undefined)", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/pi" },
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "pi");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "pi" });
      expect(response).toEqual({
        success: true,
        providerId: "pi",
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
          return name === "claude"
            ? { available: true, path: "/opt/homebrew/bin/claude" }
            : { available: false };
        },
      });

      const response = await mockInvoke<
        Envelope<{ auggie: string | null; "claude-code": string | null; codex: string | null }>
      >(PROVIDERS_CHANNELS.GET_PATHS);

      expect(mockedRequest).toHaveBeenCalledWith("host.checkAuggie");
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "claude" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex-acp" });
      expect(response).toEqual({
        success: true,
        data: {
          auggie: "/usr/local/bin/auggie",
          "claude-code": "/opt/homebrew/bin/claude",
          codex: null,
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

  describe("auggie:status → host.checkAuggie + host.findBinary(node) + host.checkGit + host.exec", () => {
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
      // No auth probe for an uninstalled CLI.
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
    });

    it("marks below-minimum versions versionOk:false and skips the auth probe", async () => {
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
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
    });

    it("derives authenticated:true from the model-list probe WITHOUT fabricating authDetails", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.findBinary": { available: true, path: "/usr/local/bin/node", version: "v22.4.1" },
        "host.checkGit": { available: true, version: "git version 2.43.0" },
        "host.exec": { stdout: "claude-sonnet-4\n", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke<Envelope<AuggieStatus>>(AUGGIE_CHANNELS.STATUS);

      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/auggie",
        args: ["model", "list"],
        timeoutMs: 5000,
      });
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
});
