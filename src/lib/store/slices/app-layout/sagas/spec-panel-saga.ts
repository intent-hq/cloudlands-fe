import { getPanelLayoutManager, hasPanelLayoutManager, } from "$features/layout/panel-layout-manager.svelte";
import { notesStateManager } from "$features/notes/notes.store.svelte";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import { WorkspaceId } from "$shared/types/branded-ids";
import { createListenSyncChannel } from "$lib/store/utils/ipc-channel";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import type { Task } from "redux-saga";
import { cancel, call, delay, fork, race, take, takeEvery } from "typed-redux-saga";
import { workspaceMounted, workspaceUnmounted, } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { clearInitialAgentConfig } from "../../workspace-agents/workspace-agents-slice";
import { selectInitialAgentConfig } from "../../workspace-agents/workspace-agents-selectors";
const specPanelTasks = new Map<string, Task[]>();
// Track workspaces where the spec slide-in has already completed.
// Once the spec has been opened (animated or not), we must NOT defer again
// on subsequent navigations back to this workspace within the same session.
const specSlideInCompleted = new Set<string>();
/**
 * Check whether the spec panel should be deferred for this workspace.
 * Returns true when an initial spec-writer agent exists — the spec panel
 * will slide in reactively once spec generation actually starts.
 */
export function shouldDeferSpecPanel(wsId: string): boolean {
    if (specSlideInCompleted.has(wsId)) {
        return false;
    }
    const brandedId = WorkspaceId(wsId);
    if (unifiedStateStore.getInitialSpecWriteInProgress(brandedId)) {
        return true;
    }
    // Check Redux first (primary source)
    const reduxConfig = selectInitialAgentConfig.select(getReduxStore().getState(), wsId);
    if (reduxConfig) {
        const isSpecWriter = reduxConfig.config.specialist === "spec-writer" ||
            reduxConfig.config.metadata?.specialist === "spec-writer";
        if (isSpecWriter && (reduxConfig.config.isInitialAgent || reduxConfig.config.isFirstWorkspaceAgent)) {
            return true;
        }
    }
    // Fall back to sessionStorage (for page reloads where Redux is empty)
    const agentConfigData = sessionStorage.getItem(`workspace:${wsId}:agent-config`);
    if (agentConfigData) {
        try {
            const config = JSON.parse(agentConfigData);
            const isSpecWriter = config.specialist === "spec-writer" || config.metadata?.specialist === "spec-writer";
            if (isSpecWriter && (config.isInitialAgent || config.isFirstWorkspaceAgent)) {
                return true;
            }
        }
        catch {
            // ignore parse errors
        }
    }
    const pendingAgentData = sessionStorage.getItem(`workspace:${wsId}:initial-agent-pending`);
    if (pendingAgentData) {
        try {
            const parsed = JSON.parse(pendingAgentData);
            const isSpecWriter = parsed.config?.specialist === "spec-writer" ||
                parsed.config?.metadata?.specialist === "spec-writer";
            if (isSpecWriter) {
                return true;
            }
        }
        catch {
            // ignore parse errors
        }
    }
    return false;
}
function cleanupDeferralKeys(wsId: string) {
    getReduxStore().dispatch(clearInitialAgentConfig(wsId));
    sessionStorage.removeItem(`workspace:${wsId}:agent-config`);
    sessionStorage.removeItem(`workspace:${wsId}:initial-agent-pending`);
    specSlideInCompleted.add(wsId);
}
function isSpecAlreadyOpen(wsId: string): boolean {
    if (!hasPanelLayoutManager(wsId))
        return false;
    const layoutManager = getPanelLayoutManager(wsId);
    const allTabs = Object.values(layoutManager.layout.panels).flatMap((p) => p.tabs);
    return allTabs.some((t) => t.type === "note" && t.noteId === SPEC_NOTE_ID);
}
function getSpecContent(): string {
    const specNote = notesStateManager.spec;
    return specNote?.content?.trim() || "";
}
function slideInSpecPanel(wsId: string): void {
    if (isSpecAlreadyOpen(wsId)) {
        cleanupDeferralKeys(wsId);
        return;
    }
    const layoutManager = getPanelLayoutManager(wsId);
    layoutManager.setDeferSpecTab(false);
    layoutManager.openTabInAdjacentOrSplit({ type: "note", title: "Spec", noteId: SPEC_NOTE_ID, closable: true }, undefined, { animated: true });
    cleanupDeferralKeys(wsId);
}
function openSpecNormally(wsId: string, isDeferring: boolean): void {
    if (isSpecAlreadyOpen(wsId)) {
        if (isDeferring) {
            const layoutManager = getPanelLayoutManager(wsId);
            layoutManager.setDeferSpecTab(false);
        }
        cleanupDeferralKeys(wsId);
        return;
    }
    const layoutManager = getPanelLayoutManager(wsId);
    if (isDeferring)
        layoutManager.setDeferSpecTab(false);
    layoutManager.openTabInAdjacentOrSplit({ type: "note", title: "Spec", noteId: SPEC_NOTE_ID, closable: true }, undefined);
    cleanupDeferralKeys(wsId);
}
/**
 * Core spec-panel watcher for a single workspace.
 * Sets up IPC listeners, timer fallbacks, and handles the slide-in / normal open.
 */
export function* watchSpecPanelForWorkspace(wsId: string) {
    if (typeof window === "undefined")
        return;
    if (!hasPanelLayoutManager(wsId))
        return;
    const layoutManager = getPanelLayoutManager(wsId);
    const isDeferring: boolean = layoutManager.isDeferringSpecTab;
    const FALLBACK_TIMER_MS = 8000;
    const SAFETY_TIMER_MS = 90000;
    // Set up the note:updated IPC channel
    const noteUpdatedChannel = createListenSyncChannel<any>("note:updated");
    // Set up the agent:idle IPC channel (only when deferring)
    const agentIdleChannel = isDeferring
        ? createListenSyncChannel<any>("agent:idle")
        : null;
    try {
        // Build the race effects object.
        // The note:updated listener is always active — it's the primary trigger for
        // both new and existing workspaces.
        const raceEffects: Record<string, any> = {
            noteUpdated: call(function* () {
                while (true) {
                    const payload: any = yield* take(noteUpdatedChannel);
                    const noteId = payload.noteId || payload.data?.noteId;
                    const eventWorkspaceId = payload.workspaceId;
                    if (noteId !== "spec" || eventWorkspaceId !== wsId)
                        continue;
                    const eventContent = payload.content ||
                        payload.data?.content ||
                        payload.changes?.content ||
                        payload.metadata?.changes?.content;
                    const specContent = eventContent || getSpecContent();
                    if (specContent.length > 0) {
                        return true;
                    }
                }
            }),
        };
        // Fallback timer only applies when deferring (new workspace with spec-writer).
        // For existing workspaces (isDeferring=false), we rely solely on note:updated
        // events to open the spec — this prevents reopening the spec tab when the user
        // deliberately closed it.
        if (isDeferring) {
            raceEffects.fallbackTimer = delay(FALLBACK_TIMER_MS, true);
            if (agentIdleChannel) {
                raceEffects.agentIdle = call(function* () {
                    while (true) {
                        const payload: any = yield* take(agentIdleChannel);
                        const eventWorkspaceId = payload.workspaceId;
                        if (eventWorkspaceId !== wsId)
                            continue;
                        return true;
                    }
                });
                raceEffects.safetyTimer = delay(SAFETY_TIMER_MS, true);
            }
        }
        // Race between: note:updated event, and (when deferring) agent:idle, fallback timer, safety timer
        const result = (yield* race(raceEffects)) as {
            noteUpdated?: true;
            agentIdle?: true;
            fallbackTimer?: true;
            safetyTimer?: true;
        };
        if (result.fallbackTimer) {
            const specContent = getSpecContent();
            if (specContent.length === 0) {
                const continuedRaceEffects: Record<string, any> = {
                    noteUpdated: raceEffects.noteUpdated,
                };
                if (agentIdleChannel) {
                    continuedRaceEffects.agentIdle = raceEffects.agentIdle;
                    continuedRaceEffects.safetyTimer = delay(SAFETY_TIMER_MS - FALLBACK_TIMER_MS, true);
                }
                const continuedResult = (yield* race(continuedRaceEffects)) as {
                    noteUpdated?: true;
                    agentIdle?: true;
                    safetyTimer?: true;
                };
                if (continuedResult.noteUpdated) {
                    yield* call(slideInSpecPanel, wsId);
                }
                else if (continuedResult.agentIdle) {
                    const continuedSpecContent = getSpecContent();
                    if (continuedSpecContent.length > 0) {
                        yield* call(slideInSpecPanel, wsId);
                    }
                    else {
                        layoutManager.setDeferSpecTab(false);
                        cleanupDeferralKeys(wsId);
                    }
                }
                else if (continuedResult.safetyTimer) {
                    layoutManager.setDeferSpecTab(false);
                    cleanupDeferralKeys(wsId);
                }
                return;
            }
        }
        // Handle outcome
        if (result.noteUpdated) {
            if (isDeferring) {
                yield* call(slideInSpecPanel, wsId);
            }
            else {
                yield* call(openSpecNormally, wsId, isDeferring);
            }
        }
        else if (result.agentIdle) {
            const specContent = getSpecContent();
            if (specContent.length > 0) {
                yield* call(slideInSpecPanel, wsId);
            }
            else {
                layoutManager.setDeferSpecTab(false);
                cleanupDeferralKeys(wsId);
            }
        }
        else if (result.fallbackTimer || result.safetyTimer) {
            // These only fire when isDeferring=true (guarded above)
            const specContent = getSpecContent();
            if (specContent.length === 0) {
                layoutManager.setDeferSpecTab(false);
                cleanupDeferralKeys(wsId);
                return;
            }
            yield* call(openSpecNormally, wsId, isDeferring);
        }
    }
    finally {
        noteUpdatedChannel.close();
        if (agentIdleChannel)
            agentIdleChannel.close();
    }
}
/**
 * Per-workspace lifecycle: set deferral, fork watcher, cancel on unmount.
 */
export function* specPanelForWorkspaceSaga(action: ReturnType<typeof workspaceMounted>) {
    const [wsId] = action.payload;
    // Set up deferral if needed (equivalent to the $effect that set deferSpecTab)
    const shouldDefer: boolean = yield* call(shouldDeferSpecPanel, wsId);
    if (shouldDefer && hasPanelLayoutManager(wsId)) {
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.setDeferSpecTab(true);
    }
    const task = yield* fork(watchSpecPanelForWorkspace, wsId);
    specPanelTasks.set(wsId, [task]);
}
export function* cancelSpecPanelForWorkspaceSaga(action: ReturnType<typeof workspaceUnmounted>) {
    const [wsId] = action.payload;
    const tasks = specPanelTasks.get(wsId);
    if (tasks) {
        for (const task of tasks) {
            yield* cancel(task);
        }
        specPanelTasks.delete(wsId);
    }
    // Clean up: cancel the watcher and clear deferral
    if (hasPanelLayoutManager(wsId)) {
        const layoutManager = getPanelLayoutManager(wsId);
        layoutManager.setDeferSpecTab(false);
    }
}
/**
 * Root saga: watches for workspace mounts and starts per-workspace spec panel watchers.
 */
export function* specPanelSaga() {
    yield* takeEvery(workspaceMounted, specPanelForWorkspaceSaga);
    yield* takeEvery(workspaceUnmounted, cancelSpecPanelForWorkspaceSaga);
}
