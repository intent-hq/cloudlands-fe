/**
 * Wire-contract + middleware tests for the agent-subscription read service.
 *
 * FAKE seam: `backendRequest` is stubbed so no daemon call happens. The
 * middleware is registered in the REAL configured store, so dispatching
 * `requestSubscriptionFetch` exercises the wiring, the request shape sent on
 * the wire (`agent.getSubscriptions`, PROTOCOL §5.5 extensions), the
 * response→slice mapping, waitingState derivation, and the LEAK-1 purge on
 * `workspaceDeleted` end to end. Mock payloads mirror the documented contract.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { backendRequestSpy } = vi.hoisted(() => ({
  backendRequestSpy: vi.fn(),
}));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => backendRequestSpy(method, params),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  fetchAgentSubscriptionSnapshot,
  refreshWorkspaceSubscriptionEntries,
  COMPLETED_DISPLAY_DURATION_MS,
  __resetAgentSubscriptionReadServiceForTests,
} from "./agent-subscription-read-service";
import {
  makeKey,
  requestSubscriptionFetch,
  setSubscriptionSnapshot,
} from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice";
import { workspaceDeleted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import type { AgentSubscriptionUIEntry } from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types";

const WS = "ws-sub-read-1";
const PARENT = "agent-parent-1";
const CHILD_A = "agent-child-a";
const CHILD_B = "agent-child-b";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** PROTOCOL §5.5 `agent.getSubscriptions` result with one after_all group. */
function wireResult() {
  return {
    subscriptions: [
      {
        id: "watch-1",
        agentId: PARENT,
        agentName: "Coordinator",
        workspaceId: WS,
        createdAt: "2026-01-01T00:00:00.000Z",
        oneShot: true,
        actorIds: [CHILD_A],
        eventTypes: ["agent:idle", "agent:failed", "agent:deleted"],
        delegationGroup: { groupId: "grp-1", awaitMode: "all" as const, expectedAgentIds: [CHILD_A, CHILD_B] },
        description: "Waiting for agent completion",
      },
    ],
    delegationGroups: [
      {
        groupId: "grp-1",
        parentAgentId: PARENT,
        awaitMode: "all" as const,
        expectedAgentIds: [CHILD_A, CHILD_B],
        completedAgentIds: [CHILD_A],
        deletedAgentIds: [],
        delivered: false,
      },
    ],
    agentStatuses: { [PARENT]: "waiting", [CHILD_A]: "completed", [CHILD_B]: "responding" },
  };
}

function emptyWireResult() {
  return { subscriptions: [], delegationGroups: [], agentStatuses: {} };
}

function readEntry(wsId: string, agentId: string): AgentSubscriptionUIEntry | undefined {
  const state = appStore.state as {
    agentSubscriptionUI?: { entries: Record<string, AgentSubscriptionUIEntry> };
  };
  return state.agentSubscriptionUI?.entries[makeKey(wsId, agentId)];
}

function getSubscriptionsCalls(): Array<[string, unknown]> {
  return backendRequestSpy.mock.calls.filter(([method]) => method === "agent.getSubscriptions");
}

describe("agent-subscription-read-service", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    __resetAgentSubscriptionReadServiceForTests();
    appStore.dispatch(workspaceDeleted(WS, []));
    __resetAgentSubscriptionReadServiceForTests();
    backendRequestSpy.mockReset();
    backendRequestSpy.mockResolvedValue(emptyWireResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("requestSubscriptionFetch sends the §5.5 request shape and maps the response into the slice", async () => {
    backendRequestSpy.mockResolvedValue(wireResult());
    appStore.dispatch(requestSubscriptionFetch(WS, PARENT));
    await flush();

    expect(getSubscriptionsCalls()).toContainEqual([
      "agent.getSubscriptions",
      { workspaceId: WS, agentId: PARENT },
    ]);

    const entry = readEntry(WS, PARENT);
    expect(entry).toBeDefined();
    expect(entry!.waitingState).toBe("waiting");
    expect(entry!.subscriptions).toEqual([
      {
        id: "watch-1",
        agentId: PARENT,
        eventTypes: ["agent:idle", "agent:failed", "agent:deleted"],
        actorIds: [CHILD_A],
        createdAt: "2026-01-01T00:00:00.000Z",
        description: "Waiting for agent completion",
        delegationGroup: { groupId: "grp-1", awaitMode: "all", expectedAgentIds: [CHILD_A, CHILD_B] },
      },
    ]);
    // Per-group agentStatuses are derived from the top-level map filtered to
    // expectedAgentIds (no per-group wire field exists).
    expect(entry!.delegationGroups).toEqual([
      {
        groupId: "grp-1",
        awaitMode: "all",
        expectedAgentIds: [CHILD_A, CHILD_B],
        completedAgentIds: [CHILD_A],
        deletedAgentIds: [],
        agentStatuses: { [CHILD_A]: "completed", [CHILD_B]: "responding" },
        delivered: false,
      },
    ]);
    expect(entry!.agentStatuses).toEqual({
      [PARENT]: "waiting",
      [CHILD_A]: "completed",
      [CHILD_B]: "responding",
    });
  });

  it("empty response keeps waitingState idle (no phantom completed on first fetch)", async () => {
    await fetchAgentSubscriptionSnapshot(WS, PARENT);
    const entry = readEntry(WS, PARENT);
    expect(entry).toBeDefined();
    expect(entry!.waitingState).toBe("idle");
    expect(entry!.subscriptions).toEqual([]);
    expect(entry!.delegationGroups).toEqual([]);
  });

  it("coalesces concurrent fetches for the same (workspace, agent)", async () => {
    backendRequestSpy.mockResolvedValue(wireResult());
    const first = fetchAgentSubscriptionSnapshot(WS, PARENT);
    const second = fetchAgentSubscriptionSnapshot(WS, PARENT);
    expect(second).toBe(first);
    await first;
    expect(getSubscriptionsCalls()).toHaveLength(1);
  });

  it("waiting → empty transitions to 'completed', then resets after the display window", async () => {
    vi.useFakeTimers();
    appStore.dispatch(
      setSubscriptionSnapshot(WS, PARENT, {
        subscriptions: [],
        delegationGroups: [
          {
            groupId: "grp-1",
            awaitMode: "all",
            expectedAgentIds: [CHILD_A],
            completedAgentIds: [],
            deletedAgentIds: [],
            agentStatuses: {},
            delivered: false,
          },
        ],
        agentStatuses: {},
        waitingState: "waiting",
      }),
    );

    // The daemon delivered the aggregated wake and dropped the group, so the
    // next snapshot comes back empty.
    backendRequestSpy.mockResolvedValue(emptyWireResult());
    await fetchAgentSubscriptionSnapshot(WS, PARENT);
    expect(readEntry(WS, PARENT)?.waitingState).toBe("completed");

    // The cleanup re-fetches (still empty) and removes the entry.
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(readEntry(WS, PARENT)).toBeUndefined();
  });

  it("completed cleanup refreshes instead of resetting when new active data arrived", async () => {
    vi.useFakeTimers();
    appStore.dispatch(
      setSubscriptionSnapshot(WS, PARENT, {
        subscriptions: [],
        delegationGroups: [
          {
            groupId: "grp-old",
            awaitMode: "all",
            expectedAgentIds: [CHILD_A],
            completedAgentIds: [CHILD_A],
            deletedAgentIds: [],
            agentStatuses: {},
            delivered: false,
          },
        ],
        agentStatuses: {},
        waitingState: "waiting",
      }),
    );
    backendRequestSpy.mockResolvedValue(emptyWireResult());
    await fetchAgentSubscriptionSnapshot(WS, PARENT);
    expect(readEntry(WS, PARENT)?.waitingState).toBe("completed");

    // A new delegation started during the display window.
    backendRequestSpy.mockResolvedValue(wireResult());
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(readEntry(WS, PARENT)?.waitingState).toBe("waiting");
    expect(readEntry(WS, PARENT)?.delegationGroups[0]?.groupId).toBe("grp-1");
  });

  it("refreshWorkspaceSubscriptionEntries re-fetches every tracked entry in the workspace only", async () => {
    backendRequestSpy.mockResolvedValue(wireResult());
    await fetchAgentSubscriptionSnapshot(WS, PARENT);
    await fetchAgentSubscriptionSnapshot(WS, "agent-parent-2");
    await fetchAgentSubscriptionSnapshot("ws-other", "agent-elsewhere");
    backendRequestSpy.mockClear();
    backendRequestSpy.mockResolvedValue(wireResult());

    refreshWorkspaceSubscriptionEntries(WS);
    await flush();

    const calls = getSubscriptionsCalls().map(([, params]) => params);
    expect(calls).toContainEqual({ workspaceId: WS, agentId: PARENT });
    expect(calls).toContainEqual({ workspaceId: WS, agentId: "agent-parent-2" });
    expect(calls).toHaveLength(2);
  });

  it("workspaceDeleted purges the workspace's entries and leaves other workspaces intact", async () => {
    backendRequestSpy.mockResolvedValue(wireResult());
    await fetchAgentSubscriptionSnapshot(WS, PARENT);
    await fetchAgentSubscriptionSnapshot("ws-other", "agent-elsewhere");
    expect(readEntry(WS, PARENT)).toBeDefined();

    appStore.dispatch(workspaceDeleted(WS, [PARENT]));

    expect(readEntry(WS, PARENT)).toBeUndefined();
    expect(readEntry("ws-other", "agent-elsewhere")).toBeDefined();
  });

  it("LEAK-1: a pre-purge fetch that resolves after workspaceDeleted is discarded", async () => {
    let resolveFetch!: (value: unknown) => void;
    backendRequestSpy.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    const pending = fetchAgentSubscriptionSnapshot(WS, PARENT);

    appStore.dispatch(workspaceDeleted(WS, [PARENT]));

    resolveFetch(wireResult());
    await pending;
    expect(readEntry(WS, PARENT)).toBeUndefined();
  });
});
