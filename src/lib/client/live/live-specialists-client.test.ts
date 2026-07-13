/**
 * Wire-contract tests for the live specialists domain (PROTOCOL §5.11).
 *
 * Regression: the specialists dropdown was stubbed to the mock client, so the
 * daemon's merged `specialist.list` view (bundled Coordinator + user/project
 * files) never reached the store. Asserts (a) the exact JSON-RPC request the
 * client emits, (b) PROTOCOL-shaped responses surface verbatim, and (c) the
 * seeder splits the merged list into the bundled/file store slices so the
 * Coordinator option is populated.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveSpecialistsClient } from "./live-specialists-client";
import type { AppClient, SpecialistDef } from "../app-client";
// Importing the seeder module registers "misc-ui-events" with the bootstrap
// registry so `seedMockStore` below drives the real seeder end-to-end.
import "$store/renderer/seeders/misc-ui-events-seeder";
import { seedMockStore } from "$store/renderer/mock-bootstrap";
import {
  setBundledSpecialists,
  setFileSpecialists,
} from "$store/renderer/slices/specialists/specialists-slice";
import { SPECIALISTS } from "$lib/constants/specialists";

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.11 resolved view: a bundled def (no path) + a user-tier file. */
const COORDINATOR_DEF: SpecialistDef = {
  id: "spec-writer",
  name: "Coordinator",
  description: "Plans work, breaks down tasks, coordinates sub-agents",
  modelTier: "smart",
  prompt: "You plan, delegate, and verify.",
  behaviorPrompt: "You plan, delegate, and verify.",
  source: "bundled",
  isCustomized: false,
};
const USER_DEF: SpecialistDef = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews diffs",
  model: "opus4.5",
  prompt: "You review code changes…",
  behaviorPrompt: "You review code changes…",
  source: "user",
  isCustomized: true,
  path: "/home/u/.augment/specialists/reviewer.md",
};

describe("LiveSpecialistsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("list forwards specialist.list (global — no workspaceId) and returns the defs verbatim", async () => {
    mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF, USER_DEF] });
    const client = new LiveSpecialistsClient();

    const defs = await client.list();

    expect(mockedRequest).toHaveBeenCalledWith("specialist.list");
    expect(defs).toEqual([COORDINATOR_DEF, USER_DEF]);
  });

  it("list folds a malformed result (no specialists array) to an empty list", async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveSpecialistsClient();

    expect(await client.list()).toEqual([]);
  });

  it("list folds a transport failure to an empty list (picker falls back to hardcoded SPECIALISTS)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
    const client = new LiveSpecialistsClient();

    expect(await client.list()).toEqual([]);
  });

  it("subscribe emits one snapshot of the current resolved view", async () => {
    mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
    const client = new LiveSpecialistsClient();

    const handler = vi.fn();
    client.subscribe(handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
  });
});

describe("misc-ui-events seeder splits specialist.list into the store slices", () => {
  afterEach(() => vi.clearAllMocks());

  it("dispatches daemon bundled defs (Coordinator) and user/project defs to their slices", async () => {
    const dispatch = vi.fn();
    await runSeeder(dispatch, [COORDINATOR_DEF, USER_DEF]);

    expect(payloadOf(dispatch, setBundledSpecialists.type)).toEqual([
      {
        id: "spec-writer",
        name: "Coordinator",
        description: "Plans work, breaks down tasks, coordinates sub-agents",
        codingAgent: undefined,
        defaultModel: undefined,
        defaultModelTier: "smart",
        defaultBehaviorPrompt: "You plan, delegate, and verify.",
        roleReminder: undefined,
        source: "bundled",
        defaultAgentType: undefined,
      },
    ]);
    expect(payloadOf(dispatch, setFileSpecialists.type)).toEqual([
      {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews diffs",
        codingAgent: undefined,
        model: "opus4.5",
        modelTier: undefined,
        behaviorPrompt: "You review code changes…",
        roleReminder: undefined,
        filePath: "/home/u/.augment/specialists/reviewer.md",
        source: "user",
      },
    ]);
  });

  it("falls back to the hardcoded SPECIALISTS (incl. Coordinator) when no bundled defs arrive", async () => {
    const dispatch = vi.fn();
    await runSeeder(dispatch, [USER_DEF]);

    const bundled = payloadOf(dispatch, setBundledSpecialists.type) as { id: string }[];
    expect(bundled).toBe(SPECIALISTS);
    expect(bundled.some((s) => s.id === "spec-writer")).toBe(true);
  });
});

/** Run the registered misc-ui-events seeder against a stub client + recording store. */
async function runSeeder(
  dispatch: ReturnType<typeof vi.fn>,
  specialists: SpecialistDef[],
): Promise<void> {
  const client = {
    system: {
      status: async () => ({
        nodeVersionOk: true,
        nodeVersion: "v20.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: false,
      }),
    },
    settings: { getProviderSettings: async () => null },
    models: { list: async () => [] },
    specialists: { list: async () => specialists, subscribe: () => () => {} },
    workspaces: { list: async () => [] },
  } as unknown as AppClient;
  await seedMockStore({ state: {}, dispatch } as never, client);
}

/** First payload argument of the first dispatched action with the given type. */
function payloadOf(dispatch: ReturnType<typeof vi.fn>, type: string): unknown {
  const action = dispatch.mock.calls
    .map((call) => call[0] as { type?: string; payload?: unknown[] })
    .find((a) => a?.type === type);
  return action?.payload?.[0];
}
