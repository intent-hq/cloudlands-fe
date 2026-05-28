import { goto } from "$app/navigation";
import { workspaceClient } from "$lib/store/slices/workspace/utils/workspace.client";
import { invoke } from "$lib/electron-bridge";
import { getReduxStore } from "$lib/store/redux-dispatch-bridge";
import { removeKnownRepo } from "$lib/store/slices/known-repos/known-repos-slice";
import {
  clearActiveWorkspace,
  clearWorkspacePendingDeletion,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  openWorkspaceRequested,
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from "$lib/store/slices/workspace/workspace-slice";
import {
  selectActiveWorkspace,
  selectWorkspaceById,
  selectWorkspaceItems,
} from "$lib/store/slices/workspace/workspace-selectors";
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
  put,
  takeLatest,
} from "typed-redux-saga";
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

async function deleteWorkspaceWithUndo(workspace: Workspace): Promise<void> {
  const toast = await getToast();
  const store = getReduxStore();
  const currentWorkspace = selectActiveWorkspace.select(store.getState());
  let undone = false;
  let toastId: string | number | undefined;

  store.dispatch(removeWorkspaceEntity(workspace.id));
  store.dispatch(markWorkspacePendingDeletion(workspace.id));
  if (currentWorkspace?.id === workspace.id) {
    store.dispatch(clearActiveWorkspace());
  }

  const timeoutId = globalThis.setTimeout(async () => {
    if (undone) {
      return;
    }

    const result = await workspaceClient.delete(workspace.id);
    if (!result.ok) {
      store.dispatch(clearWorkspacePendingDeletion(workspace.id));
      store.dispatch(setWorkspaceEntity(workspace));
      store.dispatch(loadWorkspacesRequested());
      toast.error("Failed to delete space");
      return;
    }

    store.dispatch(clearWorkspacePendingDeletion(workspace.id));
    store.dispatch(loadWorkspacesRequested());
  }, 15000);

  toastId = toast.warning(`Deleted ${workspace.title || "space"}`, {
    duration: 15000,
    action: {
      label: "Undo",
      onClick: async () => {
        undone = true;
        globalThis.clearTimeout(timeoutId);
        store.dispatch(clearWorkspacePendingDeletion(workspace.id));
        store.dispatch(setWorkspaceEntity(workspace));
        if (toastId !== undefined) {
          toast.dismiss(toastId);
        }
      },
    },
  });
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

  yield* call(deleteWorkspaceWithUndo, workspace);
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

      yield* call(deleteWorkspaceWithUndo, workspace);
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
    toast.warning(`Archived space ${workspaceTitle}`, {
      duration: 15000,
      action: {
        label: "Undo",
        // Direct dispatch is intentional: this callback fires outside any saga
        // generator context when the user clicks "Undo" after the saga has completed.
        onClick: async () => {
          const undoResult = await workspaceClient.unarchive(wsId);
          if (undoResult.ok) {
            getReduxStore().dispatch(loadWorkspacesRequested());
          }
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
    toast.warning(`Archived ${archivedIds.length} space${archivedIds.length === 1 ? "" : "s"}`, {
      duration: 15000,
      action: {
        label: "Undo",
        // Direct dispatch is intentional: this callback fires outside any saga
        // generator context when the user clicks "Undo" after the saga has completed.
        onClick: async () => {
          for (const id of archivedIds) {
            await workspaceClient.unarchive(id);
          }
          getReduxStore().dispatch(loadWorkspacesRequested());
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