import {
  describe,
  expect,
  it,
} from "vitest";
import { closeArchiveWarning, closeDeleteWarning, initialState, openArchiveWarning, openDeleteWarning, workspaceOperationsReducer } from "./workspace-operations-slice";

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
});