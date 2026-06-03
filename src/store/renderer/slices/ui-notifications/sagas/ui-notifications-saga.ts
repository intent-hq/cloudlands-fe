import { goto } from "$app/navigation";
import {
  selectNotificationVolume,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from "$store/renderer/slices/user-preferences/user-preferences-selectors";
import {
  selectActiveWorkspace,
  selectWorkspaceById,
} from "$store/renderer/slices/workspace/workspace-selectors";
import { takeEveryFromElectronChannel } from "$store/renderer/utils/ipc-channel";
import {
  call,
  fork,
} from "typed-redux-saga";

type BackgroundAgentSpawnedEvent = {
  workspaceId: string;
  agentId: string;
  taskTitle: string;
  agentType: string;
};

type NotificationShowEvent = {
  agentName: string;
  timestamp: string;
};

type NotificationNavigateEvent = {
  workspaceId: string;
};

async function showBackgroundAgentSpawnedToast(
  data: BackgroundAgentSpawnedEvent,
  workspaceTitle: string,
  shouldShowOpenAction: boolean,
): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    const toastOptions: {
      description: string;
      duration: number;
      action?: { label: string; onClick: () => Promise<void> };
    } = {
      description: `Working on: ${data.taskTitle}`,
      duration: 5000,
    };

    if (shouldShowOpenAction) {
      toastOptions.action = {
        label: "Open",
        onClick: async () => {
          await goto(`/workspace/${data.workspaceId}`);
        },
      };
    }

    toast.info(`🤖 Task orchestrator started in "${workspaceTitle}"`, toastOptions);
  } catch {
    // Toast not available - not critical
  }
}

async function playSoundForNotification(agentName: string, volume: number): Promise<void> {
  try {
    const { playNotificationSound } = await import("$lib/utils/notification-sound");
    await playNotificationSound(volume);
  } catch {
  }
}

export function* watchBackgroundAgentSpawnedSaga() {
  if (typeof window === "undefined" || !window.electronAPI) return;

  yield* takeEveryFromElectronChannel<BackgroundAgentSpawnedEvent>(
    "background-agent:spawned",
    function* (data) {
      const eventWorkspace = yield* selectWorkspaceById.effect(data.workspaceId);
      const currentWorkspace = yield* selectActiveWorkspace.effect();
      const workspaceTitle = eventWorkspace?.title || "Space";
      const shouldShowOpenAction = !!currentWorkspace && currentWorkspace.id !== data.workspaceId;
      yield* call(showBackgroundAgentSpawnedToast, data, workspaceTitle, shouldShowOpenAction);
    },
  );
}

export function* watchNotificationShowSaga() {
  if (typeof window === "undefined" || !window.electronAPI) return;

  yield* takeEveryFromElectronChannel<NotificationShowEvent>("notification:show", function* (data) {
    const soundEnabled: boolean = yield* selectSoundEnabled.effect();

    if (!soundEnabled) {
      return;
    }

    const soundOnlyWhenUnfocused: boolean = yield* selectSoundOnlyWhenUnfocused.effect();
    if (soundOnlyWhenUnfocused && document.hasFocus()) {
      return;
    }

    const volume: number = yield* selectNotificationVolume.effect();
    yield* call(playSoundForNotification, data.agentName, volume);
  });
}

export function* watchNotificationNavigateSaga() {
  if (typeof window === "undefined" || !window.electronAPI) return;

  yield* takeEveryFromElectronChannel<NotificationNavigateEvent>(
    "notification:navigate",
    function* (data) {
      if (!data?.workspaceId) {
        return;
      }

      yield* call(goto, `/workspace/${data.workspaceId}`);
    },
  );
}

export function* uiSaga() {
  yield* fork(watchBackgroundAgentSpawnedSaga);
  yield* fork(watchNotificationShowSaga);
  yield* fork(watchNotificationNavigateSaga);
}