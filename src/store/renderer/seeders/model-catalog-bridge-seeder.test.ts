/**
 * Wire-contract tests for the model catalog bridge seeder.
 *
 * Asserts the 7 `*:get-models` channels forward uniformly to the daemon's
 * per-provider model catalog (`models.list { providerId, forceRefresh }`,
 * PROTOCOL §6.7) and return honest envelopes: mapped rows on success,
 * daemon-provided `warning`/`stale` labeling on fallback, and
 * `success: false` only on wire/transport failure.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";

const mockedRequest = vi.mocked(backendRequest);

type Envelope = {
  success: boolean;
  data?: Array<{ value: string; label: string; isDefault?: boolean }>;
  warning?: string;
  stale?: boolean;
  error?: string;
};

const ALL_CHANNELS: Array<[string, string]> = [
  ["auggie", "auggie:get-models"],
  ["claude-code", "claude-code:get-models"],
  ["codex", "codex:get-models"],
  ["cortex", "cortex:get-models"],
  ["droid", "droid:get-models"],
  ["opencode", "opencode:get-models"],
  ["pi", "pi:get-models"],
];

describe("model-catalog-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./model-catalog-bridge-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(ALL_CHANNELS)(
    "%s → models.list { providerId } with wire id/name mapped to value/label",
    async (providerId, channel) => {
      mockedRequest.mockResolvedValue({
        providerId,
        models: [
          { id: "model-a", name: "Model A", description: "desc", isDefault: true },
          { id: "model-b", name: "Model B" },
        ],
        source: providerId,
      });

      const response = await mockInvoke<Envelope>(channel);

      expect(mockedRequest).toHaveBeenCalledWith("models.list", { providerId });
      expect(response.success).toBe(true);
      // claude-code additionally gets the curated `default` alias appended
      // (see the dedicated alias tests below).
      expect(response.data?.slice(0, 2)).toEqual([
        { value: "model-a", label: "Model A", description: "desc", isDefault: true },
        { value: "model-b", label: "Model B" },
      ]);
      expect(response.data).toHaveLength(providerId === "claude-code" ? 3 : 2);
      expect(response.warning).toBeUndefined();
      expect(response.stale).toBeUndefined();
    },
  );

  it("forwards forceRefresh: true from the invoke payload", async () => {
    mockedRequest.mockResolvedValue({ providerId: "auggie", models: [] });

    await mockInvoke<Envelope>("auggie:get-models", { forceRefresh: true });

    expect(mockedRequest).toHaveBeenCalledWith("models.list", {
      providerId: "auggie",
      forceRefresh: true,
    });
  });

  it("omits forceRefresh from the wire params unless explicitly true", async () => {
    mockedRequest.mockResolvedValue({ providerId: "auggie", models: [] });

    await mockInvoke<Envelope>("auggie:get-models", { forceRefresh: false });

    expect(mockedRequest).toHaveBeenCalledWith("models.list", { providerId: "auggie" });
  });

  it("preserves the daemon's warning + stale labeling on fallback catalogs", async () => {
    mockedRequest.mockResolvedValue({
      providerId: "codex",
      models: [{ id: "gpt-5.3-codex/medium", name: "GPT-5.3 Codex (Medium)" }],
      source: "static",
      stale: true,
      warning: "Codex not installed; using static model list",
    });

    const response = await mockInvoke<Envelope>("codex:get-models");

    expect(response.success).toBe(true);
    expect(response.data).toEqual([
      { value: "gpt-5.3-codex/medium", label: "GPT-5.3 Codex (Medium)" },
    ]);
    expect(response.warning).toBe("Codex not installed; using static model list");
    expect(response.stale).toBe(true);
  });

  it("merges the curated claude-code `default` alias into non-empty live catalogs", async () => {
    // Regression (PR #216 review, finding 1): the daemon's live ACP parse does
    // not emit `default`, but `claude-code:default` is the smart-tier alias
    // and must stay valid/pickable when the live probe succeeds.
    mockedRequest.mockResolvedValue({
      providerId: "claude-code",
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
      source: "claude-code",
    });

    const response = await mockInvoke<Envelope>("claude-code:get-models");

    expect(response.success).toBe(true);
    expect(response.data?.map((m) => m.value)).toEqual(["claude-sonnet-4-5", "default"]);
  });

  it("does not fabricate the claude-code alias when the catalog is empty, nor duplicate it", async () => {
    mockedRequest.mockResolvedValue({
      providerId: "claude-code",
      models: [],
      warning: "Claude Code not available",
    });
    const empty = await mockInvoke<Envelope>("claude-code:get-models");
    expect(empty.data).toEqual([]);

    mockedRequest.mockResolvedValue({
      providerId: "claude-code",
      models: [{ id: "default", name: "Default (Claude Code)" }],
    });
    const withAlias = await mockInvoke<Envelope>("claude-code:get-models");
    expect(withAlias.data?.map((m) => m.value)).toEqual(["default"]);
  });

  it("drops malformed rows (missing id/name) instead of failing the envelope", async () => {
    mockedRequest.mockResolvedValue({
      providerId: "droid",
      models: [
        { id: "valid", name: "Valid" },
        { id: "", name: "No id" },
        { name: "Missing id" },
        { id: "missing-name" },
      ],
    });

    const response = await mockInvoke<Envelope>("droid:get-models");

    expect(response.success).toBe(true);
    expect(response.data).toEqual([{ value: "valid", label: "Valid" }]);
  });

  it("returns success: false only on wire/transport failure", async () => {
    mockedRequest.mockRejectedValue(new Error("daemon unreachable"));

    const response = await mockInvoke<Envelope>("cortex:get-models");

    expect(response.success).toBe(false);
    expect(response.error).toBe("daemon unreachable");
    expect(response.data).toBeUndefined();
  });
});
