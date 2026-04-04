import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateProgress, UpdateState } from "$features/auto-update/types";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { call, delay, fork, put, takeEvery } from "typed-redux-saga";
import { selectAutoUpdateToastVisible, selectAutoUpdateStatus } from "../auto-update-selectors";
import {
  checkForUpdates,
  checkForUpdatesManual,
  downloadUpdate,
  initAutoUpdate,
  installUpdate,
  setChannel,
  setChannelIPC,
  setCheckTimedOut,
  setProgress,
  setUpdateError,
  setUpdateState,
  setUpToDate,
  showToast,
  showToastChecking,
} from "../auto-update-slice";

// Delay before attempting to initialize (allows IPC handlers to be registered)
const INIT_DELAY_MS = 2000;
// Number of retries if IPC handler not ready
const MAX_RETRIES = 3;
// Delay between retries
const RETRY_DELAY_MS = 1000;
// Timeout for update check (if no response, assume network issue)
const CHECK_TIMEOUT_MS = 15000;

type UpToDateEvent = {
  version: string;
  isDev?: boolean;
};

async function showUpToDateToast(data: UpToDateEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    const message = data.isDev
      ? "You're running a development build"
      : `You're running the latest version (${data.version})`;

    toast.success("Up to Date", {
      description: message,
      duration: 4000,
    });
  } catch {
    // ignore
  }
}

async function tryGetInitialState(retries = 0): Promise<UpdateState | null> {
  try {
    return await autoUpdateClient.getState();
  } catch (e) {
    const errorMessage = (e as Error).message || "";
    if (errorMessage.includes("No handler registered") && retries < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return tryGetInitialState(retries + 1);
    }
    console.error("[AutoUpdate] Failed to get initial update state:", e);
    return null;
  }
}

// --- IPC watchers ---

export function* watchAutoUpdateUpToDateSaga() {
  yield* takeEveryFromElectronChannel<UpToDateEvent>("auto-update:up-to-date", function* (data) {
    const toastVisible = yield* selectAutoUpdateToastVisible.effect();
    if (toastVisible) {
      // Update state but don't show the separate toast — the UI toast handles it
      yield* put(setUpToDate(data.version || ""));
      return;
    }
    yield* call(showUpToDateToast, data);
  });
}

function* watchStatusChanged() {
  yield* takeEveryFromElectronChannel<UpdateState>("auto-update:status-changed", function* (data) {
    yield* put(setUpdateState(data));
  });
}

function* watchProgress() {
  yield* takeEveryFromElectronChannel<UpdateProgress>("auto-update:progress", function* (data) {
    yield* put(setProgress(data));
  });
}

function* watchShowToast() {
  yield* takeEveryFromElectronChannel<Record<string, never>>(
    "auto-update:show-toast",
    function* () {
      yield* put(showToastChecking());
      // Safety timeout for menu-triggered checks
      yield* delay(CHECK_TIMEOUT_MS);
      const status = yield* selectAutoUpdateStatus.effect();
      if (status === "checking") {
        console.warn("[AutoUpdate] Menu-triggered check timed out");
        yield* put(setCheckTimedOut());
      }
    },
  );
}

// --- Action handlers ---

function* handleInitAutoUpdate() {
  yield* delay(INIT_DELAY_MS);
  const initialState = yield* call(tryGetInitialState);
  if (initialState) {
    yield* put(setUpdateState(initialState));
  }
}

function* handleCheckForUpdates() {
  try {
    const result: UpdateState = yield* call([autoUpdateClient, autoUpdateClient.checkForUpdates]);
    yield* put(setUpdateState(result));
  } catch (e) {
    console.error("Failed to check for updates:", e);
    yield* put(setUpdateError((e as Error).message));
  }
}

function* handleCheckForUpdatesManual() {
  yield* put(showToast());
  yield* put(showToastChecking());

  // Fork a timeout that will fire if the check takes too long
  yield* fork(function* () {
    yield* delay(CHECK_TIMEOUT_MS);
    const status = yield* selectAutoUpdateStatus.effect();
    if (status === "checking") {
      console.warn("[AutoUpdate] Check timed out, assuming network issue");
      yield* put(setCheckTimedOut());
    }
  });

  try {
    const result: UpdateState = yield* call([
      autoUpdateClient,
      autoUpdateClient.checkForUpdatesManual,
    ]);
    // Only update state if we're still in checking state (timeout might have changed it)
    const status = yield* selectAutoUpdateStatus.effect();
    if (status === "checking") {
      yield* put(setUpdateState(result));
    }
  } catch (e) {
    console.error("Failed to check for updates:", e);
    yield* put(setUpdateError((e as Error).message));
  }
}

function* handleDownloadUpdate() {
  try {
    yield* call([autoUpdateClient, autoUpdateClient.downloadUpdate]);
  } catch (e) {
    console.error("Failed to download update:", e);
    yield* put(setUpdateError((e as Error).message));
  }
}

function* handleInstallUpdate() {
  try {
    yield* call([autoUpdateClient, autoUpdateClient.installUpdate]);
  } catch (e) {
    console.error("Failed to install update:", e);
  }
}

function* handleSetChannelIPC(action: ReturnType<typeof setChannelIPC>) {
  const [channel] = action.payload;
  try {
    yield* call([autoUpdateClient, autoUpdateClient.setChannel], channel);
    yield* put(setChannel(channel));
  } catch (e) {
    console.error("Failed to set update channel:", e);
  }
}

// --- Root saga ---

export function* autoUpdateSaga() {
  yield* fork(watchAutoUpdateUpToDateSaga);
  yield* fork(watchStatusChanged);
  yield* fork(watchProgress);
  yield* fork(watchShowToast);
  yield* takeEvery(initAutoUpdate, handleInitAutoUpdate);
  yield* takeEvery(checkForUpdates, handleCheckForUpdates);
  yield* takeEvery(checkForUpdatesManual, handleCheckForUpdatesManual);
  yield* takeEvery(downloadUpdate, handleDownloadUpdate);
  yield* takeEvery(installUpdate, handleInstallUpdate);
  yield* takeEvery(setChannelIPC, handleSetChannelIPC);
}