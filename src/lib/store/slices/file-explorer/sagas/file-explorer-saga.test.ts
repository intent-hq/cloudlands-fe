import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import type { EnvironmentConfig, FileGitStatus, FileNode } from "$shared/types";
import { debounceWithKeySaga } from "svelte-redux-toolkit/utils/sagas/debounce-saga";

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
  handleToggleDirectory,
  handleRefreshDirectory,
  handleRefreshGitStatus,
  handleRefreshAgentFileEdits,
  handleSyncGitStatusFromStores,
  handleWorkspaceChangesEvent,
  handleFileTrackingChangesEvent,
  handleAgentFileChangedEvent,
  handleFileTrackingListenerReadyEvent,
  handleFileChangedWindowEvent,
  handleFileChangedIPCEvent,
  handleRootNodeReplaced,
  handleWorkspaceEnvironmentConfigChange,
  fileExplorerSaga,
  refreshAgentFileEditsForWorkspace,
  replayPendingAgentFileEditsRefreshForWorkspace,
  resetAgentFileEditsRefreshState,
} from "./file-explorer-saga";
import {
  debouncedAgentFileEditsRefresh,
  emptyFileExplorerWorkspaceState,
  fileExplorerReducer,
  initializeFileExplorer,
  incrementTreeVersion,
  initialState as fileExplorerInitialState,
  refreshAgentFileEditsRequested,
  refreshDirectoryRequested,
  refreshGitStatusRequested,
  removeAgentFileEditsEntries,
  removeGitStatusEntries,
  setChildrenAtPathAction,
  setRootNode,
  syncGitStatusFromStoresRequested,
  updateAgentFileEditsEntries,
  updateGitStatusEntries,
  debouncedFileTrackingSync,
  setFileExplorerWorkspacePath,
  setRemoteConnectionIdAction,
  setIsRemoteInitializedAction,
  refreshFileExplorer,
  addExpandedPath,
  toggleDirectoryRequested,
} from "../file-explorer-slice";
import { emptyWorkspaceState as emptyChangesWorkspaceState } from "../../changes/changes-slice";
import { initialState as gitInitialState } from "../../git/git-slice";
import { getAgentFileEdits, propagateAgentEditsToParents } from "$lib/utils/agent-file-edits";
import { invoke } from "$lib/electron-bridge";

const WS_ID = "ws-1";
const WORKSPACE_PATH = "/a/repo";

const MODIFIED: FileGitStatus = { status: " M", additions: 1, deletions: 0 };

const remoteConfig: EnvironmentConfig = {
  type: "remote",
  workspace_path: WORKSPACE_PATH,
  ssh: { host: "example.test", user: "dev" },
};

const updatedRemoteConfig: EnvironmentConfig = {
  ...remoteConfig,
  ssh: { host: "other.example.test", user: "dev" },
};

const localConfig: EnvironmentConfig = {
  type: "local",
};

function workspaceState(environmentConfig?: EnvironmentConfig) {
  return {
    activeWorkspaceId: WS_ID,
    workspaces: {
      idField: "id",
      ids: [WS_ID],
      map: { [WS_ID]: { id: WS_ID, path: WORKSPACE_PATH, environmentConfig } },
      refsCount: { [WS_ID]: 1 },
    },
  };
}

function environmentConfigTrigger(
  environmentConfig: EnvironmentConfig | undefined,
  wsId: string | null = WS_ID,
) {
  return {
    wsId,
    workspacePath: wsId ? WORKSPACE_PATH : "",
    workspaceEnvironmentConfig: environmentConfig,
  };
}

function stateWith(
  gitStatus: Record<string, FileGitStatus>,
  workspacePath = WORKSPACE_PATH,
  agentFileEdits: Record<string, string[]> = {},
  environmentConfig?: EnvironmentConfig,
  fileExplorerOverrides: Partial<typeof emptyFileExplorerWorkspaceState> = {},
) {
  return {
    workspace: workspaceState(environmentConfig),
    changes: { byWorkspaceId: { [WS_ID]: emptyChangesWorkspaceState } },
    git: gitInitialState,
    fileExplorer: {
      byWorkspaceId: {
        [WS_ID]: {
          ...emptyFileExplorerWorkspaceState,
          workspacePath,
          gitStatus,
          agentFileEdits,
          ...fileExplorerOverrides,
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
  it("does not bump treeVersion or replace the root tree", async () => {
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

describe("handleRootNodeReplaced", () => {
  const WORKSPACE_PATH = "/a/repo";
  const rootNode: FileNode = {
    name: "repo",
    path: WORKSPACE_PATH,
    type: "directory",
    children: [],
  };

  function stateAfterReplacementWithExpandedPaths() {
    let fileExplorerState = fileExplorerReducer(
      fileExplorerInitialState,
      setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH),
    );
    fileExplorerState = fileExplorerReducer(fileExplorerState, setRootNode(WS_ID, rootNode));
    for (const path of [WORKSPACE_PATH, `${WORKSPACE_PATH}/src`, `${WORKSPACE_PATH}/missing`]) {
      fileExplorerState = fileExplorerReducer(fileExplorerState, addExpandedPath(WS_ID, path));
    }
    fileExplorerState = fileExplorerReducer(fileExplorerState, setRootNode(WS_ID, rootNode));
    return { fileExplorer: fileExplorerState } as any;
  }

  it("reloads non-root expanded paths after root replacement without normalized-tree prefiltering", async () => {
    const srcChildren: FileNode[] = [
      { name: "index.ts", path: `${WORKSPACE_PATH}/src/index.ts`, type: "file" },
    ];
    const loadedPaths: string[] = [];

    await expectSaga(handleRootNodeReplaced, setRootNode(WS_ID, rootNode))
      .withState(stateAfterReplacementWithExpandedPaths())
      .provide({
        call: (effect, next) => {
          const fnName = (effect.fn as any)?.name;
          if (fnName !== "loadDirectoryCore") return next();
          const [, dirPath] = effect.args as [string, string];
          loadedPaths.push(dirPath);
          if (dirPath === `${WORKSPACE_PATH}/src`) return srcChildren;
          return [];
        },
      })
      .put(setChildrenAtPathAction(WS_ID, `${WORKSPACE_PATH}/src`, srcChildren))
      .put(setChildrenAtPathAction(WS_ID, `${WORKSPACE_PATH}/missing`, []))
      .silentRun(100);

    expect(loadedPaths).toEqual([
      `${WORKSPACE_PATH}/src`,
      `${WORKSPACE_PATH}/missing`,
    ]);
  });

  it("registers setRootNode as the canonical replacement watcher trigger", () => {
    const saga = fileExplorerSaga();
    let replacementWatcher: any;

    for (let i = 0; i < 30; i += 1) {
      const effect = saga.next().value as any;
      if (effect?.payload?.args?.[0] === setRootNode) {
        replacementWatcher = effect;
        break;
      }
    }

    expect(replacementWatcher?.type).toBe("FORK");
    expect(replacementWatcher.payload.args[1]).toBe(handleRootNodeReplaced);
  });
});

describe("handleToggleDirectory", () => {
  const WORKSPACE_PATH = "/a/repo";

  function directory(path: string, children: FileNode[] = []): FileNode {
    return {
      name: path.split("/").pop() || "repo",
      path,
      type: "directory",
      children,
    };
  }

  function file(path: string): FileNode {
    return {
      name: path.split("/").pop() || "file",
      path,
      type: "file",
    };
  }

  function stateWithRoot(root: FileNode) {
    let fileExplorerState = fileExplorerReducer(
      fileExplorerInitialState,
      setFileExplorerWorkspacePath(WS_ID, WORKSPACE_PATH),
    );
    fileExplorerState = fileExplorerReducer(fileExplorerState, setRootNode(WS_ID, root));
    return { fileExplorer: fileExplorerState } as any;
  }

  it("expands without fetching when normalized slice children are already loaded", async () => {
    const srcPath = `${WORKSPACE_PATH}/src`;
    const loadedRoot = directory(WORKSPACE_PATH, [
      directory(srcPath, [file(`${srcPath}/index.ts`)]),
    ]);

    const result = await expectSaga(
      handleToggleDirectory,
      toggleDirectoryRequested(WS_ID, srcPath),
    )
      .withState(stateWithRoot(loadedRoot))
      .put(addExpandedPath(WS_ID, srcPath))
      .silentRun(50);

    const callEffects = result.effects.call ?? [];
    expect(
      callEffects.some((effect: any) => effect.payload.fn?.name === "loadDirectoryCore"),
    ).toBe(false);
  });

  it("fetches and applies children when normalized slice children are not available", async () => {
    const srcPath = `${WORKSPACE_PATH}/src`;
    const fetchedChildren = [file(`${srcPath}/index.ts`)];

    await expectSaga(
      handleToggleDirectory,
      toggleDirectoryRequested(WS_ID, srcPath),
    )
      .withState(stateWithRoot(directory(WORKSPACE_PATH, [directory(srcPath)])))
      .provide({
        call: (effect, next) => {
          const fnName = (effect.fn as any)?.name;
          if (fnName === "loadDirectoryCore") return fetchedChildren;
          return next();
        },
      })
      .put(addExpandedPath(WS_ID, srcPath))
      .put(setChildrenAtPathAction(WS_ID, srcPath, fetchedChildren))
      .silentRun(100);
  });
});

describe("agentFileEdits refresh pipeline", () => {
  const activeWs = "ws-active";
  const rootChildren: FileNode[] = [
    { name: "src", path: "/a/repo/src", type: "directory", children: [] },
    { name: "README.md", path: "/a/repo/README.md", type: "file" },
  ];
  const stateWithActiveWs = (id: string | null) => ({
    workspace: { activeWorkspaceId: id },
    fileExplorer: { byWorkspaceId: {} },
  });
  const provideRootLoad = {
    fork: (effect: any, _next: () => unknown) => {
      const fnName = effect.fn?.name;
      if (fnName?.startsWith("watch") || fnName === "debounceSaga" || fnName === "debounceWithKeySaga") return {};
      return _next();
    },
    call: (effect: any, next: () => unknown) => {
      const fnName = effect.fn?.name;
      if (fnName === "loadGitignorePatterns" || fnName === "loadGitStatusSaga") return undefined;
      if (fnName === "loadDirectoryCore") return rootChildren;
      return next();
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentFileEditsRefreshState();
    vi.mocked(getAgentFileEdits).mockResolvedValue(new Map());
    vi.mocked(propagateAgentEditsToParents).mockReturnValue(new Map());
  });

  it("loads agent edits into Redux and removes stale paths", async () => {
    vi.mocked(getAgentFileEdits).mockResolvedValue(
      new Map([["src/foo.ts", ["agent-1"]]]),
    );
    vi.mocked(propagateAgentEditsToParents).mockReturnValue(
      new Map([["src", ["agent-1"]]]),
    );

    await expectSaga(
      handleRefreshAgentFileEdits,
      refreshAgentFileEditsRequested(WS_ID),
    )
      .withState(stateWith({}, "/a/repo", { "stale.ts": ["agent-old"] }))
      .put(removeAgentFileEditsEntries(WS_ID, ["stale.ts"]))
      .put(updateAgentFileEditsEntries(WS_ID, {
        "src/foo.ts": ["agent-1"],
        src: ["agent-1"],
      }))
      .silentRun(50);
  });

  it("populates initially empty agent edits during file-explorer init", async () => {
    vi.mocked(getAgentFileEdits).mockResolvedValue(
      new Map([["src/lib/foo.ts", ["agent-1"]]]),
    );
    vi.mocked(propagateAgentEditsToParents).mockReturnValue(
      new Map([
        ["src", ["agent-1"]],
        ["src/lib", ["agent-1"]],
      ]),
    );

    await expectSaga(fileExplorerSaga)
      .withState(stateWith({}, "/a/repo", {}))
      .provide(provideRootLoad)
      .dispatch(initializeFileExplorer(WS_ID, { workspacePath: "/a/repo" }))
      .put(updateAgentFileEditsEntries(WS_ID, {
        "src/lib/foo.ts": ["agent-1"],
        src: ["agent-1"],
        "src/lib": ["agent-1"],
      }))
      .silentRun(500);
  });

  it("initializes remote FS from workspace environment config during file-explorer init", async () => {
    vi.mocked(invoke).mockImplementation(async (channel: string) => {
      if (channel === "remote-fs:init") {
        return { success: true, data: { connectionId: "remote-conn-1" } } as any;
      }
      return { success: true, data: { fileStatuses: {}, fileChanges: {} } } as any;
    });

    await expectSaga(fileExplorerSaga)
      .withState(stateWith({}, WORKSPACE_PATH, {}, remoteConfig))
      .provide(provideRootLoad)
      .dispatch(initializeFileExplorer(WS_ID, { workspacePath: WORKSPACE_PATH }))
      .put(setRemoteConnectionIdAction(WS_ID, "remote-conn-1"))
      .put(setIsRemoteInitializedAction(WS_ID, true))
      .silentRun(500);
  });

  it("reinitializes and resets remote runtime on local-to-remote config changes", async () => {
    await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger(remoteConfig),
      prevPayload: environmentConfigTrigger(undefined),
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, remoteConfig))
      .put(setRemoteConnectionIdAction(WS_ID, null))
      .put(setIsRemoteInitializedAction(WS_ID, false))
      .put(initializeFileExplorer(WS_ID, { workspacePath: WORKSPACE_PATH, workspaceId: WS_ID }))
      .silentRun(50);
  });

  it("reinitializes and clears stale remote runtime on remote-to-local config changes", async () => {
    await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger(localConfig),
      prevPayload: environmentConfigTrigger(remoteConfig),
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, localConfig, {
        remoteConnectionId: "remote-conn-old",
        isRemoteInitialized: true,
      }))
      .put(setRemoteConnectionIdAction(WS_ID, null))
      .put(setIsRemoteInitializedAction(WS_ID, false))
      .put(initializeFileExplorer(WS_ID, { workspacePath: WORKSPACE_PATH, workspaceId: WS_ID }))
      .silentRun(50);
  });

  it("reinitializes remote runtime when remote config details change", async () => {
    await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger(updatedRemoteConfig),
      prevPayload: environmentConfigTrigger(remoteConfig),
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, updatedRemoteConfig, {
        remoteConnectionId: "remote-conn-old",
        isRemoteInitialized: true,
      }))
      .put(setRemoteConnectionIdAction(WS_ID, null))
      .put(setIsRemoteInitializedAction(WS_ID, false))
      .put(initializeFileExplorer(WS_ID, { workspacePath: WORKSPACE_PATH, workspaceId: WS_ID }))
      .silentRun(50);
  });

  it("does not dispatch duplicate initialization for same-config workspace updates", async () => {
    const result = await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger({
        type: "remote",
        workspace_path: WORKSPACE_PATH,
        ssh: { host: "example.test", user: "dev" },
      }),
      prevPayload: environmentConfigTrigger(remoteConfig),
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, remoteConfig, {
        remoteConnectionId: "remote-conn-1",
        isRemoteInitialized: true,
      }))
      .silentRun(50);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(initializeFileExplorer.type);
      expect(action.type).not.toBe(setRemoteConnectionIdAction.type);
      expect(action.type).not.toBe(setIsRemoteInitializedAction.type);
    }
  });

  it("ignores initial selector emissions and active workspace switches", async () => {
    const initialEmission = await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger(remoteConfig),
      prevPayload: undefined,
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, remoteConfig))
      .silentRun(50);

    const workspaceSwitch = await expectSaga(handleWorkspaceEnvironmentConfigChange, {
      payload: environmentConfigTrigger(remoteConfig),
      prevPayload: environmentConfigTrigger(undefined, "other-ws"),
    })
      .withState(stateWith({}, WORKSPACE_PATH, {}, remoteConfig))
      .silentRun(50);

    expect(initialEmission.effects.put ?? []).toEqual([]);
    expect(workspaceSwitch.effects.put ?? []).toEqual([]);
  });

  it("populates initially empty agent edits during file-explorer refresh", async () => {
    vi.mocked(getAgentFileEdits).mockResolvedValue(
      new Map([["src/refreshed.ts", ["agent-refresh"]]]),
    );
    vi.mocked(propagateAgentEditsToParents).mockReturnValue(
      new Map([["src", ["agent-refresh"]]]),
    );

    await expectSaga(fileExplorerSaga)
      .withState(stateWith({}, "/a/repo", {}))
      .provide(provideRootLoad)
      .dispatch(refreshFileExplorer(WS_ID))
      .put(updateAgentFileEditsEntries(WS_ID, {
        "src/refreshed.ts": ["agent-refresh"],
        src: ["agent-refresh"],
      }))
      .silentRun(500);
  });

  it("clears stale agent edit entries when the event query returns no current paths", async () => {
    vi.mocked(getAgentFileEdits).mockResolvedValue(new Map());
    vi.mocked(propagateAgentEditsToParents).mockReturnValue(new Map());

    const result = await expectSaga(
      handleRefreshAgentFileEdits,
      refreshAgentFileEditsRequested(WS_ID),
    )
      .withState(stateWith({}, "/a/repo", { "src/stale.ts": ["agent-old"] }))
      .put(removeAgentFileEditsEntries(WS_ID, ["src/stale.ts"]))
      .silentRun(50);

    const putActions = result.effects.put ?? [];
    for (const effectDescriptor of putActions) {
      const action = (effectDescriptor as any).payload.action;
      expect(action.type).not.toBe(updateAgentFileEditsEntries.type);
    }
  });

  it("serializes overlapping agent edit reloads into one follow-up reload", () => {
    const firstRefresh = refreshAgentFileEditsForWorkspace(WS_ID);
    const firstEffect = firstRefresh.next().value as any;
    expect(firstEffect.type).toBe("CALL");
    expect(firstEffect.payload.fn.name).toBe("loadAgentFileEditsSaga");

    const overlappingRefresh = refreshAgentFileEditsForWorkspace(WS_ID);
    expect(overlappingRefresh.next().done).toBe(true);

    expect(firstRefresh.next().value).toEqual(sagaEffects.delay(0));
    const replayEffect = firstRefresh.next().value as any;
    expect(replayEffect.type).toBe("CALL");
    expect(replayEffect.payload.fn).toBe(refreshAgentFileEditsForWorkspace);
    expect(replayEffect.payload.args).toEqual([WS_ID]);
    expect(firstRefresh.next().done).toBe(true);
  });

  it("allows a different workspace agent edit reload while one workspace is in progress", () => {
    const firstRefresh = refreshAgentFileEditsForWorkspace("ws-a");
    const firstEffect = firstRefresh.next().value as any;
    expect(firstEffect.type).toBe("CALL");
    expect(firstEffect.payload.fn.name).toBe("loadAgentFileEditsSaga");
    expect(firstEffect.payload.args).toEqual(["ws-a"]);

    const overlappingRefresh = refreshAgentFileEditsForWorkspace("ws-b");
    const overlappingEffect = overlappingRefresh.next().value as any;
    expect(overlappingEffect.type).toBe("CALL");
    expect(overlappingEffect.payload.fn.name).toBe("loadAgentFileEditsSaga");
    expect(overlappingEffect.payload.args).toEqual(["ws-b"]);
    expect(overlappingRefresh.next().done).toBe(true);

    expect(firstRefresh.next().done).toBe(true);
  });

  it("debounces agent edit refresh events independently per workspace", () => {
    const saga = fileExplorerSaga();
    let debounceEffect: any;

    for (let i = 0; i < 20; i += 1) {
      const effect = saga.next().value as any;
      if (effect?.payload?.fn === debounceWithKeySaga) {
        debounceEffect = effect;
        break;
      }
    }

    expect(debounceEffect?.type).toBe("FORK");
    expect(debounceEffect.payload.args[0]).toBe(debouncedAgentFileEditsRefresh);
    expect(debounceEffect.payload.args[1]).toBe(300);

    const keyExtractor = debounceEffect.payload.args[2] as (action: any) => string;
    const wsAKey = keyExtractor(refreshAgentFileEditsRequested("ws-a"));
    expect(wsAKey).toBe(keyExtractor(refreshAgentFileEditsRequested("ws-a")));
    expect(wsAKey).not.toBe(keyExtractor(refreshAgentFileEditsRequested("ws-b")));
  });

  it("agent-file-changed events request a debounced agent edit refresh", async () => {
    await expectSaga(handleAgentFileChangedEvent, { workspaceId: activeWs })
      .withState(stateWithActiveWs(activeWs))
      .put(debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested(activeWs)))
      .silentRun(50);

    vi.mocked(getAgentFileEdits).mockResolvedValue(
      new Map([["src/agent-event.ts", ["agent-1"]]]),
    );
    await expectSaga(
      handleRefreshAgentFileEdits,
      refreshAgentFileEditsRequested(activeWs),
    )
      .withState(stateWith({}, "/a/repo", {}))
      .put(updateAgentFileEditsEntries(activeWs, { "src/agent-event.ts": ["agent-1"] }))
      .silentRun(50);
  });

  it("does not reload or pollute the active workspace for non-matching agent-file events", async () => {
    const result = await expectSaga(handleAgentFileChangedEvent, { workspaceId: "other-ws" })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
    expect(getAgentFileEdits).not.toHaveBeenCalled();

    const replayResult = await expectSaga(replayPendingAgentFileEditsRefreshForWorkspace, "other-ws")
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(replayResult.effects.put ?? []).toEqual([]);
  });

  it("buffers agent-file-changed events until their workspace becomes active", async () => {
    const result = await expectSaga(handleAgentFileChangedEvent, { workspaceId: "ws-pending" })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);

    await expectSaga(replayPendingAgentFileEditsRefreshForWorkspace, "ws-pending")
      .withState(stateWithActiveWs("ws-pending"))
      .put(debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested("ws-pending")))
      .silentRun(50);
  });

  it("listener-ready events refresh active workspaces and buffer inactive ones", async () => {
    await expectSaga(handleFileTrackingListenerReadyEvent, { workspaceId: activeWs })
      .withState(stateWithActiveWs(activeWs))
      .put(debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested(activeWs)))
      .silentRun(50);

    const result = await expectSaga(handleFileTrackingListenerReadyEvent, { workspaceId: "ws-pending" })
      .withState(stateWithActiveWs(activeWs))
      .silentRun(50);
    expect(result.effects.put ?? []).toEqual([]);

    await expectSaga(replayPendingAgentFileEditsRefreshForWorkspace, "ws-pending")
      .withState(stateWithActiveWs("ws-pending"))
      .put(debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested("ws-pending")))
      .silentRun(50);
  });

  it("file change events also request an agent edit refresh", async () => {
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "change",
    })
      .withState(stateWithActiveWs(activeWs))
      .put(refreshGitStatusRequested(activeWs))
      .put(debouncedAgentFileEditsRefresh(refreshAgentFileEditsRequested(activeWs)))
      .silentRun(50);
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

  it("handleFileChangedWindowEvent 'create' with files[] uses the first entry", async () => {
    const filePath = "/a/repo/src/restored.ts";
    await expectSaga(handleFileChangedWindowEvent, {
      workspaceId: activeWs,
      type: "create",
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
    let fileExplorerState = fileExplorerReducer(
      fileExplorerInitialState,
      setFileExplorerWorkspacePath(WS_ID, workspacePath),
    );
    fileExplorerState = fileExplorerReducer(
      fileExplorerState,
      setRootNode(WS_ID, makeTree()),
    );
    return {
      fileExplorer: fileExplorerState,
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
    // filePath under an uninstantiated directory — normalized node lookup returns null.
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
