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
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  refreshFileExplorer,
  setRootNode,
  setFileExplorerWorkspacePath,
  toggleDirectoryRequested,
} from "$store/renderer/slices/file-explorer/file-explorer-slice";
import {
  selectFileExplorerNodeMap,
  selectIsPathExpanded,
} from "$store/renderer/slices/file-explorer/file-explorer-selectors";
import { refreshFileExplorerTree, toggleDirectory } from "./file-explorer-read-service";

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
});
