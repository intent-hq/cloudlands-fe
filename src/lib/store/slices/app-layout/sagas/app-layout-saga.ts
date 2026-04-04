import { goto } from "$app/navigation";
import type { PanelTab } from "$lib/store/slices/panel-layout/panel-layout-types";
import { selectFocusedPanelId, selectPanels, selectAllTabs, selectPanel } from "$lib/store/slices/panel-layout/panel-layout-selectors";
import { openTab, openTabInAdjacentOrSplit, closeActiveTab, reopenClosedTab, setActiveTab, focusPanel, selectPreviousTab, selectNextTab, updateTabBrowserUrl } from "$lib/store/slices/panel-layout/panel-layout-slice";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import { getFileExtension, track } from "$lib/services/analytics";
import { openNewSpaceModal, type NewSpaceInitialRepo, } from "$lib/store/slices/global-modals/global-modals-slice";
import { takeEveryFromElectronChannel, takeEveryFromWindowEvent, } from "$lib/store/utils/ipc-channel";
import { isFocusInTerminal } from "$lib/utils/keyboardShortcuts";
import { watchDockNavigationForWorkspaceSaga } from "./dock-navigation-saga";
import { specPanelSaga } from "./spec-panel-saga";
import { getSettingsPreviousPath, navigateToSettings } from "$lib/utils/workspace-navigation";
import type { Task } from "redux-saga";
import { cancel, call, fork, put, select, takeEvery } from "typed-redux-saga";
import { workspaceMounted, workspaceUnmounted, } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { createAgentRequested } from "../../workspace-agents/workspace-agents-slice";
import { createTerminalRequested } from "../../terminals/terminals-slice";
import { createNoteRequested, markNoteRead, } from "../../note-read-tracking/note-read-tracking-slice";
import { createFileRequested } from "../app-layout-slice";
import { notesIpc } from "../../workspace-notes/sagas/notes-ipc";
import { NOTES_CHANNELS } from "$shared/ipc/channels";
import { reloadNotes } from "../../workspace-notes/workspace-notes-slice";
import type { Note } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import { invoke } from "$lib/electron-bridge";
import { selectActiveWorkspace, selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { selectNoteById } from "../../workspace-notes/workspace-notes-selectors";
import { selectAgentById } from "../../workspace-agents/workspace-agents-selectors";
const workspaceWindowTasks = new Map<string, Task[]>();
type BrowserOpenTabEvent = {
    url: string;
    position?: "adjacent" | "replace" | "same";
    workspaceId?: string;
};
type WorkspaceCreateForRepoEvent = {
    repositoryPath: string;
    workspaceId?: string;
    workspaceTitle?: string;
};
type OpenNewSpaceModalEvent = {
    initialRepo?: NewSpaceInitialRepo;
};
type WorkspaceShowAgentDetail = {
    agentId?: string;
};
type WorkspaceOpenFileDetail = {
    path?: string;
    filePath?: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
};
type WorkspaceOpenDiffDetail = {
    change?: Record<string, unknown> & {
        file?: string;
        relativePath?: string;
    };
    filePath?: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
};
type WorkspaceOpenCommitChangesetDetail = {
    commitHash?: string;
    commitMessage?: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
};
type WorkspaceOpenNoteDetail = {
    noteId?: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
};
type WorkspaceOpenAgentDetail = {
    agentId?: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
};
type WorkspaceOpenTerminalDetail = {
    terminalId?: string;
};

function requestFocusedPanelFocus(wsId: string) {
    const focusedId = selectFocusedPanelId.select(getReduxStore().getState(), wsId);
    if (!focusedId) {
        return;
    }
    window.dispatchEvent(new CustomEvent("panel:request-focus", {
        detail: { panelId: focusedId },
    }));
}
function openWorkspaceTab(wsId: string, tab: Omit<PanelTab, "id">, openInAdjacentPanel = false, sourcePanelId?: string) {
    const store = getReduxStore();
    if (openInAdjacentPanel) {
        store.dispatch(openTabInAdjacentOrSplit(wsId, tab, sourcePanelId, { force: true }));
        requestFocusedPanelFocus(wsId);
        return;
    }
    store.dispatch(openTab(wsId, tab, sourcePanelId, undefined, true));
}
function showAgentInLayout(workspaceId: string, agentId: string) {
    const store = getReduxStore();
    const panels = selectPanels.select(store.getState(), workspaceId);
    for (const [panelId, panel] of Object.entries(panels)) {
        const existingAgentTab = panel.tabs.find((tab) => tab.type === "agent" && tab.agentId === agentId);
        if (!existingAgentTab) {
            continue;
        }
        store.dispatch(focusPanel(workspaceId, panelId));
        store.dispatch(setActiveTab(workspaceId, existingAgentTab.id, panelId));
        return;
    }
    const agent = selectAgentById.select(store.getState(), agentId);
    store.dispatch(openTab(workspaceId, {
        type: "agent",
        title: agent?.name || "Agent",
        agentId,
        closable: true,
    }));
}
const routedWorkspaceWindowEventChannelOptions = {
    capture: true,
    stopImmediatePropagation: true,
} as const;
export function* watchShowAgentSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceShowAgentDetail>("workspace:show-agent", function* (detail) {
        if (!detail?.agentId) {
            return;
        }
        showAgentInLayout(wsId, detail.agentId);
    });
}
export function* watchOpenFileSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenFileDetail>("workspace:open-file", function* (detail) {
        const filePath = detail?.path || detail?.filePath;
        if (!filePath) {
            return;
        }
        openWorkspaceTab(wsId, {
            type: "file",
            title: filePath.split("/").pop() || "File",
            filePath,
            closable: true,
        }, detail?.openInAdjacentPanel ?? false, detail?.sourcePanelId);
        track("Opened File", {
            workspace_id: wsId,
            file_extension: getFileExtension(filePath),
        });
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchOpenDiffSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenDiffDetail>("workspace:open-diff", function* (detail) {
        const filePath = detail?.filePath || detail?.change?.file || detail?.change?.relativePath;
        if (!filePath) {
            return;
        }
        openWorkspaceTab(wsId, {
            type: "diff",
            title: filePath.split("/").pop() || "Diff",
            diffPath: filePath,
            closable: true,
            data: { change: detail?.change },
        }, detail?.openInAdjacentPanel ?? false, detail?.sourcePanelId);
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchOpenCommitChangesetSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenCommitChangesetDetail>("workspace:open-commit-changeset", function* (detail) {
        if (!detail?.commitHash) {
            return;
        }
        const shortHash = detail.commitHash.substring(0, 7);
        const title = detail.commitMessage
            ? `${shortHash}: ${detail.commitMessage.substring(0, 20)}${detail.commitMessage.length > 20 ? "..." : ""}`
            : `Commit ${shortHash}`;
        openWorkspaceTab(wsId, {
            type: "changes",
            title,
            closable: true,
            data: {
                commitHash: detail.commitHash,
                commitMessage: detail.commitMessage,
            },
        }, detail.openInAdjacentPanel ?? false, detail.sourcePanelId);
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchOpenNoteSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenNoteDetail>("workspace:open-note", function* (detail) {
        if (!detail?.noteId) {
            return;
        }
        let openInAdjacentPanel = detail.openInAdjacentPanel ?? false;
        if (!openInAdjacentPanel && detail.sourcePanelId) {
            const sourcePanel = selectPanel.select(getReduxStore().getState(), wsId, detail.sourcePanelId);
            const activeTab = sourcePanel?.tabs.find((tab) => tab.id === sourcePanel.activeTabId);
            if (activeTab?.type === "agent") {
                openInAdjacentPanel = true;
            }
        }
        const note = selectNoteById.select(getReduxStore().getState(), wsId, detail.noteId);
        openWorkspaceTab(wsId, {
            type: "note",
            title: note?.title || detail.noteId,
            noteId: detail.noteId,
            closable: true,
        }, openInAdjacentPanel, detail.sourcePanelId);
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchOpenAgentSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenAgentDetail>("workspace:open-agent", function* (detail) {
        if (!detail?.agentId) {
            return;
        }
        const agent = selectAgentById.select(getReduxStore().getState(), detail.agentId);
        openWorkspaceTab(wsId, {
            type: "agent",
            title: agent?.name || "Agent",
            agentId: detail.agentId,
            closable: true,
        }, detail.openInAdjacentPanel ?? false, detail.sourcePanelId);
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchOpenTerminalSaga(wsId: string) {
    yield* takeEveryFromWindowEvent<WorkspaceOpenTerminalDetail>("workspace:open-terminal", function* (detail) {
        if (!detail?.terminalId) {
            return;
        }
        getReduxStore().dispatch(openTab(wsId, {
            type: "terminal",
            title: "Terminal",
            terminalId: detail.terminalId,
            closable: true,
        }));
    }, routedWorkspaceWindowEventChannelOptions);
}
export function* watchWorkspaceWindowEventsSaga(wsId: string) {
    yield* fork(watchShowAgentSaga, wsId);
    yield* fork(watchOpenFileSaga, wsId);
    yield* fork(watchOpenDiffSaga, wsId);
    yield* fork(watchOpenCommitChangesetSaga, wsId);
    yield* fork(watchOpenNoteSaga, wsId);
    yield* fork(watchOpenAgentSaga, wsId);
    yield* fork(watchOpenTerminalSaga, wsId);
}
export function* watchWorkspaceWindowEventsForWorkspaceSaga(action: ReturnType<typeof workspaceMounted>) {
    const [wsId] = action.payload;
    const task = yield* fork(watchWorkspaceWindowEventsSaga, wsId);
    const dockNavigationTask = yield* fork(watchDockNavigationForWorkspaceSaga, wsId);
    workspaceWindowTasks.set(wsId, [task, dockNavigationTask]);
}
export function* cancelWorkspaceWindowEventsForWorkspaceSaga(action: ReturnType<typeof workspaceUnmounted>) {
    const [wsId] = action.payload;
    const tasks = workspaceWindowTasks.get(wsId);
    if (!tasks) {
        return;
    }
    for (const task of tasks) {
        yield* cancel(task);
    }
    workspaceWindowTasks.delete(wsId);
}
export function* watchWorkspaceWindowEventLifecyclesSaga() {
    yield* takeEvery(workspaceMounted, watchWorkspaceWindowEventsForWorkspaceSaga);
    yield* takeEvery(workspaceUnmounted, cancelWorkspaceWindowEventsForWorkspaceSaga);
}
/**
 * Guard against early `workspaceMounted` dispatch.
 *
 * If the component dispatches `workspaceMounted` before the saga middleware
 * has registered its `takeEvery`, the action is silently dropped and per-workspace
 * window event handlers never start. This saga runs once at startup: after the
 * `takeEvery` is registered, it checks whether a workspace is already active in
 * Redux state. If one exists and no handlers have been forked for it, it manually
 * forks the workspace watcher with a synthetic action.
 */
/** @internal Exported for testing only. */
export function* retroactiveAppLayoutMountCheckSaga() {
    const activeWsId = yield* select(selectActiveWorkspaceId.select);

    if (!activeWsId) {
        return;
    }

    // Skip invalid workspace IDs (empty, "new", "optimistic-*", "undefined")
    if (!activeWsId || activeWsId === "new" || activeWsId.startsWith("optimistic-") || activeWsId === "undefined") {
        return;
    }

    // If the normal takeEvery already processed the mount, tasks will exist.
    if (workspaceWindowTasks.has(activeWsId)) {
        return;
    }

    // The workspace was mounted before the saga started — replay.
    yield* fork(watchWorkspaceWindowEventsForWorkspaceSaga, workspaceMounted(activeWsId));
}
export function* watchNavigateSaga() {
    yield* takeEveryFromElectronChannel<string>("navigate", function* (path) {
        if (path === "/?create=true") {
            yield* put(openNewSpaceModal(undefined));
            return;
        }
        yield* call(goto, path);
    });
}
export function* watchNavigateToSettingsSaga() {
    yield* takeEveryFromElectronChannel<null>("navigate-to-settings", function* () {
        if (window.location.pathname.startsWith("/settings")) {
            yield* call(goto, getSettingsPreviousPath());
            return;
        }
        yield* call(navigateToSettings);
    });
}
export function* watchMenuNewAgentSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-agent", function* () {
        const focusInTerminal: boolean = yield* call(isFocusInTerminal);
        if (focusInTerminal) {
            window.dispatchEvent(new CustomEvent("terminal:create-new"));
            return;
        }
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(createAgentRequested(wsId));
    });
}
export function* watchMenuNewNoteSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-note", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(createNoteRequested(wsId));
    });
}
export function* watchMenuNewTerminalSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-terminal", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(createTerminalRequested(wsId));
    });
}
export function* watchMenuNewBrowserSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-browser", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(openTab(wsId, {
            type: "browser",
            title: "Browser",
            browserUrl: "https://google.com",
            closable: true,
        }));
    });
}
export function* watchBrowserOpenTabSaga() {
    yield* takeEveryFromElectronChannel<BrowserOpenTabEvent>("browser:open-tab", function* (data) {
        const currentWorkspace = data.workspaceId ? undefined : yield* selectActiveWorkspace.effect();
        const workspaceId = data.workspaceId || currentWorkspace?.id;
        if (!workspaceId) {
            return;
        }
        const { url, position = "adjacent" } = data;
        if (position === "replace") {
            const allTabs = yield* select(selectAllTabs.select, workspaceId);
            const existingBrowserTab = allTabs.find((tab) => tab.type === "browser");
            if (existingBrowserTab) {
                yield* put(updateTabBrowserUrl(workspaceId, existingBrowserTab.id, url));
                yield* put(setActiveTab(workspaceId, existingBrowserTab.id));
                return;
            }
            yield* put(openTab(workspaceId, {
                type: "browser",
                title: "Browser",
                browserUrl: url,
                closable: true,
            }));
            return;
        }
        if (position === "adjacent") {
            const browserTab: Omit<PanelTab, "id"> = {
                type: "browser",
                title: "Browser",
                browserUrl: url,
                closable: true,
            };
            yield* put(openTabInAdjacentOrSplit(workspaceId, browserTab));
            return;
        }
        yield* put(openTab(workspaceId, {
            type: "browser",
            title: "Browser",
            browserUrl: url,
            closable: true,
        }));
    });
}
export function* watchMenuCloseTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:close-tab", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(closeActiveTab(wsId));
    });
}
export function* watchMenuReopenClosedTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:reopen-closed-tab", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(reopenClosedTab(wsId));
    });
}
export function* watchMenuSelectPreviousTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:select-previous-tab", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(selectPreviousTab(wsId));
    });
}
export function* watchMenuSelectNextTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:select-next-tab", function* () {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        yield* put(selectNextTab(wsId));
    });
}
export function* watchMenuZoomInSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:zoom-in", function* () {
        window.dispatchEvent(new CustomEvent("browser:zoom", { detail: { action: "in" } }));
    });
}
export function* watchMenuZoomOutSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:zoom-out", function* () {
        window.dispatchEvent(new CustomEvent("browser:zoom", { detail: { action: "out" } }));
    });
}
export function* watchMenuResetZoomSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:reset-zoom", function* () {
        window.dispatchEvent(new CustomEvent("browser:zoom", { detail: { action: "reset" } }));
    });
}
export function* watchWorkspaceCreateForRepoSaga() {
    yield* takeEveryFromWindowEvent<WorkspaceCreateForRepoEvent>("workspace:create-for-repo", function* (data) {
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        yield* put(openNewSpaceModal(data.repositoryPath
            ? {
                repoPath: data.repositoryPath,
                environmentType: currentWorkspace?.environmentConfig?.type,
                sshConfig: currentWorkspace?.environmentConfig?.ssh,
                previousWorkspaceId: data.workspaceId,
                previousWorkspaceTitle: data.workspaceTitle,
            }
            : undefined));
    });
}
export function* watchOpenNewSpaceModalSaga() {
    yield* takeEveryFromWindowEvent<OpenNewSpaceModalEvent>("app:open-new-space-modal", function* (data) {
        yield* put(openNewSpaceModal(data.initialRepo));
    });
}
/**
 * Open a note tab in the panel layout.
 */
function openNoteInLayout(noteId: string, noteTitle: string, wsId: string): void {
    getReduxStore().dispatch(openTab(wsId, {
        type: "note",
        title: noteTitle || "Note",
        noteId,
        closable: true,
    }, undefined, undefined, true));
}
function* handleCreateNoteRequestedSaga(wsId: string) {
    try {
        const result = yield* call(notesIpc<Note>, NOTES_CHANNELS.CREATE, {
            workspaceId: WorkspaceId(wsId),
            title: "New Note",
            content: "",
            tags: [],
        });
        if (result.ok && result.data) {
            yield* put(markNoteRead(wsId, result.data.id));
            yield* put(reloadNotes(wsId));
            openNoteInLayout(result.data.id, result.data.title || "New Note", wsId);
            track("Created Note", { note_type: "regular", source: "tab-bar" });
        }
    }
    catch {
    }
}
function* watchCreateNoteRequestedSaga() {
    yield takeEvery(createNoteRequested.type, function* ({ payload }: ReturnType<typeof createNoteRequested>) {
        const [wsId] = payload;
        yield* handleCreateNoteRequestedSaga(wsId);
    });
}
async function showCreateFileSuccessToast(fileName: string): Promise<void> {
    try {
        const { toast } = await import("svelte-sonner");
        toast.success(`Created ${fileName}`);
    }
    catch {
        // Toast not available - not critical
    }
}
async function showCreateFileErrorToast(message: string): Promise<void> {
    try {
        const { toast } = await import("svelte-sonner");
        toast.error(message);
    }
    catch {
        // Toast not available - not critical
    }
}
function* handleCreateFileRequestedSaga(wsId: string, folderPath: string, fileName: string) {
    const newFilePath = `${folderPath}/${fileName}`;
    try {
        const result: {
            success: boolean;
            error?: string;
        } = yield* call(invoke<{
            success: boolean;
            error?: string;
        }>, "file:write", { path: newFilePath, content: "", workspaceId: wsId });
        if (result?.success) {
            yield* call(showCreateFileSuccessToast, fileName);
            // Notify file tree to refresh
            window.dispatchEvent(new CustomEvent("file:changed", {
                detail: {
                    workspaceId: wsId,
                    type: "create",
                    filePath: newFilePath,
                },
            }));
            // Open the newly created file
            window.dispatchEvent(new CustomEvent("workspace:open-file", {
                detail: {
                    path: newFilePath,
                },
            }));
            track("Created File", {
                workspace_id: wsId,
                file_extension: getFileExtension(fileName),
            });
        }
        else {
            yield* call(showCreateFileErrorToast, `Failed to create file: ${result?.error || "Unknown error"}`);
        }
    }
    catch {
        yield* call(showCreateFileErrorToast, "Failed to create file");
    }
}
function* watchCreateFileRequestedSaga() {
    yield takeEvery(createFileRequested.type, function* ({ payload }: ReturnType<typeof createFileRequested>) {
        const [wsId, folderPath, fileName] = payload;
        yield* handleCreateFileRequestedSaga(wsId, folderPath, fileName);
    });
}
export function* appLayoutSaga() {
    yield* fork(watchNavigateSaga);
    yield* fork(watchNavigateToSettingsSaga);
    yield* fork(watchMenuNewAgentSaga);
    yield* fork(watchMenuNewNoteSaga);
    yield* fork(watchMenuNewTerminalSaga);
    yield* fork(watchMenuNewBrowserSaga);
    yield* fork(watchBrowserOpenTabSaga);
    yield* fork(watchMenuCloseTabSaga);
    yield* fork(watchMenuReopenClosedTabSaga);
    yield* fork(watchMenuSelectPreviousTabSaga);
    yield* fork(watchMenuSelectNextTabSaga);
    yield* fork(watchMenuZoomInSaga);
    yield* fork(watchMenuZoomOutSaga);
    yield* fork(watchMenuResetZoomSaga);
    yield* fork(watchWorkspaceCreateForRepoSaga);
    yield* fork(watchOpenNewSpaceModalSaga);
    yield* fork(watchWorkspaceWindowEventLifecyclesSaga);
    yield* fork(retroactiveAppLayoutMountCheckSaga);
    yield* fork(specPanelSaga);
    yield* fork(watchCreateNoteRequestedSaga);
    yield* fork(watchCreateFileRequestedSaga);
}
