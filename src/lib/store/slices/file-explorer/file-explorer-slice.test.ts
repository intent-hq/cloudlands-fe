import type { FileGitStatus } from "$shared/types";
import { describe, expect, it } from "vitest";
import {
  fileExplorerReducer,
  initialState,
  refreshDirectoryRequested,
  removeAgentFileEditsEntries,
  removeGitStatusEntries,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setAgentFileEditsAction,
  updateAgentFileEditsEntries,
  updateGitStatusEntries,
} from "./file-explorer-slice";

const WS_ID = "ws-1";
const WS_PATH = "/a/repo";

const MODIFIED: FileGitStatus = { status: " M", additions: 2, deletions: 1 };
const MODIFIED_SAME_SHAPE: FileGitStatus = { status: " M", additions: 2, deletions: 1 };
const ADDED: FileGitStatus = { status: "A ", additions: 5, deletions: 0 };

function seeded(): ReturnType<typeof fileExplorerReducer> {
  let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(WS_ID, WS_PATH));
  state = fileExplorerReducer(
    state,
    setGitStatusMap(WS_ID, { "src/lib/foo.ts": MODIFIED, "README.md": ADDED }),
  );
  return state;
}

describe("fileExplorerReducer — updateGitStatusEntries", () => {
  it("returns identical state reference when entries are empty", () => {
    const state = seeded();
    const next = fileExplorerReducer(state, updateGitStatusEntries(WS_ID, {}));
    expect(next).toBe(state);
  });

  it("returns identical state reference when every entry deep-equals existing", () => {
    const state = seeded();
    const next = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, {
        "src/lib/foo.ts": MODIFIED_SAME_SHAPE,
        "README.md": ADDED,
      }),
    );
    expect(next).toBe(state);
  });

  it("updates only changed entries when a value differs and keeps unchanged refs stable", () => {
    const state = seeded();
    const prevFoo = state.byWorkspaceId[WS_ID].gitStatus["src/lib/foo.ts"];
    const prevReadme = state.byWorkspaceId[WS_ID].gitStatus["README.md"];
    const nextFoo: FileGitStatus = { status: " M", additions: 10, deletions: 0 };
    const next = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, {
        "src/lib/foo.ts": nextFoo,
      }),
    );
    expect(next).not.toBe(state);
    const ws = next.byWorkspaceId[WS_ID];
    expect(ws.gitStatus["src/lib/foo.ts"]).toBe(nextFoo);
    expect(ws.gitStatus["src/lib/foo.ts"]).not.toBe(prevFoo);
    // Unchanged entries must retain the exact same object reference.
    expect(ws.gitStatus["README.md"]).toBe(prevReadme);
  });

  it("does not bump treeVersion on change", () => {
    const state = seeded();
    const prevVersion = state.byWorkspaceId[WS_ID].treeVersion;
    const next = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, {
        "src/lib/foo.ts": { status: " M", additions: 99, deletions: 0 },
      }),
    );
    expect(next.byWorkspaceId[WS_ID].treeVersion).toBe(prevVersion);
  });

  it("adds a brand-new key without removing others", () => {
    const state = seeded();
    const next = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, { "src/new.ts": ADDED }),
    );
    const ws = next.byWorkspaceId[WS_ID];
    expect(ws.gitStatus["src/new.ts"]).toBe(ADDED);
    expect(ws.gitStatus["src/lib/foo.ts"]).toBeDefined();
    expect(ws.gitStatus["README.md"]).toBeDefined();
  });
});

describe("fileExplorerReducer — removeGitStatusEntries", () => {
  it("returns identical state when none of the paths exist", () => {
    const state = seeded();
    const next = fileExplorerReducer(
      state,
      removeGitStatusEntries(WS_ID, ["nope.ts", "also-nope.ts"]),
    );
    expect(next).toBe(state);
  });

  it("removes matching paths and leaves others intact", () => {
    const state = seeded();
    const next = fileExplorerReducer(
      state,
      removeGitStatusEntries(WS_ID, ["src/lib/foo.ts"]),
    );
    const ws = next.byWorkspaceId[WS_ID];
    expect(ws.gitStatus["src/lib/foo.ts"]).toBeUndefined();
    expect(ws.gitStatus["README.md"]).toBeDefined();
    // treeVersion unchanged.
    expect(ws.treeVersion).toBe(state.byWorkspaceId[WS_ID].treeVersion);
  });
});

describe("fileExplorerReducer — updateAgentFileEditsEntries / removeAgentFileEditsEntries", () => {
  function seededEdits() {
    let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(WS_ID, WS_PATH));
    state = fileExplorerReducer(
      state,
      setAgentFileEditsAction(WS_ID, {
        "src/a.ts": ["agent-1"],
        "src/b.ts": ["agent-2"],
      }),
    );
    return state;
  }

  it("no-op when every array shallowEquals existing", () => {
    const state = seededEdits();
    const next = fileExplorerReducer(
      state,
      updateAgentFileEditsEntries(WS_ID, {
        "src/a.ts": ["agent-1"],
        "src/b.ts": ["agent-2"],
      }),
    );
    expect(next).toBe(state);
  });

  it("updates only when the array content differs", () => {
    const state = seededEdits();
    const prevB = state.byWorkspaceId[WS_ID].agentFileEdits["src/b.ts"];
    const next = fileExplorerReducer(
      state,
      updateAgentFileEditsEntries(WS_ID, { "src/a.ts": ["agent-1", "agent-9"] }),
    );
    expect(next).not.toBe(state);
    expect(next.byWorkspaceId[WS_ID].agentFileEdits["src/a.ts"]).toEqual(["agent-1", "agent-9"]);
    expect(next.byWorkspaceId[WS_ID].agentFileEdits["src/b.ts"]).toBe(prevB);
  });

  it("removeAgentFileEditsEntries is a no-op when path absent", () => {
    const state = seededEdits();
    const next = fileExplorerReducer(state, removeAgentFileEditsEntries(WS_ID, ["nope"]));
    expect(next).toBe(state);
  });
});



describe("refreshDirectoryRequested", () => {
  it("is a pure saga-trigger action — reducer does not mutate state for it", () => {
    const seededState = seeded();
    const next = fileExplorerReducer(
      seededState,
      refreshDirectoryRequested(WS_ID, "/a/repo/src/new.ts"),
    );
    expect(next).toBe(seededState);
  });
});
