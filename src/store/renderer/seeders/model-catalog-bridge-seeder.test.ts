/**
 * Wire-contract tests for the model catalog bridge seeder.
 *
 * Asserts the 7 `*:get-models` channels forward to the canonical daemon
 * probes (`host.checkAuggie` / `host.findBinary` / `host.exec`, PROTOCOL
 * §5.14) and return HONEST envelopes: live catalogs where the CLI can be
 * probed, static/default catalogs where main fell back to them, and
 * empty-data warnings (never fabricated lists) everywhere else.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";
import { getCodexModelList } from "$shared/config/open-ai-codex-models";
import { CLAUDE_CODE_NPX_MISSING_WARNING } from "$shared/constants/claude-code";

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

type Envelope = {
  success: boolean;
  data?: Array<{ value: string; label: string; isDefault?: boolean }>;
  warning?: string;
  error?: string;
};

const AUGGIE_JSON = JSON.stringify({
  models: [
    { shortName: "legacy-1", displayName: "Legacy", isLegacyModel: true },
    { shortName: "sonnet-x", displayName: "Sonnet X", modelGroupPriority: 2, priority: 1 },
    { shortName: "opus-x", displayName: "Opus X", modelGroupPriority: 1, isDefault: true },
  ],
});

describe("model-catalog-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./model-catalog-bridge-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("auggie:get-models → host.checkAuggie + host.exec", () => {
    it("shells `auggie model list --json` on the daemon host and returns the sorted, legacy-filtered catalog", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie" },
        "host.exec": { stdout: AUGGIE_JSON, stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke<Envelope>("auggie:get-models");

      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/auggie",
        args: ["model", "list", "--json"],
        timeoutMs: 30000,
      });
      expect(response.success).toBe(true);
      expect(response.data?.map((m) => m.value)).toEqual(["opus-x", "sonnet-x"]);
      expect(response.data?.[0].isDefault).toBe(true);
    });

    it("falls back to plain-text parsing when the --json flag is unsupported", async () => {
      routeDaemon({
        "host.checkAuggie": { available: true, path: "/usr/local/bin/auggie" },
        "host.exec": (params: unknown) => {
          const { args } = params as { args: string[] };
          if (args.includes("--json")) return { stdout: "", stderr: "unknown flag", exitCode: 1 };
          return {
            stdout: "Available models:\n - Opus X [opus-x]\n     Best for hard tasks\n - Sonnet X [sonnet-x]",
            stderr: "",
            exitCode: 0,
          };
        },
      });

      const response = await mockInvoke<Envelope>("auggie:get-models");

      expect(response.success).toBe(true);
      expect(response.data).toEqual([
        { value: "opus-x", label: "Opus X", description: "Best for hard tasks" },
        { value: "sonnet-x", label: "Sonnet X" },
      ]);
    });

    it("fails honestly when auggie is not installed — no fabricated catalog", async () => {
      routeDaemon({ "host.checkAuggie": { available: false } });

      const response = await mockInvoke<Envelope>("auggie:get-models");

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/not found/i);
      expect(response.data).toBeUndefined();
    });
  });

  describe("opencode:get-models → host.findBinary + host.exec", () => {
    it("parses one provider/model per line from `opencode models`", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/opencode" },
        "host.exec": {
          stdout: "anthropic/claude-sonnet-4\nopenai/gpt-5.2\n# comment\nnot-a-model\n",
          stderr: "",
          exitCode: 0,
        },
      });

      const response = await mockInvoke<Envelope>("opencode:get-models");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "opencode" });
      expect(mockedRequest).toHaveBeenCalledWith("host.exec", {
        command: "/usr/local/bin/opencode",
        args: ["models"],
        timeoutMs: 10000,
      });
      expect(response.success).toBe(true);
      expect(response.data?.map((m) => m.value)).toEqual([
        "anthropic/claude-sonnet-4",
        "openai/gpt-5.2",
      ]);
      expect(response.data?.[0].label).toBe("Anthropic Claude Sonnet 4");
    });

    it("fails honestly when opencode is not installed", async () => {
      routeDaemon({ "host.findBinary": { available: false } });

      const response = await mockInvoke<Envelope>("opencode:get-models");

      expect(response.success).toBe(false);
      expect(response.data).toEqual([]);
    });

    it("surfaces a non-zero exit as an error, not an empty success", async () => {
      routeDaemon({
        "host.findBinary": { available: true, path: "/usr/local/bin/opencode" },
        "host.exec": { stdout: "", stderr: "no credentials", exitCode: 1 },
      });

      const response = await mockInvoke<Envelope>("opencode:get-models");

      expect(response.success).toBe(false);
      expect(response.error).toBe("no credentials");
    });
  });

  describe("codex:get-models → static catalog", () => {
    it("returns the shared static catalog with an installed-aware warning", async () => {
      routeDaemon({ "host.findBinary": { available: true, path: "/usr/local/bin/codex" } });

      const response = await mockInvoke<Envelope>("codex:get-models");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "codex" });
      expect(response.success).toBe(true);
      expect(response.data).toEqual(getCodexModelList());
      expect(response.warning).toMatch(/dynamic model list unavailable/i);
    });

    it("flags the not-installed fallback in the warning", async () => {
      routeDaemon({ "host.findBinary": { available: false } });

      const response = await mockInvoke<Envelope>("codex:get-models");

      expect(response.success).toBe(true);
      expect(response.data).toEqual(getCodexModelList());
      expect(response.warning).toMatch(/not installed/i);
    });
  });

  describe("claude-code / pi — default-model catalogs", () => {
    it("returns the Default (Claude Code) entry when the claude CLI is installed", async () => {
      routeDaemon({ "host.findBinary": { available: true, path: "/usr/local/bin/claude" } });

      const response = await mockInvoke<Envelope>("claude-code:get-models");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "claude" });
      expect(response.success).toBe(true);
      expect(response.data).toEqual([
        {
          value: "default",
          label: "Default (Claude Code)",
          description: "Use Claude Code default model",
        },
      ]);
    });

    it("returns empty data + warning when claude is not installed (client folds to a thrown error)", async () => {
      routeDaemon({ "host.findBinary": { available: false } });

      const response = await mockInvoke<Envelope>("claude-code:get-models");

      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.warning).toBe("Claude Code not available");
    });

    it("returns empty data + npx-missing warning when claude is installed but npx is not", async () => {
      routeDaemon({
        "host.findBinary": (params: unknown) => {
          const { name } = params as { name: string };
          return name === "claude"
            ? { available: true, path: "/usr/local/bin/claude" }
            : { available: false };
        },
      });

      const response = await mockInvoke<Envelope>("claude-code:get-models");

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "npx" });
      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.warning).toBe(CLAUDE_CODE_NPX_MISSING_WARNING);
    });

    it("always serves the Default (Pi) entry, mirroring the main handler's fallback", async () => {
      routeDaemon({ "host.findBinary": { available: false } });

      const response = await mockInvoke<Envelope>("pi:get-models");

      expect(response.success).toBe(true);
      expect(response.data).toEqual([
        { value: "default", label: "Default (Pi)", description: "Use Pi default model" },
      ]);
      expect(response.warning).toMatch(/unavailable/i);
    });
  });

  describe("cortex / droid — honest empty terminal states", () => {
    it("default-denies cortex (feature-code gate is not renderer-verifiable)", async () => {
      routeDaemon({});

      const response = await mockInvoke<Envelope>("cortex:get-models");

      expect(response).toEqual({ success: true, data: [], warning: "Cortex not available" });
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it("droid: distinguishes not-installed from probe-unavailable, never fabricates models", async () => {
      routeDaemon({ "host.findBinary": { available: false } });
      const notInstalled = await mockInvoke<Envelope>("droid:get-models");
      expect(notInstalled).toEqual({ success: true, data: [], warning: "Droid not available" });

      routeDaemon({ "host.findBinary": { available: true, path: "/usr/local/bin/droid" } });
      const installed = await mockInvoke<Envelope>("droid:get-models");
      expect(installed.success).toBe(true);
      expect(installed.data).toEqual([]);
      expect(installed.warning).toMatch(/unavailable in this build/i);
    });
  });
});
