import { goto } from "$app/navigation";
import type { GitHubAuthRequiredEvent } from "$features/github-auth/types";
import {
  openGitCredentialsModal,
  openGitHubAuthModal,
  type GitCredentialsModalError,
} from "$lib/store/slices/global-modals/global-modals-slice";
import { selectHasShownGitCredentialsModalForWorkspace } from "$lib/store/slices/global-modals/global-modals-selectors";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import {
  call,
  fork,
  put,
  select,
} from "typed-redux-saga";

type GitAuthRequiredEvent = GitCredentialsModalError & {
  remote?: string;
};

type AgentAuthRequiredEvent = {
  workspaceId?: string;
  agentId?: string;
  isRemote: boolean;
  host?: string;
  message: string;
};

type AgentPlanRequiredEvent = {
  workspaceId?: string;
  agentId?: string;
  message: string;
  helpUrl?: string;
};

async function showAgentAuthRequiredToast(data: AgentAuthRequiredEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.warning("Agent Authentication Required", {
      description: data.message,
      duration: 15000,
      action: {
        label: "Open Terminal",
        onClick: () => {
          if (data.workspaceId) {
            void goto(`/workspace/${data.workspaceId}?panel=terminal`);
          }
        },
      },
    });
  } catch {
    // Toast not available - not critical
  }
}

async function showAgentPlanRequiredToast(data: AgentPlanRequiredEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.error("Intent: Plan Upgrade Required", {
      description: data.message,
      duration: 20000,
    });
  } catch {
    // Toast not available - not critical
  }
}

export function* watchGitHubAuthRequiredSaga() {
  yield* takeEveryFromElectronChannel<GitHubAuthRequiredEvent>(
    "github:auth-required",
    function* (data) {
      yield* put(openGitHubAuthModal(data));
    },
  );
}

export function* watchGitAuthRequiredSaga() {
  yield* takeEveryFromElectronChannel<GitAuthRequiredEvent>("git:auth-required", function* (data) {
      const hasShownForWorkspace = data.workspaceId
        ? yield* select(selectHasShownGitCredentialsModalForWorkspace.select, data.workspaceId)
        : false;

      if (hasShownForWorkspace) {
        return;
      }

      yield* put(
        openGitCredentialsModal({
          workspaceId: data.workspaceId,
          message: data.message,
          operation: data.operation,
          command: data.command,
          cwd: data.cwd,
          rawError: data.rawError,
        })
      );
    });
}

export function* watchAgentAuthRequiredSaga() {
  yield* takeEveryFromElectronChannel<AgentAuthRequiredEvent>("agent:auth-required", function* (data) {
      yield* call(showAgentAuthRequiredToast, data);
    });
}

export function* watchAgentPlanRequiredSaga() {
  yield* takeEveryFromElectronChannel<AgentPlanRequiredEvent>("agent:plan-required", function* (data) {
      yield* call(showAgentPlanRequiredToast, data);
    });
}

export function* authSaga() {
  yield* fork(watchGitHubAuthRequiredSaga);
  yield* fork(watchGitAuthRequiredSaga);
  yield* fork(watchAgentAuthRequiredSaga);
  yield* fork(watchAgentPlanRequiredSaga);
}