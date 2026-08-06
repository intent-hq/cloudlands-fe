import { describe, expect, it, vi } from "vitest";
import {
  createDividerSessionBoundaryService,
  type DividerSessionBoundary,
} from "./divider-session-boundary-service";
import {
  endDividerSession,
  endAllDividerSessions,
  startDividerSession,
  unreadTrackingReducer,
} from "../slices/unread-tracking/unread-tracking-slice";
import {
  resolveNewMessagesDividerAnchor,
  resolveLatchedDividerAnchor,
} from "$lib/components/chat/new-messages-divider";
import {
  applyPreset,
  createGridLayout,
  closeTab,
  closeTabsByAgentId,
  setActiveTab,
} from "../slices/panel-layout/panel-layout-slice";
import { setActiveWorkspaceId, clearActiveWorkspace } from "../slices/workspace/workspace-slice";
import type { StoreState } from "../types";
import type { StoreMiddlewareAPI } from "$lib/store-shim/types";

function createMockState(
  activeWsId: string | null,
  openAgentIdsByWs: Record<string, string[]>,
  sessionAgentIds: Record<string, string | null>,
): Partial<StoreState> {
  return {
    workspace: {
      activeWorkspaceId: activeWsId,
    } as any,
    panelLayout: {
      byWorkspaceId: Object.fromEntries(
        Object.entries(openAgentIdsByWs).map(([wsId, agentIds]) => [
          wsId,
          {
            panels: {
              panel1: {
                id: "panel1",
                tabs: agentIds.map((agentId, i) => ({
                  id: `tab-${agentId}-${i}`,
                  type: "agent" as const,
                  title: agentId,
                  closable: true,
                  agentId,
                })),
                activeTabId: null,
              },
            },
            root: { type: "panel" as const, panelId: "panel1" },
            focusedPanelId: "panel1",
            restoreStatus: "idle" as const,
          },
        ]),
      ),
    } as any,
    unreadTracking: {
      currentlyViewedAgentId: null,
      dividerSessionByAgentId: Object.fromEntries(
        Object.entries(sessionAgentIds).map(([agentId, anchorId]) => [agentId, { anchorId }]),
      ),
    } as any,
  };
}

function createMockAPI(initialState: Partial<StoreState>): StoreMiddlewareAPI<StoreState> {
  let dispatchedActions: any[] = [];
  let currentState = initialState;
  return {
    getState: () => currentState as StoreState,
    dispatch: vi.fn((action) => {
      dispatchedActions.push(action);
      return action;
    }),
    get _dispatchedActions() {
      return dispatchedActions;
    },
    _clearDispatched: () => {
      dispatchedActions = [];
    },
    _updateState: (newState: Partial<StoreState>) => {
      currentState = newState;
    },
  } as any;
}

describe("divider-session-boundary-service", () => {
  it("ends a session when its agent chat tab is closed", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1", "a2"] }, { a1: "m1", a2: "m2" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === closeTab.type) {
        (api as any)._updateState(
          createMockState("ws-1", { "ws-1": ["a2"] }, { a1: "m1", a2: "m2" }),
        );
      }
      return action;
    });

    middleware(next)(closeTab("ws-1", "tab-a1-0"));

    const dispatched = (api as any)._dispatchedActions;
    expect(dispatched).toEqual([endDividerSession("a1")]);
  });

  it("does not end a session when the agent tab is still open in another workspace", () => {
    const state = createMockState(
      "ws-1",
      { "ws-1": [], "ws-2": ["a1"] },
      { a1: "m1" },
    );
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    middleware(vi.fn((a) => a))(closeTab("ws-1", "tab-x"));

    expect((api as any)._dispatchedActions).toHaveLength(0);
  });

  it("does not end a session for an agent never hosted in a panel-layout tab (e.g. ChiefCard) when an unrelated tab closes", () => {
    // "chief1" has a latched divider session but is never present in any
    // workspace's panelLayout tabs (it's rendered from ChiefCard, not a tab).
    // An unrelated tab-removal action (closing "a1"'s tab) must not treat
    // "chief1" as closed just because it was never in the open-tab set.
    const boundaries: DividerSessionBoundary[] = [];
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1", chief1: "m1" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService({
      onBoundary: (b) => boundaries.push(b),
    })(api);

    const next = vi.fn((action) => {
      if (action.type === closeTab.type) {
        (api as any)._updateState(
          createMockState("ws-1", { "ws-1": [] }, { a1: "m1", chief1: "m1" }),
        );
      }
      return action;
    });

    middleware(next)(closeTab("ws-1", "tab-a1-0"));

    const dispatched = (api as any)._dispatchedActions;
    // Only a1 (whose tab actually closed) ends; chief1 was never in the
    // pre-action open-tab set, so the pre/post diff excludes it — no
    // endDividerSession and no markSeen boundary for chief1.
    expect(dispatched).toEqual([endDividerSession("a1")]);
    expect(boundaries).toEqual([{ kind: "tab-close", agentIds: ["a1"] }]);
  });

  it("does not end a chief-style session when a tab-removal action removes no agent tabs at all", () => {
    const boundaries: DividerSessionBoundary[] = [];
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { chief1: "m1" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService({
      onBoundary: (b) => boundaries.push(b),
    })(api);

    // Closing an unrelated (non-agent) tab leaves the open-agent-tab set unchanged.
    middleware(vi.fn((a) => a))(closeTab("ws-1", "tab-file-1"));

    expect((api as any)._dispatchedActions).toHaveLength(0);
    expect(boundaries).toHaveLength(0);
  });

  it("does not end sessions on same-workspace tab deactivation (setActiveTab)", () => {
    const state = createMockState("ws-1", { "ws-1": [] }, { a1: "m1" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    middleware(vi.fn((a) => a))(setActiveTab("ws-1", "tab-other"));

    expect((api as any)._dispatchedActions).toHaveLength(0);
  });

  it("ends all sessions on active-workspace switch", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1", a2: null });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === setActiveWorkspaceId.type) {
        (api as any)._updateState(
          createMockState("ws-2", { "ws-1": ["a1"] }, { a1: "m1", a2: null }),
        );
      }
      return action;
    });

    middleware(next)(setActiveWorkspaceId("ws-2"));

    expect((api as any)._dispatchedActions).toEqual([endAllDividerSessions()]);
  });

  it("ends all sessions when the active workspace is cleared (e.g. navigating to no-workspace view)", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1", a2: null });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === clearActiveWorkspace.type) {
        (api as any)._updateState(
          createMockState(null, { "ws-1": ["a1"] }, { a1: "m1", a2: null }),
        );
      }
      return action;
    });

    middleware(next)(clearActiveWorkspace());

    expect((api as any)._dispatchedActions).toEqual([endAllDividerSessions()]);
  });

  it("does not end sessions when re-selecting the already-active workspace", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    middleware(vi.fn((a) => a))(setActiveWorkspaceId("ws-1"));

    expect((api as any)._dispatchedActions).toHaveLength(0);
  });

  it("does not dispatch on workspace switch when there are no sessions", () => {
    const state = createMockState("ws-1", { "ws-1": [] }, {});
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === setActiveWorkspaceId.type) {
        (api as any)._updateState(createMockState("ws-2", { "ws-1": [] }, {}));
      }
      return action;
    });

    middleware(next)(setActiveWorkspaceId("ws-2"));

    expect((api as any)._dispatchedActions).toHaveLength(0);
  });

  it("tracks workspace changes across successive switches", () => {
    const state = createMockState("ws-1", {}, {});
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);
    const chain = middleware(
      vi.fn((action) => {
        if (action.type === setActiveWorkspaceId.type) {
          (api as any)._updateState(createMockState(action.payload[0], {}, { a1: "m1" }));
        }
        return action;
      }),
    );

    chain(setActiveWorkspaceId("ws-2"));
    (api as any)._clearDispatched();
    chain(setActiveWorkspaceId("ws-2"));
    expect((api as any)._dispatchedActions).toHaveLength(0);

    chain(setActiveWorkspaceId("ws-3"));
    expect((api as any)._dispatchedActions).toEqual([endAllDividerSessions()]);
  });

  it("ends sessions and fires onBoundary when applyPreset replaces panels with empty ones", () => {
    const boundaries: DividerSessionBoundary[] = [];
    const state = createMockState("ws-1", { "ws-1": ["a1", "a2"] }, { a1: "m1", a2: null });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService({
      onBoundary: (b) => boundaries.push(b),
    })(api);

    const next = vi.fn((action) => {
      if (action.type === applyPreset.type) {
        (api as any)._updateState(
          createMockState("ws-1", { "ws-1": [] }, { a1: "m1", a2: null }),
        );
      }
      return action;
    });

    middleware(next)(applyPreset("ws-1", "single"));

    expect((api as any)._dispatchedActions).toEqual([
      endDividerSession("a1"),
      endDividerSession("a2"),
    ]);
    expect(boundaries).toEqual([{ kind: "tab-close", agentIds: ["a1", "a2"] }]);
  });

  it("ends sessions when createGridLayout replaces panels with empty ones", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1" });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === createGridLayout.type) {
        (api as any)._updateState(createMockState("ws-1", { "ws-1": [] }, { a1: "m1" }));
      }
      return action;
    });

    middleware(next)(createGridLayout("ws-1", 2));

    expect((api as any)._dispatchedActions).toEqual([endDividerSession("a1")]);
  });

  it("ends sessions for agents closed via closeTabsByAgentId", () => {
    const state = createMockState("ws-1", { "ws-1": ["a1", "a2"] }, { a1: "m1", a2: null });
    const api = createMockAPI(state);
    const middleware = createDividerSessionBoundaryService()(api);

    const next = vi.fn((action) => {
      if (action.type === closeTabsByAgentId.type) {
        (api as any)._updateState(
          createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1", a2: null }),
        );
      }
      return action;
    });

    middleware(next)(closeTabsByAgentId("ws-1", "a2"));

    expect((api as any)._dispatchedActions).toEqual([endDividerSession("a2")]);
  });

  describe("onBoundary seam", () => {
    it("fires with kind tab-close and the closed agent ids", () => {
      const boundaries: DividerSessionBoundary[] = [];
      const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1" });
      const api = createMockAPI(state);
      const middleware = createDividerSessionBoundaryService({
        onBoundary: (b) => boundaries.push(b),
      })(api);

      const next = vi.fn((action) => {
        if (action.type === closeTab.type) {
          (api as any)._updateState(createMockState("ws-1", { "ws-1": [] }, { a1: "m1" }));
        }
        return action;
      });
      middleware(next)(closeTab("ws-1", "tab-a1-0"));

      expect(boundaries).toEqual([{ kind: "tab-close", agentIds: ["a1"] }]);
    });

    it("fires with kind workspace-switch, agent ids, and both workspace ids", () => {
      const boundaries: DividerSessionBoundary[] = [];
      const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1", a2: null });
      const api = createMockAPI(state);
      const middleware = createDividerSessionBoundaryService({
        onBoundary: (b) => boundaries.push(b),
      })(api);

      const next = vi.fn((action) => {
        if (action.type === setActiveWorkspaceId.type) {
          (api as any)._updateState(
            createMockState("ws-2", { "ws-1": ["a1"] }, { a1: "m1", a2: null }),
          );
        }
        return action;
      });
      middleware(next)(setActiveWorkspaceId("ws-2"));

      expect(boundaries).toEqual([
        {
          kind: "workspace-switch",
          agentIds: ["a1", "a2"],
          previousWorkspaceId: "ws-1",
          nextWorkspaceId: "ws-2",
        },
      ]);
    });

    it("does not fire when no boundary is detected", () => {
      const boundaries: DividerSessionBoundary[] = [];
      const state = createMockState("ws-1", { "ws-1": ["a1"] }, { a1: "m1" });
      const api = createMockAPI(state);
      const middleware = createDividerSessionBoundaryService({
        onBoundary: (b) => boundaries.push(b),
      })(api);

      middleware(vi.fn((a) => a))(setActiveTab("ws-1", "tab-a1-0"));

      expect(boundaries).toHaveLength(0);
    });
  });
});

// ============================================================================
// Cross-cutting regression: real unreadTracking reducer + boundary middleware
// + anchor resolvers exercised together, end-to-end per the spec's Acceptance
// Criteria (latch-once, boundary-only session ends, re-entry re-derivation).
// ============================================================================

describe("divider session lifecycle (cross-cutting regression)", () => {
  /**
   * Integrated harness: dispatches run through the REAL boundary middleware
   * into the REAL unreadTracking reducer, with panel-layout / workspace state
   * simulated as plain data the way the existing unit tests do. api.dispatch
   * re-enters the chain so middleware-issued endDividerSession /
   * endAllDividerSessions actions hit the reducer like in the real store.
   */
  function createIntegratedHarness(options: {
    activeWorkspaceId: string | null;
    openAgentIdsByWs: Record<string, string[]>;
  }) {
    let unreadTracking = unreadTrackingReducer(undefined, { type: "@@INIT" });
    let activeWorkspaceId = options.activeWorkspaceId;
    let openAgentIdsByWs = options.openAgentIdsByWs;
    const boundaries: DividerSessionBoundary[] = [];

    const buildState = (): StoreState =>
      ({
        ...createMockState(activeWorkspaceId, openAgentIdsByWs, {}),
        unreadTracking,
      }) as StoreState;

    const api = {
      getState: () => buildState(),
      dispatch: (action: any) => chain(action),
    } as StoreMiddlewareAPI<StoreState>;

    let pendingLayout: Record<string, string[]> | null = null;
    let pendingActiveWs: string | null | undefined;

    const next = (action: any) => {
      unreadTracking = unreadTrackingReducer(unreadTracking, action);
      if (
        (action.type === setActiveWorkspaceId.type || action.type === clearActiveWorkspace.type) &&
        pendingActiveWs !== undefined
      ) {
        activeWorkspaceId = pendingActiveWs;
        pendingActiveWs = undefined;
      }
      if (pendingLayout !== null) {
        openAgentIdsByWs = pendingLayout;
        pendingLayout = null;
      }
      return action;
    };

    const chain = createDividerSessionBoundaryService({
      onBoundary: (b) => boundaries.push(b),
    })(api)(next);

    return {
      dispatch: chain,
      /** Queue the post-reducer layout for the NEXT dispatched action. */
      queueLayout(layout: Record<string, string[]>) {
        pendingLayout = layout;
      },
      queueActiveWorkspace(wsId: string | null) {
        pendingActiveWs = wsId;
      },
      get sessions() {
        return unreadTracking.dividerSessionByAgentId;
      },
      boundaries,
    };
  }

  it("a marker advance (metadata convergence) never moves the rendered anchor", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1"] },
    });

    // Entry: transcript m1..m3, seen marker m2 → anchor derived once and latched.
    const entryAnchor = resolveNewMessagesDividerAnchor(["m1", "m2", "m3"], "m2");
    expect(entryAnchor).toBe("m2");
    harness.dispatch(startDividerSession("a1", entryAnchor));

    // Mid-session: transcript grows and the daemon marker converges to m5.
    const grownTranscript = ["m1", "m2", "m3", "m4", "m5"];
    const freshDerivation = resolveNewMessagesDividerAnchor(grownTranscript, "m5");
    expect(freshDerivation).toBeNull(); // a re-derivation WOULD remove the divider…

    // …but rendering uses only the latched anchor: the divider stays at m2.
    expect(harness.sessions.a1).toEqual({ anchorId: "m2" });
    expect(resolveLatchedDividerAnchor(grownTranscript, harness.sessions.a1!.anchorId)).toBe("m2");
    expect(harness.boundaries).toHaveLength(0);
  });

  it("a session latched null shows no divider mid-session even as messages arrive", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1"] },
    });

    // Entry with the marker at the newest message: latch null (no divider).
    const entryAnchor = resolveNewMessagesDividerAnchor(["m1", "m2"], "m2");
    expect(entryAnchor).toBeNull();
    harness.dispatch(startDividerSession("a1", entryAnchor));
    expect(harness.sessions.a1).toEqual({ anchorId: null });

    // New messages stream in; a fresh derivation would now place a divider…
    const grownTranscript = ["m1", "m2", "m3", "m4"];
    expect(resolveNewMessagesDividerAnchor(grownTranscript, "m2")).toBe("m2");

    // …but the null latch wins for the whole session, and a cached-panel
    // remount re-latch attempt is a first-write-wins no-op.
    harness.dispatch(startDividerSession("a1", "m2"));
    expect(harness.sessions.a1).toEqual({ anchorId: null });
    expect(resolveLatchedDividerAnchor(grownTranscript, harness.sessions.a1!.anchorId)).toBeNull();
  });

  it("same-workspace tab switch away and back preserves the latched session", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1", "a2"] },
    });
    harness.dispatch(startDividerSession("a1", "m2"));

    // Switch to another tab in the SAME workspace and back — not a boundary.
    harness.dispatch(setActiveTab("ws-1", "tab-a2-1"));
    harness.dispatch(setActiveTab("ws-1", "tab-a1-0"));
    expect(harness.boundaries).toHaveLength(0);
    expect(harness.sessions.a1).toEqual({ anchorId: "m2" });

    // Returning remounts the panel; the remount re-latch is a no-op.
    harness.dispatch(startDividerSession("a1", "m9"));
    expect(harness.sessions.a1).toEqual({ anchorId: "m2" });
    expect(resolveLatchedDividerAnchor(["m1", "m2", "m3"], harness.sessions.a1!.anchorId)).toBe(
      "m2",
    );
  });

  it("tab close ends the session, fires the boundary seam, and re-entry re-derives", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1"] },
    });
    harness.dispatch(startDividerSession("a1", "m2"));

    // Close the agent's chat tab (stop-looking boundary #1).
    harness.queueLayout({ "ws-1": [] });
    harness.dispatch(closeTab("ws-1", "tab-a1-0"));

    expect(harness.sessions.a1).toBeUndefined();
    expect(harness.boundaries).toEqual([{ kind: "tab-close", agentIds: ["a1"] }]);

    // Re-entry: the boundary markSeen advanced the marker to m4; a NEW session
    // derives fresh from the updated marker (transcript grew to m6).
    harness.queueLayout({ "ws-1": ["a1"] });
    const reentryAnchor = resolveNewMessagesDividerAnchor(
      ["m1", "m2", "m3", "m4", "m5", "m6"],
      "m4",
    );
    expect(reentryAnchor).toBe("m4");
    harness.dispatch(startDividerSession("a1", reentryAnchor));
    expect(harness.sessions.a1).toEqual({ anchorId: "m4" });
  });

  it("workspace switch ends every session and fires the boundary seam", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1", "a2"] },
    });
    harness.dispatch(startDividerSession("a1", "m2"));
    harness.dispatch(startDividerSession("a2", null));

    harness.queueActiveWorkspace("ws-2");
    harness.dispatch(setActiveWorkspaceId("ws-2"));

    expect(harness.sessions).toEqual({});
    expect(harness.boundaries).toEqual([
      {
        kind: "workspace-switch",
        agentIds: ["a1", "a2"],
        previousWorkspaceId: "ws-1",
        nextWorkspaceId: "ws-2",
      },
    ]);
  });

  it("clearing the active workspace ends sessions, preventing a stale divider on return to the same workspace", () => {
    const harness = createIntegratedHarness({
      activeWorkspaceId: "ws-1",
      openAgentIdsByWs: { "ws-1": ["a1"] },
    });
    harness.dispatch(startDividerSession("a1", "m2"));

    // Navigate away to a no-workspace view (e.g. /workspace/new): activeWorkspaceId -> null.
    harness.queueActiveWorkspace(null);
    harness.dispatch(clearActiveWorkspace());

    expect(harness.sessions).toEqual({});
    expect(harness.boundaries).toEqual([
      {
        kind: "workspace-switch",
        agentIds: ["a1"],
        previousWorkspaceId: "ws-1",
        nextWorkspaceId: null,
      },
    ]);

    // Returning to the SAME workspace re-selects it; since the session was
    // already cleared on the null transition, no stale divider survives —
    // a fresh startDividerSession re-derives from the current marker.
    harness.queueActiveWorkspace("ws-1");
    harness.dispatch(setActiveWorkspaceId("ws-1"));
    expect(harness.boundaries).toHaveLength(1); // no extra boundary fired

    harness.dispatch(startDividerSession("a1", "m9"));
    expect(harness.sessions.a1).toEqual({ anchorId: "m9" });
  });
});
