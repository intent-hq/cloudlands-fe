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
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from "./backend-transport";
import { LiveSpecialistsClient } from "./live-specialists-client";
import type { AppClient, SpecialistDef } from "../app-client";
// Importing the seeder module registers "misc-ui-events" with the bootstrap
// registry so `seedMockStore` below drives the real seeder end-to-end.
import "$store/renderer/seeders/misc-ui-events-seeder";
import { seedMockStore } from "$store/renderer/mock-bootstrap";
import { store as appStore } from "$store/renderer/store";
import type { FileSpecialist } from "$store/renderer/slices/specialists/specialists-slice";
import { SPECIALISTS } from "$lib/constants/specialists";

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedUnsubscribe = vi.mocked(backendUnsubscribe);
const mockedOnNotification = vi.mocked(onBackendNotification);
const mockedOnReconnected = vi.mocked(onBackendReconnected);

/** Callback shape `onBackendNotification` registers (BackendNotification sink). */
type NotificationCallback = Parameters<typeof onBackendNotification>[0];

/** PROTOCOL §5.11 resolved view: a bundled def (no path) + a user-tier file. */
const COORDINATOR_DEF: SpecialistDef = {
  id: "spec-writer",
  name: "Coordinator",
  description: "Plans work, breaks down tasks, coordinates sub-agents",
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

    expect(mockedRequest).toHaveBeenCalledWith("specialist.list", undefined);
    expect(defs).toEqual([COORDINATOR_DEF, USER_DEF]);
  });

  it("list passes the optional provider as the resolution context (resolvedModel preview)", async () => {
    mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
    const client = new LiveSpecialistsClient();

    const defs = await client.list("claude-code");

    expect(mockedRequest).toHaveBeenCalledWith("specialist.list", { provider: "claude-code" });
    expect(defs).toEqual([COORDINATOR_DEF]);
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

  describe("subscribe (specialists:changed live refetch)", () => {
    afterEach(() => vi.useRealTimers());

    it("emits an initial snapshot and registers the specialists:changed subscription", async () => {
      mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      // Exact daemon subscription wire shape.
      expect(mockedSubscribe).toHaveBeenCalledWith({ eventTypes: ["specialists:changed"] });
      await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
      expect(handler).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("refetches specialist.list and emits the fresh resolved view on specialists:changed", async () => {
      vi.useFakeTimers();
      let notify: NotificationCallback | undefined;
      mockedOnNotification.mockImplementation((cb) => {
        notify = cb;
        return vi.fn();
      });
      mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]);
      handler.mockClear();

      mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF, USER_DEF] });
      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-1" } });
      await vi.advanceTimersByTimeAsync(100);

      // Refetch is the global specialist.list (no workspaceId, no provider).
      expect(mockedRequest).toHaveBeenLastCalledWith("specialist.list", undefined);
      expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF, USER_DEF]);
      unsubscribe();
    });

    it("debounces a burst of specialists:changed events into one refetch", async () => {
      vi.useFakeTimers();
      let notify: NotificationCallback | undefined;
      mockedOnNotification.mockImplementation((cb) => {
        notify = cb;
        return vi.fn();
      });
      mockedRequest.mockResolvedValue({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedRequest).toHaveBeenCalledTimes(1); // initial snapshot

      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-1" } });
      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-2" } });
      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-3" } });
      await vi.advanceTimersByTimeAsync(200);

      expect(mockedRequest).toHaveBeenCalledTimes(2); // initial + ONE debounced refetch
      unsubscribe();
    });

    it("ignores non-matching notifications", async () => {
      vi.useFakeTimers();
      let notify: NotificationCallback | undefined;
      mockedOnNotification.mockImplementation((cb) => {
        notify = cb;
        return vi.fn();
      });
      mockedRequest.mockResolvedValue({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      await vi.advanceTimersByTimeAsync(0);
      handler.mockClear();

      notify?.({ method: "skills:changed", params: { workspaceId: "ws-1" } });
      await vi.advanceTimersByTimeAsync(200);

      expect(mockedRequest).toHaveBeenCalledTimes(1); // initial snapshot only
      expect(handler).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("unsubscribes from the daemon subscription and removes the listener on dispose", async () => {
      const removeListener = vi.fn();
      mockedOnNotification.mockImplementation(() => removeListener);
      mockedSubscribe.mockResolvedValueOnce({ subscriptionId: "sub-42" });
      mockedRequest.mockResolvedValueOnce({ specialists: [] });
      const client = new LiveSpecialistsClient();

      const unsubscribe = client.subscribe(vi.fn());
      await vi.waitFor(() => expect(mockedSubscribe).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockedUnsubscribe).not.toHaveBeenCalled();

      unsubscribe();

      expect(removeListener).toHaveBeenCalled();
      expect(mockedUnsubscribe).toHaveBeenCalledWith("sub-42");
    });

    it("releases a daemon subscription that resolves after dispose (late-resolve guard)", async () => {
      let resolveSubscribe!: (value: { subscriptionId: string }) => void;
      mockedSubscribe.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSubscribe = resolve;
        }),
      );
      mockedRequest.mockResolvedValueOnce({ specialists: [] });
      const client = new LiveSpecialistsClient();

      const unsubscribe = client.subscribe(vi.fn());
      unsubscribe();
      expect(mockedUnsubscribe).not.toHaveBeenCalled();

      resolveSubscribe({ subscriptionId: "sub-late" });
      await vi.waitFor(() => expect(mockedUnsubscribe).toHaveBeenCalledWith("sub-late"));
    });

    it("cancels a pending debounced refetch and stops emitting after dispose", async () => {
      vi.useFakeTimers();
      let notify: NotificationCallback | undefined;
      mockedOnNotification.mockImplementation((cb) => {
        notify = cb;
        return vi.fn();
      });
      mockedRequest.mockResolvedValue({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      await vi.advanceTimersByTimeAsync(0);
      handler.mockClear();

      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-1" } });
      unsubscribe(); // dispose before the debounce timer fires
      await vi.advanceTimersByTimeAsync(200);

      expect(mockedRequest).toHaveBeenCalledTimes(1); // no refetch after dispose
      expect(handler).not.toHaveBeenCalled();
    });

    it("handles subscription registration failure gracefully (keeps the snapshot)", async () => {
      mockedSubscribe.mockRejectedValueOnce(new Error("subscribe boom"));
      mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
      unsubscribe();
      expect(mockedUnsubscribe).not.toHaveBeenCalled();
    });

    it("keeps the last known-good view when the event-driven refetch fails (#610)", async () => {
      vi.useFakeTimers();
      let notify: NotificationCallback | undefined;
      mockedOnNotification.mockImplementation((cb) => {
        notify = cb;
        return vi.fn();
      });
      mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF, USER_DEF] });
      const client = new LiveSpecialistsClient();

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF, USER_DEF]);
      handler.mockClear();

      // Transient transport failure on the refetch: NO emit — the handler
      // (and thus the store) keeps the prior resolved view instead of [].
      mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
      notify?.({ method: "specialists:changed", params: { workspaceId: "ws-1" } });
      await vi.advanceTimersByTimeAsync(200);

      expect(handler).not.toHaveBeenCalled();
      unsubscribe();
    });

    describe("reconnect (RESUB-1, #609)", () => {
      it("re-issues the subscribe and refetches the snapshot once on reconnect", async () => {
        let reconnect: (() => void) | undefined;
        mockedOnReconnected.mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        mockedSubscribe
          .mockResolvedValueOnce({ subscriptionId: "sub-1" })
          .mockResolvedValueOnce({ subscriptionId: "sub-2" });
        mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
        const client = new LiveSpecialistsClient();

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
        expect(mockedSubscribe).toHaveBeenCalledTimes(1);
        handler.mockClear();
        mockedRequest.mockClear();

        mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF, USER_DEF] });
        reconnect?.();

        // Re-subscribe with the same wire shape + exactly one snapshot refetch.
        expect(mockedSubscribe).toHaveBeenCalledTimes(2);
        expect(mockedSubscribe).toHaveBeenLastCalledWith({ eventTypes: ["specialists:changed"] });
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF, USER_DEF]));
        expect(mockedRequest).toHaveBeenCalledTimes(1);
        expect(mockedRequest).toHaveBeenCalledWith("specialist.list", undefined);

        // The refreshed id is released on dispose.
        unsubscribe();
        expect(mockedUnsubscribe).toHaveBeenCalledWith("sub-2");
      });

      it("cancels a pending debounced refetch on reconnect (exactly one refetch)", async () => {
        vi.useFakeTimers();
        let notify: NotificationCallback | undefined;
        mockedOnNotification.mockImplementation((cb) => {
          notify = cb;
          return vi.fn();
        });
        let reconnect: (() => void) | undefined;
        mockedOnReconnected.mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        mockedRequest.mockResolvedValue({ specialists: [COORDINATOR_DEF] });
        const client = new LiveSpecialistsClient();

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.advanceTimersByTimeAsync(0);
        expect(mockedRequest).toHaveBeenCalledTimes(1); // initial snapshot
        mockedRequest.mockClear();

        // A specialists:changed burst arms the debounce timer, then the
        // reconnect lands before it fires: the pending timer is cancelled and
        // the reconnect refetch is the ONLY specialist.list call.
        notify?.({ method: "specialists:changed", params: { workspaceId: "ws-1" } });
        reconnect?.();
        await vi.advanceTimersByTimeAsync(0);
        expect(mockedRequest).toHaveBeenCalledTimes(1); // immediate reconnect refetch

        await vi.advanceTimersByTimeAsync(200); // past the debounce window
        expect(mockedRequest).toHaveBeenCalledTimes(1); // no extra debounced refetch
        unsubscribe();
      });

      it("keeps the last known-good view when the reconnect refetch fails", async () => {
        let reconnect: (() => void) | undefined;
        mockedOnReconnected.mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
        const client = new LiveSpecialistsClient();

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
        handler.mockClear();

        mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
        reconnect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(handler).not.toHaveBeenCalled();
        unsubscribe();
      });

      it("does nothing when a reconnect races a dispose", async () => {
        let reconnect: (() => void) | undefined;
        mockedOnReconnected.mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        mockedRequest.mockResolvedValueOnce({ specialists: [COORDINATOR_DEF] });
        const client = new LiveSpecialistsClient();

        const handler = vi.fn();
        const unsubscribe = client.subscribe(handler);
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith([COORDINATOR_DEF]));
        expect(mockedSubscribe).toHaveBeenCalledTimes(1);
        handler.mockClear();
        mockedRequest.mockClear();

        unsubscribe();
        mockedUnsubscribe.mockClear();
        reconnect?.();
        await new Promise((resolve) => setTimeout(resolve, 0));

        // No re-subscribe, no refetch, no emit after dispose.
        expect(mockedSubscribe).toHaveBeenCalledTimes(1);
        expect(mockedRequest).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
      });

      it("releases a re-subscribe that resolves after a dispose (reconnect late-resolve guard)", async () => {
        let reconnect: (() => void) | undefined;
        mockedOnReconnected.mockImplementation((cb) => {
          reconnect = cb;
          return vi.fn();
        });
        mockedSubscribe.mockResolvedValueOnce({ subscriptionId: "sub-1" });
        mockedRequest.mockResolvedValue({ specialists: [COORDINATOR_DEF] });
        const client = new LiveSpecialistsClient();

        const unsubscribe = client.subscribe(vi.fn());
        await vi.waitFor(() => expect(mockedSubscribe).toHaveBeenCalledTimes(1));

        // Reconnect: the re-subscribe stays in flight while the dispose lands.
        let resolveSubscribe!: (value: { subscriptionId: string }) => void;
        mockedSubscribe.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSubscribe = resolve;
          }),
        );
        reconnect?.();
        unsubscribe();
        expect(mockedUnsubscribe).not.toHaveBeenCalled();

        resolveSubscribe({ subscriptionId: "sub-late" });
        await vi.waitFor(() => expect(mockedUnsubscribe).toHaveBeenCalledWith("sub-late"));
      });
    });
  });

  describe("write methods (create/edit/delete)", () => {
    it("create forwards specialist.create with id/spec and optional scope/workspacePath", async () => {
      const newSpec: SpecialistDef = {
        id: "reviewer",
        name: "Reviewer",
        description: "Reviews diffs",
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
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("dispatches daemon bundled defs (Coordinator) and user/project defs to their slices", async () => {
    await runSeeder([COORDINATOR_DEF, USER_DEF]);

    // The shared dispatchSpecialistList reconstructs the bundled set from the
    // SPECIALISTS constant overlaid with daemon entries by id, so the daemon's
    // Coordinator def replaces the constant's spec-writer entry.
    const state = appStore.state as SeederSpecialistsState;
    const coordinator = state.specialists?.bundledSpecialists?.find(
      (s) => s.id === "spec-writer",
    );
    expect(coordinator).toEqual({
      id: "spec-writer",
      name: "Coordinator",
      description: "Plans work, breaks down tasks, coordinates sub-agents",
      codingAgent: undefined,
      defaultModel: undefined,
      defaultBehaviorPrompt: "You plan, delegate, and verify.",
      roleReminder: undefined,
      source: "bundled",
      defaultAgentType: undefined,
      hidden: undefined,
    });
    expect(state.specialists?.fileSpecialists?.map["reviewer"]).toEqual({
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews diffs",
      codingAgent: undefined,
      model: "opus4.5",
      behaviorPrompt: "You review code changes…",
      roleReminder: undefined,
      filePath: "/home/u/.intent/specialists/reviewer.md",
      source: "user",
      hidden: undefined,
    });
  });

  it("falls back to the hardcoded SPECIALISTS (incl. Coordinator) when no bundled defs arrive", async () => {
    await runSeeder([USER_DEF]);

    const state = appStore.state as SeederSpecialistsState;
    const bundledIds = new Set(state.specialists?.bundledSpecialists?.map((s) => s.id));
    for (const builtin of SPECIALISTS) {
      expect(bundledIds.has(builtin.id), `bundled set missing ${builtin.id}`).toBe(true);
    }
    expect(bundledIds.has("spec-writer")).toBe(true);
  });
});

/** Shape of the specialists slice the seeder assertions read off the store. */
type SeederSpecialistsState = {
  specialists?: {
    bundledSpecialists?: typeof SPECIALISTS;
    fileSpecialists?: { map: Record<string, FileSpecialist> };
  };
};

/** Run the registered misc-ui-events seeder against a stub client + the real store. */
async function runSeeder(specialists: SpecialistDef[]): Promise<void> {
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
  await seedMockStore(appStore, client);
}
