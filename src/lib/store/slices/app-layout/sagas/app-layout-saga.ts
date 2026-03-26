import { goto } from "$app/navigation";
import { getPanelLayoutManager, hasPanelLayoutManager, type PanelTab, } from "$features/layout/panel-layout-manager.svelte";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { getFileExtension, track } from "$lib/services/analytics";
import { openNewSpaceModal, type NewSpaceInitialRepo, } from "$lib/store/slices/global-modals/global-modals-slice";
import { takeEveryFromElectronChannel, takeEveryFromWindowEvent, } from "$lib/store/utils/ipc-channel";
import { isFocusInTerminal } from "$lib/utils/keyboardShortcuts";
import { watchDockNavigationForWorkspaceSaga } from "./dock-navigation-saga";
import { specPanelSaga } from "./spec-panel-saga";
import { getSettingsPreviousPath, navigateToSettings } from "$lib/utils/workspace-navigation";
import type { Task } from "redux-saga";
import { cancel, call, fork, put, takeEvery } from "typed-redux-saga";
import { workspaceMounted, workspaceUnmounted, } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { createAgentRequested } from "../../workspace-agents/workspace-agents-slice";
import { createTerminalRequested } from "../../terminals/terminals-slice";
import { createNoteRequested, markNoteRead, } from "../../note-read-tracking/note-read-tracking-slice";
import { createFileRequested } from "../app-layout-slice";
import { notesClient } from "$features/notes/notes.client";
import { notesStateManager } from "$features/notes/notes.store.svelte";
import { WorkspaceId } from "$shared/types/branded-ids";
import { invoke } from "$lib/electron-bridge";
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
function getCurrentPanelLayoutManager(workspaceId?: string) {
    if (!workspaceId || !hasPanelLayoutManager(workspaceId)) {
        return null;
    }
    return getPanelLayoutManager(workspaceId);
}
function getWorkspaceMetadata(workspaceId: string) {
    if (workspaceStore.current?.id !== workspaceId) {
        return null;
    }
    return workspaceStore.current as {
        id: string;
        notes?: Array<{
            id: string;
            title?: string | null;
        }>;
        agents?: Array<{
            id: string;
            title?: string | null;
            name?: string | null;
        }>;
    };
}
function requestFocusedPanelFocus(manager: ReturnType<typeof getPanelLayoutManager>) {
    if (!manager.focusedPanelId) {
        return;
    }
    window.dispatchEvent(new CustomEvent("panel:request-focus", {
        detail: { panelId: manager.focusedPanelId },
    }));
}
function openWorkspaceTab(manager: ReturnType<typeof getPanelLayoutManager>, tab: Omit<PanelTab, "id">, openInAdjacentPanel = false, sourcePanelId?: string) {
    if (openInAdjacentPanel) {
        manager.openTabInAdjacentOrSplit(tab, sourcePanelId);
        requestFocusedPanelFocus(manager);
        return;
    }
    manager.openTab(tab, sourcePanelId);
}
function showAgentInLayout(workspaceId: string, agentId: string) {
    const manager = getCurrentPanelLayoutManager(workspaceId);
    if (!manager) {
        return;
    }
    for (const [panelId, panel] of Object.entries(manager.layout.panels)) {
        const existingAgentTab = panel.tabs.find((tab) => tab.type === "agent" && tab.agentId === agentId);
        if (!existingAgentTab) {
            continue;
        }
        manager.focusPanel(panelId);
        manager.setActiveTab(existingAgentTab.id, panelId);
        return;
    }
    const workspace = getWorkspaceMetadata(workspaceId);
    const agent = workspace?.agents?.find((candidate) => candidate.id === agentId);
    manager.openTab({
        type: "agent",
        title: agent?.title || agent?.name || "Agent",
        agentId,
        closable: true,
    });
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        openWorkspaceTab(manager, {
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        openWorkspaceTab(manager, {
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        const shortHash = detail.commitHash.substring(0, 7);
        const title = detail.commitMessage
            ? `${shortHash}: ${detail.commitMessage.substring(0, 20)}${detail.commitMessage.length > 20 ? "..." : ""}`
            : `Commit ${shortHash}`;
        openWorkspaceTab(manager, {
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        const workspace = getWorkspaceMetadata(wsId);
        let openInAdjacentPanel = detail.openInAdjacentPanel ?? false;
        if (!openInAdjacentPanel && detail.sourcePanelId) {
            const sourcePanel = manager.getPanel(detail.sourcePanelId);
            const activeTab = sourcePanel?.tabs.find((tab) => tab.id === sourcePanel.activeTabId);
            if (activeTab?.type === "agent") {
                openInAdjacentPanel = true;
            }
        }
        const note = workspace?.notes?.find((candidate) => candidate.id === detail.noteId);
        openWorkspaceTab(manager, {
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        const workspace = getWorkspaceMetadata(wsId);
        const agent = workspace?.agents?.find((candidate) => candidate.id === detail.agentId);
        openWorkspaceTab(manager, {
            type: "agent",
            title: agent?.title || agent?.name || "Agent",
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
        const manager = getCurrentPanelLayoutManager(wsId);
        if (!manager) {
            return;
        }
        manager.openTab({
            type: "terminal",
            title: "Terminal",
            terminalId: detail.terminalId,
            closable: true,
        });
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
        const wsId = workspaceStore.current?.id;
        if (!wsId) {
            return;
        }
        yield* put(createAgentRequested(wsId));
    });
}
export function* watchMenuNewNoteSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-note", function* () {
        const wsId = workspaceStore.current?.id;
        if (!wsId) {
            return;
        }
        yield* put(createNoteRequested(wsId));
    });
}
export function* watchMenuNewTerminalSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-terminal", function* () {
        const wsId = workspaceStore.current?.id;
        if (!wsId) {
            return;
        }
        yield* put(createTerminalRequested(wsId));
    });
}
export function* watchMenuNewBrowserSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:new-browser", function* () {
        const manager = getCurrentPanelLayoutManager(workspaceStore.current?.id);
        if (!manager) {
            return;
        }
        yield* call([manager, manager.openBrowserPanel]);
    });
}
export function* watchBrowserOpenTabSaga() {
    yield* takeEveryFromElectronChannel<BrowserOpenTabEvent>("browser:open-tab", function* (data) {
        const workspaceId = data.workspaceId || workspaceStore.current?.id;
        const manager = getCurrentPanelLayoutManager(workspaceId);
        if (!manager) {
            return;
        }
        const { url, position = "adjacent" } = data;
        if (position === "replace") {
            const existingBrowserTab = manager.allOpenTabs.find((tab) => tab.type === "browser");
            if (existingBrowserTab) {
                yield* call([manager, manager.updateTabBrowserUrl], existingBrowserTab.id, url);
                yield* call([manager, manager.setActiveTab], existingBrowserTab.id);
                return;
            }
            yield* call([manager, manager.openBrowserPanel], url);
            return;
        }
        if (position === "adjacent") {
            const browserTab: Omit<PanelTab, "id"> = {
                type: "browser",
                title: "Browser",
                browserUrl: url,
                closable: true,
            };
            yield* call({ context: manager, fn: manager.openTabInAdjacentOrSplit }, browserTab);
            return;
        }
        yield* call([manager, manager.openBrowserPanel], url);
    });
}
export function* watchMenuCloseTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:close-tab", function* () {
        const manager = getCurrentPanelLayoutManager(workspaceStore.current?.id);
        if (!manager) {
            return;
        }
        yield* call([manager, manager.closeActiveTab]);
    });
}
export function* watchMenuReopenClosedTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:reopen-closed-tab", function* () {
        const manager = getCurrentPanelLayoutManager(workspaceStore.current?.id);
        if (!manager) {
            return;
        }
        yield* call([manager, manager.reopenClosedTab]);
    });
}
export function* watchMenuSelectPreviousTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:select-previous-tab", function* () {
        const manager = getCurrentPanelLayoutManager(workspaceStore.current?.id);
        if (!manager) {
            return;
        }
        yield* call([manager, manager.selectPreviousTab]);
    });
}
export function* watchMenuSelectNextTabSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:select-next-tab", function* () {
        const manager = getCurrentPanelLayoutManager(workspaceStore.current?.id);
        if (!manager) {
            return;
        }
        yield* call([manager, manager.selectNextTab]);
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
        const currentWorkspace = workspaceStore.current;
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
 * Open a note tab in the panel layout manager.
 */
function openNoteInLayout(noteId: string, noteTitle: string, wsId: string): void {
    if (!hasPanelLayoutManager(wsId))
        return;
    const layoutManager = getPanelLayoutManager(wsId);
    layoutManager.openTab({
        type: "note",
        title: noteTitle || "Note",
        noteId,
        closable: true,
    });
}
function* handleCreateNoteRequestedSaga(wsId: string) {
    try {
        const result: Awaited<ReturnType<typeof notesClient.create>> = yield* call({ context: notesClient, fn: notesClient.create }, {
            workspaceId: WorkspaceId(wsId),
            title: "New Note",
            content: "",
            tags: [],
        });
        if (result.ok && result.data) {
            yield* put(markNoteRead(wsId, result.data.id));
            yield* call([notesStateManager, notesStateManager.reloadNotes]);
            openNoteInLayout(result.data.id, result.data.title || "New Note", wsId);
            track("Created Note", { note_type: "regular", source: "tab-bar" });
        }
    }
    catch (error) {
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
    catch (error) {
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
    yield* fork(specPanelSaga);
    yield* fork(watchCreateNoteRequestedSaga);
    yield* fork(watchCreateFileRequestedSaga);
}
