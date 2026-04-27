import { describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";
import type { FileGitStatus, FileNode } from "$shared/types";

// typed-redux-saga must be mocked BEFORE importing the saga module because
// the saga module imports from typed-redux-saga at the top level.
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: { fileStatuses: {}, fileChanges: {} } }),
  listenSync: vi.fn(),
}));

vi.mock("$features/git/git.client", () => ({
  gitClient: {
    getStatus: vi.fn().mockResolvedValue({ ok: true, data: { files: [] } }),
    getDiff: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  },
}));

vi.mock("$lib/utils/agent-file-edits", () => ({
  getAgentFileEdits: vi.fn().mockResolvedValue(new Map()),
  propagateAgentEditsToParents: vi.fn().mockReturnValue(new Map()),
}));

// Import after mocks
import {
  applyGitStatusSnapshot,
  handleRefreshDirectory,
  handleRefreshGitStatus,
  handleSyncGitStatusFromStores,
  handleWorkspaceChangesEvent,
  handleFileTrackingChangesEvent,
  handleFileChangedWindowEvent,
  handleFileChangedIPCEvent,
} from "./file-explorer-saga";
import {
  emptyFileExplorerWorkspaceState,
  incrementTreeVersion,
  refreshDirectoryRequested,
  refreshGitStatusRequested,
  removeGitStatusEntries,
  setChildrenAtPathAction,
  setRootNode,
  syncGitStatusFromStoresRequested,
  updateGitStatusEntries,
  debouncedFileTrackingSync,
  refreshFileExplorer,
} from "../file-explorer-slice";

const WS_ID = "ws-1";

const MODIFIED: FileGitStatus = { status: " M", additions: 1, deletions: 0 };

function stateWith(gitStatus: Record<string, FileGitStatus>, workspacePath = "/a/repo") {
  return {
    fileExplorer: {
      byWorkspaceId: {
        [WS_ID]: {
          ...emptyFileExplorerWorkspaceState,
          workspacePath,
          gitStatus,
        },
      },
    },
  } as any;
}

describe("applyGitStatusSnapshot", () => {
  it("dispatches updateGitStatusEntries and removeGitStatusEntries for diff", async () => {
    await expectSaga(
      applyGitStatusSnapshot,
      WS_ID,
      { "src/new.ts": MODIFIED },
    )
      .withState(stateWith({ "src/stale.ts": MODIFIED }))
      .put(removeGitStatusEntries(WS_ID, ["src/stale.ts"]))
      .put(updateGitStatusEntries(WS_ID, { "src/new.ts": MODIFIED }))
      .silentRun(50);
  });

  it("dispatches only update when nothing is stale", async () => {
    await expectSaga(
      applyGitStatusSnapshot,
      WS_ID,
      { "src/a.ts": MODIFIED },
    )
      .withState(stateWith({}))
      .put(updateGitStatusEntries(WS_ID, { "src/a.ts": MODIFIED }))
      .not.put(removeGitStatusEntries(WS_ID, []))
      .silentRun(50);
  });

  it("dispatches only remove when snapshot is empty and prior map is not", async () => {
    const result = await expectSaga(applyGitStatusSnapshot, WS_ID, {})
      .withState(stateWith({ "src/a.ts": MODIFIED }))
      .put(removeGitStatusEntries(WS_ID, ["src/a.ts"]))
      .silentRun(50);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(updateGitStatusEntries.type);
    }
  });
});

describe("handleRefreshGitStatus", () => {
  it("does not dispatch setRootNode, setChildrenAtPathAction, or incrementTreeVersion", async () => {
    const result = await expectSaga(
      handleRefreshGitStatus,
      refreshGitStatusRequested(WS_ID),
    )
      .withState(stateWith({}))
      .silentRun(100);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(setRootNode.type);
      expect(action.type).not.toBe(setChildrenAtPathAction.type);
      expect(action.type).not.toBe(incrementTreeVersion.type);
    }
  });
});

describe("handleSyncGitStatusFromStores", () => {
  it("does not bump treeVersion or replace rootNode", async () => {
    const result = await expectSaga(
      handleSyncGitStatusFromStores,
      syncGitStatusFromStoresRequested(WS_ID),
    )
      .withState(stateWith({}))
      .silentRun(100);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(setRootNode.type);
      expect(action.type).not.toBe(setChildrenAtPathAction.type);
      expect(action.type).not.toBe(incrementTreeVersion.type);
    }
  });
});

describe("Wave 1 IPC + window watcher handlers", () => {
  const activeWs = "ws-active";
  const stateWithActiveWs = (id: string | null) => ({
    workspace: { activeWorkspaceId: id },
    fileExplorer: { byWorkspaceId: {} },
  });

  it("handleWorkspaceChangesEvent dispatches sync when event workspaceId matches active", async () => {
    await expectSaga(handleWorkspaceChangesEvent, { workspaceId: activeWs })
      .withState(stateWithActiveWs(activeWs))
      .put(syncGitStatusFromStoresRequested(activeWs))
      .silentRun(50);
  });

  it("handleWorkspaceChangesEvent is a no-op when workspaceId is missing", async () => {
    const result = await expectSaga(handleWorkspaceChangesEvent, {})
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleWorkspaceChangesEvent is a no-op when event is for a different workspace", async () => {
    const result = await expectSaga(handleWorkspaceChangesEvent, { workspaceId: "other-ws" })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileTrackingChangesEvent routes through the debounce wrapper for scoped events", async () => {
    await expectSaga(handleFileTrackingChangesEvent, { workspaceId: activeWs })
      .withState(stateWithActiveWs(activeWs))
      .put(debouncedFileTrackingSync(syncGitStatusFromStoresRequested(activeWs)))
      .silentRun(50);
  });

  it("handleFileTrackingChangesEvent falls back to active workspace when event has no id", async () => {
    await expectSaga(handleFileTrackingChangesEvent, {})
      .withState(stateWithActiveWs(activeWs))
      .put(debouncedFileTrackingSync(syncGitStatusFromStoresRequested(activeWs)))
      .silentRun(50);
  });

  it("handleFileTrackingChangesEvent is a no-op when event targets a different workspace", async () => {
    const result = await expectSaga(handleFileTrackingChangesEvent, { workspaceId: "other-ws" })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileChangedWindowEvent 'change' dispatches refreshGitStatusRequested", async () => {
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "change",
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshGitStatusRequested(activeWs))
      .silentRun(50);
  });

  it("handleFileChangedWindowEvent 'create' with filePath dispatches refreshDirectoryRequested (not refreshFileExplorer)", async () => {
    const filePath = "/a/repo/src/new.ts";
    const result = await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "create",
      filePath,
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(refreshFileExplorer.type);
    }
  });

  it("handleFileChangedWindowEvent 'delete' with filePath dispatches refreshDirectoryRequested", async () => {
    const filePath = "/a/repo/src/gone.ts";
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "delete",
      filePath,
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
  });

  it("handleFileChangedWindowEvent 'add' with files[] uses the first entry", async () => {
    const filePath = "/a/repo/README.md";
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "add",
      files: [filePath],
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
  });

  it("handleFileChangedWindowEvent 'delete' without a filePath falls back to refreshFileExplorer", async () => {
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "delete",
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshFileExplorer(activeWs))
      .silentRun(500);
  });

  it("handleFileChangedWindowEvent is a no-op when workspaceId is missing", async () => {
    const result = await expectSaga(handleFileChangedWindowEvent, {
      type: "change",
    })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileChangedWindowEvent is a no-op for unknown change types", async () => {
    const result = await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "unknown-type",
    })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileChangedIPCEvent (main-process action='create') dispatches refreshDirectoryRequested", async () => {
    const filePath = "/a/repo/src/agent-new.ts";
    await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { path: filePath, action: "create" },
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
  });

  it("handleFileChangedIPCEvent (main-process action='delete') dispatches refreshDirectoryRequested", async () => {
    const filePath = "/a/repo/src/agent-gone.ts";
    await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { path: filePath, action: "delete" },
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
  });

  it("handleFileChangedIPCEvent (main-process action='modify') dispatches refreshGitStatusRequested", async () => {
    await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { path: "/a/repo/src/edited.ts", action: "modify" },
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshGitStatusRequested(activeWs))
      .silentRun(50);
  });

  it("handleFileChangedIPCEvent (main-process action='rename') refreshes the new path's directory", async () => {
    const filePath = "/a/repo/src/renamed.ts";
    await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { path: filePath, oldPath: "/a/repo/src/old.ts", action: "rename" },
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshDirectoryRequested(activeWs, filePath))
      .silentRun(500);
  });

  it("handleFileChangedIPCEvent is a no-op when event targets a different workspace", async () => {
    const result = await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: "other-ws",
      data: { path: "/a/repo/src/x.ts", action: "create" },
    })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(500);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileChangedIPCEvent is a no-op when action is missing", async () => {
    const result = await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { path: "/a/repo/src/x.ts" },
    })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });

  it("handleFileChangedIPCEvent ('create' without path) falls back to refreshFileExplorer", async () => {
    await expectSaga(handleFileChangedIPCEvent, {
      workspaceId: activeWs,
      data: { action: "create" },
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshFileExplorer(activeWs))
      .silentRun(500);
  });
});



describe("handleRefreshDirectory", () => {
  const WORKSPACE_PATH = "/a/repo";

  function makeTree(): FileNode {
    const srcDir: FileNode = {
      name: "src",
      path: "/a/repo/src",
      type: "directory",
      children: [
        { name: "foo.ts", path: "/a/repo/src/foo.ts", type: "file" },
      ],
    };
    return {
      name: "repo",
      path: WORKSPACE_PATH,
      type: "directory",
      children: [srcDir],
    };
  }

  function stateWithTree(workspacePath = WORKSPACE_PATH) {
    return {
      fileExplorer: {
        byWorkspaceId: {
          [WS_ID]: {
            ...emptyFileExplorerWorkspaceState,
            workspacePath,
            rootNode: makeTree(),
          },
        },
      },
    } as any;
  }

  it("reloads one directory and dispatches setChildrenAtPathAction for parentDir; does not dispatch setRootNode", async () => {
    const parentDir = "/a/repo/src";
    const filePath = "/a/repo/src/new.ts";
    const newChildren: FileNode[] = [
      { name: "foo.ts", path: "/a/repo/src/foo.ts", type: "file" },
      { name: "new.ts", path: "/a/repo/src/new.ts", type: "file" },
    ];

    const result = await expectSaga(
      handleRefreshDirectory,
      refreshDirectoryRequested(WS_ID, filePath),
    )
      .withState(stateWithTree())
      .provide({
        call: (effect, next) => {
          const fnName = (effect.fn as any)?.name;
          if (fnName === "loadDirectoryCore") return newChildren;
          return next();
        },
      })
      .put(setChildrenAtPathAction(WS_ID, parentDir, newChildren))
      .silentRun(100);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(setRootNode.type);
    }
  });

  it("no-ops when workspacePath is unset", async () => {
    const stateNoWs = {
      fileExplorer: { byWorkspaceId: {} },
    } as any;
    const result = await expectSaga(
      handleRefreshDirectory,
      refreshDirectoryRequested(WS_ID, "/some/path/file.ts"),
    )
      .withState(stateNoWs)
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
    expect(result.effects.call ?? []).toEqual([]);
  });

  it("no-ops when the parent directory is not currently loaded in the tree", async () => {
    // filePath under an uninstantiated directory — findNodeByPath returns null.
    const result = await expectSaga(
      handleRefreshDirectory,
      refreshDirectoryRequested(WS_ID, "/a/repo/unloaded/child.ts"),
    )
      .withState(stateWithTree())
      .silentRun(50);
    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(setChildrenAtPathAction.type);
    }
  });

  it("ignores file paths outside the workspace", async () => {
    const result = await expectSaga(
      handleRefreshDirectory,
      refreshDirectoryRequested(WS_ID, "/somewhere/else/file.ts"),
    )
      .withState(stateWithTree())
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);
  });
});
