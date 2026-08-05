import {
  describe,
  expect,
  it,
} from "vitest";
import {
  bulkArchiveActiveWorkComputed,
  closeArchiveWarning,
  closeBulkArchiveConfirm,
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  initialState,
  openArchiveWarning,
  openBulkArchiveConfirm,
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
      openBulkDeleteWarningConfirm({
        repoKey: "owner/repo",
        workspaceCount: 3,
        agentCount: 2,
        hookCount: 1,
      })
    );

    expect(opened.showBulkDeleteWarningConfirm).toBe(true);
    expect(opened.pendingBulkDeleteRepoKey).toBe("owner/repo");
    expect(opened.bulkDeleteWorkspaceCount).toBe(3);
    expect(opened.bulkDeleteActiveAgentCount).toBe(2);
    expect(opened.bulkDeleteActiveHookCount).toBe(1);

    const closed = workspaceOperationsReducer(opened, closeBulkDeleteWarningConfirm());

    expect(closed.showBulkDeleteWarningConfirm).toBe(false);
    expect(closed.pendingBulkDeleteRepoKey).toBeNull();
    expect(closed.bulkDeleteWorkspaceCount).toBe(0);
    expect(closed.bulkDeleteActiveAgentCount).toBe(0);
    expect(closed.bulkDeleteActiveHookCount).toBe(0);
  });

  it("folds computed active work into an open bulk archive confirm and clears it on close", () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openBulkArchiveConfirm("owner/repo")
    );

    expect(opened.bulkArchiveActiveAgentCount).toBe(0);
    expect(opened.bulkArchiveActiveHookCount).toBe(0);

    const computed = workspaceOperationsReducer(
      opened,
      bulkArchiveActiveWorkComputed({
        repoKey: "owner/repo",
        agentCount: 2,
        hookCount: 1,
        token: opened.bulkArchiveComputeToken,
      })
    );

    expect(computed.bulkArchiveActiveAgentCount).toBe(2);
    expect(computed.bulkArchiveActiveHookCount).toBe(1);

    const closed = workspaceOperationsReducer(computed, closeBulkArchiveConfirm());

    expect(closed.showBulkArchiveConfirm).toBe(false);
    expect(closed.bulkArchiveActiveAgentCount).toBe(0);
    expect(closed.bulkArchiveActiveHookCount).toBe(0);
  });

  it("drops late active-work results when the confirm is closed or for another repo", () => {
    const firstOpen = workspaceOperationsReducer(
      initialState,
      openBulkArchiveConfirm("owner/repo")
    );
    const closedState = workspaceOperationsReducer(firstOpen, closeBulkArchiveConfirm());
    const afterLate = workspaceOperationsReducer(
      closedState,
      bulkArchiveActiveWorkComputed({
        repoKey: "owner/repo",
        agentCount: 2,
        hookCount: 1,
        token: firstOpen.bulkArchiveComputeToken,
      })
    );

    expect(afterLate.bulkArchiveActiveAgentCount).toBe(0);
    expect(afterLate.bulkArchiveActiveHookCount).toBe(0);

    const reopened = workspaceOperationsReducer(
      closedState,
      openBulkArchiveConfirm("other/repo")
    );
    const afterMismatch = workspaceOperationsReducer(
      reopened,
      bulkArchiveActiveWorkComputed({
        repoKey: "owner/repo",
        agentCount: 2,
        hookCount: 1,
        token: reopened.bulkArchiveComputeToken,
      })
    );

    expect(afterMismatch.bulkArchiveActiveAgentCount).toBe(0);
    expect(afterMismatch.bulkArchiveActiveHookCount).toBe(0);
  });

  it("drops a stale compute after a close→reopen for the same repo (token mismatch)", () => {
    const firstOpen = workspaceOperationsReducer(
      initialState,
      openBulkArchiveConfirm("owner/repo")
    );
    const reopened = workspaceOperationsReducer(
      workspaceOperationsReducer(firstOpen, closeBulkArchiveConfirm()),
      openBulkArchiveConfirm("owner/repo")
    );

    // Stale compute from the first open carries the old token — dropped.
    const afterStale = workspaceOperationsReducer(
      reopened,
      bulkArchiveActiveWorkComputed({
        repoKey: "owner/repo",
        agentCount: 2,
        hookCount: 1,
        token: firstOpen.bulkArchiveComputeToken,
      })
    );

    expect(afterStale.bulkArchiveActiveAgentCount).toBe(0);
    expect(afterStale.bulkArchiveActiveHookCount).toBe(0);

    // The fresh compute with the current token still folds.
    const afterFresh = workspaceOperationsReducer(
      afterStale,
      bulkArchiveActiveWorkComputed({
        repoKey: "owner/repo",
        agentCount: 0,
        hookCount: 0,
        token: reopened.bulkArchiveComputeToken,
      })
    );

    expect(afterFresh.bulkArchiveActiveAgentCount).toBe(0);
    expect(afterFresh.bulkArchiveActiveHookCount).toBe(0);
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