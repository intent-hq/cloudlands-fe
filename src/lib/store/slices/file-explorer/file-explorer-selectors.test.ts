import type { FileNode, FileGitStatus } from "$shared/types";
import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import {
  emptyFileExplorerWorkspaceState,
  fileExplorerReducer,
  setChildrenAtPathAction,
  setGitStatusMap,
  setRootNode,
  setFileExplorerWorkspacePath,
  addExpandedPath,
} from "./file-explorer-slice";
import { selectFlattenedNodes } from "./file-explorer-selectors";
import type { FileExplorerWorkspaceState } from "./file-explorer-types";

const WS_ID = "ws-1";
const WORKSPACE_PATH = "/a/repo";

function makeTree(): FileNode {
  const foo: FileNode = { name: "foo.ts", path: "/a/repo/src/lib/foo.ts", type: "file" };
  const bar: FileNode = { name: "bar.ts", path: "/a/repo/src/lib/bar.ts", type: "file" };
  const lib: FileNode = {
    name: "lib",
    path: "/a/repo/src/lib",
    type: "directory",
    children: [foo, bar],
  };
  // `src` has a second child (index.ts) to avoid single-child directory
  // compaction in flattenVisibleNodes, so `src` itself appears in the flat list.
  const index: FileNode = { name: "index.ts", path: "/a/repo/src/index.ts", type: "file" };
  const src: FileNode = {
    name: "src",
    path: "/a/repo/src",
    type: "directory",
    children: [lib, index],
  };
  const readme: FileNode = { name: "README.md", path: "/a/repo/README.md", type: "file" };
  return {
    name: "repo",
    path: WORKSPACE_PATH,
    type: "directory",
    children: [src, readme],
  };
}

function mockState(overrides: Partial<FileExplorerWorkspaceState> = {}): StoreState {
  const ws: FileExplorerWorkspaceState = {
    ...emptyFileExplorerWorkspaceState,
    workspacePath: WORKSPACE_PATH,
    rootNode: makeTree(),
    // Expand root + all intermediate directories so every node is visible
    expandedPaths: [WORKSPACE_PATH, "/a/repo/src", "/a/repo/src/lib"],
    ...overrides,
  };
  return {
    fileExplorer: { byWorkspaceId: { [WS_ID]: ws } },
  } as unknown as StoreState;
}

function findByPath(nodes: ReturnType<typeof selectFlattenedNodes.select>, path: string) {
  return nodes.find((n) => n.node.path === path);
}

describe("selectFlattenedNodes — agentEdits derivation", () => {
  it("returns no agentEdits when record is empty", () => {
    const flat = selectFlattenedNodes.select(mockState({ agentFileEdits: {} }), WS_ID);
    for (const n of flat) {
      expect(n.agentEdits).toBeUndefined();
    }
  });

  it("enriches a top-level child using its relative path", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ agentFileEdits: { "README.md": ["agent-1"] } }),
      WS_ID,
    );
    const readme = findByPath(flat, "/a/repo/README.md");
    expect(readme?.agentEdits).toEqual(["agent-1"]);
  });

  it("enriches a nested child at depth ≥ 2", () => {
    const flat = selectFlattenedNodes.select(
      mockState({
        agentFileEdits: {
          "src/lib/foo.ts": ["agent-1", "agent-2"],
        },
      }),
      WS_ID,
    );
    const foo = findByPath(flat, "/a/repo/src/lib/foo.ts");
    expect(foo?.agentEdits).toEqual(["agent-1", "agent-2"]);
  });

  it("does not set agentEdits when the node has no matching record entry", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ agentFileEdits: { "src/lib/foo.ts": ["agent-1"] } }),
      WS_ID,
    );
    const src = findByPath(flat, "/a/repo/src");
    expect(src?.agentEdits).toBeUndefined();
    const readme = findByPath(flat, "/a/repo/README.md");
    expect(readme?.agentEdits).toBeUndefined();
  });

  it("enriches a directory from parent entries (as produced by propagateAgentEditsToParents)", () => {
    // propagateAgentEditsToParents fills parent directory entries using relative
    // directory paths. Simulate that here and verify the directory picks it up.
    const flat = selectFlattenedNodes.select(
      mockState({
        agentFileEdits: {
          "src": ["agent-1"],
          "src/lib": ["agent-1"],
          "src/lib/foo.ts": ["agent-1"],
        },
      }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/src")?.agentEdits).toEqual(["agent-1"]);
    expect(findByPath(flat, "/a/repo/src/lib")?.agentEdits).toEqual(["agent-1"]);
    expect(findByPath(flat, "/a/repo/src/lib/foo.ts")?.agentEdits).toEqual(["agent-1"]);
  });

  it("handles the workspace-root path entry (stripped to empty string)", () => {
    // If something stored an entry under the empty key, the stripped logic must
    // only apply it to nodes whose path actually strips to "", i.e. the root.
    // The workspace root is not in the flattened list (only its children are),
    // so we just verify child nodes are unaffected by an empty-key entry.
    const flat = selectFlattenedNodes.select(
      mockState({ agentFileEdits: { "": ["agent-1"] } }),
      WS_ID,
    );
    for (const n of flat) {
      expect(n.agentEdits).toBeUndefined();
    }
  });

  it("recomputes when agentFileEdits changes", () => {
    const before = selectFlattenedNodes.select(
      mockState({ agentFileEdits: {} }),
      WS_ID,
    );
    expect(findByPath(before, "/a/repo/src/lib/foo.ts")?.agentEdits).toBeUndefined();

    const after = selectFlattenedNodes.select(
      mockState({ agentFileEdits: { "src/lib/foo.ts": ["agent-9"] } }),
      WS_ID,
    );
    expect(findByPath(after, "/a/repo/src/lib/foo.ts")?.agentEdits).toEqual(["agent-9"]);
  });
});

const MODIFIED: FileGitStatus = { status: " M", additions: 3, deletions: 1 };
const ADDED: FileGitStatus = { status: "A ", additions: 7, deletions: 0 };

describe("selectFlattenedNodes — gitStatus derivation", () => {
  it("returns no gitStatus or directoryHasChanges when record is empty", () => {
    const flat = selectFlattenedNodes.select(mockState({ gitStatus: {} }), WS_ID);
    for (const n of flat) {
      expect(n.gitStatus).toBeUndefined();
      expect(n.directoryHasChanges).toBeUndefined();
    }
  });

  it("enriches a top-level file using its relative path", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ gitStatus: { "README.md": MODIFIED } }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/README.md")?.gitStatus).toEqual(MODIFIED);
  });

  it("enriches a nested file at depth ≥ 2", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ gitStatus: { "src/lib/foo.ts": MODIFIED } }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/src/lib/foo.ts")?.gitStatus).toEqual(MODIFIED);
  });

  it("rolls directoryHasChanges up every ancestor of a changed file", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ gitStatus: { "src/lib/foo.ts": MODIFIED } }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/src")?.directoryHasChanges).toBe(true);
    expect(findByPath(flat, "/a/repo/src/lib")?.directoryHasChanges).toBe(true);
    // Directories must not carry gitStatus; that field is file-only.
    expect(findByPath(flat, "/a/repo/src")?.gitStatus).toBeUndefined();
    expect(findByPath(flat, "/a/repo/src/lib")?.gitStatus).toBeUndefined();
  });

  it("does not flag directories that do not contain any changed file", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ gitStatus: { "README.md": MODIFIED } }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/src")?.directoryHasChanges).toBeUndefined();
    expect(findByPath(flat, "/a/repo/src/lib")?.directoryHasChanges).toBeUndefined();
  });

  it("does not set gitStatus on files with no matching record entry", () => {
    const flat = selectFlattenedNodes.select(
      mockState({ gitStatus: { "src/lib/foo.ts": MODIFIED } }),
      WS_ID,
    );
    expect(findByPath(flat, "/a/repo/README.md")?.gitStatus).toBeUndefined();
    expect(findByPath(flat, "/a/repo/src/lib/bar.ts")?.gitStatus).toBeUndefined();
  });

  it("returns gitStatus for deep nodes added via setChildrenAtPathAction (lazy expand)", () => {
    // Start from a tree where `src/lib` has not been expanded yet (no children loaded).
    const foo: FileNode = { name: "foo.ts", path: "/a/repo/src/lib/foo.ts", type: "file" };
    const bar: FileNode = { name: "bar.ts", path: "/a/repo/src/lib/bar.ts", type: "file" };
    const lib: FileNode = {
      name: "lib",
      path: "/a/repo/src/lib",
      type: "directory",
      children: [],
    };
    const index: FileNode = { name: "index.ts", path: "/a/repo/src/index.ts", type: "file" };
    const src: FileNode = {
      name: "src",
      path: "/a/repo/src",
      type: "directory",
      children: [lib, index],
    };
    const root: FileNode = {
      name: "repo",
      path: WORKSPACE_PATH,
      type: "directory",
      children: [src],
    };

    let state = fileExplorerReducer(undefined, setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH));
    state = fileExplorerReducer(state, setRootNode(WS_ID, root));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, WORKSPACE_PATH));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, "/a/repo/src"));
    state = fileExplorerReducer(state, addExpandedPath(WS_ID, "/a/repo/src/lib"));
    state = fileExplorerReducer(
      state,
      setGitStatusMap(WS_ID, { "src/lib/foo.ts": ADDED }),
    );

    // Before children are loaded, foo.ts is not in the flattened list.
    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    expect(findByPath(before, "/a/repo/src/lib/foo.ts")).toBeUndefined();
    // The directory rollup should still flag the ancestors from the record alone.
    expect(findByPath(before, "/a/repo/src/lib")?.directoryHasChanges).toBe(true);
    expect(findByPath(before, "/a/repo/src")?.directoryHasChanges).toBe(true);

    // Simulate lazy-expand by dropping children in under /a/repo/src/lib.
    state = fileExplorerReducer(state, setChildrenAtPathAction(WS_ID, "/a/repo/src/lib", [foo, bar]));

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    expect(findByPath(after, "/a/repo/src/lib/foo.ts")?.gitStatus).toEqual(ADDED);
    expect(findByPath(after, "/a/repo/src/lib/bar.ts")?.gitStatus).toBeUndefined();
  });

  it("recomputes when setGitStatusMap changes the record", () => {
    let state = fileExplorerReducer(undefined, setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH));
    state = fileExplorerReducer(state, setRootNode(WS_ID, makeTree()));
    for (const p of [WORKSPACE_PATH, "/a/repo/src", "/a/repo/src/lib"]) {
      state = fileExplorerReducer(state, addExpandedPath(WS_ID, p));
    }

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    expect(findByPath(before, "/a/repo/src/lib/foo.ts")?.gitStatus).toBeUndefined();
    expect(findByPath(before, "/a/repo/src")?.directoryHasChanges).toBeUndefined();

    state = fileExplorerReducer(
      state,
      setGitStatusMap(WS_ID, { "src/lib/foo.ts": MODIFIED }),
    );

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    expect(findByPath(after, "/a/repo/src/lib/foo.ts")?.gitStatus).toEqual(MODIFIED);
    expect(findByPath(after, "/a/repo/src")?.directoryHasChanges).toBe(true);
    expect(findByPath(after, "/a/repo/src/lib")?.directoryHasChanges).toBe(true);
  });
});

