/**
 * Git events IPC service — restores the renderer halves of the deleted
 * `git/sagas/git-operations-saga.ts` (watchGitOperationCompletedSaga /
 * watchGitOperationFailedSaga) and `auth/sagas/auth-saga.ts`
 * (watchGitAuthRequiredSaga / watchGitHubAuthRequiredSaga), removed with the
 * saga runtime in 95d908a2 without re-homing. With no listener, git operation
 * results produced no toasts and `lastGitOperation`/`lastGitError` never
 * updated, and the git-credentials / GitHub-auth modals never opened on
 * auth-required events.
 *
 * This reconnects the paths WITHOUT re-adding a saga, following the
 * menu-ipc-service pattern: on middleware creation it registers window IPC
 * listeners for the preload-allowed channels:
 *   - `git:op-completed` → dispatch `setLastGitOperation`, then a success
 *     toast titled with the event workspace's title (fallback "Space"), with
 *     an Open action when the event workspace is not the active workspace.
 *   - `git:op-failed` → dispatch `setLastGitError`, then a failure toast
 *     (suppressed when already viewing the failing workspace, except for
 *     auto-commit failures).
 *   - `git:auth-required` → open the git-credentials modal, unless it was
 *     already shown for that workspace this session.
 *   - `github:auth-required` → open the GitHub auth modal.
 * NOT handled here: `git:auto-commit-hook-failure` (partial listeners exist
 * elsewhere). Toast failures are swallowed — toasts are not critical.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: no selector imports —
 * reads `appStore.state` directly and imports the toast lib lazily.
 */
import { goto } from "$app/navigation";
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import { isElectron } from "$lib/electron-bridge";
import type { GitHubAuthRequiredEvent } from "$features/github-auth/types";
import {
  setLastGitOperation,
  setLastGitError,
  type GitOperationCompletedEvent,
  type GitOperationFailedEvent,
} from "../slices/git/git-slice";
import {
  openGitCredentialsModal,
  openGitHubAuthModal,
  type GitCredentialsModalError,
} from "../slices/global-modals/global-modals-slice";

/** Payload of `git:auth-required` (see the deleted watchGitAuthRequiredSaga). */
type GitAuthRequiredEvent = GitCredentialsModalError & {
  remote?: string;
};

/** Minimal structural view of the state slices this service reads directly. */
interface GitEventsStateSlice {
  workspace?: {
    activeWorkspaceId?: string | null;
    workspaces?: { map?: Record<string, { id: string; title?: string } | undefined> };
  };
  globalModals?: {
    gitCredentials?: { shownForWorkspaceIds?: Record<string, boolean> };
  };
}

function getState(): GitEventsStateSlice {
  return appStore.state as unknown as GitEventsStateSlice;
}

function getWorkspace(wsId: string | null | undefined) {
  if (!wsId) return undefined;
  return getState().workspace?.workspaces?.map?.[wsId];
}

function getActiveWorkspace() {
  return getWorkspace(getState().workspace?.activeWorkspaceId);
}

async function showGitOperationCompletedToast(
  data: GitOperationCompletedEvent,
  workspaceName: string,
  shouldShowOpenAction: boolean,
): Promise<void> {
  if ((data.operationType === "auto-commit" || data.operationType === "commit") && data.result?.noChanges) {
    return;
  }
  try {
    const { toast } = await import("svelte-sonner");
    let message: string;
    switch (data.operationType) {
      case "commit":
        message = `✅ Changes committed in "${workspaceName}"`;
        break;
      case "push":
        message = `✅ Changes pushed in "${workspaceName}"`;
        break;
      case "create-pr":
        message = data.result?.prNumber
          ? `✅ PR #${data.result.prNumber} created in "${workspaceName}"`
          : `✅ PR created in "${workspaceName}"`;
        break;
      case "auto-commit":
        message = `✅ Auto-committed in "${workspaceName}"`;
        break;
      default:
        message = `✅ Git operation completed in "${workspaceName}"`;
    }
    const toastOptions: {
      description?: string;
      duration: number;
      action?: { label: string; onClick: () => Promise<void> };
    } = {
      duration: 5000,
    };
    if (data.operationType === "create-pr" && data.metadata?.prTitle) {
      toastOptions.description = data.metadata.prTitle;
    }
    if (shouldShowOpenAction) {
      toastOptions.action = {
        label: "Open",
        onClick: async () => {
          await goto(`/workspace/${data.workspaceId}`);
        },
      };
    }
    toast.success(message, toastOptions);
  } catch {
    // Toast not available - not critical
  }
}

async function showGitOperationFailedToast(
  data: GitOperationFailedEvent,
  workspaceName: string,
  currentWorkspaceId: string | undefined,
): Promise<void> {
  if (
    data.operationType === "auto-commit" &&
    (data.error.toLowerCase().includes("pre-commit hook") ||
      data.error.toLowerCase().includes("hook") ||
      data.error.includes("woken to retry"))
  ) {
    return;
  }
  try {
    const { toast } = await import("svelte-sonner");
    const isViewingFailingWorkspace = currentWorkspaceId === data.workspaceId;
    if (isViewingFailingWorkspace && data.operationType !== "auto-commit") {
      return;
    }
    let message: string;
    switch (data.operationType) {
      case "commit":
        message = `❌ Commit failed in "${workspaceName}"`;
        break;
      case "push":
        message = `❌ Push failed in "${workspaceName}"`;
        break;
      case "create-pr":
        message = `❌ PR creation failed in "${workspaceName}"`;
        break;
      case "auto-commit":
        message = `❌ Auto-commit failed in "${workspaceName}"`;
        break;
      default:
        message = `❌ Git operation failed in "${workspaceName}"`;
    }
    const toastOptions: {
      description: string;
      duration: number;
      action?: { label: string; onClick: () => Promise<void> };
    } = {
      description: data.error && data.error.length > 200 ? data.error.slice(0, 200) + "…" : data.error,
      duration: 10000,
    };
    const shouldShowOpenAction = currentWorkspaceId && currentWorkspaceId !== data.workspaceId;
    if (shouldShowOpenAction) {
      toastOptions.action = {
        label: "Open",
        onClick: async () => {
          await goto(`/workspace/${data.workspaceId}`);
        },
      };
    }
    toast.error(message, toastOptions);
  } catch {
    // Toast not available - not critical
  }
}

async function handleGitOpCompleted(data?: GitOperationCompletedEvent): Promise<void> {
  if (!data) return;
  appStore.dispatch(setLastGitOperation(data));
  const eventWorkspace = getWorkspace(data.workspaceId);
  const currentWorkspace = getActiveWorkspace();
  await showGitOperationCompletedToast(
    data,
    eventWorkspace?.title || "Space",
    Boolean(currentWorkspace && currentWorkspace.id !== data.workspaceId),
  );
}

async function handleGitOpFailed(data?: GitOperationFailedEvent): Promise<void> {
  if (!data) return;
  appStore.dispatch(setLastGitError(data));
  const eventWorkspace = getWorkspace(data.workspaceId);
  const currentWorkspace = getActiveWorkspace();
  await showGitOperationFailedToast(data, eventWorkspace?.title || "Space", currentWorkspace?.id);
}

function handleGitAuthRequired(data?: GitAuthRequiredEvent): void {
  if (!data) return;
  const hasShownForWorkspace = data.workspaceId
    ? Boolean(getState().globalModals?.gitCredentials?.shownForWorkspaceIds?.[data.workspaceId])
    : false;
  if (hasShownForWorkspace) {
    return;
  }
  appStore.dispatch(
    openGitCredentialsModal({
      workspaceId: data.workspaceId,
      message: data.message,
      operation: data.operation,
      command: data.command,
      cwd: data.cwd,
      rawError: data.rawError,
    }),
  );
}

function handleGitHubAuthRequired(data?: GitHubAuthRequiredEvent): void {
  if (!data) return;
  appStore.dispatch(openGitHubAuthModal(data));
}

export function createGitEventsIpcMiddleware(): StoreMiddleware {
  return () => {
    // Register the listeners once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      // Handlers are async but never reject (toast errors are swallowed),
      // so registering them directly is safe — and lets tests await them.
      window.electronAPI.on("git:op-completed", handleGitOpCompleted);
      window.electronAPI.on("git:op-failed", handleGitOpFailed);
      window.electronAPI.on("git:auth-required", handleGitAuthRequired);
      window.electronAPI.on("github:auth-required", handleGitHubAuthRequired);
      // Note: No cleanup is performed. The listeners persist for the lifetime
      // of the renderer process (same as menu-ipc-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
