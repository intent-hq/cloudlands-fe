/**
 * Wire-contract tests for the live providers domain (PROTOCOL §5.38).
 *
 * Asserts (a) the exact JSON-RPC request the client emits on the
 * `backend:request` channel (`providers.catalog`, `{}` params — daemon-global,
 * no `workspaceId`), (b) a PROTOCOL-shaped response passes through verbatim
 * (registry order preserved, gated-off rows and optional fields intact), and
 * (c) divergent payloads and transport failures THROW — the FE never silently
 * absorbs a wire mismatch (fix-site is the BE or PROTOCOL.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import type { ProviderCatalogResult } from "$shared/provider-catalog";
import { LiveProvidersClient } from "./live-providers-client";

/** PROTOCOL §5.38-shaped response — registry order has unsloth before pi. */
const CATALOG: ProviderCatalogResult = {
  providers: [
    {
      id: "auggie",
      displayName: "Augment Auggie",
      shortName: "Auggie",
      command: "auggie",
      isDefault: true,
      canBeDisabled: true,
      loginCommandHint: "auggie login",
      authErrorPatterns: ["authentication required", "auggie login"],
      visible: true,
      modelTiers: { fast: "haiku4.5", balanced: "sonnet4.5", smart: "opus4.7" },
    },
    {
      id: "unsloth",
      displayName: "Unsloth",
      shortName: "Unsloth",
      command: "opencode",
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: "https://docs.unsloth.ai",
      visible: true,
    },
    {
      id: "pi",
      displayName: "Pi",
      shortName: "Pi",
      command: "pi-acp",
      isDefault: false,
      canBeDisabled: true,
      loginDocsUrl: "https://pi.dev/docs/latest/quickstart",
      visible: true,
    },
    {
      id: "mock",
      displayName: "Mock (E2E)",
      shortName: "Mock",
      command: "node",
      isDefault: false,
      canBeDisabled: true,
      requiresEnvVar: "MOCK_AGENT_SCRIPT_PATH",
      visible: false,
    },
  ],
  defaultProviderId: "auggie",
};

describe("LiveProvidersClient", () => {
  let client: LiveProvidersClient;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    client = new LiveProvidersClient();
    mockInvoke = vi.fn();
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: mockInvoke,
        on: vi.fn(),
        offById: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.stubGlobal("window", originalWindow);
  });

  it("invokes providers.catalog with empty params via backend:request (§5.38)", async () => {
    mockInvoke.mockResolvedValue({ ok: true, result: CATALOG });

    await client.catalog();

    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: "providers.catalog",
      params: {},
    });
  });

  it("passes a PROTOCOL-shaped catalog through verbatim, preserving registry order", async () => {
    mockInvoke.mockResolvedValue({ ok: true, result: CATALOG });

    const result = await client.catalog();

    expect(result).toEqual(CATALOG);
    // Registry order (unsloth before pi) survives — clients must key by id,
    // but the order is carried through faithfully for informational use.
    expect(result.providers.map((p) => p.id)).toEqual(["auggie", "unsloth", "pi", "mock"]);
    // Optional fields are present-by-presence: absent on dynamic providers.
    expect(result.providers[1].modelTiers).toBeUndefined();
    expect(result.providers[3].visible).toBe(false);
  });

  it("throws on a payload that diverges from the §5.38 shape (never silently absorbed)", async () => {
    mockInvoke.mockResolvedValue({
      ok: true,
      result: {
        providers: [{ id: "auggie", displayName: "Augment Auggie" }],
        defaultProviderId: "auggie",
      },
    });

    await expect(client.catalog()).rejects.toThrow();
  });

  it("throws on transport failure so the seeder keeps the previous catalog", async () => {
    mockInvoke.mockResolvedValue({
      ok: false,
      error: { code: "TRANSPORT_ERROR", message: "uds boom" },
    });

    await expect(client.catalog()).rejects.toThrow();
  });
});
