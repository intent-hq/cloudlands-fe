import { goto } from "$app/navigation";
import type { PanelTab } from "$lib/store/slices/panel-layout/panel-layout-types";
import { selectFocusedPanelId, selectPanels, selectAllTabs, selectPanel, selectActiveTabInPanel } from "$lib/store/slices/panel-layout/panel-layout-selectors";
import { openTab, openTabInAdjacentOrSplit, closeActiveTab, reopenClosedTab, setActiveTab, focusPanel, selectPreviousTab, selectNextTab, updateTabBrowserUrl } from "$lib/store/slices/panel-layout/panel-layout-slice";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import { getFileExtension, track } from "$lib/services/analytics";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { isFocusInTerminal } from "$lib/utils/keyboardShortcuts";
import { watchDockNavigationForWorkspaceSaga } from "./dock-navigation-saga";
import { specPanelSaga } from "./spec-panel-saga";
import { getSettingsPreviousPath, navigateToSettings } from "$lib/utils/workspace-navigation";
import type { Task } from "redux-saga";
import { cancel, call, delay, fork, put, select, takeEvery } from "typed-redux-saga";
import { workspaceMounted, workspaceUnmounted, } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { createAgentRequested } from "../../workspace-agents/workspace-agents-slice";
import { createTerminalRequested } from "../../terminals/terminals-slice";
import { createNoteRequested, markNoteRead, } from "../../note-read-tracking/note-read-tracking-slice";
import { createFileRequested, createWorkspaceForRepoRequested, focusBrowserTabRequested, openAgentTabRequested, openNewSpaceModalRequested, openTerminalTabRequested, requestPanelFocus, showAgentRequested, } from "../app-layout-slice";
import { openWorkspaceChatChanges, openWorkspaceCommitChangeset, openWorkspaceDiff, openWorkspaceFile, openWorkspaceLocalChanges, openWorkspaceNote, } from "../../workspace-navigation/workspace-navigation-slice";
import { notesIpc } from "../../workspace-notes/sagas/notes-ipc";
import { NOTES_CHANNELS } from "$shared/ipc/channels";
import { reloadNotes } from "../../workspace-notes/workspace-notes-slice";
import type { Note } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import { invoke } from "$lib/electron-bridge";
import { selectActiveWorkspace } from "../../workspace/workspace-selectors";
import { selectNoteById } from "../../workspace-notes/workspace-notes-selectors";
import { selectAgentById } from "../../workspace-agents/workspace-agents-selectors";
import { setShowCreateModal } from "../../sidebar-nav/sidebar-nav-slice";
import { browserTabZoomRequested } from "../../browser/browser-slice";
import type { BrowserZoomAction } from "../../browser/browser-types";
import { dispatchWindowEvent } from "$lib/utils/window-events";
const dockNavigationTasks = new Map<string, Task>();
type BrowserOpenTabEvent = {
    url: string;
    position?: "adjacent" | "replace" | "same";
    workspaceId?: string;
};
const FOCUSABLE_TAB_TYPES = new Set<string>(["agent", "note", "file"]);
const PANEL_FOCUS_DELAY_MS = 100;
function* requestFocusedPanelFocus(wsId: string) {
    const focusedId = yield* selectFocusedPanelId.effect(wsId);
    if (!focusedId) {
        return;
    }
    yield* put(requestPanelFocus(wsId, focusedId));
}
function* handleRequestPanelFocus(wsId: string, panelId: string) {
    const activeTab = yield* selectActiveTabInPanel.effect(wsId, panelId);
    yield* delay(PANEL_FOCUS_DELAY_MS);
    if (activeTab && FOCUSABLE_TAB_TYPES.has(activeTab.type)) {
        dispatchWindowEvent("panel:focus-content", {
            panelId,
            tabId: activeTab.id,
            tabType: activeTab.type,
            agentId: activeTab.agentId,
            noteId: activeTab.noteId,
            workspaceId: wsId,
        });
        return;
    }
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }
}
export function* watchRequestPanelFocusSaga() {
    yield* takeEvery(requestPanelFocus.type, function* ({ payload }: ReturnType<typeof requestPanelFocus>) {
        const [wsId, panelId] = payload;
        if (!wsId || !panelId) {
            return;
        }
        yield* handleRequestPanelFocus(wsId, panelId);
    });
}
export function* watchFocusBrowserTabSaga() {
    yield* takeEvery(focusBrowserTabRequested.type, function* ({ payload }: ReturnType<typeof focusBrowserTabRequested>) {
        const [wsId, tabId] = payload;
        if (!wsId || !tabId) {
            return;
        }
        const panels = yield* selectPanels.effect(wsId);
        for (const [panelId, panel] of Object.entries(panels)) {
            const tab = panel.tabs.find((t) => t.id === tabId);
            if (tab) {
                yield* put(focusPanel(wsId, panelId));
                yield* put(setActiveTab(wsId, tabId, panelId));
                return;
            }
        }
    });
}
function* openWorkspaceTab(wsId: string, tab: Omit<PanelTab, "id">, openInAdjacentPanel = false, sourcePanelId?: string) {
    const store = getReduxStore();
    if (openInAdjacentPanel) {
        store.dispatch(openTabInAdjacentOrSplit(wsId, tab, sourcePanelId, { force: true }));
        yield* requestFocusedPanelFocus(wsId);
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
export function* watchShowAgentSaga() {
    yield* takeEvery(showAgentRequested.type, function* ({ payload }: ReturnType<typeof showAgentRequested>) {
        const [wsId, detail] = payload;
        if (!wsId || !detail?.agentId) {
            return;
        }
        showAgentInLayout(wsId, detail.agentId);
    });
}
export function* watchOpenFileSaga() {
    yield* takeEvery(openWorkspaceFile.type, function* ({ payload }: ReturnType<typeof openWorkspaceFile>) {
        const [wsId, filePath, options] = payload;
        if (!wsId || !filePath) {
            return;
        }
        yield* openWorkspaceTab(wsId, {
            type: "file",
            title: filePath.split("/").pop() || "File",
            filePath,
            closable: true,
            data: options?.line ? { line: options.line, jumpTimestamp: Date.now() } : undefined,
        }, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
        track("Opened File", {
            workspace_id: wsId,
            file_extension: getFileExtension(filePath),
        });
    });
}
export function* watchOpenDiffSaga() {
    yield* takeEvery(openWorkspaceDiff.type, function* ({ payload }: ReturnType<typeof openWorkspaceDiff>) {
        const [wsId, change, options] = payload;
        const filePath = options?.filePath || change?.file || change?.relativePath;
        if (!wsId || !filePath) {
            return;
        }
        yield* openWorkspaceTab(wsId, {
            type: "diff",
            title: filePath.split("/").pop() || "Diff",
            diffPath: filePath,
            closable: true,
            data: {
                change,
                branchBaseRef: options?.branchBaseRef,
                branchBaseCommitSha: options?.branchBaseCommitSha,
            },
        }, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
    });
}
export function* watchOpenCommitChangesetSaga() {
    yield* takeEvery(openWorkspaceCommitChangeset.type, function* ({ payload }: ReturnType<typeof openWorkspaceCommitChangeset>) {
        const [wsId, commitHash, commitMessage, options] = payload;
        if (!wsId || !commitHash) {
            return;
        }
        const shortHash = commitHash.substring(0, 7);
        const title = commitMessage
            ? `${shortHash}: ${commitMessage.substring(0, 20)}${commitMessage.length > 20 ? "..." : ""}`
            : `Commit ${shortHash}`;
        yield* openWorkspaceTab(wsId, {
            type: "changes",
            title,
            closable: true,
            data: {
                commitHash,
                commitMessage,
            },
        }, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
    });
}
export function* watchOpenChatChangesSaga() {
    yield* takeEvery(openWorkspaceChatChanges.type, function* ({ payload }: ReturnType<typeof openWorkspaceChatChanges>) {
        const [wsId, changes, title, options] = payload;
        if (!wsId || !changes) {
            return;
        }
        yield* openWorkspaceTab(wsId, {
            type: "chat-changes",
            title,
            closable: true,
            data: {
                changes,
                title,
                messageId: options?.messageId,
                isAggregate: options?.isAggregate,
                agentId: options?.agentId,
                turnNumber: options?.turnNumber,
            },
        });
    });
}
export function* watchOpenLocalChangesSaga() {
    yield* takeEvery(openWorkspaceLocalChanges.type, function* ({ payload }: ReturnType<typeof openWorkspaceLocalChanges>) {
        const [wsId] = payload;
        if (!wsId) {
            return;
        }
        yield* openWorkspaceTab(wsId, {
            type: "local-changes",
            title: "All changes",
            closable: true,
        });
    });
}
export function* watchOpenNoteSaga() {
    yield* takeEvery(openWorkspaceNote.type, function* ({ payload }: ReturnType<typeof openWorkspaceNote>) {
        const [wsId, noteId, options] = payload;
        if (!wsId || !noteId) {
            return;
        }
        let openInAdjacentPanel = options?.openInAdjacentPanel ?? false;
        if (!openInAdjacentPanel && options?.sourcePanelId) {
            const sourcePanel = yield* selectPanel.effect(wsId, options.sourcePanelId);
            const activeTab = sourcePanel?.tabs.find((tab) => tab.id === sourcePanel.activeTabId);
            if (activeTab?.type === "agent") {
                openInAdjacentPanel = true;
            }
        }
        const note = yield* selectNoteById.effect(wsId, noteId);
        yield* openWorkspaceTab(wsId, {
            type: "note",
            title: note?.title || noteId,
            noteId,
            closable: true,
        }, openInAdjacentPanel, options?.sourcePanelId);
    });
}
export function* watchOpenAgentSaga() {
    yield* takeEvery(openAgentTabRequested.type, function* ({ payload }: ReturnType<typeof openAgentTabRequested>) {
        const [wsId, detail] = payload;
        if (!wsId || !detail?.agentId) {
            return;
        }
        const agent = yield* selectAgentById.effect(detail.agentId);
        yield* openWorkspaceTab(wsId, {
            type: "agent",
            title: agent?.name || "Agent",
            agentId: detail.agentId,
            closable: true,
        }, detail.openInAdjacentPanel ?? false, detail.sourcePanelId);
    });
}
export function* watchOpenTerminalSaga() {
    yield* takeEvery(openTerminalTabRequested.type, function* ({ payload }: ReturnType<typeof openTerminalTabRequested>) {
        const [wsId, detail] = payload;
        if (!wsId || !detail?.terminalId) {
            return;
        }
        getReduxStore().dispatch(openTab(wsId, {
            type: "terminal",
            title: "Terminal",
            terminalId: detail.terminalId,
            closable: true,
        }));
    });
}
export function* watchWorkspaceWindowEventsSaga() {
    yield* fork(watchShowAgentSaga);
    yield* fork(watchOpenFileSaga);
    yield* fork(watchOpenDiffSaga);
    yield* fork(watchOpenCommitChangesetSaga);
    yield* fork(watchOpenChatChangesSaga);
    yield* fork(watchOpenLocalChangesSaga);
    yield* fork(watchOpenNoteSaga);
    yield* fork(watchOpenAgentSaga);
    yield* fork(watchOpenTerminalSaga);
}
function* startDockNavigationForWorkspaceSaga(action: ReturnType<typeof workspaceMounted>) {
    const [wsId] = action.payload;
    const task = yield* fork(watchDockNavigationForWorkspaceSaga, wsId);
    dockNavigationTasks.set(wsId, task);
}
function* cancelDockNavigationForWorkspaceSaga(action: ReturnType<typeof workspaceUnmounted>) {
    const [wsId] = action.payload;
    const task = dockNavigationTasks.get(wsId);
    if (!task) {
        return;
    }
    yield* cancel(task);
    dockNavigationTasks.delete(wsId);
}
export function* watchWorkspaceWindowEventLifecyclesSaga() {
    yield* takeEvery(workspaceMounted, startDockNavigationForWorkspaceSaga);
    yield* takeEvery(workspaceUnmounted, cancelDockNavigationForWorkspaceSaga);
}
export function* watchNavigateSaga() {
    yield* takeEveryFromElectronChannel<string>("navigate", function* (path) {
        if (path === "/?create=true" || path === "/workspace/new") {
            yield* put(setShowCreateModal(true));
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
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        const wsId = currentWorkspace?.id;
        if (!wsId) {
            return;
        }
        if (focusInTerminal) {
            dispatchWindowEvent("workspace:new-terminal", { workspaceId: wsId });
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
function* dispatchBrowserTabZoom(action: BrowserZoomAction) {
    const currentWorkspace = yield* selectActiveWorkspace.effect();
    const wsId = currentWorkspace?.id;
    if (!wsId) {
        return;
    }
    const focusedPanelId = yield* selectFocusedPanelId.effect(wsId);
    if (!focusedPanelId) {
        return;
    }
    const activeTab = yield* selectActiveTabInPanel.effect(wsId, focusedPanelId);
    if (!activeTab || activeTab.type !== "browser") {
        return;
    }
    yield* put(browserTabZoomRequested(wsId, activeTab.id, action));
}
export function* watchMenuZoomInSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:zoom-in", function* () {
        yield* dispatchBrowserTabZoom("in");
    });
}
export function* watchMenuZoomOutSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:zoom-out", function* () {
        yield* dispatchBrowserTabZoom("out");
    });
}
export function* watchMenuResetZoomSaga() {
    yield* takeEveryFromElectronChannel<null>("menu:reset-zoom", function* () {
        yield* dispatchBrowserTabZoom("reset");
    });
}
export function* watchWorkspaceCreateForRepoSaga() {
    yield* takeEvery(createWorkspaceForRepoRequested.type, function* ({ payload }: ReturnType<typeof createWorkspaceForRepoRequested>) {
        const [data] = payload;
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        if (data.repositoryPath) {
            sessionStorage.setItem("workspace-prefill", JSON.stringify({
                repoPath: data.repositoryPath,
                environmentType: currentWorkspace?.environmentConfig?.type,
                sshConfig: currentWorkspace?.environmentConfig?.ssh,
                previousWorkspaceId: data.workspaceId,
                previousWorkspaceTitle: data.workspaceTitle,
            }));
        }
        yield* put(setShowCreateModal(true));
    });
}
export function* watchOpenNewSpaceOnboardingSaga() {
    yield* takeEvery(openNewSpaceModalRequested.type, function* ({ payload }: ReturnType<typeof openNewSpaceModalRequested>) {
        const [data] = payload;
        if (data.initialRepo?.repoPath) {
            sessionStorage.setItem("workspace-prefill", JSON.stringify({ repoPath: data.initialRepo.repoPath }));
        }
        yield* put(setShowCreateModal(true));
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
            dispatchWindowEvent("file:changed", {
                workspaceId: wsId,
                type: "create",
                filePath: newFilePath,
            });
            // Open the newly created file
            yield* put(openWorkspaceFile(wsId, newFilePath));
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
    yield* fork(watchOpenNewSpaceOnboardingSaga);
    yield* fork(watchWorkspaceWindowEventsSaga);
    yield* fork(watchWorkspaceWindowEventLifecyclesSaga);
    yield* fork(specPanelSaga);
    yield* fork(watchCreateNoteRequestedSaga);
    yield* fork(watchCreateFileRequestedSaga);
    yield* fork(watchRequestPanelFocusSaga);
    yield* fork(watchFocusBrowserTabSaga);
}
