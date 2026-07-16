import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import { AgentActivationState } from "$shared/types/agent-session";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seam: `appClient.agents.get` + `appClient.agents.delete` are stubbed. The
// mutation middleware runs against the REAL configured store so the
// restore/activate/save + deletion async actions resolve through the real
// action.success/failure path and their promises settle exactly as
// agent-stream-lifecycle (and the deletion triggers) expect.
const { get, del } = vi.hoisted(() => ({ get: vi.fn(), del: vi.fn() }));
vi.mock("$lib/client", () => ({
  appClient: { agents: { get, delete: del } },
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

import { store as appStore } from "$store/renderer/store";
import { toast } from "svelte-sonner";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  activateAgentRequested,
  commitPendingAgentDeletionRequested,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  flushPendingAgentDeletionsRequested,
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
  undoAgentDeletionRequested,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
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
    toastMock.warning.mockClear();
    toastMock.error.mockClear();
  });

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
});
