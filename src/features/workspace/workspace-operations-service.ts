/**
 * Workspace operations service — the sanctioned post-saga mechanism for the
 * archive / unarchive / delete / bulk-archive / bulk-delete buttons.
 *
 * These triggers lost their consumer when the saga runtime was removed (they
 * used to live in `sagas/workspace-operations-saga.ts`), so the buttons in
 * `WorkspaceCard.svelte` / `routes/+page.svelte` dispatched no-op actions. This
 * restores the operation path WITHOUT re-adding a saga and WITHOUT changing any
 * dispatch site: `createWorkspaceOperationsMiddleware()` observes every
 * dispatched action and routes the workspace-operation triggers to the
 * `workspaceClient` IPC seam (the same client the deleted saga used), mirroring
 * the already-fixed `requestOpenWorkspace` path.
 *
 * The list-refresh dispatch (`loadWorkspacesRequested`) is a post-saga no-op, so
 * each operation converges the store optimistically (remove/update the entity)
 * the way the UI grouping reads it, plus an Undo toast for the destructive ones.
 *
 * Dependency-light per src/store AGENTS.md: top-level imports are limited to the
 * workspace IPC client, the configured store, slice actions, collection utils,
 * shared types, and the logger. Modules that transitively import selectors
 * (`delete-warning-utils`, tab-state) and the toast library are dynamically
 * imported inside handlers so `store.createSelector` is never evaluated while the
 * store is still initializing through the middleware chain, and so this
 * middleware-reachable module never statically pulls in `$app/*` navigation.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import {
  getItem,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import { WorkspaceStatusEnum, type Workspace } from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";
import { store as appStore } from "$store/renderer/store";
import {
  bulkUpdateWorkspaceEntities,
  clearActiveWorkspace,
  clearWorkspacePendingDeletion,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
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
  requestUnarchiveWorkspace,
} from "$store/renderer/slices/workspace-operations/workspace-operations-slice";
import { removeRepo } from "$store/renderer/slices/known-repos/known-repos-slice";
import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { invoke } from "$lib/electron-bridge";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("WorkspaceOperationsService");

/** Undo window for the destructive archive/delete toasts (matches legacy saga). */
const UNDO_DURATION_MS = 15000;

async function getToast() {
  const { toast } = await import("svelte-sonner");
  return toast;
}

function readWorkspaces(): Workspace[] {
  return getItems(appStore.state.workspace.workspaces);
}

function readWorkspaceById(workspaceId: string): Workspace | undefined {
  return getItem(appStore.state.workspace.workspaces, workspaceId as Workspace["id"]);
}

/**
 * Merge a partial change into a stored workspace. `updateWorkspaceEntity` has no
 * standalone reducer; the wired path applies it through `bulkUpdateWorkspaceEntities`.
 */
function applyWorkspaceChanges(workspaceId: string, changes: Partial<Workspace>): void {
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

function isViewingWorkspace(workspaceId: string): boolean {
  if (typeof window === "undefined") return false;
  const prefix = `/workspace/${workspaceId}`;
  const path = window.location.pathname;
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * When the removed workspace is the one on screen, close its tab and route to
 * the next tab (or home). Uses the global SvelteKit `goto` that `+layout.svelte`
 * exposes on `window.__app_goto` so this module never imports `$app/*` — which
 * the (pre-existing) main-process typecheck graph cannot resolve.
 */
async function navigateAwayIfViewing(workspaceId: string): Promise<void> {
  if (!isViewingWorkspace(workspaceId)) return;
  const { closeWorkspaceTab } = await import(
    "$store/renderer/slices/tab-state/tab-state-slice"
  );
  const { selectCurrentWorkspaceTabId } = await import(
    "$store/renderer/slices/tab-state/tab-state-selectors"
  );

  appStore.dispatch(closeWorkspaceTab(workspaceId));
  const nextTabId = selectCurrentWorkspaceTabId.select(appStore.state);
  const target =
    typeof nextTabId === "string" && nextTabId.length > 0 && nextTabId !== workspaceId
      ? `/workspace/${nextTabId}`
      : "/";

  const goto = (window as unknown as { __app_goto?: (route: string) => unknown }).__app_goto;
  if (goto) await goto(target);
}

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
      workspace.status === WorkspaceStatusEnum.Archived &&
      workspaceMatchesRepoKey(workspace, repoKey)
  );
}

/**
 * Pending workspace deletions awaiting commit, keyed by workspaceId. Transient,
 * UI-only state (never Redux, per src/store AGENTS.md) — mirrors the
 * soft-hide-then-commit registry in `agent-mutation-service`. Each entry holds
 * the armed undo timer plus the commit closure so the unload flush below can
 * fire the wire call before the renderer (and its 15s setTimeout) dies.
 */
interface PendingWorkspaceDeletion {
  timer: ReturnType<typeof setTimeout>;
  commit: () => Promise<void>;
}
const pendingWorkspaceDeletions = new Map<string, PendingWorkspaceDeletion>();

/**
 * Immediately commit every pending (undo-window) workspace deletion. Wired to
 * window teardown below: the deferred `workspace.delete` commit otherwise rides
 * a setTimeout that dies with the renderer, silently resurrecting the deleted
 * workspace on the next launch. Each commit initiates its wire request
 * synchronously, so the requests are handed to the transport before teardown
 * completes. Idempotent — commit clears its own registry entry, and an undone
 * deletion is already out of the registry.
 */
export function flushPendingWorkspaceDeletions(): void {
  for (const pending of [...pendingWorkspaceDeletions.values()]) {
    void pending.commit();
  }
}

// Commit pending deletions on window teardown — same convention as the
// beforeunload flush in `unified-save-queue.ts`; `pagehide` additionally
// covers teardown paths where beforeunload does not fire.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPendingWorkspaceDeletions);
  window.addEventListener("pagehide", flushPendingWorkspaceDeletions);
}

/**
 * Optimistically remove the workspace, then commit the delete after the undo
 * window unless the user undid it. A failed delete restores the entity.
 */
async function deleteWorkspaceWithUndo(workspace: Workspace): Promise<void> {
  const toast = await getToast();
  const wasActive = appStore.state.workspace.activeWorkspaceId === workspace.id;

  appStore.dispatch(removeWorkspaceEntity(workspace.id));
  appStore.dispatch(markWorkspacePendingDeletion(workspace.id));
  if (wasActive) appStore.dispatch(clearActiveWorkspace());

  let undone = false;
  const commit = async () => {
    const pending = pendingWorkspaceDeletions.get(workspace.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingWorkspaceDeletions.delete(workspace.id);
    }
    if (undone) return;
    const result = await workspaceClient.delete(workspace.id);
    if (!result.ok) {
      appStore.dispatch(clearWorkspacePendingDeletion(workspace.id));
      appStore.dispatch(setWorkspaceEntity(workspace));
      toast.error("Failed to delete space");
      return;
    }
    appStore.dispatch(clearWorkspacePendingDeletion(workspace.id));
  };

  const timer = setTimeout(() => void commit(), UNDO_DURATION_MS);
  pendingWorkspaceDeletions.set(workspace.id, { timer, commit });

  toast.warning(`Deleted ${workspace.title || "space"}`, {
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        clearTimeout(timer);
        pendingWorkspaceDeletions.delete(workspace.id);
        appStore.dispatch(clearWorkspacePendingDeletion(workspace.id));
        appStore.dispatch(setWorkspaceEntity(workspace));
      },
    },
  });
}

/** Delete from a card/header: gate on running agents, else delete-with-undo. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const { hasRunningAgents, getRunningAgentNames } = await import(
    "$lib/utils/delete-warning-utils"
  );
  if (hasRunningAgents(workspaceId)) {
    appStore.dispatch(
      openDeleteWarning({ workspaceId, agentNames: getRunningAgentNames(workspaceId) })
    );
    return;
  }

  const workspace = readWorkspaceById(workspaceId);
  if (!workspace) return;

  await navigateAwayIfViewing(workspaceId);
  await deleteWorkspaceWithUndo(workspace);
}

/** "Delete anyway" from the running-agents warning modal. */
export async function confirmDeleteFromWarning(): Promise<void> {
  const workspaceId = appStore.state.workspaceOperations.pendingDeleteWorkspaceId;
  appStore.dispatch(closeDeleteWarning());
  if (!workspaceId) return;

  const workspace = readWorkspaceById(workspaceId);
  if (!workspace) return;

  await navigateAwayIfViewing(workspaceId);
  await deleteWorkspaceWithUndo(workspace);
}

/** Archive a workspace, converge the store, and offer an Undo (unarchive). */
export async function archiveWorkspace(workspaceId: string): Promise<void> {
  const toast = await getToast();
  const title = readWorkspaceById(workspaceId)?.title || "space";

  await navigateAwayIfViewing(workspaceId);

  const result = await workspaceClient.archive(workspaceId as WorkspaceId);
  if (!result.ok) {
    toast.error("Failed to archive space");
    return;
  }

  applyWorkspaceChanges(workspaceId, {
    status: WorkspaceStatusEnum.Archived,
    archived: true,
  });

  let undone = false;
  toast.warning(`Archived space ${title}`, {
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: () => {
        if (undone) return;
        undone = true;
        void (async () => {
          const undo = await workspaceClient.unarchive(workspaceId as WorkspaceId);
          if (undo.ok) {
            applyWorkspaceChanges(workspaceId, {
              status: WorkspaceStatusEnum.Active,
              archived: false,
            });
          }
        })();
      },
    },
  });
}

/** Unarchive a workspace and converge the store. */
export async function unarchiveWorkspace(workspaceId: string): Promise<void> {
  const toast = await getToast();
  const title = readWorkspaceById(workspaceId)?.title || "space";

  const result = await workspaceClient.unarchive(workspaceId as WorkspaceId);
  if (!result.ok) {
    toast.error("Failed to unarchive space");
    return;
  }

  applyWorkspaceChanges(workspaceId, { status: WorkspaceStatusEnum.Active, archived: false });
  toast.success(`Unarchived space ${title}`);
}

/** Archive every active workspace for a repo, with a single bulk Undo. */
export async function bulkArchive(): Promise<void> {
  const repoKey = appStore.state.workspaceOperations.pendingBulkRepoKey;
  appStore.dispatch(closeBulkArchiveConfirm());
  if (!repoKey) {
    logger.error("bulkArchive called without a repo key");
    return;
  }

  const toast = await getToast();
  const toArchive = getActiveWorkspacesForRepo(repoKey, readWorkspaces());
  if (toArchive.length === 0) {
    toast.info("No active spaces to archive");
    return;
  }

  const results = await Promise.allSettled(
    toArchive.map((workspace) =>
      workspaceClient.archive(workspace.id).then((result) => ({ id: workspace.id, result }))
    )
  );

  const archivedIds: WorkspaceId[] = [];
  let failCount = 0;
  for (const settled of results) {
    if (settled.status === "fulfilled" && settled.value.result.ok) {
      archivedIds.push(settled.value.id);
      applyWorkspaceChanges(settled.value.id, {
        status: WorkspaceStatusEnum.Archived,
        archived: true,
      });
      continue;
    }
    failCount++;
  }

  if (archivedIds.length > 0) {
    let undone = false;
    toast.warning(`Archived ${archivedIds.length} space${archivedIds.length === 1 ? "" : "s"}`, {
      duration: UNDO_DURATION_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (undone) return;
          undone = true;
          void (async () => {
            for (const id of archivedIds) {
              const undo = await workspaceClient.unarchive(id);
              if (undo.ok) {
                applyWorkspaceChanges(id, {
                  status: WorkspaceStatusEnum.Active,
                  archived: false,
                });
              }
            }
          })();
        },
      },
    });
  }

  if (failCount > 0) {
    toast.error(`Failed to archive ${failCount} space${failCount === 1 ? "" : "s"}`);
  }
}

/**
 * Permanently delete every archived workspace for a repo, converging the store.
 *
 * Runs deletes sequentially (not in parallel) so the daemon's per-repo
 * worktree lock doesn't force all requests to start their 120s timeout clocks
 * at t=0 while each workspace waits for the previous one's cleanup to finish
 * under the lock. On timeout (request exceeds 120s), the FE reports it as "still
 * deleting" rather than a hard failure, and relies on the `workspace:deleted`
 * event (emitted when the daemon finishes) to purge the row from the list — so
 * the UI converges correctly even when the cleanup outlives the timeout.
 */
async function performBulkDeleteArchived(repoKey: string): Promise<void> {
  const toast = await getToast();
  const toDelete = getArchivedWorkspacesForRepo(repoKey, readWorkspaces());
  if (toDelete.length === 0) {
    toast.info("No archived spaces to delete");
    return;
  }

  let deleteCount = 0;
  let timeoutCount = 0;
  let failCount = 0;

  for (const workspace of toDelete) {
    const result = await workspaceClient.delete(workspace.id);
    if (result.ok) {
      deleteCount++;
      appStore.dispatch(removeWorkspaceEntity(workspace.id));
    } else if (result.error?.includes("timed out")) {
      timeoutCount++;
      // Do NOT remove the entity — leave it for the workspace:deleted event to
      // purge when the daemon finishes.
    } else {
      failCount++;
    }
  }

  if (deleteCount > 0) {
    toast.success(
      `Permanently deleted ${deleteCount} archived space${deleteCount === 1 ? "" : "s"}`
    );
  }
  if (timeoutCount > 0) {
    toast.info(
      `${timeoutCount} space${timeoutCount === 1 ? " is" : "s are"} still deleting (large checkout${timeoutCount === 1 ? "" : "s"})`
    );
  }
  if (failCount > 0) {
    toast.error(`Failed to delete ${failCount} space${failCount === 1 ? "" : "s"}`);
  }
}

/** Bulk-delete archived workspaces; defer to the warning modal if agents run. */
export async function bulkDeleteArchived(): Promise<void> {
  const repoKey = appStore.state.workspaceOperations.pendingBulkRepoKey;
  appStore.dispatch(closeBulkDeleteArchivedConfirm());
  if (!repoKey) {
    logger.error("bulkDeleteArchived called without a repo key");
    return;
  }

  const toDelete = getArchivedWorkspacesForRepo(repoKey, readWorkspaces());
  if (toDelete.length === 0) {
    const toast = await getToast();
    toast.info("No archived spaces to delete");
    return;
  }

  const { hasRunningAgents } = await import("$lib/utils/delete-warning-utils");
  if (toDelete.some((workspace) => hasRunningAgents(workspace.id))) {
    appStore.dispatch(
      openBulkDeleteWarningConfirm({ repoKey, workspaceCount: toDelete.length })
    );
    return;
  }

  await performBulkDeleteArchived(repoKey);
}

/** "Delete anyway" from the bulk running-agents warning modal. */
export async function bulkDeleteAfterWarning(): Promise<void> {
  const repoKey = appStore.state.workspaceOperations.pendingBulkDeleteRepoKey;
  appStore.dispatch(closeBulkDeleteWarningConfirm());
  if (!repoKey) {
    logger.error("bulkDeleteAfterWarning called without a repo key");
    return;
  }
  await performBulkDeleteArchived(repoKey);
}

/** Legacy safe-handler envelope for `workspace:remove-recent-repository`. */
type RemoveRepoResponse = { success: boolean; data?: { removed: boolean }; error?: string };

/**
 * Remove a repo with no active spaces from the persistent known-repo registry
 * (the "Remove" confirm on a repositories-list card). Routes through the
 * `workspace:remove-recent-repository` channel — bridged to the daemon's
 * `repo.remove` (PROTOCOL §5.11) — then converges the known-repos slice so the
 * card disappears without a reload; the next `repo.list` hydration agrees
 * because the daemon registry row is gone. Failures surface as a loud toast
 * and leave the list intact.
 */
export async function removeRepoFromRegistry(): Promise<void> {
  const repoPath = appStore.state.workspaceOperations.pendingRemoveRepoPath;
  appStore.dispatch(closeRemoveRepoConfirm());
  if (!repoPath) {
    logger.error("removeRepoFromRegistry called without a repo path");
    return;
  }

  const toast = await getToast();
  try {
    const result = await invoke<RemoveRepoResponse>(
      WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
      { repository: repoPath }
    );
    if (!result?.success) {
      throw new Error(result?.error || "Remove failed");
    }
    appStore.dispatch(removeRepo(repoPath));
  } catch (error) {
    logger.error("Failed to remove repository from registry", error);
    toast.error("Failed to remove repository");
  }
}

/**
 * Middleware that gives the workspace-operation triggers a real handler: after
 * each action passes through the (no-op) reducer, it routes the trigger to the
 * matching seam-backed handler. Fire-and-forget — dispatch stays synchronous and
 * never throws.
 */
export function createWorkspaceOperationsMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      switch (action.type) {
        case requestArchiveWorkspace.type:
          if (typeof payload[0] === "string") void archiveWorkspace(payload[0]);
          break;
        case requestUnarchiveWorkspace.type:
          if (typeof payload[0] === "string") void unarchiveWorkspace(payload[0]);
          break;
        case requestDeleteWorkspace.type:
          if (typeof payload[0] === "string") void deleteWorkspace(payload[0]);
          break;
        case confirmDeleteWorkspace.type:
          void confirmDeleteFromWarning();
          break;
        case confirmBulkArchive.type:
          void bulkArchive();
          break;
        case confirmBulkDeleteArchived.type:
          void bulkDeleteArchived();
          break;
        case confirmBulkDeleteWarning.type:
          void bulkDeleteAfterWarning();
          break;
        case confirmRemoveRepo.type:
          void removeRepoFromRegistry();
          break;
      }
    }
    return result;
  };
}
