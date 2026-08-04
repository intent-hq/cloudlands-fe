import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import { AgentActivationState } from "$shared/types/agent-session";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seam: `appClient.agents.get` + `appClient.agents.delete` +
// `appClient.agents.rename` are stubbed. The mutation middleware runs against
// the REAL configured store so the restore/activate/save + deletion + rename
// async actions resolve through the real action.success/failure path and
// their promises settle exactly as agent-send (and the deletion/
// rename triggers) expect.
const { get, del, list, rename, dismissQuestions, stop, cancelSubscriptions } = vi.hoisted(() => ({
  get: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
  rename: vi.fn(),
  dismissQuestions: vi.fn(),
  stop: vi.fn(),
  cancelSubscriptions: vi.fn(),
}));
vi.mock("$lib/client", () => ({
  appClient: {
    agents: { get, delete: del, list, rename, dismissQuestions, stop, cancelSubscriptions },
  },
}));

// The deletion handlers lazily `import("svelte-sonner")` for the undo/error
// toasts; stub it so no real toast component is mounted.
vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// The undo handler lazily imports the subscription read service to refetch the
// workspace's entries. Override ONLY that export (importOriginal keeps
// `createAgentSubscriptionReadMiddleware` real for the configured store's
// middleware chain) so the test can assert the refetch without a wire call.
const { refreshWorkspaceSubscriptionEntries } = vi.hoisted(() => ({
  refreshWorkspaceSubscriptionEntries: vi.fn(),
}));
vi.mock("./agent-subscription-read-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-subscription-read-service")>();
  return { ...actual, refreshWorkspaceSubscriptionEntries };
});

import { store as appStore } from "$store/renderer/store";
import { toast } from "svelte-sonner";
import {
  agentSessionDismissQuestionsRequested,
  bulkUpsertSessions,
  removeSession,
  updateSession,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  activateAgentRequested,
  commitPendingAgentDeletionRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  flushPendingAgentDeletionsRequested,
  hydrateAgentsRequested,
  renameAgentSessionRequested,
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
  undoAgentDeletionRequested,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import {
  cancelAgentSubscriptionsRequested,
  makeKey,
  setSubscriptionSnapshot,
} from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice";
import type { AgentSubscriptionUIEntry } from "$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types";
import {
  closeTab,
  initializeLayout,
  pruneRecentlyClosed,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import { selectRecentlyClosed } from "$store/renderer/slices/panel-layout/panel-layout-selectors";

function makeSession(id: string, wsId: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    backendSessionId: "backend-" + id,
    workspaceId: wsId,
    name: "Agent",
    status: AgentStatus.Active,
    messages: [],
    model: "sonnet",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function readSession(agentId: string): AgentSession | undefined {
  return (appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } })
    .agentSessions?.byAgentId[agentId];
}

function seedSession(session: AgentSession): void {
  appStore.dispatch(bulkUpsertSessions([session]));
  appStore.dispatch(upsertSession(session));
}

describe("agentMutationService (fake appClient.agents.get, real store)", () => {
  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    get.mockReset();
  });

  it("restoreAgentSessionRequested resolves with the existing usable session (no fetch)", async () => {
    const WS = "ws-restore-cached";
    const AGENT = "agent-restore-cached";
    seedSession(makeSession(AGENT, WS));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).not.toHaveBeenCalled();
    expect(resolved?.id).toBe(AGENT);
  });

  it("restoreAgentSessionRequested fetches via appClient.agents.get and persists", async () => {
    const WS = "ws-restore-fetch";
    const AGENT = "agent-restore-fetch";
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Pending }));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).toHaveBeenCalledWith(AGENT);
    expect(resolved?.id).toBe(AGENT);
    expect(readSession(AGENT)?.id).toBe(AGENT);
  });

  it("restoreAgentSessionRequested rejects via action.failure on get throw", async () => {
    const WS = "ws-restore-err";
    const AGENT = "agent-restore-err";
    get.mockRejectedValueOnce(new Error("boom"));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("boom");
  });

  it("STAB-55: restore refetch preserves the hydrated transcript when agent.get returns the AgentLite empty-messages projection", async () => {
    // Repro: agent in error state after a daemon restart — the local session
    // is NOT usable (no backendSessionId), so restore refetches `agent.get`.
    // The wire projection is AgentLite (PROTOCOL §5.5): messages normalized to
    // []. Persisting it as-is clobbered the transcript chat-read-service had
    // already hydrated, blanking the chat on the next send.
    const WS = "ws-restore-preserve";
    const AGENT = "agent-restore-preserve";
    const transcript = [
      {
        id: "m-history-1",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        contentBlocks: [{ type: "text", text: "earlier question" }],
      },
      {
        id: "m-history-2",
        role: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        contentBlocks: [{ type: "text", text: "earlier answer" }],
      },
    ] as AgentSession["messages"];
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Error,
        messages: transcript,
      }),
    );
    // The daemon restarted: agent.get returns a fresh AgentLite with messages: [].
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Idle, messages: [] }));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).toHaveBeenCalledWith(AGENT);
    expect(resolved?.messages?.map((m) => m.id)).toEqual(["m-history-1", "m-history-2"]);
    expect(readSession(AGENT)?.messages?.map((m) => m.id)).toEqual([
      "m-history-1",
      "m-history-2",
    ]);
  });

  it("STAB-55: restore refetch keeps the fetched transcript when agent.get actually returns messages", async () => {
    const WS = "ws-restore-fetched-msgs";
    const AGENT = "agent-restore-fetched-msgs";
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        messages: [
          {
            id: "m-local",
            role: "user",
            timestamp: "2026-01-01T00:00:00.000Z",
            contentBlocks: [{ type: "text", text: "local" }],
          },
        ] as AgentSession["messages"],
      }),
    );
    get.mockResolvedValueOnce(
      makeSession(AGENT, WS, {
        messages: [
          {
            id: "m-wire",
            role: "user",
            timestamp: "2026-01-01T00:00:02.000Z",
            contentBlocks: [{ type: "text", text: "wire" }],
          },
        ] as AgentSession["messages"],
      }),
    );

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.messages?.map((m) => m.id)).toEqual(["m-wire"]);
  });

  it("activateAgentRequested marks the session ACTIVE and resolves", async () => {
    const WS = "ws-activate";
    const AGENT = "agent-activate";
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        activationState: AgentActivationState.PENDING,
      }),
    );
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Pending }));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.activationState).toBe(AgentActivationState.ACTIVE);
    expect(resolved?.status).toBe(AgentStatus.Active);
    expect(readSession(AGENT)?.activationState).toBe(AgentActivationState.ACTIVE);
  });

  it("STAB-55: activate refetch preserves the hydrated transcript when agent.get returns the AgentLite empty-messages projection", async () => {
    const WS = "ws-activate-preserve";
    const AGENT = "agent-activate-preserve";
    const transcript = [
      {
        id: "m-act-1",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        contentBlocks: [{ type: "text", text: "history" }],
      },
    ] as AgentSession["messages"];
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        activationState: AgentActivationState.PENDING,
        messages: transcript,
      }),
    );
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Pending, messages: [] }));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.messages?.map((m) => m.id)).toEqual(["m-act-1"]);
    expect(readSession(AGENT)?.messages?.map((m) => m.id)).toEqual(["m-act-1"]);
  });

  it("activateAgentRequested is a no-op when the session is already Active", async () => {
    const WS = "ws-active-already";
    const AGENT = "agent-active-already";
    seedSession(makeSession(AGENT, WS, { status: AgentStatus.Active }));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).not.toHaveBeenCalled();
    expect(resolved?.id).toBe(AGENT);
  });

  it("activateAgentRequested marks ERROR and rejects when the seam throws", async () => {
    const WS = "ws-activate-err";
    const AGENT = "agent-activate-err";
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        activationState: AgentActivationState.PENDING,
      }),
    );
    get.mockRejectedValueOnce(new Error("nope"));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("nope");
    expect(readSession(AGENT)?.activationState).toBe(AgentActivationState.ERROR);
    expect(readSession(AGENT)?.lastActivationError).toBe("nope");
  });

  it("saveAgentSessionRequested resolves immediately (no persistence layer on the seam)", async () => {
    const action = saveAgentSessionRequested("ws-save", "agent-save");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();
  });
});

describe("agentMutationService — deletion (soft-hide-then-commit)", () => {
  const UNDO_MS = 15000;
  // Handlers chain a dynamic `import("svelte-sonner")` before/around the wire
  // call, so drain the microtask queue a few turns to settle them.
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  const toastMock = toast as unknown as {
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
    del.mockReset();
    list.mockReset();
    toastMock.warning.mockClear();
    toastMock.error.mockClear();
    refreshWorkspaceSubscriptionEntries.mockClear();
  });

  /** Seed a parent agent's subscription-UI entry watching `childId`. */
  function seedSubscriptionEntry(wsId: string, parentId: string, childId: string): void {
    appStore.dispatch(
      setSubscriptionSnapshot(wsId, parentId, {
        subscriptions: [
          {
            id: "watch-1",
            agentId: parentId,
            eventTypes: ["agent:completed"],
            actorIds: [childId],
            createdAt: "2026-01-01T00:00:00Z",
            description: "Completion watch",
          },
        ],
        delegationGroups: [
          {
            groupId: "g-1",
            awaitMode: "all",
            expectedAgentIds: [childId, "agent-other"],
            completedAgentIds: [childId],
            deletedAgentIds: [],
            agentStatuses: { [childId]: "responding", "agent-other": "idle" },
            delivered: false,
          },
        ],
        agentStatuses: { [childId]: "responding", "agent-other": "idle" },
        waitingState: "waiting",
      }),
    );
  }

  function readSubscriptionEntry(wsId: string, parentId: string): AgentSubscriptionUIEntry {
    return (
      appStore.state as {
        agentSubscriptionUI: { entries: Record<string, AgentSubscriptionUIEntry> };
      }
    ).agentSubscriptionUI.entries[makeKey(wsId, parentId)];
  }

  it("soft-hides the session and shows an undo toast WITHOUT calling the daemon", async () => {
    const WS = "ws-del-undo";
    const AGENT = "agent-del-undo";
    seedSession(makeSession(AGENT, WS));

    const action = deleteAgentWithUndoRequested(WS, AGENT, "My Agent");
    appStore.dispatch(action);
    const removed = await action.promise;
    await flush();

    expect(removed?.id).toBe(AGENT);
    expect(readSession(AGENT)).toBeUndefined();
    expect(del).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledTimes(1);

    // Clean up the armed commit timer so it does not leak across tests.
    appStore.dispatch(undoAgentDeletionRequested(WS, AGENT));
  });

  // Regression: with a deletion pending, an `agent:status-changed`-driven
  // `hydrateAgentsRequested` whose `agent.list` response still contains the
  // soft-hidden agent (the daemon has not been told about the deletion yet)
  // must NOT re-add it — previously this resurrected the agent whenever any
  // other agent in the workspace was active/streaming during the undo window.
  it("hydrateAgentsRequested during the undo window does not resurrect the soft-hidden agent", async () => {
    const WS = "ws-del-hydrate";
    const AGENT = "agent-del-hydrate";
    const OTHER = "agent-del-hydrate-other";
    seedSession(makeSession(AGENT, WS));
    seedSession(makeSession(OTHER, WS));

    const action = deleteAgentWithUndoRequested(WS, AGENT, "Doomed");
    appStore.dispatch(action);
    await action.promise;
    expect(readSession(AGENT)).toBeUndefined();

    list.mockResolvedValueOnce([makeSession(AGENT, WS), makeSession(OTHER, WS)]);
    appStore.dispatch(hydrateAgentsRequested(WS));
    await flush();

    expect(list).toHaveBeenCalledWith(WS);
    // Neither the session store nor the workspace index re-added the agent.
    expect(readSession(AGENT)).toBeUndefined();
    const wsAgents = (
      appStore.state as {
        workspaceAgents: { byWorkspaceId: Record<string, { agentIds?: string[] }> };
      }
    ).workspaceAgents.byWorkspaceId[WS];
    expect(wsAgents?.agentIds ?? []).not.toContain(AGENT);
    expect(readSession(OTHER)).toBeDefined();

    // Undo still fully restores the agent after the hydrate attempt.
    const undo = undoAgentDeletionRequested(WS, AGENT);
    appStore.dispatch(undo);
    await expect(undo.promise).resolves.toBe(true);
    expect(readSession(AGENT)).toBeDefined();
    expect(del).not.toHaveBeenCalled();
  });

  it("commits the real agent.delete after the undo window elapses", async () => {
    const WS = "ws-del-elapse";
    const AGENT = "agent-del-elapse";
    seedSession(makeSession(AGENT, WS));
    del.mockResolvedValueOnce({ success: true });

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;
    expect(del).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await flush();

    expect(del).toHaveBeenCalledWith(AGENT, WS);
  });

  it("undoAgentDeletionRequested restores the session and never calls the daemon", async () => {
    const WS = "ws-del-restore";
    const AGENT = "agent-del-restore";
    seedSession(makeSession(AGENT, WS, { name: "Restorable" }));

    const del1 = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(del1);
    await del1.promise;
    expect(readSession(AGENT)).toBeUndefined();

    const undo = undoAgentDeletionRequested(WS, AGENT);
    appStore.dispatch(undo);
    const undone = await undo.promise;

    expect(undone).toBe(true);
    expect(readSession(AGENT)?.name).toBe("Restorable");

    // Window elapsing must NOT commit the (undone) deletion.
    await vi.advanceTimersByTimeAsync(UNDO_MS);
    await flush();
    expect(del).not.toHaveBeenCalled();
  });

  it("undoAgentDeletionRequested resolves false when nothing is pending", async () => {
    const undo = undoAgentDeletionRequested("ws-none", "agent-none");
    appStore.dispatch(undo);
    await expect(undo.promise).resolves.toBe(false);
  });

  it("commitPendingAgentDeletionRequested commits before the window elapses", async () => {
    const WS = "ws-del-commit";
    const AGENT = "agent-del-commit";
    seedSession(makeSession(AGENT, WS));
    del.mockResolvedValueOnce({ success: true });

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;

    appStore.dispatch(commitPendingAgentDeletionRequested(WS, AGENT));
    await flush();

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(AGENT, WS);
  });

  it("flushPendingAgentDeletionsRequested commits all pending deletions for the workspace", async () => {
    const WS = "ws-del-flush";
    const A1 = "agent-flush-1";
    const A2 = "agent-flush-2";
    seedSession(makeSession(A1, WS));
    seedSession(makeSession(A2, WS));
    del.mockResolvedValue({ success: true });

    appStore.dispatch(deleteAgentWithUndoRequested(WS, A1));
    appStore.dispatch(deleteAgentWithUndoRequested(WS, A2));

    const flushAction = flushPendingAgentDeletionsRequested(WS);
    appStore.dispatch(flushAction);
    await flushAction.promise;
    await flush();

    expect(del).toHaveBeenCalledWith(A1, WS);
    expect(del).toHaveBeenCalledWith(A2, WS);
  });

  it("restores the session when the daemon delete fails", async () => {
    const WS = "ws-del-fail";
    const AGENT = "agent-del-fail";
    seedSession(makeSession(AGENT, WS, { name: "Survivor" }));
    del.mockResolvedValueOnce({ success: false, error: "boom" });

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;

    appStore.dispatch(commitPendingAgentDeletionRequested(WS, AGENT));
    await flush();

    // The wire call is made and reports failure; the soft-hidden session is
    // un-hidden so the user does not silently lose it. (The error toast is a
    // best-effort lazily-imported affordance and is not asserted here.)
    expect(del).toHaveBeenCalledWith(AGENT, WS);
    expect(readSession(AGENT)?.name).toBe("Survivor");
    // A failed delete emits no daemon event, so the restore itself must
    // refetch the subscription entries the soft-hide optimistically pruned.
    expect(refreshWorkspaceSubscriptionEntries).toHaveBeenCalledWith(WS);
  });

  it("deleteAgentSessionRequested (no-undo path) restores the session and refetches subscriptions when the delete fails", async () => {
    const WS = "ws-del-now-fail";
    const PARENT = "agent-del-now-fail-parent";
    const AGENT = "agent-del-now-fail-child";
    seedSession(makeSession(AGENT, WS, { name: "Survivor" }));
    seedSubscriptionEntry(WS, PARENT, AGENT);
    del.mockResolvedValueOnce({ success: false, error: "boom" });

    const action = deleteAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("boom");
    await flush();

    // The soft-hide pruned the parent's watch on this agent...
    expect(readSubscriptionEntry(WS, PARENT).subscriptions).toHaveLength(0);
    // ...and the failed delete (no daemon event) restores the session and
    // triggers the subscription refetch so the footer converges again.
    expect(del).toHaveBeenCalledWith(AGENT, WS);
    expect(readSession(AGENT)?.name).toBe("Survivor");
    expect(refreshWorkspaceSubscriptionEntries).toHaveBeenCalledWith(WS);
  });

  it("deleteAgentSessionRequested soft-hides and commits the daemon delete immediately", async () => {
    const WS = "ws-del-now";
    const AGENT = "agent-del-now";
    seedSession(makeSession(AGENT, WS));
    del.mockResolvedValueOnce({ success: true });

    const action = deleteAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;
    await flush();

    expect(del).toHaveBeenCalledWith(AGENT, WS);
    expect(readSession(AGENT)).toBeUndefined();
  });

  it("soft-hide prunes recentlyClosed entries for the deleted agent", async () => {
    const WS = "ws-del-prune-soft";
    const AGENT = "agent-del-prune-soft";
    seedSession(makeSession(AGENT, WS));

    // Seed a recentlyClosed entry for this agent's tab by opening then closing it.
    appStore.dispatch(
      initializeLayout(WS, {
        root: { type: "panel", panelId: "p1" },
        panels: {
          p1: {
            id: "p1",
            tabs: [
              {
                id: "tab-a",
                type: "agent",
                title: "Agent",
                agentId: AGENT,
                closable: true,
              },
            ],
            activeTabId: "tab-a",
          },
        },
        focusedPanelId: "p1",
      }),
    );
    appStore.dispatch(closeTab(WS, "tab-a", "p1", 1000));
    expect(selectRecentlyClosed.select(appStore.state, WS)).toHaveLength(1);

    const del1 = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(del1);
    await del1.promise;
    await flush();

    // Soft-hide should have pruned the agent entry from recentlyClosed.
    const remaining = selectRecentlyClosed.select(appStore.state, WS);
    expect(remaining.every((e) => !(e.tab.type === "agent" && e.tab.agentId === AGENT))).toBe(true);

    // Clean up the armed commit timer.
    appStore.dispatch(undoAgentDeletionRequested(WS, AGENT));
  });

  it("commit dispatches prune (agent recents cannot resurface after commit)", async () => {
    const WS = "ws-del-prune-commit";
    const AGENT = "agent-del-prune-commit";
    seedSession(makeSession(AGENT, WS));
    del.mockResolvedValueOnce({ success: true });

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;

    // A late "close" of a tab could have re-inserted an agent entry inside the
    // undo window; simulate it and verify the commit re-prunes.
    appStore.dispatch(
      pruneRecentlyClosed(WS, { agentId: "sentinel-not-this-one" }), // no-op
    );
    // Seed a leftover agent entry by dispatching closeTab against a synthesized layout.
    appStore.dispatch(
      initializeLayout(WS, {
        root: { type: "panel", panelId: "p1" },
        panels: {
          p1: {
            id: "p1",
            tabs: [
              {
                id: "tab-a",
                type: "agent",
                title: "Agent",
                agentId: AGENT,
                closable: true,
              },
            ],
            activeTabId: "tab-a",
          },
        },
        focusedPanelId: "p1",
      }),
    );
    appStore.dispatch(closeTab(WS, "tab-a", "p1", 1000));
    expect(
      selectRecentlyClosed
        .select(appStore.state, WS)
        .some((e) => e.tab.type === "agent" && e.tab.agentId === AGENT),
    ).toBe(true);

    appStore.dispatch(commitPendingAgentDeletionRequested(WS, AGENT));
    await flush();

    expect(del).toHaveBeenCalledWith(AGENT, WS);
    expect(
      selectRecentlyClosed
        .select(appStore.state, WS)
        .some((e) => e.tab.type === "agent" && e.tab.agentId === AGENT),
    ).toBe(false);
  });

  it("delete-with-undo optimistically removes the agent from subscription-UI entries", async () => {
    const WS = "ws-del-subui-undo";
    const PARENT = "agent-subui-undo-parent";
    const AGENT = "agent-subui-undo-child";
    seedSession(makeSession(AGENT, WS));
    seedSubscriptionEntry(WS, PARENT, AGENT);

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;

    const entry = readSubscriptionEntry(WS, PARENT);
    expect(entry.subscriptions).toHaveLength(0);
    expect(entry.delegationGroups[0].expectedAgentIds).toEqual(["agent-other"]);
    expect(entry.delegationGroups[0].completedAgentIds).toEqual([]);
    expect(entry.delegationGroups[0].agentStatuses).toEqual({ "agent-other": "idle" });
    expect(entry.agentStatuses).toEqual({ "agent-other": "idle" });
    expect(del).not.toHaveBeenCalled();

    // Clean up the armed commit timer.
    appStore.dispatch(undoAgentDeletionRequested(WS, AGENT));
  });

  it("deleteAgentSessionRequested (no-undo path) also removes the agent from subscription-UI entries", async () => {
    const WS = "ws-del-subui-now";
    const PARENT = "agent-subui-now-parent";
    const AGENT = "agent-subui-now-child";
    seedSession(makeSession(AGENT, WS));
    seedSubscriptionEntry(WS, PARENT, AGENT);
    del.mockResolvedValueOnce({ success: true });

    const action = deleteAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;
    await flush();

    const entry = readSubscriptionEntry(WS, PARENT);
    expect(entry.subscriptions).toHaveLength(0);
    expect(entry.delegationGroups[0].expectedAgentIds).toEqual(["agent-other"]);
    expect(entry.agentStatuses).toEqual({ "agent-other": "idle" });
    expect(del).toHaveBeenCalledWith(AGENT, WS);
  });

  it("undo refetches the workspace's subscription entries so the daemon's live watch repopulates", async () => {
    const WS = "ws-del-subui-refetch";
    const AGENT = "agent-subui-refetch-child";
    seedSession(makeSession(AGENT, WS));

    const action = deleteAgentWithUndoRequested(WS, AGENT);
    appStore.dispatch(action);
    await action.promise;
    expect(refreshWorkspaceSubscriptionEntries).not.toHaveBeenCalled();

    const undo = undoAgentDeletionRequested(WS, AGENT);
    appStore.dispatch(undo);
    await expect(undo.promise).resolves.toBe(true);
    // The refetch rides a lazy dynamic import; drain the microtask queue.
    await flush();

    expect(refreshWorkspaceSubscriptionEntries).toHaveBeenCalledWith(WS);
    expect(del).not.toHaveBeenCalled();
  });
});


describe("agentMutationService — rename (Bug 1: renameAgentSessionRequested reaches the daemon)", () => {
  const toastMock = toast as unknown as { error: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    rename.mockReset();
    toastMock.error.mockClear();
  });

  it("forwards agent.rename via the seam and resolves the action promise", async () => {
    const WS = "ws-rename-ok";
    const AGENT = "agent-rename-ok";
    seedSession(makeSession(AGENT, WS));
    rename.mockResolvedValueOnce({ success: true });

    const action = renameAgentSessionRequested(WS, AGENT, "New Name");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(rename).toHaveBeenCalledWith(AGENT, "New Name", WS);
  });

  it("rejects when the daemon reports failure", async () => {
    rename.mockResolvedValueOnce({ success: false, error: "rename boom" });

    const action = renameAgentSessionRequested("ws-rename-fail", "agent-rename-fail", "X");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("rename boom");
  });

  it("rejects when the seam throws (transport failure)", async () => {
    rename.mockRejectedValueOnce(new Error("wire down"));

    const action = renameAgentSessionRequested("ws-rename-throw", "agent-rename-throw", "X");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("wire down");
  });

  // Regression for the AgentCard.saveEdit contract: the optimistic Redux
  // update happens BEFORE the dispatch, and the failure-revert + error-toast
  // path hangs off `action.promise.catch`. Before the middleware serviced
  // this trigger the promise never settled, so a failed (or never-sent)
  // rename silently reverted on the next agent.list refetch instead.
  it("settles the promise so AgentCard's optimistic revert + error toast path fires on failure", async () => {
    const WS = "ws-rename-revert";
    const AGENT = "agent-rename-revert";
    seedSession(makeSession(AGENT, WS, { name: "Old Name", nameExplicitlySet: false }));
    rename.mockResolvedValueOnce({ success: false, error: "daemon says no" });

    // Mirror AgentCard.saveEdit: optimistic update, dispatch, revert on catch.
    appStore.dispatch(updateSession(AGENT, { name: "New Name", nameExplicitlySet: true }));
    const action = renameAgentSessionRequested(WS, AGENT, "New Name");
    appStore.dispatch(action);
    const reverted = action.promise.catch(() => {
      appStore.dispatch(updateSession(AGENT, { name: "Old Name", nameExplicitlySet: false }));
      toast.error("Failed to rename agent");
    });
    await reverted;

    expect(rename).toHaveBeenCalledWith(AGENT, "New Name", WS);
    expect(readSession(AGENT)?.name).toBe("Old Name");
    expect(readSession(AGENT)?.nameExplicitlySet).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith("Failed to rename agent");
  });
});

describe("agentMutationService — dismiss questions (optimistic marker + rollback)", () => {
  const toastMock = toast as unknown as { error: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    dismissQuestions.mockReset();
    toastMock.error.mockClear();
  });

  it("optimistically stamps dismissedQuestionsMessageId, forwards agent.dismissQuestions, and resolves", async () => {
    const WS = "ws-dismiss-ok";
    const AGENT = "agent-dismiss-ok";
    seedSession(makeSession(AGENT, WS, { metadata: { model: "sonnet" } }));
    let metadataAtWireCall: unknown;
    dismissQuestions.mockImplementationOnce(async () => {
      metadataAtWireCall = readSession(AGENT)?.metadata;
      return { success: true };
    });

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(dismissQuestions).toHaveBeenCalledWith({
      agentId: AGENT,
      workspaceId: WS,
      messageId: "msg-q1",
    });
    // The marker was applied BEFORE the wire call (optimistic hide) and
    // pre-existing metadata was preserved.
    expect(metadataAtWireCall).toMatchObject({
      model: "sonnet",
      dismissedQuestionsMessageId: "msg-q1",
    });
    expect(readSession(AGENT)?.metadata?.dismissedQuestionsMessageId).toBe("msg-q1");
  });

  it("rolls the metadata back and surfaces a toast when the daemon reports failure", async () => {
    const WS = "ws-dismiss-fail";
    const AGENT = "agent-dismiss-fail";
    seedSession(makeSession(AGENT, WS, { metadata: { model: "sonnet" } }));
    dismissQuestions.mockResolvedValueOnce({ success: false, error: "dismiss boom" });

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("dismiss boom");

    expect(readSession(AGENT)?.metadata).toEqual({ model: "sonnet" });
    // Toast import is lazy; flush the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastMock.error).toHaveBeenCalledWith("dismiss boom");
  });

  it("rolls back and rejects when the seam throws (transport failure)", async () => {
    const WS = "ws-dismiss-throw";
    const AGENT = "agent-dismiss-throw";
    seedSession(makeSession(AGENT, WS));
    dismissQuestions.mockRejectedValueOnce(new Error("wire down"));

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("wire down");

    expect(readSession(AGENT)?.metadata?.dismissedQuestionsMessageId).toBeUndefined();
  });

  it("still forwards the wire call when the session is not in the store (no optimistic stamp)", async () => {
    dismissQuestions.mockResolvedValueOnce({ success: true });

    const action = agentSessionDismissQuestionsRequested(
      "agent-dismiss-missing",
      "ws-dismiss-missing",
      "msg-q1",
    );
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(dismissQuestions).toHaveBeenCalledWith({
      agentId: "agent-dismiss-missing",
      workspaceId: "ws-dismiss-missing",
      messageId: "msg-q1",
    });
  });

  it("rollback only reverts the marker key — a concurrent in-flight metadata write survives", async () => {
    const WS = "ws-dismiss-concurrent";
    const AGENT = "agent-dismiss-concurrent";
    seedSession(makeSession(AGENT, WS, { metadata: { model: "sonnet" } }));
    dismissQuestions.mockImplementationOnce(async () => {
      // A concurrent write lands while the RPC is in flight (e.g. an
      // agent:updated refetch that persisted a model switch).
      const current = readSession(AGENT);
      appStore.dispatch(
        updateSession(AGENT, { metadata: { ...current?.metadata, model: "opus" } }),
      );
      return { success: false, error: "dismiss boom" };
    });

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("dismiss boom");

    // The concurrent model switch is preserved; only the marker is reverted.
    expect(readSession(AGENT)?.metadata).toEqual({ model: "opus" });
  });

  it("rollback no-ops when a concurrent write already replaced the marker with a different value", async () => {
    const WS = "ws-dismiss-replaced";
    const AGENT = "agent-dismiss-replaced";
    seedSession(makeSession(AGENT, WS, { metadata: {} }));
    dismissQuestions.mockImplementationOnce(async () => {
      const current = readSession(AGENT);
      appStore.dispatch(
        updateSession(AGENT, {
          metadata: { ...current?.metadata, dismissedQuestionsMessageId: "msg-q2" },
        }),
      );
      return { success: false, error: "dismiss boom" };
    });

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("dismiss boom");

    // The newer marker (a later dismissal for msg-q2) is not clobbered.
    expect(readSession(AGENT)?.metadata?.dismissedQuestionsMessageId).toBe("msg-q2");
  });

  it("rollback no-ops when the session was deleted mid-flight", async () => {
    const WS = "ws-dismiss-deleted";
    const AGENT = "agent-dismiss-deleted";
    seedSession(makeSession(AGENT, WS));
    dismissQuestions.mockImplementationOnce(async () => {
      appStore.dispatch(removeSession(AGENT));
      return { success: false, error: "dismiss boom" };
    });

    const action = agentSessionDismissQuestionsRequested(AGENT, WS, "msg-q1");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("dismiss boom");

    expect(readSession(AGENT)).toBeUndefined();
  });
});

describe("agentMutationService — stop session (stopAgentSessionRequested → agent.stop)", () => {
  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    stop.mockReset();
  });

  it("forwards agent.stop via the seam and resolves the action promise", async () => {
    stop.mockResolvedValueOnce({ success: true });

    const action = stopAgentSessionRequested("ws-stop-ok", "agent-stop-ok");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(stop).toHaveBeenCalledWith("agent-stop-ok");
  });

  it("rejects when the daemon reports failure", async () => {
    stop.mockResolvedValueOnce({ success: false, error: "stop boom" });

    const action = stopAgentSessionRequested("ws-stop-fail", "agent-stop-fail");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("stop boom");
  });

  it("rejects when the seam throws (transport failure)", async () => {
    stop.mockRejectedValueOnce(new Error("wire down"));

    const action = stopAgentSessionRequested("ws-stop-throw", "agent-stop-throw");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("wire down");
  });
});

describe("agentMutationService — cancel subscriptions (scoped agent.cancelSubscriptions)", () => {
  const toastMock = toast as unknown as { error: ReturnType<typeof vi.fn> };

  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    cancelSubscriptions.mockReset();
    toastMock.error.mockClear();
  });

  it("forwards the subscriptionId-scoped params and resolves the promise", async () => {
    cancelSubscriptions.mockResolvedValueOnce({ success: true });

    const action = cancelAgentSubscriptionsRequested("ws-cancel-1", "agent-parent-1", {
      subscriptionId: "watch-1",
    });
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(cancelSubscriptions).toHaveBeenCalledWith({
      agentId: "agent-parent-1",
      workspaceId: "ws-cancel-1",
      subscriptionId: "watch-1",
    });
  });

  it("forwards the groupId-scoped params and resolves the promise", async () => {
    cancelSubscriptions.mockResolvedValueOnce({ success: true });

    const action = cancelAgentSubscriptionsRequested("ws-cancel-2", "agent-parent-2", {
      groupId: "grp-1",
    });
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(cancelSubscriptions).toHaveBeenCalledWith({
      agentId: "agent-parent-2",
      workspaceId: "ws-cancel-2",
      groupId: "grp-1",
    });
  });

  it("omits both optional ids for an unscoped cancel", async () => {
    cancelSubscriptions.mockResolvedValueOnce({ success: true });

    const action = cancelAgentSubscriptionsRequested("ws-cancel-3", "agent-parent-3");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();

    expect(cancelSubscriptions).toHaveBeenCalledWith({
      agentId: "agent-parent-3",
      workspaceId: "ws-cancel-3",
    });
  });

  it("rejects and surfaces a toast when the daemon reports failure (e.g. -32602 unknown id)", async () => {
    cancelSubscriptions.mockResolvedValueOnce({
      success: false,
      error: "unknown subscription id: watch-missing",
    });

    const action = cancelAgentSubscriptionsRequested("ws-cancel-4", "agent-parent-4", {
      subscriptionId: "watch-missing",
    });
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("unknown subscription id");
    // Toast import is lazy; flush the microtask queue before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastMock.error).toHaveBeenCalledWith("unknown subscription id: watch-missing");
  });

  it("rejects when the seam throws (transport failure)", async () => {
    cancelSubscriptions.mockRejectedValueOnce(new Error("wire down"));

    const action = cancelAgentSubscriptionsRequested("ws-cancel-5", "agent-parent-5", {
      groupId: "grp-x",
    });
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("wire down");
  });
});

