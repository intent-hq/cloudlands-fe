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
  path: "/home/u/.intent/specialists/reviewer.md",
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

  describe("write methods (create/edit/delete)", () => {
    it("create forwards specialist.create with id/spec and optional scope/workspacePath", async () => {
      const newSpec: SpecialistDef = {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews diffs",
        modelTier: "high",
        prompt: "You review code changes.",
        behaviorPrompt: "You review code changes.",
        source: "user",
        isCustomized: true,
      };
      mockedRequest.mockResolvedValueOnce({ specialist: newSpec });
      const client = new LiveSpecialistsClient();

      const result = await client.create("reviewer", newSpec);

      expect(result).toEqual(newSpec);
      expect(mockedRequest).toHaveBeenCalledWith("specialist.create", {
        id: "reviewer",
        spec: newSpec,
      });
    });

    it("create includes scope=project when provided", async () => {
      const newSpec: SpecialistDef = {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews diffs",
        prompt: "body",
        behaviorPrompt: "body",
        source: "project",
        isCustomized: true,
      };
      mockedRequest.mockResolvedValueOnce({ specialist: newSpec });
      const client = new LiveSpecialistsClient();

      await client.create("reviewer", newSpec, "project", "/ws/path");

      expect(mockedRequest).toHaveBeenCalledWith("specialist.create", {
        id: "reviewer",
        spec: newSpec,
        scope: "project",
        workspacePath: "/ws/path",
      });
    });

    it("create propagates daemon errors without swallowing (existing id in scope)", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("specialist already exists in user scope: reviewer"));
      const client = new LiveSpecialistsClient();
      const spec: SpecialistDef = {
        id: "reviewer",
        name: "Reviewer",
        description: "d",
        prompt: "p",
        behaviorPrompt: "p",
        source: "user",
      };

      await expect(client.create("reviewer", spec)).rejects.toThrow(
        "specialist already exists in user scope: reviewer",
      );
    });

    it("edit forwards specialist.edit with id/spec/scope and optional workspacePath", async () => {
      const editedSpec: SpecialistDef = {
        id: "reviewer",
        name: "Reviewer v2",
        description: "Reviews diffs carefully",
        prompt: "v2",
        behaviorPrompt: "v2",
        source: "user",
        isCustomized: true,
      };
      mockedRequest.mockResolvedValueOnce({ specialist: editedSpec });
      const client = new LiveSpecialistsClient();

      const result = await client.edit("reviewer", editedSpec, "user");

      expect(result).toEqual(editedSpec);
      expect(mockedRequest).toHaveBeenCalledWith("specialist.edit", {
        id: "reviewer",
        spec: editedSpec,
        scope: "user",
      });
    });

    it("edit includes workspacePath when provided", async () => {
      const editedSpec: SpecialistDef = {
        id: "implementor",
        name: "Implementor",
        description: "d",
        prompt: "p",
        behaviorPrompt: "p",
        source: "project",
        isCustomized: true,
      };
      mockedRequest.mockResolvedValueOnce({ specialist: editedSpec });
      const client = new LiveSpecialistsClient();

      await client.edit("implementor", editedSpec, "project", "/ws/path");

      expect(mockedRequest).toHaveBeenCalledWith("specialist.edit", {
        id: "implementor",
        spec: editedSpec,
        scope: "project",
        workspacePath: "/ws/path",
      });
    });

    it("edit propagates daemon errors without swallowing (missing file)", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("specialist not found in user scope: missing"));
      const client = new LiveSpecialistsClient();
      const spec: SpecialistDef = {
        id: "missing",
        name: "Missing",
        description: "d",
        prompt: "p",
        behaviorPrompt: "p",
        source: "user",
      };

      await expect(client.edit("missing", spec, "user")).rejects.toThrow(
        "specialist not found in user scope: missing",
      );
    });

    it("delete forwards specialist.delete with id/scope and optional workspacePath", async () => {
      mockedRequest.mockResolvedValueOnce({ success: true });
      const client = new LiveSpecialistsClient();

      const result = await client.delete("reviewer", "user");

      expect(result).toEqual({ success: true });
      expect(mockedRequest).toHaveBeenCalledWith("specialist.delete", {
        id: "reviewer",
        scope: "user",
      });
    });

    it("delete includes workspacePath when provided", async () => {
      mockedRequest.mockResolvedValueOnce({ success: true });
      const client = new LiveSpecialistsClient();

      await client.delete("implementor", "project", "/ws/path");

      expect(mockedRequest).toHaveBeenCalledWith("specialist.delete", {
        id: "implementor",
        scope: "project",
        workspacePath: "/ws/path",
      });
    });

    it("delete propagates daemon errors without swallowing (bundled is read-only)", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("bundled specialists are read-only"));
      const client = new LiveSpecialistsClient();

      await expect(client.delete("implementor", "user")).rejects.toThrow(
        "bundled specialists are read-only",
      );
    });

    it("delete propagates daemon errors when file is missing", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("specialist not found in user scope: missing"));
      const client = new LiveSpecialistsClient();

      await expect(client.delete("missing", "user")).rejects.toThrow(
        "specialist not found in user scope: missing",
      );
    });
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
        filePath: "/home/u/.intent/specialists/reviewer.md",
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
