import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FileNode } from "$shared/types";

// FAKE seam: appClient.files.listDirectory is stubbed so no daemon call (and
// never a mutation) happens. The service runs against the REAL configured store
// so the toggle/expand/refresh middleware wiring and child population are
// exercised end to end. READ-ONLY: only `listDirectory` is exercised.
vi.mock("$lib/client", () => ({
  appClient: {
    files: {
      listDirectory: vi.fn(() => Promise.resolve([] as FileNode[])),
      explorerTree: vi.fn(() => Promise.resolve(null as FileNode | null)),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  initializeFileExplorer,
  refreshDirectoryRequested,
  refreshFileExplorer,
  setRootNode,
  setFileExplorerWorkspacePath,
  toggleDirectoryRequested,
} from "$store/renderer/slices/file-explorer/file-explorer-slice";
import {
  selectFileExplorerIsInitialized,
  selectFileExplorerNodeMap,
  selectFileExplorerRootNode,
  selectIsPathExpanded,
} from "$store/renderer/slices/file-explorer/file-explorer-selectors";
import {
  initializeFileExplorerTree,
  refreshFileExplorerTree,
  toggleDirectory,
} from "./file-explorer-read-service";

const filesApi = appClient.files as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Seed a workspace with a root containing one (unloaded) directory. */
function seedRoot(wsId: string, root: string): void {
  appStore.dispatch(setFileExplorerWorkspacePath(wsId, root));
  appStore.dispatch(
    setRootNode(wsId, {
      name: root.split("/").pop() ?? root,
      path: root,
      type: "directory",
      children: [{ name: "src", path: `${root}/src`, type: "directory", children: [] }],
    }),
  );
}

describe("fileExplorerReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    filesApi.listDirectory.mockResolvedValue([] as never);
  });

  it("toggleDirectory lists children via the seam and populates the tree", async () => {
    const wsId = "ws-fx-toggle";
    const root = "/repo-toggle";
    seedRoot(wsId, root);
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "a.ts", path: "a.ts", type: "file" },
    ] as never);

    await toggleDirectory(wsId, `${root}/src`);

    expect(filesApi.listDirectory).toHaveBeenCalledWith(wsId, "src");
    expect(selectIsPathExpanded.select(appStore.state, wsId, `${root}/src`)).toBe(true);
    expect(selectFileExplorerNodeMap.select(appStore.state, wsId)).toHaveProperty(`${root}/src/a.ts`);
  });

  it("dispatching toggleDirectoryRequested triggers a seam load (middleware wiring)", async () => {
    const wsId = "ws-fx-mw";
    const root = "/repo-mw";
    seedRoot(wsId, root);
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "b.ts", path: "b.ts", type: "file" },
    ] as never);

    appStore.dispatch(toggleDirectoryRequested(wsId, `${root}/src`));
    await flush();

    expect(filesApi.listDirectory).toHaveBeenCalledWith(wsId, "src");
    expect(selectFileExplorerNodeMap.select(appStore.state, wsId)).toHaveProperty(`${root}/src/b.ts`);
  });

  it("collapses an expanded directory without re-listing", async () => {
    const wsId = "ws-fx-collapse";
    const root = "/repo-collapse";
    seedRoot(wsId, root);
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "c.ts", path: "c.ts", type: "file" },
    ] as never);

    await toggleDirectory(wsId, `${root}/src`);
    expect(selectIsPathExpanded.select(appStore.state, wsId, `${root}/src`)).toBe(true);
    filesApi.listDirectory.mockClear();

    await toggleDirectory(wsId, `${root}/src`);
    expect(selectIsPathExpanded.select(appStore.state, wsId, `${root}/src`)).toBe(false);
    expect(filesApi.listDirectory).not.toHaveBeenCalled();
  });

  it("refresh re-fetches the root and expanded directories via the seam", async () => {
    const wsId = "ws-fx-refresh";
    const root = "/repo-refresh";
    seedRoot(wsId, root);
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "d.ts", path: "d.ts", type: "file" },
    ] as never);
    await toggleDirectory(wsId, `${root}/src`);
    filesApi.listDirectory.mockClear();
    // Path-aware so re-listing the root still returns the `src` directory it
    // already knows about (a real daemon would), and `src` repopulates its file.
    filesApi.listDirectory.mockImplementation((_wsId: string, rel: string) =>
      Promise.resolve(
        rel === ""
          ? [{ name: "src", path: "src", type: "directory", children: [] }]
          : rel === "src"
            ? [{ name: "d.ts", path: "d.ts", type: "file" }]
            : [],
      ),
    );

    await refreshFileExplorerTree(wsId);

    const calls = filesApi.listDirectory.mock.calls.map((c) => c[1]);
    expect(calls).toContain(""); // root (workspace-relative "")
    expect(calls).toContain("src"); // expanded directory
    expect(selectFileExplorerNodeMap.select(appStore.state, wsId)).toHaveProperty(`${root}/src/d.ts`);
  });

  it("refresh is a no-op when no root tree exists (daemon file.tree BE gap)", async () => {
    const wsId = "ws-fx-no-root";

    await refreshFileExplorerTree(wsId);

    expect(filesApi.listDirectory).not.toHaveBeenCalled();
  });

  it("dispatching refreshFileExplorer triggers a refresh (middleware wiring)", async () => {
    const wsId = "ws-fx-refresh-mw";
    const root = "/repo-refresh-mw";
    seedRoot(wsId, root);

    appStore.dispatch(refreshFileExplorer(wsId));
    await flush();

    expect(filesApi.listDirectory).toHaveBeenCalledWith(wsId, "");
  });

  it("initializeFileExplorerTree fetches file.tree and anchors the root at workspacePath", async () => {
    const wsId = "ws-fx-init";
    const root = "/repo-init";
    filesApi.explorerTree.mockResolvedValueOnce({
      name: "",
      path: "",
      type: "directory",
      children: [
        { name: "src", path: "src", type: "directory", children: [] },
        { name: "README.md", path: "README.md", type: "file" },
      ],
    } as never);

    await initializeFileExplorerTree(wsId, { workspacePath: root });

    expect(filesApi.explorerTree).toHaveBeenCalledWith(wsId);
    const rootNode = selectFileExplorerRootNode.select(appStore.state, wsId);
    expect(rootNode?.path).toBe(root);
    expect(selectFileExplorerIsInitialized.select(appStore.state, wsId)).toBe(true);
    const nodeMap = selectFileExplorerNodeMap.select(appStore.state, wsId);
    expect(nodeMap).toHaveProperty(`${root}/src`);
    expect(nodeMap).toHaveProperty(`${root}/README.md`);
  });

  it("initializeFileExplorerTree is idempotent for the same workspacePath", async () => {
    const wsId = "ws-fx-init-idem";
    const root = "/repo-init-idem";
    filesApi.explorerTree.mockResolvedValueOnce({
      name: "",
      path: "",
      type: "directory",
      children: [{ name: "a", path: "a", type: "directory", children: [] }],
    } as never);

    await initializeFileExplorerTree(wsId, { workspacePath: root });
    filesApi.explorerTree.mockClear();
    await initializeFileExplorerTree(wsId, { workspacePath: root });

    expect(filesApi.explorerTree).not.toHaveBeenCalled();
  });

  it("dispatching initializeFileExplorer triggers explorerTree (middleware wiring)", async () => {
    const wsId = "ws-fx-init-mw";
    const root = "/repo-init-mw";
    filesApi.explorerTree.mockResolvedValueOnce({
      name: "",
      path: "",
      type: "directory",
      children: [{ name: "x.ts", path: "x.ts", type: "file" }],
    } as never);

    appStore.dispatch(initializeFileExplorer(wsId, { workspacePath: root }));
    await flush();
    await flush();

    expect(filesApi.explorerTree).toHaveBeenCalledWith(wsId);
    expect(selectFileExplorerRootNode.select(appStore.state, wsId)?.path).toBe(root);
  });

  it("dispatching refreshDirectoryRequested re-lists the parent dir (middleware wiring)", async () => {
    const wsId = "ws-fx-refresh-dir";
    const root = "/repo-refresh-dir";
    seedRoot(wsId, root);
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "n.ts", path: "n.ts", type: "file" },
    ] as never);
    await toggleDirectory(wsId, `${root}/src`);
    filesApi.listDirectory.mockClear();
    filesApi.listDirectory.mockResolvedValueOnce([
      { name: "n.ts", path: "n.ts", type: "file" },
      { name: "new.ts", path: "new.ts", type: "file" },
    ] as never);

    appStore.dispatch(refreshDirectoryRequested(wsId, `${root}/src/new.ts`));
    await flush();

    expect(filesApi.listDirectory).toHaveBeenCalledWith(wsId, "src");
    expect(selectFileExplorerNodeMap.select(appStore.state, wsId)).toHaveProperty(`${root}/src/new.ts`);
  });
});
