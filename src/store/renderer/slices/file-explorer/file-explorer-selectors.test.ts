import { WorkspaceStatus, type EnvironmentConfig, type FileNode, type FileGitStatus, type Workspace } from "$shared/types";
import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  fileExplorerReducer,
  emptyFileExplorerWorkspaceState,
  initialState,
  setChildrenAtPathAction,
  setGitStatusMap,
  setRootNode,
  setFileExplorerWorkspacePath,
  addExpandedPath,
  updateGitStatusEntries,
  removeGitStatusEntries,
} from "./file-explorer-slice";
import {
  selectFileExplorerRootNode,
  selectFileExplorerEnvironmentConfigTrigger,
  selectEffectiveFileExplorerWorkspacePath,
  selectFileExplorerInitializationInputs,
  selectFlattenedNodes,
  selectShouldInitializeFileExplorerForWorkspace,
} from "./file-explorer-selectors";
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

function makeCompactedTree(): FileNode {
  const foo: FileNode = { name: "foo.ts", path: "/a/repo/src/lib/foo.ts", type: "file" };
  const lib: FileNode = {
    name: "lib",
    path: "/a/repo/src/lib",
    type: "directory",
    children: [foo],
  };
  const src: FileNode = {
    name: "src",
    path: "/a/repo/src",
    type: "directory",
    children: [lib],
  };
  return {
    name: "repo",
    path: WORKSPACE_PATH,
    type: "directory",
    children: [src],
  };
}

function makeDeepCompactedTree(): FileNode {
  const utils: FileNode = {
    name: "utils.ts",
    path: "/a/repo/src/lib/components/utils.ts",
    type: "file",
  };
  const components: FileNode = {
    name: "components",
    path: "/a/repo/src/lib/components",
    type: "directory",
    children: [utils],
  };
  const lib: FileNode = {
    name: "lib",
    path: "/a/repo/src/lib",
    type: "directory",
    children: [components],
  };
  const src: FileNode = {
    name: "src",
    path: "/a/repo/src",
    type: "directory",
    children: [lib],
  };
  return {
    name: "repo",
    path: WORKSPACE_PATH,
    type: "directory",
    children: [src],
  };
}

function mockState(
  overrides: Partial<FileExplorerWorkspaceState> = {},
  rootNode: FileNode = makeTree(),
): StoreState {
  let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH));
  state = fileExplorerReducer(state, setRootNode(WS_ID, rootNode));
  const ws: FileExplorerWorkspaceState = {
    ...state.byWorkspaceId[WS_ID],
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

function mockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WS_ID as Workspace["id"],
    title: "Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    path: WORKSPACE_PATH,
    ...overrides,
  };
}

function mockInitializationState(
  overrides: Partial<FileExplorerWorkspaceState> = {},
  workspaceOverrides: Partial<Workspace> | null = {},
): StoreState {
  const workspace = workspaceOverrides === null ? undefined : mockWorkspace(workspaceOverrides);
  return {
    workspace: {
      activeWorkspaceId: WS_ID,
      workspaces: {
        idField: "id",
        ids: workspace ? [WS_ID] : [],
        map: workspace ? { [WS_ID]: workspace } : {},
        refsCount: workspace ? { [WS_ID]: 1 } : {},
      },
    },
    fileExplorer: {
      byWorkspaceId: {
        [WS_ID]: {
          ...emptyFileExplorerWorkspaceState,
          ...overrides,
        },
      },
    },
  } as unknown as StoreState;
}

const remoteConfig: EnvironmentConfig = {
  type: "remote",
  workspace_path: WORKSPACE_PATH,
  ssh: { host: "example.test", user: "dev" },
};

describe("selectFileExplorerRootNode", () => {
  it("returns the normalized root node without materializing child objects", () => {
    const root = selectFileExplorerRootNode.select(mockState(), WS_ID);

    expect(root?.path).toBe(WORKSPACE_PATH);
    expect(root?.children).toEqual([
      "/a/repo/src",
      "/a/repo/README.md",
    ]);
    expect(typeof root?.children[0]).toBe("string");
  });
});

describe("selectEffectiveFileExplorerWorkspacePath", () => {
  it("uses worktreePath before repositoryPath and path", () => {
    expect(
      selectEffectiveFileExplorerWorkspacePath.select(
        mockInitializationState({}, {
          path: "/workspace/base",
          repositoryPath: "/workspace/repo",
          worktreePath: "/workspace/worktree",
        }),
        WS_ID,
      ),
    ).toBe("/workspace/worktree");
  });

  it("falls back to repositoryPath before path", () => {
    expect(
      selectEffectiveFileExplorerWorkspacePath.select(
        mockInitializationState({}, {
          path: "/workspace/base",
          repositoryPath: "/workspace/repo",
          worktreePath: undefined,
        }),
        WS_ID,
      ),
    ).toBe("/workspace/repo");
  });

  it("falls back to path when worktree and repository paths are unset", () => {
    expect(
      selectEffectiveFileExplorerWorkspacePath.select(
        mockInitializationState({}, {
          path: "/workspace/base",
          repositoryPath: undefined,
          worktreePath: undefined,
        }),
        WS_ID,
      ),
    ).toBe("/workspace/base");
  });

  it("returns empty string when no workspace path is available", () => {
    expect(selectEffectiveFileExplorerWorkspacePath.select(mockInitializationState({}, null), WS_ID)).toBe("");
  });
});

describe("selectFileExplorerInitializationInputs", () => {
  it("tracks UI effect inputs needed by the initialization gate", () => {
    expect(
      selectFileExplorerInitializationInputs.select(
        mockInitializationState(
          {
            workspacePath: WORKSPACE_PATH,
            isLoading: false,
            isInitialized: true,
            isRemoteInitialized: false,
          },
          { environmentConfig: remoteConfig },
        ),
        WS_ID,
      ),
    ).toEqual({
      workspacePath: WORKSPACE_PATH,
      currentWorkspacePath: WORKSPACE_PATH,
      isLoading: false,
      isInitialized: true,
    });
  });
});

describe("selectFileExplorerEnvironmentConfigTrigger", () => {
  it("derives an explicit workspace environment config trigger from workspace state", () => {
    expect(
      selectFileExplorerEnvironmentConfigTrigger.select(
        mockInitializationState(
          { workspacePath: WORKSPACE_PATH, isInitialized: true },
          { environmentConfig: remoteConfig },
        ),
        WS_ID,
      ),
    ).toEqual({
      wsId: WS_ID,
      workspacePath: WORKSPACE_PATH,
      workspaceEnvironmentConfig: remoteConfig,
    });
  });
});

describe("selectShouldInitializeFileExplorerForWorkspace", () => {
  it("initializes when Redux state is empty or cleared", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState(),
        WS_ID,
      ),
    ).toBe(true);
  });

  it("skips an already initialized same workspace path", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState({ workspacePath: WORKSPACE_PATH, isInitialized: true }),
        WS_ID,
      ),
    ).toBe(false);
  });

  it("initializes when the workspace path changes", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState({ workspacePath: "/workspace/old", isInitialized: true }),
        WS_ID,
      ),
    ).toBe(true);
  });

  it("does not duplicate an in-flight initialization for the same workspace path", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState({ workspacePath: WORKSPACE_PATH, isLoading: true }),
        WS_ID,
      ),
    ).toBe(false);
  });

  it("initializes a workspace that now has remote config when remote setup is still required", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState(
          { workspacePath: WORKSPACE_PATH, isInitialized: true },
          { environmentConfig: remoteConfig },
        ),
        WS_ID,
      ),
    ).toBe(true);
  });

  it("initializes a remote workspace when remote setup is still required", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState(
          {
            workspacePath: WORKSPACE_PATH,
            isInitialized: true,
          },
          { environmentConfig: remoteConfig },
        ),
        WS_ID,
      ),
    ).toBe(true);
  });

  it("skips a fully initialized remote workspace with matching config", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState(
          {
            workspacePath: WORKSPACE_PATH,
            isInitialized: true,
            isRemoteInitialized: true,
          },
          { environmentConfig: remoteConfig },
        ),
        WS_ID,
      ),
    ).toBe(false);
  });

  it("skips initialization when the workspace path cannot be derived", () => {
    expect(
      selectShouldInitializeFileExplorerForWorkspace.select(
        mockInitializationState({ workspacePath: WORKSPACE_PATH, isInitialized: true }, null),
        WS_ID,
      ),
    ).toBe(false);
  });
});

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

describe("selectFlattenedNodes — referential stability across surgical updates", () => {
  function buildSeededState() {
    let state = fileExplorerReducer(undefined, setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH));
    state = fileExplorerReducer(state, setRootNode(WS_ID, makeTree()));
    for (const p of [WORKSPACE_PATH, "/a/repo/src", "/a/repo/src/lib"]) {
      state = fileExplorerReducer(state, addExpandedPath(WS_ID, p));
    }
    return state;
  }

  it("returns ===-equal entries for rows whose inputs did not change", () => {
    let state = buildSeededState();
    // Seed git status for README.md, then update a different file.
    state = fileExplorerReducer(state, updateGitStatusEntries(WS_ID, { "README.md": MODIFIED }));

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooBefore = findByPath(before, "/a/repo/src/lib/foo.ts");
    const barBefore = findByPath(before, "/a/repo/src/lib/bar.ts");
    const indexBefore = findByPath(before, "/a/repo/src/index.ts");
    const readmeBefore = findByPath(before, "/a/repo/README.md");

    state = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, { "src/lib/foo.ts": ADDED }),
    );

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );

    // Rows unrelated to the changed file keep identical object identity.
    expect(findByPath(after, "/a/repo/src/lib/bar.ts")).toBe(barBefore);
    expect(findByPath(after, "/a/repo/src/index.ts")).toBe(indexBefore);
    expect(findByPath(after, "/a/repo/README.md")).toBe(readmeBefore);

    // The changed file row is a new object reflecting new gitStatus.
    const fooAfter = findByPath(after, "/a/repo/src/lib/foo.ts");
    expect(fooAfter).not.toBe(fooBefore);
    expect(fooAfter?.gitStatus).toEqual(ADDED);

    // Ancestors whose directoryHasChanges flipped true also get new identity.
    // (They were untouched in the before-state because only README.md had status,
    // and README.md is a sibling of src, not inside it.)
    expect(findByPath(after, "/a/repo/src")).not.toBe(findByPath(before, "/a/repo/src"));
    expect(findByPath(after, "/a/repo/src/lib")).not.toBe(
      findByPath(before, "/a/repo/src/lib"),
    );
  });

  it("no-op updateGitStatusEntries (value deep-equals) keeps row identity stable", () => {
    let state = buildSeededState();
    state = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, { "src/lib/foo.ts": MODIFIED }),
    );

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooBefore = findByPath(before, "/a/repo/src/lib/foo.ts");

    // Re-dispatch with a value that deep-equals existing → reducer returns same state ref
    state = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, {
        "src/lib/foo.ts": { status: " M", additions: 3, deletions: 1 },
      }),
    );

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );

    expect(findByPath(after, "/a/repo/src/lib/foo.ts")).toBe(fooBefore);
  });

  it("removeGitStatusEntries rebuilds the affected row with gitStatus cleared", () => {
    let state = buildSeededState();
    state = fileExplorerReducer(
      state,
      updateGitStatusEntries(WS_ID, { "src/lib/foo.ts": MODIFIED }),
    );

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooBefore = findByPath(before, "/a/repo/src/lib/foo.ts");
    expect(fooBefore?.gitStatus).toEqual(MODIFIED);

    state = fileExplorerReducer(state, removeGitStatusEntries(WS_ID, ["src/lib/foo.ts"]));

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooAfter = findByPath(after, "/a/repo/src/lib/foo.ts");
    expect(fooAfter).not.toBe(fooBefore);
    expect(fooAfter?.gitStatus).toBeUndefined();
  });

  it("setChildrenAtPathAction (targeted directory refresh) keeps rows outside that directory ===-equal", () => {
    // Simulates what Wave 3's handleRefreshDirectory does: reload one
    // directory's children and dispatch setChildrenAtPathAction. Rows that
    // live outside that directory must retain object identity.
    let state = buildSeededState();

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const readmeBefore = findByPath(before, "/a/repo/README.md");
    const indexBefore = findByPath(before, "/a/repo/src/index.ts");

    // Replace children of /a/repo/src/lib — add a newly created file.
    const newFoo: FileNode = { name: "foo.ts", path: "/a/repo/src/lib/foo.ts", type: "file" };
    const newBar: FileNode = { name: "bar.ts", path: "/a/repo/src/lib/bar.ts", type: "file" };
    const newFile: FileNode = { name: "new.ts", path: "/a/repo/src/lib/new.ts", type: "file" };
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, "/a/repo/src/lib", [newFoo, newBar, newFile]),
    );

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );

    // README.md and src/index.ts are outside /a/repo/src/lib — they must keep identity.
    expect(findByPath(after, "/a/repo/README.md")).toBe(readmeBefore);
    expect(findByPath(after, "/a/repo/src/index.ts")).toBe(indexBefore);

    // And the newly added file appears in the list.
    expect(findByPath(after, "/a/repo/src/lib/new.ts")).toBeDefined();
  });

  it("setChildrenAtPathAction refreshes same-path child metadata instead of reusing stale nodes", () => {
    let state = buildSeededState();

    const before = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooBefore = findByPath(before, "/a/repo/src/lib/foo.ts");
    expect(fooBefore?.node.size).toBeUndefined();

    const refreshedFoo: FileNode = {
      name: "foo.ts",
      path: "/a/repo/src/lib/foo.ts",
      type: "file",
      size: 99,
    };
    const refreshedBar: FileNode = {
      name: "bar.ts",
      path: "/a/repo/src/lib/bar.ts",
      type: "file",
    };
    state = fileExplorerReducer(
      state,
      setChildrenAtPathAction(WS_ID, "/a/repo/src/lib", [refreshedFoo, refreshedBar]),
    );

    const after = selectFlattenedNodes.select(
      { fileExplorer: state } as unknown as StoreState,
      WS_ID,
    );
    const fooAfter = findByPath(after, "/a/repo/src/lib/foo.ts");
    expect(fooAfter).not.toBe(fooBefore);
    expect(fooAfter?.node.size).toBe(99);
  });
});

describe("selectFlattenedNodes — compacted directory expansion", () => {
  function compactedState(
    expandedPaths: string[],
    overrides: Partial<FileExplorerWorkspaceState> = {},
    rootNode: FileNode = makeCompactedTree(),
  ) {
    return mockState({
      expandedPaths,
      ...overrides,
    }, rootNode);
  }

  it("omits descendants for a collapsed compacted single-child directory chain", () => {
    const flat = selectFlattenedNodes.select(compactedState([WORKSPACE_PATH]), WS_ID);

    const compactedRow = findByPath(flat, "/a/repo/src/lib");
    expect(compactedRow?.displayPath).toBe("src/lib");
    expect(compactedRow?.isExpanded).toBe(false);
    expect(findByPath(flat, "/a/repo/src/lib/foo.ts")).toBeUndefined();
  });

  it("shows loaded descendants when an ancestor segment in the compacted chain is expanded", () => {
    const flat = selectFlattenedNodes.select(
      compactedState([WORKSPACE_PATH, "/a/repo/src"]),
      WS_ID,
    );

    const compactedRow = findByPath(flat, "/a/repo/src/lib");
    expect(compactedRow?.displayPath).toBe("src/lib");
    expect(compactedRow?.isExpanded).toBe(true);
    expect(compactedRow?.compactedExpandedPaths).toEqual(["/a/repo/src"]);
    expect(findByPath(flat, "/a/repo/src/lib/foo.ts")?.depth).toBe(1);
  });

  it("shows loaded descendants when the visible compacted directory is expanded", () => {
    const flat = selectFlattenedNodes.select(
      compactedState([WORKSPACE_PATH, "/a/repo/src/lib"]),
      WS_ID,
    );

    const compactedRow = findByPath(flat, "/a/repo/src/lib");
    expect(compactedRow?.isExpanded).toBe(true);
    expect(compactedRow?.compactedExpandedPaths).toEqual(["/a/repo/src/lib"]);
    expect(findByPath(flat, "/a/repo/src/lib/foo.ts")).toBeDefined();
  });

  it("shows loaded descendants when a deeper compacted segment is expanded", () => {
    const flat = selectFlattenedNodes.select(
      compactedState(
        [WORKSPACE_PATH, "/a/repo/src/lib/components"],
        {},
        makeDeepCompactedTree(),
      ),
      WS_ID,
    );

    const compactedRow = findByPath(flat, "/a/repo/src/lib/components");
    expect(compactedRow?.displayPath).toBe("src/lib/components");
    expect(compactedRow?.isExpanded).toBe(true);
    expect(findByPath(flat, "/a/repo/src/lib/components/utils.ts")).toBeDefined();
  });

  it("keeps an auto-expanded single-directory chain as one expanded compacted row", () => {
    const flat = selectFlattenedNodes.select(
      compactedState(
        [WORKSPACE_PATH, "/a/repo/src", "/a/repo/src/lib", "/a/repo/src/lib/components"],
        {},
        makeDeepCompactedTree(),
      ),
      WS_ID,
    );

    const compactedRow = findByPath(flat, "/a/repo/src/lib/components");
    expect(compactedRow?.displayPath).toBe("src/lib/components");
    expect(compactedRow?.isExpanded).toBe(true);
    expect(compactedRow?.compactedExpandedPaths).toEqual([
      "/a/repo/src",
      "/a/repo/src/lib",
      "/a/repo/src/lib/components",
    ]);
    expect(findByPath(flat, "/a/repo/src/lib/components/utils.ts")?.depth).toBe(1);
  });

  it("keeps metadata enrichment on descendants below an expanded compacted row", () => {
    const flat = selectFlattenedNodes.select(
      compactedState([WORKSPACE_PATH, "/a/repo/src"], {
        agentFileEdits: { "src/lib/foo.ts": ["agent-1"] },
        gitStatus: { "src/lib/foo.ts": MODIFIED },
      }),
      WS_ID,
    );

    const foo = findByPath(flat, "/a/repo/src/lib/foo.ts");
    expect(foo?.agentEdits).toEqual(["agent-1"]);
    expect(foo?.gitStatus).toEqual(MODIFIED);
  });
});
