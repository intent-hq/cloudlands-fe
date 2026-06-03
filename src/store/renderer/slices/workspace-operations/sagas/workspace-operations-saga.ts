import { goto } from "$app/navigation";
import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { invoke } from "$lib/electron-bridge";
import { removeKnownRepo } from "$store/renderer/slices/known-repos/known-repos-slice";
import {
  clearActiveWorkspace,
  clearWorkspacePendingDeletion,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  openWorkspaceRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
import {
  selectActiveWorkspace,
  selectWorkspaceById,
  selectWorkspaceItems,
} from "$store/renderer/slices/workspace/workspace-selectors";
import {
  getRunningAgentNames,
  hasRunningAgents,
} from "$lib/utils/delete-warning-utils";
import { navigateAfterWorkspaceRemoval } from "$lib/utils/workspace-navigation";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import {
  WorkspaceStatusEnum,
  type Workspace,
} from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";
import {
  call,
  delay,
  put,
  race,
  spawn,
  take,
  takeLatest,
} from "typed-redux-saga";
import { buffers, channel, type Channel } from "redux-saga";
import {
  selectPendingBulkDeleteRepoKey,
  selectPendingBulkRepoKey,
  selectPendingDeleteWorkspaceId,
  selectPendingRemoveRepoPath,
} from "../workspace-operations-selectors";
import {
  closeBulkArchiveConfirm,
  closeBulkDeleteArchivedConfirm,
  closeBulkDeleteWarningConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  confirmBulkArchive,
  confirmBulkDeleteArchived,
  confirmBulkDeleteWarning,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  openBulkDeleteWarningConfirm,
  openDeleteWarning,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestOpenWorkspace,
  requestUnarchiveWorkspace,
} from "../workspace-operations-slice";

const WORKSPACE_OPERATION_UNDO_DURATION_MS = 15000;

function workspaceMatchesRepoKey(workspace: Workspace, repoKey: string): boolean {
  if (workspace.repositoryOwner && workspace.repositoryName) {
    return `${workspace.repositoryOwner}/${workspace.repositoryName}` === repoKey;
  }

  if (workspace.repositoryPath) {
    return workspace.repositoryPath === repoKey;
  }

  return repoKey === "unknown";
}

function getActiveWorkspacesForRepo(repoKey: string, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Deleted &&
      workspaceMatchesRepoKey(workspace, repoKey)
  );
}

function getArchivedWorkspacesForRepo(repoKey: string, workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace.status === WorkspaceStatusEnum.Archived && workspaceMatchesRepoKey(workspace, repoKey)
  );
}

async function getToast() {
  const { toast } = await import("svelte-sonner");
  return toast;
}

function createUndoChannel(): Channel<true> {
  return channel<true>(buffers.sliding(1));
}

function* deleteWorkspaceWithUndo(workspace: Workspace) {
  const toast = yield* call(getToast);
  const currentWorkspace = yield* selectActiveWorkspace.effect();
  const undoChannel = createUndoChannel();
  let toastId: string | number | undefined;

  yield* put(removeWorkspaceEntity(workspace.id));
  yield* put(markWorkspacePendingDeletion(workspace.id));
  if (currentWorkspace?.id === workspace.id) {
    yield* put(clearActiveWorkspace());
  }

  try {
    toastId = toast.warning(`Deleted ${workspace.title || "space"}`, {
      duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
      action: {
        label: "Undo",
        onClick: () => {
          undoChannel.put(true);
        },
      },
    });

    const { undo } = yield* race({
      undo: take(undoChannel),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });

    if (undo) {
      yield* put(clearWorkspacePendingDeletion(workspace.id));
      yield* put(setWorkspaceEntity(workspace));
      if (toastId !== undefined) {
        toast.dismiss(toastId);
      }
      return;
    }

    const result = yield* call([workspaceClient, workspaceClient.delete], workspace.id);
    if (!result.ok) {
      yield* put(clearWorkspacePendingDeletion(workspace.id));
      yield* put(setWorkspaceEntity(workspace));
      yield* put(loadWorkspacesRequested());
      toast.error("Failed to delete space");
      return;
    }

    yield* put(clearWorkspacePendingDeletion(workspace.id));
    yield* put(loadWorkspacesRequested());
  } finally {
    undoChannel.close();
  }
}

function* watchArchiveUndo(undoChannel: Channel<true>, workspaceId: WorkspaceId) {
  try {
    const { undo } = yield* race({
      undo: take(undoChannel),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });

    if (!undo) {
      return;
    }

    const undoResult = yield* call([workspaceClient, workspaceClient.unarchive], workspaceId);
    if (undoResult.ok) {
      yield* put(loadWorkspacesRequested());
    }
  } finally {
    undoChannel.close();
  }
}

function* watchBulkArchiveUndo(undoChannel: Channel<true>, archivedIds: WorkspaceId[]) {
  try {
    const { undo } = yield* race({
      undo: take(undoChannel),
      timeout: delay(WORKSPACE_OPERATION_UNDO_DURATION_MS),
    });

    if (!undo) {
      return;
    }

    for (const id of archivedIds) {
      yield* call([workspaceClient, workspaceClient.unarchive], id);
    }
    yield* put(loadWorkspacesRequested());
  } finally {
    undoChannel.close();
  }
}

async function performBulkDeleteArchivedForRepo(repoKey: string, workspaces: Workspace[]): Promise<boolean> {
  const toast = await getToast();
  const toDelete = getArchivedWorkspacesForRepo(repoKey, workspaces);

  if (toDelete.length === 0) {
    toast.info("No archived spaces to delete");
    return false;
  }

  const results = await Promise.allSettled(
    toDelete.map((workspace) => workspaceClient.delete(workspace.id))
  );

  let deleteCount = 0;
  let failCount = 0;

  for (let index = 0; index < results.length; index++) {
    const settled = results[index];
    if (settled.status === "fulfilled" && settled.value.ok) {
      deleteCount++;
      continue;
    }

    failCount++;
  }

  if (deleteCount > 0) {
    toast.success(
      `Permanently deleted ${deleteCount} archived space${deleteCount === 1 ? "" : "s"}`
    );
  }

  if (failCount > 0) {
    toast.error(`Failed to delete ${failCount} space${failCount === 1 ? "" : "s"}`);
  }

  return deleteCount > 0 || failCount > 0;
}

export function* requestOpenWorkspaceSaga(action: ReturnType<typeof requestOpenWorkspace>) {
  const [{ workspaceId, openInNewWindow }] = action.payload;
  const route = `/workspace/${workspaceId}`;

  if (openInNewWindow) {
    try {
      yield* call(invoke, IPC_CHANNELS.WINDOW.OPEN_NEW, { route });
    } catch (error) {
      console.warn("Failed to open new window, navigating instead:", error);
      yield* call(goto, route);
    }
    return;
  }

  yield* put(openWorkspaceRequested(workspaceId));
  yield* call(goto, route);
}

export function* requestDeleteWorkspaceSaga(action: ReturnType<typeof requestDeleteWorkspace>) {
  const [workspaceId] = action.payload;

  if (hasRunningAgents(workspaceId)) {
    yield* put(
      openDeleteWarning({
        workspaceId,
        agentNames: getRunningAgentNames(workspaceId),
      })
    );
    return;
  }

  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  if (!workspace) return;

  const wsPrefix = `/workspace/${workspaceId}`;
  const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
  if (isViewingWorkspace) {
    yield* call(navigateAfterWorkspaceRemoval, workspaceId);
  }

  yield* spawn(deleteWorkspaceWithUndo, workspace);
}

export function* confirmDeleteWorkspaceSaga() {
  const workspaceId = yield* selectPendingDeleteWorkspaceId.effect();
  yield* put(closeDeleteWarning());

  if (workspaceId) {
    const workspace = yield* selectWorkspaceById.effect(workspaceId);

    if (workspace) {
      const wsPrefix = `/workspace/${workspace.id}`;
      const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
      if (isViewingWorkspace) {
        yield* call(navigateAfterWorkspaceRemoval, workspace.id);
      }

      yield* spawn(deleteWorkspaceWithUndo, workspace);
    }
  }
}

export function* requestArchiveWorkspaceSaga(action: ReturnType<typeof requestArchiveWorkspace>) {
  const [workspaceId] = action.payload;
  const toast = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const workspaceTitle = workspace?.title || "space";

  const wsPrefix = `/workspace/${workspaceId}`;
  const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
  if (isViewingWorkspace) {
    yield* call(navigateAfterWorkspaceRemoval, workspaceId);
  }

  const wsId = workspaceId as WorkspaceId;
  const result = yield* call([workspaceClient, workspaceClient.archive], wsId);

  if (result.ok) {
    yield* put(loadWorkspacesRequested());
    const undoChannel = createUndoChannel();
    yield* spawn(watchArchiveUndo, undoChannel, wsId);
    toast.warning(`Archived space ${workspaceTitle}`, {
      duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
      action: {
        label: "Undo",
        onClick: () => {
          undoChannel.put(true);
        },
      },
    });
    return;
  }

  toast.error("Failed to archive space");
}

export function* requestUnarchiveWorkspaceSaga(action: ReturnType<typeof requestUnarchiveWorkspace>) {
  const [workspaceId] = action.payload;
  const toast = yield* call(getToast);
  const workspace = yield* selectWorkspaceById.effect(workspaceId);
  const workspaceTitle = workspace?.title || "space";
  const result = yield* call([workspaceClient, workspaceClient.unarchive], workspaceId as WorkspaceId);

  if (result.ok) {
    toast.success(`Unarchived space ${workspaceTitle}`);
    yield* put(loadWorkspacesRequested());
    return;
  }

  toast.error("Failed to unarchive space");
}

export function* confirmBulkArchiveSaga() {
  const repoKey = yield* selectPendingBulkRepoKey.effect();
  yield* put(closeBulkArchiveConfirm());

  if (!repoKey) {
    console.error("confirmBulkArchiveSaga called without a repo key");
    return;
  }

  const toast = yield* call(getToast);
  const workspaces = yield* selectWorkspaceItems.effect();
  const toArchive = getActiveWorkspacesForRepo(repoKey, workspaces);

  if (toArchive.length === 0) {
    toast.info("No active spaces to archive");
    return;
  }

  const results = yield* call(() =>
    Promise.allSettled(
      toArchive.map((workspace) =>
        workspaceClient.archive(workspace.id).then((result) => ({ id: workspace.id, result }))
      )
    )
  );

  const archivedIds: WorkspaceId[] = [];
  let failCount = 0;

  for (const settled of results) {
    if (settled.status === "fulfilled" && settled.value.result.ok) {
      archivedIds.push(settled.value.id);
      continue;
    }

    failCount++;
  }

  if (archivedIds.length > 0) {
    yield* put(loadWorkspacesRequested());
    const undoChannel = createUndoChannel();
    yield* spawn(watchBulkArchiveUndo, undoChannel, archivedIds);
    toast.warning(`Archived ${archivedIds.length} space${archivedIds.length === 1 ? "" : "s"}`, {
      duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
      action: {
        label: "Undo",
        onClick: () => {
          undoChannel.put(true);
        },
      },
    });
  }

  if (failCount > 0) {
    toast.error(`Failed to archive ${failCount} space${failCount === 1 ? "" : "s"}`);
  }
}

export function* confirmBulkDeleteArchivedSaga() {
  const repoKey = yield* selectPendingBulkRepoKey.effect();
  yield* put(closeBulkDeleteArchivedConfirm());

  if (!repoKey) {
    console.error("confirmBulkDeleteArchivedSaga called without a repo key");
    return;
  }

  const toast = yield* call(getToast);
  const workspaces = yield* selectWorkspaceItems.effect();
  const toDelete = getArchivedWorkspacesForRepo(repoKey, workspaces);

  if (toDelete.length === 0) {
    toast.info("No archived spaces to delete");
    return;
  }

  const workspacesWithAgents = toDelete.filter((workspace) => hasRunningAgents(workspace.id));
  if (workspacesWithAgents.length > 0) {
    yield* put(
      openBulkDeleteWarningConfirm({
        repoKey,
        workspaceCount: toDelete.length,
      })
    );
    return;
  }

  const shouldReload: boolean = yield* call(performBulkDeleteArchivedForRepo, repoKey, workspaces);
  if (shouldReload) {
    yield* put(loadWorkspacesRequested());
  }
}

export function* confirmBulkDeleteWarningSaga() {
  const repoKey = yield* selectPendingBulkDeleteRepoKey.effect();
  yield* put(closeBulkDeleteWarningConfirm());

  if (!repoKey) {
    console.error("confirmBulkDeleteWarningSaga called without a repo key");
    return;
  }

  const workspaces = yield* selectWorkspaceItems.effect();
  const shouldReload: boolean = yield* call(performBulkDeleteArchivedForRepo, repoKey, workspaces);
  if (shouldReload) {
    yield* put(loadWorkspacesRequested());
  }
}

export function* confirmRemoveRepoSaga() {
  const repoPath = yield* selectPendingRemoveRepoPath.effect();
  yield* put(closeRemoveRepoConfirm());

  if (repoPath) {
    yield* put(removeKnownRepo(repoPath));
  }
}

export function* workspaceOperationsSaga() {
  yield* takeLatest(requestOpenWorkspace, requestOpenWorkspaceSaga);
  yield* takeLatest(requestDeleteWorkspace, requestDeleteWorkspaceSaga);
  yield* takeLatest(confirmDeleteWorkspace, confirmDeleteWorkspaceSaga);
  yield* takeLatest(requestArchiveWorkspace, requestArchiveWorkspaceSaga);
  yield* takeLatest(requestUnarchiveWorkspace, requestUnarchiveWorkspaceSaga);
  yield* takeLatest(confirmBulkArchive, confirmBulkArchiveSaga);
  yield* takeLatest(confirmBulkDeleteArchived, confirmBulkDeleteArchivedSaga);
  yield* takeLatest(confirmBulkDeleteWarning, confirmBulkDeleteWarningSaga);
  yield* takeLatest(confirmRemoveRepo, confirmRemoveRepoSaga);
}