import {
  describe,
  expect,
  it,
} from "vitest";
import {
  closeArchiveWarning,
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  initialState,
  openArchiveWarning,
  openBulkDeleteWarningConfirm,
  openDeleteWarning,
  openRemoveRepoConfirm,
  workspaceOperationsReducer,
} from "./workspace-operations-slice";

describe("workspaceOperationsReducer", () => {
  it("opens and clears the delete warning state", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openDeleteWarning({ workspaceId: "ws-1", agentNames: ["Agent One"], hookNames: ["ci-watch"] })
    );

    expect(opened.showDeleteWarning).toBe(true);
    expect(opened.pendingDeleteWorkspaceId).toBe("ws-1");
    expect(opened.runningAgentNamesForDelete).toEqual(["Agent One"]);
    expect(opened.activeHookNamesForDelete).toEqual(["ci-watch"]);

    const closed = workspaceOperationsReducer(opened, closeDeleteWarning());

    expect(closed.showDeleteWarning).toBe(false);
    expect(closed.pendingDeleteWorkspaceId).toBeNull();
    expect(closed.runningAgentNamesForDelete).toEqual([]);
    expect(closed.activeHookNamesForDelete).toEqual([]);
  });

  it("opens and clears the archive warning state", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openArchiveWarning({ workspaceId: "ws-2", agentNames: ["Agent Two"], hookNames: ["pr-watch"] })
    );

    expect(opened.showArchiveWarning).toBe(true);
    expect(opened.pendingArchiveWorkspaceId).toBe("ws-2");
    expect(opened.runningAgentNamesForArchive).toEqual(["Agent Two"]);
    expect(opened.activeHookNamesForArchive).toEqual(["pr-watch"]);

    const closed = workspaceOperationsReducer(opened, closeArchiveWarning());

    expect(closed.showArchiveWarning).toBe(false);
    expect(closed.pendingArchiveWorkspaceId).toBeNull();
    expect(closed.runningAgentNamesForArchive).toEqual([]);
    expect(closed.activeHookNamesForArchive).toEqual([]);
  });

  it("tracks and clears bulk delete warning details", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openBulkDeleteWarningConfirm({ repoKey: "owner/repo", workspaceCount: 3 })
    );

    expect(opened.showBulkDeleteWarningConfirm).toBe(true);
    expect(opened.pendingBulkDeleteRepoKey).toBe("owner/repo");
    expect(opened.bulkDeleteWorkspaceCount).toBe(3);

    const closed = workspaceOperationsReducer(opened, closeBulkDeleteWarningConfirm());

    expect(closed.showBulkDeleteWarningConfirm).toBe(false);
    expect(closed.pendingBulkDeleteRepoKey).toBeNull();
    expect(closed.bulkDeleteWorkspaceCount).toBe(0);
  });

  it("tracks and clears pending repo removal", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openRemoveRepoConfirm("/tmp/repo")
    );

    expect(opened.showRemoveRepoConfirm).toBe(true);
    expect(opened.pendingRemoveRepoPath).toBe("/tmp/repo");

    const closed = workspaceOperationsReducer(opened, closeRemoveRepoConfirm());

    expect(closed.showRemoveRepoConfirm).toBe(false);
    expect(closed.pendingRemoveRepoPath).toBeNull();
  });
});