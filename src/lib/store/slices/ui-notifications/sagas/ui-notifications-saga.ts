import { goto } from "$app/navigation";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { selectNotificationVolume, selectSoundEnabled, selectSoundOnlyWhenUnfocused } from "$lib/store/slices/user-preferences/user-preferences-selectors";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { call, fork, select } from "typed-redux-saga";

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

async function showBackgroundAgentSpawnedToast(data: BackgroundAgentSpawnedEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    const eventWorkspace = workspaceStore.items.find((workspace) => workspace.id === data.workspaceId);
    const currentWorkspace = workspaceStore.current;
    const workspaceTitle = eventWorkspace?.title || "Space";
    const shouldShowOpenAction = !!currentWorkspace && currentWorkspace.id !== data.workspaceId;

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
      yield* call(showBackgroundAgentSpawnedToast, data);
    },
  );
}

export function* watchNotificationShowSaga() {
  if (typeof window === "undefined" || !window.electronAPI) return;

  yield* takeEveryFromElectronChannel<NotificationShowEvent>("notification:show", function* (data) {
    const soundEnabled: boolean = yield* select(selectSoundEnabled.select);

    if (!soundEnabled) {
      return;
    }

    const soundOnlyWhenUnfocused: boolean = yield* select(selectSoundOnlyWhenUnfocused.select);
    if (soundOnlyWhenUnfocused && document.hasFocus()) {
      return;
    }

    const volume: number = yield* select(selectNotificationVolume.select);
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