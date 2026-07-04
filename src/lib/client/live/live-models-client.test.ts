/**
 * Wire-contract tests for the live models domain (PROTOCOL §5.30).
 *
 * Regression: the models catalog was stubbed to the mock client, so the
 * daemon's rich `models.list` view (auggie CLI + 5-minute cache + static
 * fallback) never reached the picker. Asserts (a) the exact JSON-RPC request
 * the client emits, (b) PROTOCOL §5.30 `ModelInfo` responses map to the FE
 * `AuggieModel` shape (`id → value`, `name → label`) with optional metadata
 * preserved, and (c) transport failures / malformed payloads fold to an empty
 * list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveModelsClient } from "./live-models-client";

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.30 example row — the daemon-canonical `id`/`name` names. */
const SONNET_ROW = {
  id: "sonnet4.5",
  name: "Sonnet 4.5",
  provider: "auggie",
  description: "Balanced general model",
  modelGroupPriority: 1,
  costTier: 2,
  badges: [{ color: "green", label: "Auto" }],
  effortLevels: ["low", "medium", "high"],
  isDefault: true,
  priority: 1,
};

describe("LiveModelsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("list forwards models.list (global — no workspaceId) and remaps id/name → value/label", async () => {
    mockedRequest.mockResolvedValueOnce({ models: [SONNET_ROW], source: "auggie" });
    const client = new LiveModelsClient();

    const models = await client.list();

    expect(mockedRequest).toHaveBeenCalledWith("models.list");
    expect(models).toEqual([
      {
        value: "sonnet4.5",
        label: "Sonnet 4.5",
        description: "Balanced general model",
        modelGroupPriority: 1,
        costTier: 2,
        badges: [{ color: "green", label: "Auto" }],
        effortLevels: ["low", "medium", "high"],
        isDefault: true,
        priority: 1,
      },
    ]);
  });

  it("omits optional metadata that the wire row does not carry", async () => {
    mockedRequest.mockResolvedValueOnce({
      models: [{ id: "haiku", name: "Haiku", provider: "auggie" }],
    });
    const client = new LiveModelsClient();

    expect(await client.list()).toEqual([{ value: "haiku", label: "Haiku" }]);
  });

  it("drops rows missing id/name so the picker never renders a blank entry", async () => {
    mockedRequest.mockResolvedValueOnce({
      models: [
        { name: "Nameless" },
        { id: "idless" },
        { id: "ok", name: "Ok", provider: "auggie" },
      ],
    });
    const client = new LiveModelsClient();

    expect(await client.list()).toEqual([{ value: "ok", label: "Ok" }]);
  });

  it("folds a malformed result (no models array) to an empty list", async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveModelsClient();

    expect(await client.list()).toEqual([]);
  });

  it("folds a transport failure to an empty list (seeder falls back to static)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
    const client = new LiveModelsClient();

    expect(await client.list()).toEqual([]);
  });

  it("subscribe emits one snapshot of the current catalog", async () => {
    mockedRequest.mockResolvedValueOnce({ models: [SONNET_ROW], source: "auggie" });
    const client = new LiveModelsClient();

    const handler = vi.fn();
    client.subscribe(handler);
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledWith([
        expect.objectContaining({ value: "sonnet4.5", label: "Sonnet 4.5" }),
      ]),
    );
  });
});
