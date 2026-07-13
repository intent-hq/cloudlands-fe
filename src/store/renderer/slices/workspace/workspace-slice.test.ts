import type { PullRequestInfo, Workspace, WorkspaceId } from "$shared/types";
import { PullRequestStatus, WorkspaceStatusEnum } from "$shared/types";
import {
  describe,
  expect,
  it,
} from "vitest";
import {
  openTerminalOverlay,
  toggleTerminalOverlay,
} from "../terminals/terminals-slice";
import {
  createCollection,
  getItem,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  bulkUpdateWorkspaceEntities,
  cleanupRecency,
  clearActiveWorkspace,
  clearPendingCreation,
  clearWorkspacePendingDeletion,
  initialState,
  markWorkspacePendingDeletion,
  loadRecencyData,
  replaceWorkspaceList,
  recordWorkspaceView,
  resetWorkspaceState,
  removeWorkspaceEntity,
  setActiveWorkspaceId,
  setPendingCreation,
  setWorkspaceCreating,
  setWorkspaceEntity,
  setWorkspaceError,
  setWorkspaceHasLoaded,
  setWorkspaceLoading,
  updateWorkspaceEntity,
  workspaceReducer,
} from "./workspace-slice";
import {
  selectActiveWorkspace,
  selectActiveWorkspaceId,
  selectCurrentWorkspace,
  selectWorkspacesSortedByRecency,
  selectWorkspaceById,
  selectWorkspaceHasLoaded,
  selectWorkspaceIsCreating,
  selectWorkspaceIsEmpty,
  selectWorkspaceItems,
  selectWorkspaceLoading,
  selectWorkspacePendingCreations,
  selectWorkspacePendingDeletions,
} from "./workspace-selectors";

/** Minimal workspace fixture for testing. */
function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

/** Minimal pull request fixture for testing. */
function makePullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: "pr-1",
    number: 42,
    url: "https://github.com/example/repo/pull/42",
    title: "Example PR",
    status: PullRequestStatus.Open,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("workspaceReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores the active workspace id explicitly", () => {
    const next = workspaceReducer(initialState, setActiveWorkspaceId("ws-1"));
    expect(next.activeWorkspaceId).toBe("ws-1");
  });

  describe("workspace recency tracking", () => {
    it("loads persisted recency data", () => {
      const recency = { lastViewedAt: { "ws-1": 100, "ws-2": 200 } };
      const next = workspaceReducer(initialState, loadRecencyData(recency));
      expect(next.recency).toEqual(recency);
    });

    it("records the last viewed timestamp for a workspace", () => {
      const next = workspaceReducer(initialState, recordWorkspaceView("ws-1", 123));
      expect(next.recency.lastViewedAt).toEqual({ "ws-1": 123 });
    });

    it("cleans up recency data for workspaces that no longer exist", () => {
      const withRecency = workspaceReducer(
        initialState,
        loadRecencyData({ lastViewedAt: { "ws-1": 100, "ws-2": 200 } })
      );

      const next = workspaceReducer(withRecency, cleanupRecency(["ws-2"]));
      expect(next.recency.lastViewedAt).toEqual({ "ws-2": 200 });
    });

    it("is a no-op when recency cleanup removes nothing", () => {
      const withRecency = workspaceReducer(
        initialState,
        loadRecencyData({ lastViewedAt: { "ws-1": 100 } })
      );

      const next = workspaceReducer(withRecency, cleanupRecency(["ws-1", "ws-2"]));
      expect(next).toBe(withRecency);
    });
  });

  it("tracks the workspace opened in terminal overlay actions", () => {
    expect(workspaceReducer(initialState, openTerminalOverlay("ws-2")).activeWorkspaceId).toBe(
      "ws-2"
    );
    expect(workspaceReducer(initialState, toggleTerminalOverlay("ws-3")).activeWorkspaceId).toBe(
      "ws-3"
    );
  });

  describe("workspace request state", () => {
    it("clears the active workspace explicitly", () => {
      const withActive = workspaceReducer(initialState, setActiveWorkspaceId("ws-1"));
      const next = workspaceReducer(withActive, clearActiveWorkspace());
      expect(next.activeWorkspaceId).toBeNull();
    });

    it("tracks loading, error, loaded, and creating flags", () => {
      let state = workspaceReducer(initialState, setWorkspaceLoading(true));
      state = workspaceReducer(state, setWorkspaceError("boom"));
      state = workspaceReducer(state, setWorkspaceHasLoaded(true));
      state = workspaceReducer(state, setWorkspaceCreating(true));

      expect(state.loading).toBe(true);
      expect(state.error).toBe("boom");
      expect(state.hasLoaded).toBe(true);
      expect(state.isCreating).toBe(true);
    });

    it("tracks and clears pending deletion maps", () => {
      let state = workspaceReducer(initialState, markWorkspacePendingDeletion("ws-1"));
      expect(state.pendingDeletions).toEqual({ "ws-1": true });

      state = workspaceReducer(state, clearWorkspacePendingDeletion("ws-1"));
      expect(state.pendingDeletions).toEqual({});
    });

    it("tracks and clears pending creations", () => {
      const pending = makeWorkspace({ id: "pending-1", title: "Pending" });
      let state = workspaceReducer(initialState, setPendingCreation(pending));
      expect(state.pendingCreations["pending-1"]).toEqual(pending);

      state = workspaceReducer(state, clearPendingCreation("pending-1"));
      expect(state.pendingCreations).toEqual({});
    });

    it("replaces visible workspace items while preserving enrichment and pending creations", () => {
      const existing = makeWorkspace({
        id: "ws-1",
        title: "Existing",
        agentSummary: { agentIds: ["agent-1"] },
      });
      const pending = makeWorkspace({ id: "pending-1", title: "Pending" });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(state, setPendingCreation(pending));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([
          {
            ...existing,
            agentSummary: undefined,
            status: WorkspaceStatusEnum.Active,
            archived: false,
          },
          makeWorkspace({ id: "pending-1", title: "Pending From Backend" }),
          makeWorkspace({ id: "ws-2", title: "Second" }),
        ])
      );

      expect(state.workspaces.ids).toEqual(["ws-1", "pending-1", "ws-2"]);
      expect(getItem(state.workspaces, "ws-1")?.agentSummary).toEqual(existing.agentSummary);
      expect(state.pendingCreations).toEqual({});
    });

    it("preserves runtime PR fields when a lite list payload omits them", () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({
        id: "ws-1",
        title: "Existing",
        pullRequests: [pr],
        activePullRequest: pr,
        prNumber: pr.number,
        prStatus: pr.status,
        prUrl: pr.url,
      });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([
          makeWorkspace({
            id: "ws-1",
            title: "Existing",
            pullRequests: undefined,
            activePullRequest: undefined,
            prNumber: undefined,
            prStatus: undefined,
            prUrl: undefined,
          }),
        ])
      );

      const merged = getItem(state.workspaces, "ws-1");
      expect(merged?.pullRequests).toEqual([pr]);
      expect(merged?.activePullRequest).toEqual(pr);
      expect(merged?.prNumber).toBe(pr.number);
      expect(merged?.prStatus).toBe(pr.status);
      expect(merged?.prUrl).toBe(pr.url);
    });

    it("preserves existing pullRequests when an incoming empty array would clear them", () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({ id: "ws-1", pullRequests: [pr] });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([makeWorkspace({ id: "ws-1", pullRequests: [] })])
      );

      expect(getItem(state.workspaces, "ws-1")?.pullRequests).toEqual([pr]);
    });

    it("resets workspace migration state including recency", () => {
      const ws = makeWorkspace({ id: "ws-1" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));
      state = workspaceReducer(state, setWorkspaceLoading(true));
      state = workspaceReducer(state, markWorkspacePendingDeletion("ws-1"));
      state = workspaceReducer(state, recordWorkspaceView("ws-1", 123));

      const reset = workspaceReducer(state, resetWorkspaceState());
      expect(reset.activeWorkspaceId).toBeNull();
      expect(reset.workspaces).toEqual(createCollection("id"));
      expect(reset.loading).toBe(false);
      expect(reset.pendingDeletions).toEqual({});
      expect(reset.recency).toEqual(initialState.recency);
    });
  });

  // -----------------------------------------------------------------------
  // Workspace entity storage
  // -----------------------------------------------------------------------

  describe("setWorkspaceEntity", () => {
    it("stores a workspace entity by ID", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "My Workspace" });
      const next = workspaceReducer(initialState, setWorkspaceEntity(ws));
      expect(getItem(next.workspaces, "ws-1")).toEqual(ws);
    });

    it("overwrites an existing workspace entity", () => {
      const ws1 = makeWorkspace({ id: "ws-1", title: "Original" });
      const ws1Updated = makeWorkspace({ id: "ws-1", title: "Updated" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws1Updated));
      expect(getItem(state.workspaces, "ws-1")?.title).toBe("Updated");
    });

    it("does not affect other workspace entities", () => {
      const ws1 = makeWorkspace({ id: "ws-1" });
      const ws2 = makeWorkspace({ id: "ws-2" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      expect(getItem(state.workspaces, "ws-1")).toEqual(ws1);
      expect(getItem(state.workspaces, "ws-2")).toEqual(ws2);
    });

    it("preserves runtime PR fields when re-hydrated with a lite payload that omits them", () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({
        id: "ws-1",
        pullRequests: [pr],
        activePullRequest: pr,
        prNumber: pr.number,
        prStatus: pr.status,
        prUrl: pr.url,
      });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        setWorkspaceEntity(
          makeWorkspace({
            id: "ws-1",
            pullRequests: undefined,
            activePullRequest: undefined,
            prNumber: undefined,
            prStatus: undefined,
            prUrl: undefined,
          })
        )
      );

      const merged = getItem(state.workspaces, "ws-1");
      expect(merged?.pullRequests).toEqual([pr]);
      expect(merged?.activePullRequest).toEqual(pr);
      expect(merged?.prNumber).toBe(pr.number);
      expect(merged?.prStatus).toBe(pr.status);
      expect(merged?.prUrl).toBe(pr.url);
    });
  });

  describe("updateWorkspaceEntity", () => {
    it("is a fan-out action and does not mutate workspace storage directly", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original" });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(state, updateWorkspaceEntity("ws-1", { title: "Changed" }));

      expect(next).toBe(state);
      expect(getItem(next.workspaces, "ws-1")?.title).toBe("Original");
    });
  });

  describe("bulkUpdateWorkspaceEntities", () => {
    it("merges partial changes into an existing workspace", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original" });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity("ws-1", {
            id: "ws-renamed" as WorkspaceId,
            title: "Changed",
            createdAt: "2026-02-01T00:00:00Z",
            updatedAt: "2026-02-01T00:00:00Z",
          }),
        ])
      );

      expect(next).not.toBe(state);
      expect(next.workspaces).not.toBe(state.workspaces);
      expect(getItem(next.workspaces, "ws-1")?.title).toBe("Changed");
      expect(getItem(next.workspaces, "ws-1")?.branch).toBe("main"); // untouched
      expect(getItem(next.workspaces, "ws-1")?.id).toBe("ws-1");
      expect(getItem(next.workspaces, "ws-1")?.createdAt).toBe(ws.createdAt);
      expect(getItem(next.workspaces, "ws-1")?.updatedAt).toBe(ws.updatedAt);
    });

    it("is a no-op when workspace does not exist", () => {
      const state = workspaceReducer(
        initialState,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-missing", { title: "Nope" })])
      );
      expect(state).toBe(initialState);
    });

    it("preserves state identity when changes are empty", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original" });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-1", {})])
      );

      expect(next).toBe(state);
    });

    it("preserves state identity when changes match the existing workspace", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original" });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-1", { title: "Original" })])
      );

      expect(next).toBe(state);
    });

    it("still applies pending archive overrides when effective fields change", () => {
      const ws = makeWorkspace({ id: "ws-1", status: WorkspaceStatusEnum.Active, archived: false });
      const state = {
        ...workspaceReducer(initialState, setWorkspaceEntity(ws)),
        pendingArchives: { "ws-1": true },
      };

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-1", {})])
      );

      expect(next).not.toBe(state);
      expect(getItem(next.workspaces, "ws-1")?.status).toBe(WorkspaceStatusEnum.Archived);
      expect(getItem(next.workspaces, "ws-1")?.archived).toBe(true);
    });

    it("applies updates in original order across multiple workspaces", () => {
      let state = workspaceReducer(initialState, setWorkspaceEntity(makeWorkspace({ id: "ws-1" })));
      state = workspaceReducer(state, setWorkspaceEntity(makeWorkspace({ id: "ws-2" })));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity("ws-1", { title: "First" }),
          updateWorkspaceEntity("ws-2", { title: "Second" }),
          updateWorkspaceEntity("ws-1", { branch: "feature" }),
          updateWorkspaceEntity("ws-1", { title: "Final" }),
        ])
      );

      expect(getItem(next.workspaces, "ws-1")?.title).toBe("Final");
      expect(getItem(next.workspaces, "ws-1")?.branch).toBe("feature");
      expect(getItem(next.workspaces, "ws-2")?.title).toBe("Second");
    });

    it("preserves pending archive semantics across same-workspace updates", () => {
      const ws = makeWorkspace({ id: "ws-1", status: WorkspaceStatusEnum.Active, archived: false });
      const state = {
        ...workspaceReducer(initialState, setWorkspaceEntity(ws)),
        pendingArchives: { "ws-1": true },
      };

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity("ws-1", { title: "Pending Archive" }),
          updateWorkspaceEntity("ws-1", { status: WorkspaceStatusEnum.Active }),
        ])
      );

      expect(getItem(next.workspaces, "ws-1")?.title).toBe("Pending Archive");
      expect(getItem(next.workspaces, "ws-1")?.status).toBe(WorkspaceStatusEnum.Active);
    });
  });

  describe("removeWorkspaceEntity", () => {
    it("removes a workspace entity by ID", () => {
      const ws = makeWorkspace({ id: "ws-1" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));
      expect(getItem(state.workspaces, "ws-1")).toBeUndefined();
    });

    it("is a no-op when workspace does not exist", () => {
      const state = workspaceReducer(initialState, removeWorkspaceEntity("ws-missing"));
      expect(state).toBe(initialState);
    });

    it("does not affect other workspace entities", () => {
      const ws1 = makeWorkspace({ id: "ws-1" });
      const ws2 = makeWorkspace({ id: "ws-2" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));
      expect(getItem(state.workspaces, "ws-1")).toBeUndefined();
      expect(getItem(state.workspaces, "ws-2")).toEqual(ws2);
    });

    it("also removes the workspace from the ordered list and clears active if needed", () => {
      const ws = makeWorkspace({ id: "ws-1" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));

      state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));
      expect(state.workspaces.ids).toEqual([]);
      expect(state.activeWorkspaceId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Regression: active-workspace Redux hydration
  // -----------------------------------------------------------------------

  describe("active-workspace hydration regression", () => {
    it("workspace switch cycle: Redux holds both entities and active pointer resolves to the new workspace", () => {
      const wsA = makeWorkspace({ id: "ws-A", title: "Workspace A" });
      const wsB = makeWorkspace({ id: "ws-B", title: "Workspace B" });

      // Simulate opening ws-A: hydrate entity + set active
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsA));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-A"));

      expect(getItem(state.workspaces, "ws-A")).toEqual(wsA);
      expect(state.activeWorkspaceId).toBe("ws-A");

      // Simulate switching to ws-B: hydrate entity + set active
      state = workspaceReducer(state, setWorkspaceEntity(wsB));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-B"));

      // Active pointer moved to ws-B
      expect(state.activeWorkspaceId).toBe("ws-B");
      // ws-B entity is present
      expect(getItem(state.workspaces, "ws-B")).toEqual(wsB);
      // ws-A entity is still retained (not cleared on switch)
      expect(getItem(state.workspaces, "ws-A")).toEqual(wsA);
    });

    it("switching workspaces does not leave stale data as the active Redux value", () => {
      const wsA = makeWorkspace({ id: "ws-A", title: "Stale Workspace" });
      const wsB = makeWorkspace({ id: "ws-B", title: "Fresh Workspace" });

      // Open ws-A
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsA));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-A"));

      // Switch to ws-B
      state = workspaceReducer(state, setWorkspaceEntity(wsB));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-B"));

      // selectActiveWorkspace must resolve to ws-B, not ws-A
      const fullState = { workspace: state } as any;
      const active = selectActiveWorkspace.select(fullState);
      expect(active).toEqual(wsB);
      expect(active?.title).toBe("Fresh Workspace");
    });

    it("updateWorkspaceEntity keeps the active workspace entity current after IPC update", () => {
      const ws = makeWorkspace({ id: "ws-1", title: "Original Title" });

      // Hydrate and activate
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));

      // Simulate batched workspace:updated IPC storage
      state = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-1", { title: "Updated Title" })])
      );

      // Active workspace selector should reflect the update
      const fullState = { workspace: state } as any;
      const active = selectActiveWorkspace.select(fullState);
      expect(active?.title).toBe("Updated Title");
      // Other fields untouched
      expect(active?.branch).toBe("main");
    });

    it("setWorkspaceEntity re-hydration overwrites stale cached entity for the active workspace", () => {
      const wsOld = makeWorkspace({ id: "ws-1", title: "Cached" });
      const wsFresh = makeWorkspace({ id: "ws-1", title: "From Backend" });

      // Pre-populate from cache
      let state = workspaceReducer(initialState, setWorkspaceEntity(wsOld));
      state = workspaceReducer(state, setActiveWorkspaceId("ws-1"));

      // Post-open confirmation overwrites with fresher data
      state = workspaceReducer(state, setWorkspaceEntity(wsFresh));

      const fullState = { workspace: state } as any;
      expect(selectActiveWorkspace.select(fullState)?.title).toBe("From Backend");
    });

    it("active workspace is undefined when entity has not been hydrated yet", () => {
      // Only activeWorkspaceId is set, but no entity stored
      const state = workspaceReducer(initialState, setActiveWorkspaceId("ws-1"));
      const fullState = { workspace: state } as any;
      expect(selectActiveWorkspace.select(fullState)).toBeUndefined();
      // selectWorkspaceById also returns undefined
      expect(selectWorkspaceById.select(fullState, "ws-1")).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe("workspace selectors", () => {
  const stateWith = (ws: Partial<typeof initialState>) => ({
    workspace: { ...initialState, ...ws },
  });

  it("selectActiveWorkspaceId returns the active workspace id", () => {
    expect(selectActiveWorkspaceId.select(stateWith({ activeWorkspaceId: "ws-1" }) as any)).toBe(
      "ws-1"
    );
  });

  it("exposes workspace request-state selectors", () => {
    const state = stateWith({
      loading: true,
      error: "boom",
      hasLoaded: true,
      isCreating: true,
      pendingDeletions: { "ws-1": true },
      pendingArchives: { "ws-2": true },
      pendingCreations: { "ws-3": makeWorkspace({ id: "ws-3" }) },
    });

    expect(selectWorkspaceLoading.select(state as any)).toBe(true);
    expect(selectWorkspaceHasLoaded.select(state as any)).toBe(true);
    expect(selectWorkspaceIsCreating.select(state as any)).toBe(true);
    expect(selectWorkspacePendingDeletions.select(state as any)).toEqual({ "ws-1": true });
    expect(Object.keys(selectWorkspacePendingCreations.select(state as any))).toEqual(["ws-3"]);
  });

  it("selectWorkspacesSortedByRecency sorts viewed workspaces ahead of unviewed ones", () => {
    const ws1 = makeWorkspace({ id: "ws-1", title: "First" });
    const ws2 = makeWorkspace({ id: "ws-2", title: "Second" });
    const ws3 = makeWorkspace({ id: "ws-3", title: "Third" });
    const ws4 = makeWorkspace({ id: "ws-4", title: "Fourth" });
    const state = stateWith({
      recency: { lastViewedAt: { "ws-1": 100, "ws-2": 200 } },
    });

    const sorted = selectWorkspacesSortedByRecency.select(state as any, [ws3, ws1, ws4, ws2]);
    expect(sorted.map((workspace) => workspace.id)).toEqual(["ws-2", "ws-1", "ws-3", "ws-4"]);
  });

  // -----------------------------------------------------------------------
  // Workspace entity selectors
  // -----------------------------------------------------------------------

  it("selectWorkspaceById returns stored workspace", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Found" });
    const state = stateWith({ workspaces: createCollection("id", [ws]) });
    expect(selectWorkspaceById.select(state as any, "ws-1")).toEqual(ws);
  });

  it("selectWorkspaceById returns undefined for unknown id", () => {
    expect(selectWorkspaceById.select(stateWith({}) as any, "ws-missing")).toBeUndefined();
  });

  it("selectWorkspaceItems and emptiness use collection order", () => {
    const ws1 = makeWorkspace({ id: "ws-1", path: "C:\\repo\\one" });
    const ws2 = makeWorkspace({ id: "ws-2", path: "/repo/two" });
    const state = stateWith({
      workspaces: createCollection("id", [ws2, ws1]),
    });

    expect(getItems((state as any).workspace.workspaces).map((workspace) => workspace.id)).toEqual([
      "ws-2",
      "ws-1",
    ]);
    expect(selectWorkspaceItems.select(state as any).map((workspace) => workspace.id)).toEqual(["ws-2", "ws-1"]);
    expect(selectWorkspaceIsEmpty.select(state as any)).toBe(false);
  });

  it("selectActiveWorkspace resolves active workspace from the collection", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Active" });
    const state = stateWith({
      activeWorkspaceId: "ws-1",
      workspaces: createCollection("id", [ws]),
    });
    expect(selectActiveWorkspace.select(state as any)).toEqual(ws);
  });

  it("selectActiveWorkspace returns undefined when no active id", () => {
    expect(selectActiveWorkspace.select(stateWith({}) as any)).toBeUndefined();
  });

  it("selectActiveWorkspace returns undefined when active id not hydrated", () => {
    const state = stateWith({ activeWorkspaceId: "ws-1", workspaces: createCollection("id") });
    expect(selectActiveWorkspace.select(state as any)).toBeUndefined();
  });

  it("selectCurrentWorkspace aliases the active workspace selector", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Current" });
    const state = stateWith({ activeWorkspaceId: "ws-1", workspaces: createCollection("id", [ws]) });
    expect(selectCurrentWorkspace.select(state as any)).toEqual(ws);
  });

});

