import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeStage, type TrackedChange } from "$features/file-tracking/types";
import {
  markWorkspaceNavigationInitialized,
  openWorkspaceDiff,
  openWorkspaceFile,
  updateWorkspaceCodeReview,
  workspaceNavigationReducer,
  type WorkspaceNavigationState,
  openWorkspaceCodeReview,
} from "./workspace-navigation-slice";

const baseState: WorkspaceNavigationState = {
  byWorkspaceId: {},
};

const trackedChange: TrackedChange = {
  id: "change-1",
  file: "src/App.svelte",
  relativePath: "src/App.svelte",
  stage: ChangeStage.Unstaged,
  stats: { additions: 3, deletions: 1 },
  attribution: { timestamp: 1 },
};

describe("workspaceNavigationReducer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:00:00.000Z"));
  });

  it("adds initial history for the default spec note when initialized", () => {
    const nextState = workspaceNavigationReducer(baseState, markWorkspaceNavigationInitialized("ws-1"));
    const workspaceState = nextState.byWorkspaceId["ws-1"]!;

    expect(workspaceState.ui.hasInitialized).toBe(true);
    expect(workspaceState.navigation.currentIndex).toBe(0);
    expect(workspaceState.navigation.history).toEqual([
      expect.objectContaining({ type: "note", id: "spec", label: "Note" }),
    ]);
  });

  it("stores file selection, line jump, and navigation history", () => {
    const nextState = workspaceNavigationReducer(
      baseState,
      openWorkspaceFile("ws-1", "src/routes/+page.svelte", { line: 42 })
    );
    const workspaceState = nextState.byWorkspaceId["ws-1"]!;

    expect(workspaceState.mainPanel).toMatchObject({
      type: "file",
      selectedFile: "src/routes/+page.svelte",
    });
    expect(workspaceState.ui.jumpToLine).toBe(42);
    expect(workspaceState.navigation.history).toEqual([
      expect.objectContaining({ type: "file", id: "src/routes/+page.svelte" }),
    ]);
  });

  it("toggles repeated diff opens for the same file and stage back to accept-changes", () => {
    const withDiff = workspaceNavigationReducer(baseState, openWorkspaceDiff("ws-1", trackedChange));
    const toggled = workspaceNavigationReducer(withDiff, openWorkspaceDiff("ws-1", trackedChange));
    const workspaceState = toggled.byWorkspaceId["ws-1"]!;

    expect(workspaceState.mainPanel.type).toBe("accept-changes");
    expect(workspaceState.navigation.history).toHaveLength(1);
  });

  it("stores branch-base context for diff panels and history entries", () => {
    const state = workspaceNavigationReducer(
      baseState,
      openWorkspaceDiff("ws-1", trackedChange, {
        branchBaseRef: "origin/main",
        branchBaseCommitSha: "abc123",
      })
    );
    const workspaceState = state.byWorkspaceId["ws-1"]!;

    expect(workspaceState.mainPanel).toEqual(
      expect.objectContaining({
        type: "file-tracking-diff",
        branchBaseRef: "origin/main",
        branchBaseCommitSha: "abc123",
      })
    );
    expect(workspaceState.navigation.history[0]).toEqual(
      expect.objectContaining({
        type: "diff",
        branchBaseRef: "origin/main",
        branchBaseCommitSha: "abc123",
      })
    );
  });

  it("merges code review updates into the current review panel and history", () => {
    const withReview = workspaceNavigationReducer(
      baseState,
      openWorkspaceCodeReview("ws-1", {
        result: null,
        stagedFiles: ["src/App.svelte"],
        status: "running",
      })
    );
    const updated = workspaceNavigationReducer(
      withReview,
      updateWorkspaceCodeReview("ws-1", {
        result: "Looks good",
        status: "complete",
        streamingText: "done",
      })
    );
    const workspaceState = updated.byWorkspaceId["ws-1"]!;
    const currentEntry = workspaceState.navigation.history[workspaceState.navigation.currentIndex]!;

    expect(workspaceState.mainPanel).toMatchObject({
      type: "code-review",
      result: "Looks good",
      status: "complete",
      streamingText: "done",
    });
    expect(currentEntry).toMatchObject({
      type: "code-review",
      result: "Looks good",
      status: "complete",
    });
  });
});
