import type { Task } from "redux-saga";
import { cancel, call, fork, put, select, takeEvery } from "typed-redux-saga";
import type { ReviewStatus } from "$lib/components/code-review/types";
import { ChangeStage, type DiffHunk, type TrackedChange } from "$features/file-tracking/types";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import type { WorkspaceEvent } from "$features/events/types";
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

function isChangeStage(value: unknown): value is ChangeStage {
  return Object.values(ChangeStage).includes(value as ChangeStage);
}

function isFileChangeStatus(value: unknown): value is NonNullable<TrackedChange["status"]> {
  return (
    value === "added" ||
    value === "modified" ||
    value === "deleted" ||
    value === "renamed"
  );
}

function normalizePersistedTrackedChangeStats(value: unknown): TrackedChange["stats"] {
  const stats = isRecord(value) ? value : undefined;
  const additions = stats?.additions;
  const deletions = stats?.deletions;
  const binary = stats?.binary;

  return {
    additions: isNumber(additions) ? additions : 0,
    deletions: isNumber(deletions) ? deletions : 0,
    ...(isBoolean(binary) ? { binary } : {}),
  };
}

function normalizePersistedTrackedChangeAttribution(value: unknown): TrackedChange["attribution"] {
  if (!isRecord(value)) {
    return { manual: true, timestamp: 0 };
  }

  const agent = isRecord(value.agent)
    ? (value.agent as unknown as NonNullable<TrackedChange["attribution"]["agent"]>)
    : undefined;

  return {
    ...(agent ? { agent } : {}),
    ...(isBoolean(value.manual) ? { manual: value.manual } : {}),
    timestamp: isNumber(value.timestamp) ? value.timestamp : 0,
  };
}

function isDiffLineType(value: unknown): value is DiffHunk["lines"][number]["type"] {
  return value === "add" || value === "remove" || value === "context";
}

function normalizePersistedTrackedChangeContent(value: unknown): TrackedChange["content"] {
  if (!isRecord(value)) return undefined;

  const content = {
    ...(isString(value.oldContent) ? { oldContent: value.oldContent } : {}),
    ...(isString(value.newContent) ? { newContent: value.newContent } : {}),
    ...(isString(value.oldContentSha) ? { oldContentSha: value.oldContentSha } : {}),
    ...(isString(value.newContentSha) ? { newContentSha: value.newContentSha } : {}),
    ...(isString(value.diff) ? { diff: value.diff } : {}),
    ...(isString(value.diffSha) ? { diffSha: value.diffSha } : {}),
    ...(isBoolean(value.isFullFileContent) ? { isFullFileContent: value.isFullFileContent } : {}),
  };

  return Object.keys(content).length > 0 ? content : undefined;
}

function normalizePersistedDiffLine(value: unknown): DiffHunk["lines"][number] | undefined {
  if (!isRecord(value) || !isDiffLineType(value.type) || !isString(value.content)) {
    return undefined;
  }

  return {
    type: value.type,
    content: value.content,
    ...(isNumber(value.oldLineNumber) ? { oldLineNumber: value.oldLineNumber } : {}),
    ...(isNumber(value.newLineNumber) ? { newLineNumber: value.newLineNumber } : {}),
    ...(isBoolean(value.selected) ? { selected: value.selected } : {}),
  };
}

function normalizePersistedDiffHunk(value: unknown): DiffHunk | undefined {
  if (!isRecord(value)) return undefined;

  const lines = Array.isArray(value.lines)
    ? value.lines.map(normalizePersistedDiffLine).filter((line) => line !== undefined)
    : undefined;

  if (
    !isNumber(value.oldStart) ||
    !isNumber(value.oldLines) ||
    !isNumber(value.newStart) ||
    !isNumber(value.newLines) ||
    !lines
  ) {
    return undefined;
  }

  return {
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    lines,
  };
}

function normalizePersistedTrackedChangeHunks(value: unknown): TrackedChange["hunks"] {
  if (!Array.isArray(value)) return undefined;

  const hunks = value.map(normalizePersistedDiffHunk).filter((hunk) => hunk !== undefined);
  return hunks.length > 0 ? hunks : undefined;
}

function normalizePersistedTrackedChange(value: unknown): TrackedChange | undefined {
  if (!isRecord(value)) return undefined;

  const file = isString(value.file)
    ? value.file
    : isString(value.relativePath)
      ? value.relativePath
      : undefined;
  const relativePath = isString(value.relativePath) ? value.relativePath : file;

  if (!isString(value.id) || !file || !relativePath || !isChangeStage(value.stage)) {
    return undefined;
  }

  const content = normalizePersistedTrackedChangeContent(value.content);
  const hunks = normalizePersistedTrackedChangeHunks(value.hunks);

  return {
    id: value.id,
    file,
    relativePath,
    stage: value.stage,
    stats: normalizePersistedTrackedChangeStats(value.stats),
    status: isFileChangeStatus(value.status) ? value.status : undefined,
    attribution: normalizePersistedTrackedChangeAttribution(value.attribution),
    ...(isString(value.commitHash) ? { commitHash: value.commitHash } : {}),
    ...(isNumber(value.prNumber) ? { prNumber: value.prNumber } : {}),
    ...(content ? { content } : {}),
    ...(hunks ? { hunks } : {}),
  };
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
      selectedTrackedChange: normalizePersistedTrackedChange(mainPanel?.selectedTrackedChange),
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

  workspaceNavigationTasks.set(wsId, []);
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
