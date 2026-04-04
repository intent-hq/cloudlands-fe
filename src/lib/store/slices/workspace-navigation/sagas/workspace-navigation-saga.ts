import type { Task } from "redux-saga";
import { cancel, call, fork, put, select, takeEvery } from "typed-redux-saga";
import type { ReviewStatus } from "$lib/components/code-review/types";
import { takeEveryFromWindowEvent } from "$lib/store/utils/ipc-channel";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import type { WorkspaceEvent } from "$features/events/types";
import type { TrackedChange } from "$features/file-tracking/types";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../../workspace/workspace-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { selectWorkspaceNavigationState } from "../workspace-navigation-selectors";
import {
  createWorkspaceNavigationState,
  hydrateWorkspaceNavigation,
  openWorkspaceAcceptChanges,
  openWorkspaceActivityChanges,
  openWorkspaceAgentTurnChanges,
  openWorkspaceBrowser,
  openWorkspaceChangeSet,
  openWorkspaceChatChanges,
  openWorkspaceCodeReview,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
  type JsonValue,
  type WorkspaceNavigationAgentTurn,
  type WorkspaceNavigationWorkspaceState,
  updateWorkspaceCodeReview,
  workspaceNavigationStorageKey,
} from "../workspace-navigation-slice";
import { panelContextSaga } from "./panel-context-saga";

const workspaceNavigationTasks = new Map<string, Task[]>();
const workspaceNavigationCache = new Map<string, WorkspaceNavigationWorkspaceState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "complete" ||
    value === "error" ||
    value === "stale"
  );
}

function normalizePersistedWorkspaceNavigationState(
  value: unknown,
  wsId: string
): WorkspaceNavigationWorkspaceState {
  const fallback = createWorkspaceNavigationState(wsId);
  if (!isRecord(value)) return fallback;

  const workspace = isRecord(value.workspace) ? value.workspace : undefined;
  const mainPanel = isRecord(value.mainPanel) ? value.mainPanel : undefined;
  const drawer = isRecord(value.drawer) ? value.drawer : undefined;
  const navigation = isRecord(value.navigation) ? value.navigation : undefined;
  const ui = isRecord(value.ui) ? value.ui : undefined;
  const history = Array.isArray(navigation?.history)
    ? navigation.history.filter(isRecord).map((entry) => ({
        ...entry,
        type: isString(entry.type) ? entry.type : "note",
        id: isString(entry.id) ? entry.id : undefined,
        label: isString(entry.label) ? entry.label : undefined,
        timestamp: isNumber(entry.timestamp) ? entry.timestamp : undefined,
        scrollPosition: isNumber(entry.scrollPosition) ? entry.scrollPosition : undefined,
      }))
    : fallback.navigation.history;

  return {
    version: isNumber(value.version) ? value.version : fallback.version,
    workspace: {
      id: isString(workspace?.id) ? workspace.id : wsId,
      status:
        workspace?.status === "ready" ||
        workspace?.status === "error" ||
        workspace?.status === "creating"
          ? workspace.status
          : fallback.workspace.status,
    },
    mainPanel: {
      type: isString(mainPanel?.type) ? (mainPanel.type as WorkspaceNavigationWorkspaceState["mainPanel"]["type"]) : fallback.mainPanel.type,
      selectedFile: isString(mainPanel?.selectedFile) ? mainPanel.selectedFile : undefined,
      selectedNoteId: isString(mainPanel?.selectedNoteId) ? mainPanel.selectedNoteId : fallback.mainPanel.selectedNoteId,
      selectedChangeId: isString(mainPanel?.selectedChangeId) ? mainPanel.selectedChangeId : undefined,
      selectedBrowserUrl: isString(mainPanel?.selectedBrowserUrl) ? mainPanel.selectedBrowserUrl : undefined,
      selectedTrackedChange: isRecord(mainPanel?.selectedTrackedChange)
        ? (mainPanel.selectedTrackedChange as unknown as TrackedChange)
        : undefined,
      selectedActivityEvent: isRecord(mainPanel?.selectedActivityEvent)
        ? (mainPanel.selectedActivityEvent as unknown as WorkspaceEvent)
        : undefined,
      selectedAgentTurn: isRecord(mainPanel?.selectedAgentTurn)
        ? (mainPanel.selectedAgentTurn as WorkspaceNavigationAgentTurn)
        : undefined,
      selectedCommit: isRecord(mainPanel?.selectedCommit)
        ? (mainPanel.selectedCommit as { hash: string; message?: string })
        : undefined,
      selectedSourceId: isString(mainPanel?.selectedSourceId) ? mainPanel.selectedSourceId : undefined,
      chatChanges: Array.isArray(mainPanel?.chatChanges)
        ? (mainPanel.chatChanges as JsonValue[])
        : undefined,
      chatChangesTitle: isString(mainPanel?.chatChangesTitle) ? mainPanel.chatChangesTitle : undefined,
      chatChangesMessageId: isString(mainPanel?.chatChangesMessageId)
        ? mainPanel.chatChangesMessageId
        : undefined,
      chatChangesAgentId: isString(mainPanel?.chatChangesAgentId)
        ? mainPanel.chatChangesAgentId
        : undefined,
      chatChangesTurnNumber: isNumber(mainPanel?.chatChangesTurnNumber)
        ? mainPanel.chatChangesTurnNumber
        : undefined,
      chatChangesIsAggregate: isBoolean(mainPanel?.chatChangesIsAggregate)
        ? mainPanel.chatChangesIsAggregate
        : undefined,
      scrollToLine: isNumber(mainPanel?.scrollToLine) ? mainPanel.scrollToLine : undefined,
      commitHash: isString(mainPanel?.commitHash) ? mainPanel.commitHash : undefined,
      commitMessage: isString(mainPanel?.commitMessage) ? mainPanel.commitMessage : undefined,
      result:
        mainPanel?.result === null || isString(mainPanel?.result) ? (mainPanel.result as string | null) : undefined,
      agentId:
        mainPanel?.agentId === null || isString(mainPanel?.agentId)
          ? (mainPanel.agentId as string | null)
          : undefined,
      stagedFiles: Array.isArray(mainPanel?.stagedFiles)
        ? mainPanel.stagedFiles.filter(isString)
        : undefined,
      status: isReviewStatus(mainPanel?.status) ? mainPanel.status : undefined,
      streamingText: isString(mainPanel?.streamingText) ? mainPanel.streamingText : undefined,
      error: isString(mainPanel?.error) ? mainPanel.error : undefined,
    },
    drawer: {
      open: isBoolean(drawer?.open) ? drawer.open : fallback.drawer.open,
      type:
        drawer?.type === "agent" || drawer?.type === "terminal" || drawer?.type === "overview"
          ? drawer.type
          : fallback.drawer.type,
      itemId: drawer?.itemId === null || isString(drawer?.itemId) ? (drawer.itemId as string | null) : null,
    },
    navigation: {
      history: history as WorkspaceNavigationWorkspaceState["navigation"]["history"],
      currentIndex: isNumber(navigation?.currentIndex)
        ? Math.max(-1, Math.min(navigation.currentIndex, history.length - 1))
        : history.length - 1,
    },
    ui: {
      hasInitialized: isBoolean(ui?.hasInitialized) ? ui.hasInitialized : fallback.ui.hasInitialized,
      jumpToLine: isNumber(ui?.jumpToLine) ? ui.jumpToLine : undefined,
    },
  };
}

function workspaceMatches(detail: unknown, wsId: string): boolean {
  if (!isRecord(detail) || !isString(detail.workspaceId)) return true;
  return detail.workspaceId === wsId;
}

function stripWorkspaceFilePath(filePath: string): string {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

export function* hydrateWorkspaceNavigationStateSaga(wsId: string) {
  const cachedState = workspaceNavigationCache.get(wsId);
  if (cachedState) {
    yield* put(hydrateWorkspaceNavigation(wsId, cachedState));
    return;
  }

  const storedState = yield* getLocalStorageJSON<unknown>(workspaceNavigationStorageKey(wsId));
  const normalizedState = normalizePersistedWorkspaceNavigationState(storedState, wsId);
  workspaceNavigationCache.set(wsId, normalizedState);
  yield* put(hydrateWorkspaceNavigation(wsId, normalizedState));
}

export function* watchWorkspaceNavigationForWorkspaceSaga({ payload: [wsId] }: ReturnType<typeof workspaceMounted>) {
  yield* call(hydrateWorkspaceNavigationStateSaga, wsId);

  const tasks = [
    yield* fork(watchOpenAcceptChangesSaga, wsId),
    yield* fork(watchOpenFileSaga, wsId),
    yield* fork(watchOpenNoteSaga, wsId),
    yield* fork(watchOpenBrowserSaga, wsId),
    yield* fork(watchOpenDiffSaga, wsId),
    yield* fork(watchOpenCommitSaga, wsId),
    yield* fork(watchNavigateToChangesSaga, wsId),
    yield* fork(watchOpenChatChangesSaga, wsId),
    yield* fork(watchOpenLocalChangesSaga, wsId),
    yield* fork(watchOpenCommitChangesetSaga, wsId),
    yield* fork(watchOpenCodeReviewSaga, wsId),
    yield* fork(watchCodeReviewUpdateSaga, wsId),
  ];

  workspaceNavigationTasks.set(wsId, tasks);
}

export function* cancelWorkspaceNavigationForWorkspaceSaga({
  payload: [wsId],
}: ReturnType<typeof workspaceUnmounted>) {
  for (const task of workspaceNavigationTasks.get(wsId) ?? []) {
    yield* cancel(task);
  }

  workspaceNavigationTasks.delete(wsId);
  workspaceNavigationCache.delete(wsId);
}

export function* cleanupDeletedWorkspaceCacheSaga({
  payload: [wsId],
}: ReturnType<typeof removeWorkspaceEntity>) {
  workspaceNavigationCache.delete(wsId);
}

export function* watchWorkspaceNavigationLifecycleSaga() {
  yield* takeEvery(workspaceMounted, watchWorkspaceNavigationForWorkspaceSaga);
  yield* takeEvery(workspaceUnmounted, cancelWorkspaceNavigationForWorkspaceSaga);
  yield* takeEvery(removeWorkspaceEntity, cleanupDeletedWorkspaceCacheSaga);
}

/**
 * Guard against early `workspaceMounted` dispatch.
 *
 * If `workspaceMounted` fires before the saga registers its `takeEvery`,
 * workspace navigation handlers never start. This saga checks once at startup
 * whether a workspace is already active but has no handlers forked yet,
 * and replays the mount if so.
 */
/** @internal Exported for testing only. */
export function* retroactiveNavigationMountCheckSaga() {
  const activeWsId = yield* select(selectActiveWorkspaceId.select);

  if (!activeWsId) {
    return;
  }

  // Skip invalid workspace IDs
  if (!activeWsId || activeWsId === "new" || activeWsId.startsWith("optimistic-") || activeWsId === "undefined") {
    return;
  }

  // If the normal takeEvery already processed the mount, tasks will exist.
  if (workspaceNavigationTasks.has(activeWsId)) {
    return;
  }

  // The workspace was mounted before the saga started — replay.
  yield* fork(watchWorkspaceNavigationForWorkspaceSaga, workspaceMounted(activeWsId));
}

type PersistableAction = { payload?: [wsId: string, ...rest: unknown[]] };

export function* persistWorkspaceNavigationSaga(action: PersistableAction) {
  const [wsId] = action.payload ?? [];
  if (!wsId) return;

  const workspaceState = yield* selectWorkspaceNavigationState.effect(wsId);
  workspaceNavigationCache.set(wsId, workspaceState);
  yield* setLocalStorageJSON(workspaceNavigationStorageKey(wsId), workspaceState);
}

export function* watchWorkspaceNavigationPersistenceSaga() {
  yield* takeEvery(hydrateWorkspaceNavigation, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceAcceptChanges, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceActivityChanges, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceAgentTurnChanges, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceBrowser, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceChangeSet, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceChatChanges, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceCodeReview, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceCommitChangeset, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceDiff, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceFile, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceLocalChanges, persistWorkspaceNavigationSaga);
  yield* takeEvery(openWorkspaceNote, persistWorkspaceNavigationSaga);
  yield* takeEvery(updateWorkspaceCodeReview, persistWorkspaceNavigationSaga);
}

export function* watchOpenAcceptChangesSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-accept-changes",
    function* (detail: unknown) {
      if (!workspaceMatches(detail, wsId)) return;
      yield* put(openWorkspaceAcceptChanges(wsId));
    },
    { capture: true }
  );
}

export function* watchOpenFileSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-file",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId)) return;

      const rawPath = isString(detail.path) ? detail.path : isString(detail.filePath) ? detail.filePath : undefined;
      if (!rawPath || detail.openInAdjacentPanel === true) return;

      yield* put(
        openWorkspaceFile(wsId, stripWorkspaceFilePath(rawPath), {
          line: isNumber(detail.line) ? detail.line : undefined,
        })
      );
    },
    { capture: true }
  );
}

export function* watchOpenNoteSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-note",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId)) return;
      if (!isString(detail.noteId) || detail.openInAdjacentPanel === true) return;
      yield* put(openWorkspaceNote(wsId, detail.noteId));
    },
    { capture: true }
  );
}

export function* watchOpenBrowserSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-browser-url",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId) || !isString(detail.url)) return;
      yield* put(openWorkspaceBrowser(wsId, detail.url));
    },
    { capture: true }
  );
}

export function* watchOpenDiffSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-diff",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId) || !isRecord(detail.change)) return;

      yield* put(
        openWorkspaceDiff(wsId, detail.change as unknown as TrackedChange, {
          changeId: isString(detail.changeId) ? detail.changeId : undefined,
          filePath: isString(detail.filePath) ? detail.filePath : undefined,
          scrollToLine: isNumber(detail.scrollToLine) ? detail.scrollToLine : undefined,
          forceUpdate: detail.forceUpdate === true,
        })
      );
    },
    { capture: true }
  );
}

export function* watchOpenCommitSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-commit",
    function* (detail: unknown) {
      if (!workspaceMatches(detail, wsId)) return;
      yield* put(openWorkspaceChangeSet(wsId));
    },
    { capture: true }
  );
}

export function* watchNavigateToChangesSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:navigate-to-changes",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId) || !isString(detail.type)) return;

      if (detail.type === "agent-turn-changes" && isString(detail.agentId)) {
        yield* put(
          openWorkspaceAgentTurnChanges(wsId, {
            agentId: detail.agentId,
            sessionId: isString(detail.sessionId) ? detail.sessionId : undefined,
            turnNumber: isNumber(detail.turnNumber) ? detail.turnNumber : undefined,
          })
        );
      }

      if (detail.type === "activity-changes" && isRecord(detail.event)) {
        yield* put(openWorkspaceActivityChanges(wsId, detail.event as unknown as WorkspaceEvent));
      }
    },
    { capture: true }
  );
}

export function* watchOpenChatChangesSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-chat-changes",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId) || !Array.isArray(detail.changes)) return;
      if (!isString(detail.title)) return;

      yield* put(
        openWorkspaceChatChanges(wsId, detail.changes as JsonValue[], detail.title, {
          messageId: isString(detail.messageId) ? detail.messageId : undefined,
          isAggregate: detail.isAggregate === true,
          agentId: isString(detail.agentId) ? detail.agentId : undefined,
          turnNumber: isNumber(detail.turnNumber) ? detail.turnNumber : undefined,
        })
      );
    },
    { capture: true }
  );
}

export function* watchOpenLocalChangesSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-local-changes",
    function* (detail: unknown) {
      if (!workspaceMatches(detail, wsId)) return;
      yield* put(openWorkspaceLocalChanges(wsId));
    },
    { capture: true }
  );
}

export function* watchOpenCommitChangesetSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-commit-changeset",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId)) return;
      yield* put(
        openWorkspaceCommitChangeset(
          wsId,
          isString(detail.commitHash) ? detail.commitHash : undefined,
          isString(detail.commitMessage) ? detail.commitMessage : undefined
        )
      );
    },
    { capture: true }
  );
}

export function* watchOpenCodeReviewSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:open-code-review",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId)) return;
      yield* put(
        openWorkspaceCodeReview(wsId, {
          result:
            detail.result === null || isString(detail.result) ? (detail.result as string | null) : undefined,
          agentId:
            detail.agentId === null || isString(detail.agentId)
              ? (detail.agentId as string | null)
              : undefined,
          stagedFiles: Array.isArray(detail.stagedFiles) ? detail.stagedFiles.filter(isString) : undefined,
          status: isReviewStatus(detail.status) ? detail.status : "running",
          streamingText: isString(detail.streamingText) ? detail.streamingText : undefined,
          error: isString(detail.error) ? detail.error : undefined,
        })
      );
    },
    { capture: true }
  );
}

export function* watchCodeReviewUpdateSaga(wsId: string) {
  yield* takeEveryFromWindowEvent(
    "workspace:code-review-update",
    function* (detail: unknown) {
      if (!isRecord(detail) || !workspaceMatches(detail, wsId)) return;
      yield* put(
        updateWorkspaceCodeReview(wsId, {
          result:
            detail.result === null || isString(detail.result) ? (detail.result as string | null) : undefined,
          agentId:
            detail.agentId === null || isString(detail.agentId)
              ? (detail.agentId as string | null)
              : undefined,
          stagedFiles: Array.isArray(detail.stagedFiles) ? detail.stagedFiles.filter(isString) : undefined,
          status: isReviewStatus(detail.status) ? detail.status : undefined,
          streamingText: isString(detail.streamingText) ? detail.streamingText : undefined,
          error: isString(detail.error) ? detail.error : undefined,
        })
      );
    },
    { capture: true }
  );
}

export function* workspaceNavigationSaga() {
  yield* fork(watchWorkspaceNavigationLifecycleSaga);
  yield* fork(retroactiveNavigationMountCheckSaga);
  yield* fork(watchWorkspaceNavigationPersistenceSaga);
  yield* fork(panelContextSaga);
}
