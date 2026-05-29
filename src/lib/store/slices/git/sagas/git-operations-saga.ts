import { goto } from "$app/navigation";
import {
  isGitOp,
  trackGitOp,
} from "$lib/services/analytics";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import {
  selectActiveWorkspace,
  selectWorkspaceById,
} from "$lib/store/slices/workspace/workspace-selectors";
import {
  call,
  fork,
  put,
} from "typed-redux-saga";
import {
  setLastAutoCommitHookFailure,
  setLastGitError,
  setLastGitOperation,
  type AutoCommitHookFailureEvent,
  type GitOperationCompletedEvent,
  type GitOperationFailedEvent,
} from "../git-slice";
async function handleGitOperationCompleted(
    data: GitOperationCompletedEvent,
    workspaceName: string,
    shouldShowOpenAction: boolean | undefined,
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
            action?: {
                label: string;
                onClick: () => Promise<void>;
            };
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
    }
    catch {
        // Toast not available - not critical
    }
    if (data.metadata?.agentId) {
        const trigger = data.operationType === "auto-commit" ? "auto_commit" : "agent";
        const op = data.operationType === "auto-commit" ? "commit" : data.operationType;
        if (isGitOp(op)) {
            trackGitOp(op, {
                workspaceId: data.workspaceId,
                success: true,
                trigger,
                agentId: data.metadata.agentId,
            });
        }
    }
}
async function handleGitOperationFailed(
    data: GitOperationFailedEvent,
    workspaceName: string,
    currentWorkspaceId: string | undefined,
): Promise<void> {
    if (data.operationType === "auto-commit" &&
        (data.error.toLowerCase().includes("pre-commit hook") ||
            data.error.toLowerCase().includes("hook") ||
            data.error.includes("woken to retry"))) {
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
            action?: {
                label: string;
                onClick: () => Promise<void>;
            };
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
    }
    catch {
        // Toast not available - not critical
    }
    if (data.metadata?.agentId) {
        const trigger = data.operationType === "auto-commit" ? "auto_commit" : "agent";
        const op = data.operationType === "auto-commit" ? "commit" : data.operationType;
        if (isGitOp(op)) {
            trackGitOp(op, {
                workspaceId: data.workspaceId,
                success: false,
                trigger,
                agentId: data.metadata.agentId,
            });
        }
    }
}
async function handleAutoCommitHookFailure(data: AutoCommitHookFailureEvent): Promise<void> {
    try {
        const { toast } = await import("svelte-sonner");
        const name = data.agentName || "Agent";
        if (data.status === "waking-agent") {
            toast.warning("Auto-commit: pre-commit hooks failed", {
                description: `Asking ${name} to fix the issues (attempt ${data.retryCount})`,
                duration: 8000,
            });
        }
        else {
            toast.error("Auto-commit failed: pre-commit hooks", {
                description: `${name} couldn't fix the hook failures after ${data.retryCount} attempts. Please commit manually.`,
                duration: 15000,
            });
        }
    }
    catch {
        // Toast not available - not critical
    }
}
export function* watchGitOperationCompletedSaga() {
    if (typeof window === "undefined" || !window.electronAPI)
        return;
    yield* takeEveryFromElectronChannel<GitOperationCompletedEvent>("git:op-completed", function* (data) {
        yield* put(setLastGitOperation(data));
        const eventWorkspace = yield* selectWorkspaceById.effect(data.workspaceId);
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        yield* call(
            handleGitOperationCompleted,
            data,
            eventWorkspace?.title || "Space",
            currentWorkspace && currentWorkspace.id !== data.workspaceId,
        );
    });
}
export function* watchGitOperationFailedSaga() {
    if (typeof window === "undefined" || !window.electronAPI)
        return;
    yield* takeEveryFromElectronChannel<GitOperationFailedEvent>("git:op-failed", function* (data) {
        yield* put(setLastGitError(data));
        const eventWorkspace = yield* selectWorkspaceById.effect(data.workspaceId);
        const currentWorkspace = yield* selectActiveWorkspace.effect();
        yield* call(handleGitOperationFailed, data, eventWorkspace?.title || "Space", currentWorkspace?.id);
    });
}
export function* watchAutoCommitHookFailureSaga() {
    if (typeof window === "undefined" || !window.electronAPI)
        return;
    yield* takeEveryFromElectronChannel<AutoCommitHookFailureEvent>("git:auto-commit-hook-failure", function* (data) {
        yield* put(setLastAutoCommitHookFailure(data));
        yield* call(handleAutoCommitHookFailure, data);
    });
}
export function* gitOperationsSaga() {
    yield* fork(watchGitOperationCompletedSaga);
    yield* fork(watchGitOperationFailedSaga);
    yield* fork(watchAutoCommitHookFailureSaga);
}

