import * as sagaEffects from "redux-saga/effects";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

vi.mock("typed-redux-saga", async () => {
  const actual = await import("$lib/store/utils/test-helpers/typed-redux-saga-mock");

  return {
    ...actual,
    debounce: function* (ms: number, pattern: any, worker: any) {
      return yield sagaEffects.debounce(ms, pattern, worker);
    },
    getContext: function* (key: string) {
      return yield sagaEffects.getContext(key);
    },
  };
});

const { clearPanelLayoutAdapterMock } = vi.hoisted(() => ({
  clearPanelLayoutAdapterMock: vi.fn(),
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  clearPanelLayoutAdapter: clearPanelLayoutAdapterMock,
}));

vi.mock("$features/layout/panel-layout-history.client", () => ({
  panelLayoutHistoryClient: {
    save: vi.fn(),
    load: vi.fn(),
  },
}));

import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { setLocalStorageJSON } from "../../../utils/safe-local-storage-saga";
import {
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type WorkspacePanelLayout,
} from "../panel-layout-types";
import {
  initializeLayout,
  emptyWorkspaceState,
  initialState,
  panelLayoutReducer,
  setRestoreStatus,
} from "../panel-layout-slice";
import {
  filesReducer,
  initialState as initialFilesState,
  loadFileContentSucceeded,
  removeFileContentEntry,
} from "../../files/files-slice";
import { selectFileContentPrunePayload } from "../panel-layout-selectors";
import {
  cleanupClosedFileContentEntries,
  handleWorkspaceMountedRestore,
  handleWorkspaceUnmounted,
  isStoredLayoutValid,
  loadLayoutFromStorage,
  panelLayoutSaga,
  retroactivePanelLayoutMountCheckSaga,
  watchOpenFileTabContentCleanup,
} from "./panel-layout-saga";

type FileEntrySpec = { wsId: string; path: string };

function createFilesState(entries: FileEntrySpec[]) {
  return entries.reduce(
    (state, { wsId, path }) =>
      filesReducer(state, loadFileContentSucceeded(wsId, path, `/repo/${path}`, `${path} content`, false)),
    initialFilesState,
  );
}

function createStoreState(
  openFilePathsByWorkspace: Record<string, string[]>,
  fileEntries: FileEntrySpec[],
  activeWorkspaceId: string | null = Object.keys(openFilePathsByWorkspace)[0] ?? fileEntries[0]?.wsId ?? null,
) {
  return {
    panelLayout: {
      byWorkspaceId: Object.fromEntries(
        Object.entries(openFilePathsByWorkspace).map(([wsId, paths]) => [
          wsId,
          {
            ...emptyWorkspaceState,
            panels: {
              panel: {
                id: "panel",
                activeTabId: paths[0] ? `file-tab-0` : null,
                tabs: paths.map((path, index) => ({
                  id: `file-tab-${index}`,
                  type: "file" as const,
                  title: path.split("/").pop() ?? path,
                  closable: true,
                  filePath: path,
                })),
              },
            },
          },
        ]),
      ),
    },
    files: createFilesState(fileEntries),
    storeUtility: { updatesLocked: false },
    workspace: { activeWorkspaceId },
  };
}

describe("panelLayoutSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks all watchers including workspace restore lifecycle watchers", () => {
    const gen = panelLayoutSaga();
    const forkedFns: unknown[] = [];

    for (let i = 0; i < 8; i++) {
      const result = gen.next();
      expect(result.done).toBe(false);
      expect((result.value as any).type).toBe("FORK");
      forkedFns.push((result.value as any).payload.fn);
    }

    expect(forkedFns).toContain(watchOpenFileTabContentCleanup);
    expect(gen.next().done).toBe(true);
  });

  it("prunes file content entries with no current open file tab", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState({ "ws-files": [] }, [{ wsId: "ws-files", path: "src/file.ts" }]) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual(["src/file.ts"]);
    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    expect(gen.next("ws-files").value).toEqual(
      sagaEffects.put(removeFileContentEntry("ws-files", "src/file.ts")),
    );
    expect(gen.next().done).toBe(true);
  });

  it("keeps file content when the same path remains open in another tab", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { "ws-files": ["src/file.ts", "src/file.ts"] },
        [{ wsId: "ws-files", path: "src/file.ts" }],
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("does not prune file content when only non-file tabs are absent from current state", () => {
    const state = createStoreState(
      { "ws-tabs": ["src/file.ts"] },
      [{ wsId: "ws-tabs", path: "src/file.ts" }],
    );
    state.panelLayout.byWorkspaceId["ws-tabs"].panels.panel.tabs.push({
      id: "note-tab",
      type: "note",
      title: "Note",
      closable: true,
      noteId: "note-1",
    });

    const payload = selectFileContentPrunePayload.select(state as any);
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("prunes the old file content path when a file tab path changes", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { "ws-files": ["src/new.ts"] },
        [
          { wsId: "ws-files", path: "src/old.ts" },
          { wsId: "ws-files", path: "src/new.ts" },
        ],
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual(["src/old.ts"]);
    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    expect(gen.next("ws-files").value).toEqual(
      sagaEffects.put(removeFileContentEntry("ws-files", "src/old.ts")),
    );
    expect(gen.next().done).toBe(true);
  });

  it("prunes stale entries on the initial selector emission", () => {
    const gen = cleanupClosedFileContentEntries({
      prevPayload: null,
      payload: ["src/file.ts"],
    });

    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    expect(gen.next("ws-files").value).toEqual(
      sagaEffects.put(removeFileContentEntry("ws-files", "src/file.ts")),
    );
    expect(gen.next().done).toBe(true);
  });

  it("does not prune stale entries from inactive workspaces", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { "ws-open": ["src/shared.ts"] },
        [
          { wsId: "ws-open", path: "src/shared.ts" },
          { wsId: "ws-stale", path: "src/shared.ts" },
        ],
        "ws-open",
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("checks only the newly active workspace after an active workspace switch", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { "ws-previous": [], "ws-current": [] },
        [
          { wsId: "ws-previous", path: "src/previous.ts" },
          { wsId: "ws-current", path: "src/current.ts" },
        ],
        "ws-current",
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual(["src/current.ts"]);
    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    expect(gen.next("ws-current").value).toEqual(
      sagaEffects.put(removeFileContentEntry("ws-current", "src/current.ts")),
    );
    expect(gen.next().done).toBe(true);
  });

  it("does not produce cleanup for inactive workspace tab changes", () => {
    const state = createStoreState(
      { "ws-active": ["src/active.ts"], "ws-inactive": [] },
      [
        { wsId: "ws-active", path: "src/active.ts" },
        { wsId: "ws-inactive", path: "src/inactive.ts" },
      ],
      "ws-active",
    );
    state.panelLayout.byWorkspaceId["ws-inactive"].panels.panel.tabs.push({
      id: "inactive-note-tab",
      type: "note",
      title: "Inactive Note",
      closable: true,
      noteId: "inactive-note",
    });

    const payload = selectFileContentPrunePayload.select(state as any);
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("does not produce cleanup when there is no active workspace", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { "ws-inactive": [] },
        [{ wsId: "ws-inactive", path: "src/inactive.ts" }],
        null,
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("does not produce cleanup when the active workspace id is invalid", () => {
    const payload = selectFileContentPrunePayload.select(
      createStoreState(
        { new: [] },
        [{ wsId: "new", path: "src/new-workspace.ts" }],
        "new",
      ) as any,
    );
    const gen = cleanupClosedFileContentEntries({ prevPayload: null, payload });

    expect(payload).toEqual([]);
    expect(gen.next().done).toBe(true);
  });

  it("calls clearPanelLayoutAdapter when workspace is unmounted", () => {
    const action = workspaceUnmounted("ws-cleanup");
    const gen = handleWorkspaceUnmounted(action);
    gen.next();

    expect(clearPanelLayoutAdapterMock).toHaveBeenCalledWith("ws-cleanup");
  });

  it("marks restore pending, initializes layout, then marks restored", () => {
    const action = workspaceMounted("ws-restore");
    const storedLayout = {
      root: { type: "panel" as const, panelId: "p1" },
      panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
      focusedPanelId: "p1",
    };

    const gen = handleWorkspaceMountedRestore(action);

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-restore", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-restore"));
    expect(gen.next(storedLayout).value).toEqual(
      sagaEffects.put(initializeLayout("ws-restore", storedLayout)),
    );
    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-restore", "restored")));
    expect(gen.next().done).toBe(true);
  });

  it("marks restore invalid when stored layout fails validation", () => {
    const gen = handleWorkspaceMountedRestore(workspaceMounted("ws-invalid"));

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-invalid", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-invalid"));
    expect(gen.next("invalid").value).toEqual(sagaEffects.put(setRestoreStatus("ws-invalid", "invalid")));
    expect(gen.next().done).toBe(true);
  });

  it("marks restore empty when nothing is stored", () => {
    const gen = handleWorkspaceMountedRestore(workspaceMounted("ws-empty"));

    expect(gen.next().value).toEqual(sagaEffects.put(setRestoreStatus("ws-empty", "pending")));
    expect(gen.next().value).toEqual(sagaEffects.call(loadLayoutFromStorage, "ws-empty"));
    expect(gen.next(null).value).toEqual(sagaEffects.put(setRestoreStatus("ws-empty", "empty")));
    expect(gen.next().done).toBe(true);
  });

  it("replays a missed workspace mount during retroactive check", () => {
    const gen = retroactivePanelLayoutMountCheckSaga();

    expect(gen.next().value).toEqual(sagaEffects.select(selectActiveWorkspaceId.select));
    const forkEffect = gen.next("ws-retro").value as any;
    expect(forkEffect.type).toBe("FORK");
    expect(forkEffect.payload.args[0]).toEqual(workspaceMounted("ws-retro"));
  });

  it("validates root refs, focusedPanelId, activeTabIds, and malformed tab entries", () => {
    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "missing" },
        panels: {},
        focusedPanelId: null,
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
        focusedPanelId: "missing",
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [{ id: "tab-1" } as any], activeTabId: "missing" } },
        focusedPanelId: "p1",
      }),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [null] as any, activeTabId: "tab-1" } },
        focusedPanelId: "p1",
      } as any),
    ).toBe(false);

    expect(
      isStoredLayoutValid({
        root: { type: "panel", panelId: "p1" },
        panels: { p1: { id: "p1", tabs: ["bad-tab"] as any, activeTabId: "tab-1" } },
        focusedPanelId: "p1",
      } as any),
    ).toBe(false);
  });

  it("persists initialized layouts without ephemeral pending focus state", async () => {
    const wsId = "ws-persist";
    const layout: WorkspacePanelLayout = {
      root: { type: "panel", panelId: "panel-1" },
      panels: {
        "panel-1": {
          id: "panel-1",
          tabs: [],
          activeTabId: null,
        },
      },
      focusedPanelId: "panel-1",
    };
    const action = initializeLayout(wsId, layout);
    const state = {
      panelLayout: panelLayoutReducer(initialState, action),
      storeUtility: { updatesLocked: false },
      workspace: { activeWorkspaceId: null },
    };
    const readableStoreState = {
      subscribe: (run: (value: typeof state) => void) => {
        run(state);
        return () => {};
      },
    };

    await expectSaga(panelLayoutSaga)
      .withState(state)
      .provide([[matchers.getContext("readableStoreState"), readableStoreState]])
      .dispatch(action)
      .call(setLocalStorageJSON, `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, layout)
      .silentRun(0);
  });
});

