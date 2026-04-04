import { describe, expect, it } from "vitest";
import {
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  initialState,
  openBulkDeleteWarningConfirm,
  openDeleteWarning,
  openRemoveRepoConfirm,
  workspaceOperationsReducer,
} from "./workspace-operations-slice";

describe("workspaceOperationsReducer", () => {
  it("opens and clears the delete warning state", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openDeleteWarning({ workspaceId: "ws-1", agentNames: ["Agent One"] })
    );

    expect(opened.showDeleteWarning).toBe(true);
    expect(opened.pendingDeleteWorkspaceId).toBe("ws-1");
    expect(opened.runningAgentNamesForDelete).toEqual(["Agent One"]);

    const closed = workspaceOperationsReducer(opened, closeDeleteWarning());

    expect(closed.showDeleteWarning).toBe(false);
    expect(closed.pendingDeleteWorkspaceId).toBeNull();
    expect(closed.runningAgentNamesForDelete).toEqual([]);
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