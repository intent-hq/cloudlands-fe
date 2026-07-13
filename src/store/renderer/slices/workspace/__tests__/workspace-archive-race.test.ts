/**
 * Regression tests for race conditions between workspace archive and other
 * CRUD operations.
 *
 * These tests cover scenarios previously tested in workspace-archive-race.test.ts:
 * 1. Archive flag survives workspace list replacement from backend
 * 2. Update after archive preserves the archived status
 * 3. Concurrent archive + delete does not corrupt state
 * 4. Archive + immediate re-list merges correctly
 */

import type { Workspace, WorkspaceId } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import {
  describe,
  expect,
  it,
} from "vitest";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  bulkUpdateWorkspaceEntities,
  clearWorkspacePendingDeletion,
  initialState,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
  updateWorkspaceEntity,
  workspaceReducer,
  type WorkspaceState,
} from "../workspace-slice";

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

describe("workspace archive race conditions", () => {
  it("archive flag in pendingArchives overrides status during replaceWorkspaceList", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Active Space" });
    const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

    // Simulate setting pendingArchives manually (normally done by saga)
    const stateWithArchive: WorkspaceState = {
      ...state,
      pendingArchives: { "ws-1": true },
    };

    // Backend returns the workspace still as Active (archive hasn't propagated yet)
    const freshFromBackend = makeWorkspace({
      id: "ws-1",
      title: "Active Space",
      status: WorkspaceStatusEnum.Active,
    });

    const afterReplace = workspaceReducer(
      stateWithArchive,
      replaceWorkspaceList([freshFromBackend])
    );

    // The workspace should appear as Archived due to pendingArchives flag
    const replaced = getItem(afterReplace.workspaces, "ws-1");
    expect(replaced?.status).toBe(WorkspaceStatusEnum.Archived);
    expect(replaced?.archived).toBe(true);
  });

  it("updateWorkspaceEntity preserves archived status when pendingArchives is set", () => {
    const ws = makeWorkspace({ id: "ws-1", status: WorkspaceStatusEnum.Active });
    let state = workspaceReducer(initialState, setWorkspaceEntity(ws));

    // Simulate pending archive
    state = { ...state, pendingArchives: { "ws-1": true } };

    // A batched IPC update arrives with a title change but no status change
    state = workspaceReducer(
      state,
      bulkUpdateWorkspaceEntities([updateWorkspaceEntity("ws-1", { title: "Updated Title" })])
    );

    const updated = getItem(state.workspaces, "ws-1");
    expect(updated?.title).toBe("Updated Title");
    expect(updated?.status).toBe(WorkspaceStatusEnum.Archived);
    expect(updated?.archived).toBe(true);
  });

  it("concurrent archive + delete: pending deletion prevents stale entity from lingering", () => {
    const ws = makeWorkspace({ id: "ws-1" });
    let state = workspaceReducer(initialState, setWorkspaceEntity(ws));

    // Both archive and delete are initiated concurrently
    state = { ...state, pendingArchives: { "ws-1": true } };
    state = workspaceReducer(state, markWorkspacePendingDeletion("ws-1"));

    expect(state.pendingDeletions["ws-1"]).toBe(true);
    expect(state.pendingArchives["ws-1"]).toBe(true);

    // Delete wins: entity is removed
    state = workspaceReducer(state, removeWorkspaceEntity("ws-1"));

    expect(getItem(state.workspaces, "ws-1")).toBeUndefined();
    expect(state.activeWorkspaceId).toBeNull();
  });

  it("delete + immediate re-list filters out pending-deletion workspace from visible list", () => {
    const ws = makeWorkspace({ id: "ws-1", title: "Doomed" });
    let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
    state = workspaceReducer(state, markWorkspacePendingDeletion("ws-1"));

    // Backend list still includes ws-1 (deletion not propagated yet)
    state = workspaceReducer(
      state,
      replaceWorkspaceList([makeWorkspace({ id: "ws-1", title: "Doomed" })])
    );

    // replaceWorkspaceList filters out pending-deletion workspaces
    expect(state.pendingDeletions["ws-1"]).toBe(true);
    expect(getItem(state.workspaces, "ws-1")).toBeUndefined();
  });

  it("clearing pending deletion after backend confirms removal is idempotent", () => {
    let state = workspaceReducer(initialState, markWorkspacePendingDeletion("ws-1"));
    state = workspaceReducer(state, clearWorkspacePendingDeletion("ws-1"));

    // Clearing again is a no-op
    const state2 = workspaceReducer(state, clearWorkspacePendingDeletion("ws-1"));
    expect(state2).toBe(state);
    expect(state2.pendingDeletions).toEqual({});
  });

  it("archive + update with explicit status change overrides pending archive", () => {
    const ws = makeWorkspace({ id: "ws-1", status: WorkspaceStatusEnum.Active });
    let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
    state = { ...state, pendingArchives: { "ws-1": true } };

    // An update with an explicit status (e.g., backend confirms unarchive)
    state = workspaceReducer(
      state,
      bulkUpdateWorkspaceEntities([
        updateWorkspaceEntity("ws-1", { status: WorkspaceStatusEnum.Active }),
      ])
    );

    // The explicit status should take precedence (pendingArchive guard only applies
    // when changes.status === undefined)
    const updated = getItem(state.workspaces, "ws-1");
    expect(updated?.status).toBe(WorkspaceStatusEnum.Active);
  });
});

