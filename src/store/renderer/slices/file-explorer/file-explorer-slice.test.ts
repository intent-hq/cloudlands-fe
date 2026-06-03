import type { FileGitStatus, FileNode } from "$shared/types";
import { getItem } from "ag-redux-toolkit/utils/collections/collection-utils";
import {
  describe,
  expect,
  it,
} from "vitest";
import {
  addExpandedPath,
  emptyFileExplorerWorkspaceState,
  fileExplorerReducer,
  initialState,
  refreshDirectoryRequested,
  removeAgentFileEditsEntries,
  removeGitStatusEntries,
  setChildrenAtPathAction,
  setFileExplorerWorkspacePath,
  setGitStatusMap,
  setAgentFileEditsAction,
  setRootNode,
  updateAgentFileEditsEntries,
  updateGitStatusEntries,
} from "./file-explorer-slice";

const WS_ID = "ws-1";
const WS_PATH = "/a/repo";

const MODIFIED: FileGitStatus = { status: " M", additions: 2, deletions: 1 };
const MODIFIED_SAME_SHAPE: FileGitStatus = { status: " M", additions: 2, deletions: 1 };
const ADDED: FileGitStatus = { status: "A ", additions: 5, deletions: 0 };

function directory(path: string, children?: FileNode[]): FileNode {
  return {
    name: path.split("/").pop() || "",
    path,
    type: "directory",
    ...(children ? { children } : {}),
  };
}

function file(path: string): FileNode {
  return {
    name: path.split("/").pop() || "",
    path,
    type: "file",
  };
}

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

describe("fileExplorerReducer — normalized tree state", () => {
  it("starts with a serializable empty normalized tree", () => {
    expect(emptyFileExplorerWorkspaceState.rootPath).toBeNull();
    expect(emptyFileExplorerWorkspaceState.nodes).toEqual({
      idField: "path",
      ids: [],
      map: {},
      refsCount: {},
    });
    expect(Object.hasOwn(emptyFileExplorerWorkspaceState, "environmentConfig")).toBe(false);
    expect(JSON.parse(JSON.stringify(emptyFileExplorerWorkspaceState))).toEqual(
      emptyFileExplorerWorkspaceState,
    );
  });

  it("normalizes a root FileNode tree into a path-keyed Collection", () => {
    const root = directory(WS_PATH, [
      directory(`${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
      file(`${WS_PATH}/README.md`),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));
    const ws = state.byWorkspaceId[WS_ID];

    expect(ws.rootPath).toBe(WS_PATH);
    expect(ws.nodes.ids).toEqual([
      WS_PATH,
      `${WS_PATH}/src`,
      `${WS_PATH}/src/index.ts`,
      `${WS_PATH}/README.md`,
    ]);
    expect(getItem(ws.nodes, WS_PATH)?.children).toEqual([
      `${WS_PATH}/src`,
      `${WS_PATH}/README.md`,
    ]);
    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([
      `${WS_PATH}/src/index.ts`,
    ]);
  });

  it("replaces an existing root tree and removes old root descendants", () => {
    const initialRoot = directory(WS_PATH, [
      directory(`${WS_PATH}/src`, [file(`${WS_PATH}/src/old.ts`)]),
    ]);
    const replacementPath = "/replacement/repo";
    const replacementRoot = directory(replacementPath, [
      directory(`${replacementPath}/app`, [file(`${replacementPath}/app/new.ts`)]),
    ]);

    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, initialRoot));
    const next = fileExplorerReducer(state, setRootNode(WS_ID, replacementRoot));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.rootPath).toBe(replacementPath);
    expect(ws.nodes.ids).toEqual([
      replacementPath,
      `${replacementPath}/app`,
      `${replacementPath}/app/new.ts`,
    ]);
    expect(getItem(ws.nodes, WS_PATH)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src`)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/old.ts`)).toBeUndefined();
    expect(getItem(ws.nodes, replacementPath)?.children).toEqual([`${replacementPath}/app`]);
    expect(getItem(ws.nodes, `${replacementPath}/app`)?.children).toEqual([
      `${replacementPath}/app/new.ts`,
    ]);
    expect(getItem(ws.nodes, `${replacementPath}/app/new.ts`)?.children).toEqual([]);
    expect(ws.treeVersion).toBe(state.byWorkspaceId[WS_ID].treeVersion + 1);
  });

  it("preserves expanded paths when a replacement tree omits them", () => {
    const initialRoot = directory(WS_PATH, [directory(`${WS_PATH}/src`)]);
    const replacementRoot = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);

    let state = fileExplorerReducer(initialState, setRootNode(WS_ID, initialRoot));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, WS_PATH));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, `${WS_PATH}/src`));

    const next = fileExplorerReducer(state, setRootNode(WS_ID, replacementRoot));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.expandedPaths).toEqual([WS_PATH, `${WS_PATH}/src`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src`)).toBeUndefined();
  });

  it("replaces directory children while preserving sibling node references", () => {
    const root = directory(WS_PATH, [directory(`${WS_PATH}/src`), file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));
    const readmeBefore = getItem(state.byWorkspaceId[WS_ID].nodes, `${WS_PATH}/README.md`);

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
    );
    const ws = next.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([`${WS_PATH}/src/index.ts`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/index.ts`)).toMatchObject({
      path: `${WS_PATH}/src/index.ts`,
      type: "file",
      children: [],
    });
    expect(getItem(ws.nodes, `${WS_PATH}/README.md`)).toBe(readmeBefore);
    expect(ws.treeVersion).toBe(state.byWorkspaceId[WS_ID].treeVersion + 1);
  });

  it("returns the same state reference when replacing children is a no-op", () => {
    const root = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, WS_PATH, [file(`${WS_PATH}/README.md`)]),
    );

    expect(next).toBe(state);
  });

  it("ignores child replacement for paths absent from the normalized tree", () => {
    const root = directory(WS_PATH, [file(`${WS_PATH}/README.md`)]);
    const state = fileExplorerReducer(initialState, setRootNode(WS_ID, root));

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/index.ts`)]),
    );

    expect(next).toBe(state);
    expect(getItem(next.byWorkspaceId[WS_ID].nodes, `${WS_PATH}/src/index.ts`)).toBeUndefined();
  });

  it("removes stale descendants when a directory refresh changes child paths", () => {
    let state = fileExplorerReducer(
      initialState,
      setRootNode(WS_ID, directory(WS_PATH, [directory(`${WS_PATH}/src`)])),
    );
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [directory(`${WS_PATH}/src/lib`)]),
    );
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src/lib`, [file(`${WS_PATH}/src/lib/old.ts`)]),
    );

    const next = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, `${WS_PATH}/src`, [file(`${WS_PATH}/src/new.ts`)]),
    );
    const ws = next.byWorkspaceId[WS_ID];

    expect(getItem(ws.nodes, `${WS_PATH}/src`)?.children).toEqual([`${WS_PATH}/src/new.ts`]);
    expect(getItem(ws.nodes, `${WS_PATH}/src/new.ts`)).toBeDefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/lib`)).toBeUndefined();
    expect(getItem(ws.nodes, `${WS_PATH}/src/lib/old.ts`)).toBeUndefined();
  });

  it("clears normalized nodes when the workspace path changes", () => {
    const state = fileExplorerReducer(
      initialState,
      setRootNode(WS_ID, directory(WS_PATH, [file(`${WS_PATH}/README.md`)])),
    );

    const next = fileExplorerReducer(state, setFileExplorerWorkspacePath(WS_ID, "/other/repo"));
    const ws = next.byWorkspaceId[WS_ID];

    expect(ws.workspacePath).toBe("/other/repo");
    expect(ws.rootPath).toBeNull();
    expect(ws.nodes.ids).toEqual([]);
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
