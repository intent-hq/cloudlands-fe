import {
  selectPanels,
  selectRestoreStatus,
} from "$lib/store/slices/panel-layout/panel-layout-selectors";
import type { PanelLayoutRestoreStatus } from "$lib/store/slices/panel-layout/panel-layout-types";
import {
  openTabInAdjacentOrSplit,
  setDeferSpecTab,
  setRestoreStatus,
} from "$lib/store/slices/panel-layout/panel-layout-slice";
import { selectSpec } from "$lib/store/slices/workspace-notes/workspace-notes-selectors";
import {
  selectIsInitialSpecWriteInProgress,
  selectInitialAgentConfig,
} from "../../workspace-agents/workspace-agents-selectors";
import { SPEC_NOTE_ID } from "$shared/constants/notes";
import type { Task } from "redux-saga";
import {
  cancel,
  call,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
} from "typed-redux-saga";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { clearInitialAgentConfig } from "../../workspace-agents/workspace-agents-slice";

const specPanelTasks = new Map<string, Task[]>();
const RESTORE_STATUS_TIMEOUT_MS = 500;
const RESTORE_STATUS_POLL_INTERVAL_MS = 50;
// Track workspaces where the spec slide-in has already completed.
// Once the spec has been opened (animated or not), we must NOT defer again
// on subsequent navigations back to this workspace within the same session.
const specSlideInCompleted = new Set<string>();
/**
 * Check whether the spec panel should be deferred for this workspace.
 * Returns true when an initial spec-writer agent exists — the spec panel
 * will slide in reactively once spec generation actually starts.
 *
 * Generator: reads Redux state via `yield* selector.effect(...)` so saga-context
 * code never calls `selector.select(configuredStore.state, …)`.
 */
export function* shouldDeferSpecPanel(wsId: string) {
    if (specSlideInCompleted.has(wsId)) {
        return false;
    }
    const isInitialSpecWriteInProgress = yield* selectIsInitialSpecWriteInProgress.effect(wsId);
    if (isInitialSpecWriteInProgress) {
        return true;
    }
    // Check Redux first (primary source)
    const reduxConfig = yield* selectInitialAgentConfig.effect(wsId);
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
function* cleanupDeferralKeys(wsId: string) {
    yield* put(clearInitialAgentConfig(wsId));
    sessionStorage.removeItem(`workspace:${wsId}:agent-config`);
    sessionStorage.removeItem(`workspace:${wsId}:initial-agent-pending`);
    specSlideInCompleted.add(wsId);
}
function* isSpecAlreadyOpen(wsId: string) {
    const panels = yield* selectPanels.effect(wsId);
    const allTabs = Object.values(panels).flatMap((p) => p.tabs);
    return allTabs.some((t) => t.type === "note" && t.noteId === SPEC_NOTE_ID);
}
function* getSpecContent(wsId?: string) {
    // Try to find spec for a specific workspace, or scan all workspaces
    if (wsId) {
        const specNote = yield* selectSpec.effect(wsId);
        return specNote?.content?.trim() || "";
    }
    return "";
}
function* waitForRestoreStatusToSettle(wsId: string): Generator<any, PanelLayoutRestoreStatus, any> {
    // First check if status already settled (e.g., if handleWorkspaceMountedRestore ran first)
    let restoreStatus: PanelLayoutRestoreStatus = yield* selectRestoreStatus.effect(wsId);

    // Always wait for at least one setRestoreStatus action for THIS workspace,
    // with a timeout. This guarantees we see the real dispatch from
    // handleWorkspaceMountedRestore, regardless of saga execution order.
    const startTime = Date.now();

    while (Date.now() - startTime < RESTORE_STATUS_TIMEOUT_MS) {
        // Wait for the next setRestoreStatus action matching our workspace
        yield* race({
            action: take((action: any) =>
                action.type === setRestoreStatus.type &&
                action.payload[0] === wsId
            ),
            timeout: delay(RESTORE_STATUS_POLL_INTERVAL_MS),
        });

        restoreStatus = yield* selectRestoreStatus.effect(wsId);

        // Terminal states: "restored", "empty", "invalid"
        if (restoreStatus !== "idle" && restoreStatus !== "pending") {
            return restoreStatus;
        }
    }

    // Timed out — return whatever we have
    return restoreStatus;
}
function* slideInSpecPanel(wsId: string) {
    if (yield* isSpecAlreadyOpen(wsId)) {
        yield* cleanupDeferralKeys(wsId);
        return;
    }
    yield* put(setDeferSpecTab(wsId, false));
    yield* put(openTabInAdjacentOrSplit(wsId, { type: "note", title: "Spec", noteId: SPEC_NOTE_ID, closable: true }));
    yield* cleanupDeferralKeys(wsId);
}
function* openSpecNormally(wsId: string, isDeferring: boolean) {
    if (yield* isSpecAlreadyOpen(wsId)) {
        if (isDeferring) {
            yield* put(setDeferSpecTab(wsId, false));
        }
        yield* cleanupDeferralKeys(wsId);
        return;
    }
    if (isDeferring)
        yield* put(setDeferSpecTab(wsId, false));
    yield* put(openTabInAdjacentOrSplit(wsId, { type: "note", title: "Spec", noteId: SPEC_NOTE_ID, closable: true }, undefined));
    yield* cleanupDeferralKeys(wsId);
}
/**
 * Core spec-panel watcher for a single workspace.
 * Polls for spec content and opens the spec panel when content appears.
 * Replaces the previous complex multi-stage race approach which had timing
 * issues that caused the race to resolve before content arrived.
 */
export function* watchSpecPanelForWorkspace(wsId: string) {
    if (typeof window === "undefined")
        return;
    const MAX_WAIT_MS = 90_000;
    const POLL_INTERVAL_MS = 2_000;
    try {
        const startTime = Date.now();
        while (Date.now() - startTime < MAX_WAIT_MS) {
            const content: string = yield* call(getSpecContent, wsId);
            if (content && content.length > 0) {
                yield* call(slideInSpecPanel, wsId);
                return;
            }
            yield* delay(POLL_INTERVAL_MS);
        }
        // Timed out — check one final time in case content appeared during last interval
        const finalContent: string = yield* call(getSpecContent, wsId);
        if (finalContent && finalContent.length > 0) {
            yield* call(slideInSpecPanel, wsId);
        }
    }
    finally {
        // Safety: always clear deferSpecTab on any exit (success, crash, cancellation)
        yield* put(setDeferSpecTab(wsId, false));
        yield* cleanupDeferralKeys(wsId);
    }
}
/**
 * Per-workspace lifecycle: set deferral, fork watcher, cancel on unmount.
 */
export function* specPanelForWorkspaceSaga(action: ReturnType<typeof workspaceMounted>) {
    const [wsId] = action.payload;
    const restoreStatus: PanelLayoutRestoreStatus = yield* call(waitForRestoreStatusToSettle, wsId);
    const specAlreadyOpen: boolean = yield* call(isSpecAlreadyOpen, wsId);
    if (specAlreadyOpen) {
        yield* put(setDeferSpecTab(wsId, false));
        yield* cleanupDeferralKeys(wsId);
        return;
    }
    if (restoreStatus === "restored") {
        yield* cleanupDeferralKeys(wsId);
        return;
    }
    // Set up deferral if needed (equivalent to the $effect that set deferSpecTab)
    const shouldDefer: boolean = yield* call(shouldDeferSpecPanel, wsId);
    const specContent: string = yield* call(getSpecContent, wsId);
    if (specContent.length > 0) {
        yield* call(openSpecNormally, wsId, shouldDefer);
        return;
    }
    if (shouldDefer) {
        yield* put(setDeferSpecTab(wsId, true));
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
    yield* put(setDeferSpecTab(wsId, false));
}
/**
 * Retroactive mount check: if a workspace was already mounted before this saga
 * started (race condition on startup), replay the mount handler.
 */
/** @internal Exported for testing only. */
export function* retroactiveSpecPanelMountCheckSaga() {
    const activeWsId = yield* selectActiveWorkspaceId.effect();

    if (!activeWsId) {
        return;
    }

    // Skip invalid workspace IDs (empty, "new", "optimistic-*", "undefined")
    if (!activeWsId || activeWsId === "new" || activeWsId.startsWith("optimistic-") || activeWsId === "undefined") {
        return;
    }

    // If the normal takeEvery already processed the mount, tasks will exist.
    if (specPanelTasks.has(activeWsId)) {
        return;
    }

    // The workspace was mounted before the saga started — replay.
    yield* fork(specPanelForWorkspaceSaga, workspaceMounted(activeWsId));
}

/**
 * Root saga: watches for workspace mounts and starts per-workspace spec panel watchers.
 */
export function* specPanelSaga() {
    yield* takeEvery(workspaceMounted, specPanelForWorkspaceSaga);
    yield* takeEvery(workspaceUnmounted, cancelSpecPanelForWorkspaceSaga);

    // Check if a workspace is already active (missed the mount action)
    yield* fork(retroactiveSpecPanelMountCheckSaga);
}
