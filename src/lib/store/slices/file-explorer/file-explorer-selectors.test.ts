import type { FileNode } from "$shared/types";
import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import { emptyFileExplorerWorkspaceState } from "./file-explorer-slice";
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

