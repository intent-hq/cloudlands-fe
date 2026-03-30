import { goto } from "$app/navigation";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { invoke } from "$lib/electron-bridge";
import { removeKnownRepo } from "$lib/store/slices/known-repos/known-repos-slice";
import { getRunningAgentNames, hasRunningAgents } from "$lib/utils/delete-warning-utils";
import { navigateAfterWorkspaceRemoval } from "$lib/utils/workspace-navigation";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { WorkspaceStatusEnum, type Workspace } from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";
import { call, put, takeLatest, delay } from "typed-redux-saga";
import {
  selectPendingBulkDeleteRepoKey,
  selectPendingBulkRepoKey,
  selectPendingDeleteWorkspace,
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

function workspaceMatchesRepoKey(workspace: Workspace, repoKey: string): boolean {
  if (workspace.repositoryOwner && workspace.repositoryName) {
    return `${workspace.repositoryOwner}/${workspace.repositoryName}` === repoKey;
  }

  if (workspace.repositoryPath) {
    return workspace.repositoryPath === repoKey;
  }

  return repoKey === "unknown";
}

function getActiveWorkspacesForRepo(repoKey: string): Workspace[] {
  return workspaceStore.items.filter(
    (workspace) =>
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Deleted &&
      workspaceMatchesRepoKey(workspace, repoKey)
  );
}

function getArchivedWorkspacesForRepo(repoKey: string): Workspace[] {
  return workspaceStore.items.filter(
    (workspace) =>
      workspace.status === WorkspaceStatusEnum.Archived && workspaceMatchesRepoKey(workspace, repoKey)
  );
}

async function getToast() {
  const { toast } = await import("svelte-sonner");
  return toast;
}

async function deleteWorkspaceWithUndo(workspace: Workspace): Promise<void> {
  await workspaceStore.deleteWithUndo(workspace.id, workspace.title);
}

async function performBulkDeleteArchivedForRepo(repoKey: string): Promise<void> {
  const toast = await getToast();
  const toDelete = getArchivedWorkspacesForRepo(repoKey);

  if (toDelete.length === 0) {
    toast.info("No archived spaces to delete");
    return;
  }

  const results = await Promise.allSettled(toDelete.map((workspace) => workspaceStore.delete(workspace.id)));

  let deleteCount = 0;
  let failCount = 0;
  const failedIds: WorkspaceId[] = [];

  for (let index = 0; index < results.length; index++) {
    const settled = results[index];
    if (settled.status === "fulfilled" && settled.value.ok) {
      deleteCount++;
      continue;
    }

    failCount++;
    failedIds.push(toDelete[index].id);
  }

  if (deleteCount > 0) {
    toast.success(
      `Permanently deleted ${deleteCount} archived space${deleteCount === 1 ? "" : "s"}`
    );
  }

  if (failCount > 0) {
    toast.error(`Failed to delete ${failCount} space${failCount === 1 ? "" : "s"}`);
    for (const id of failedIds) {
      workspaceStore.restoreToUI(id);
    }
    await workspaceStore.load();
  }
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

  yield* delay(50);
  yield* call([workspaceStore, workspaceStore.setCurrentWorkspace], workspaceId as WorkspaceId);
  yield* call(goto, route);
}

export function* requestDeleteWorkspaceSaga(action: ReturnType<typeof requestDeleteWorkspace>) {
  const [workspace] = action.payload;

  if (hasRunningAgents(workspace.id)) {
    yield* put(
      openDeleteWarning({
        workspace,
        agentNames: getRunningAgentNames(workspace.id),
      })
    );
    return;
  }

  const wsPrefix = `/workspace/${workspace.id}`;
  const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
  if (isViewingWorkspace) {
    yield* call(navigateAfterWorkspaceRemoval, workspace.id);
  }

  yield* call(deleteWorkspaceWithUndo, workspace);
}

export function* confirmDeleteWorkspaceSaga() {
  const workspace = yield* selectPendingDeleteWorkspace.effect();
  yield* put(closeDeleteWarning());

  if (workspace) {
    const wsPrefix = `/workspace/${workspace.id}`;
    const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
    if (isViewingWorkspace) {
      yield* call(navigateAfterWorkspaceRemoval, workspace.id);
    }

    yield* call(deleteWorkspaceWithUndo, workspace);
  }
}

export function* requestArchiveWorkspaceSaga(action: ReturnType<typeof requestArchiveWorkspace>) {
  const [workspace] = action.payload;
  const toast = yield* call(getToast);
  const workspaceTitle = workspace.title || "space";

  const wsPrefix = `/workspace/${workspace.id}`;
  const isViewingWorkspace = window.location.pathname === wsPrefix || window.location.pathname.startsWith(wsPrefix + '/');
  if (isViewingWorkspace) {
    yield* call(navigateAfterWorkspaceRemoval, workspace.id);
  }

  const result = yield* call([workspaceStore, workspaceStore.archive], workspace.id);

  if (result.ok) {
    toast.warning(`Archived space ${workspaceTitle}`, {
      duration: 15000,
      action: {
        label: "Undo",
        onClick: async () => {
          await workspaceStore.unarchive(workspace.id);
        },
      },
    });
    return;
  }

  toast.error("Failed to archive space");
}

export function* requestUnarchiveWorkspaceSaga(action: ReturnType<typeof requestUnarchiveWorkspace>) {
  const [workspace] = action.payload;
  const toast = yield* call(getToast);
  const workspaceTitle = workspace.title || "space";
  const result = yield* call([workspaceStore, workspaceStore.unarchive], workspace.id);

  if (result.ok) {
    toast.success(`Unarchived space ${workspaceTitle}`);
    yield* call([workspaceStore, workspaceStore.load]);
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
  const toArchive = getActiveWorkspacesForRepo(repoKey);

  if (toArchive.length === 0) {
    toast.info("No active spaces to archive");
    return;
  }

  const results = yield* call(() =>
    Promise.allSettled(
      toArchive.map((workspace) =>
        workspaceStore.archive(workspace.id).then((result) => ({ id: workspace.id, result }))
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
    toast.warning(`Archived ${archivedIds.length} space${archivedIds.length === 1 ? "" : "s"}`, {
      duration: 15000,
      action: {
        label: "Undo",
        onClick: async () => {
          for (const id of archivedIds) {
            await workspaceStore.unarchive(id);
          }
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
  const toDelete = getArchivedWorkspacesForRepo(repoKey);

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

  yield* call(performBulkDeleteArchivedForRepo, repoKey);
}

export function* confirmBulkDeleteWarningSaga() {
  const repoKey = yield* selectPendingBulkDeleteRepoKey.effect();
  yield* put(closeBulkDeleteWarningConfirm());

  if (!repoKey) {
    console.error("confirmBulkDeleteWarningSaga called without a repo key");
    return;
  }

  yield* call(performBulkDeleteArchivedForRepo, repoKey);
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