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
    "codex-acp": { available: false },
    npx: { available: false },
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
        tools: ["claude", "codex", "opencode", "pi", "droid", "codex-acp", "npx"],
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
      // Availability keys: claude and codex (the real prerequisite CLIs);
      // auth runs `claude auth status` and `codex login status`.
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

    it("warns when the claude CLI is installed but npx is missing (adapter runs via npx)", async () => {
      routeDaemon({
        "host.checkAuggie": { available: false },
        "host.toolAvailability": {
          tools: {
            ...NO_TOOLS.tools,
            claude: { available: true, path: "/usr/local/bin/claude" },
          },
        },
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
      });

      const response = await mockInvoke<Envelope<ProviderAvailabilityResult>>(
        PROVIDERS_CHANNELS.GET_AVAILABILITY,
      );

      expect(response.data?.providers.codex).toEqual({ available: false });
      expect(response.data?.hasAnyProvider).toBe(false);
      // No auth probe for an uninstalled CLI.
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
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

    it("rechecks claude-code with an npx probe — warning set when npx is missing", async () => {
      routeDaemon({
        "host.findBinary": (params) => {
          const { name } = params as { name: string };
          return name === "claude"
            ? { available: true, path: "/usr/local/bin/claude" }
            : { available: false };
        },
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke(PROVIDERS_CHANNELS.CHECK_SINGLE, "codex");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex-acp" });
      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "npx" });
      // Auth runs against the real codex CLI.
      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/codex",
        args: ["login", "status"],
        timeoutMs: 5000,
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
        "host.exec": { stdout: "Logged in", stderr: "", exitCode: 0 },
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
      expect(mockedRequest).not.toHaveBeenCalledWith("host.exec", expect.anything());
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

  describe("auggie:install / auggie:authenticate → manual guidance + real auth probe", () => {
    it("returns the manual npm install instructions (no fabricated install flow)", async () => {
      const response = await mockInvoke<
        Envelope<{ instructions?: string[]; command?: string }>
      >(AUGGIE_CHANNELS.INSTALL);
      expect(response.success).toBe(true);
      expect(response.data?.instructions?.[0]).toContain("Install the Auggie CLI");
      expect(response.data?.command).toBe("npm install -g @augmentcode/auggie");
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it("resolves authenticated:true when the daemon-host auth probe passes", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.exec": { stdout: "model-a\nmodel-b", stderr: "", exitCode: 0 },
      });
      const response = await mockInvoke<Envelope<{ authenticated?: boolean }>>(
        AUGGIE_CHANNELS.AUTHENTICATE,
        { action: "start" },
      );
      expect(response).toEqual({ success: true, data: { authenticated: true } });
      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/auggie",
        args: ["model", "list"],
        timeoutMs: 5000,
      });
    });

    it("returns `auggie login` instructions when installed but logged out", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie", version: "0.14.0" },
        "host.exec": { stdout: "Not logged in", stderr: "", exitCode: 1 },
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
