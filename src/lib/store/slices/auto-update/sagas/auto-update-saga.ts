import { autoUpdateStore } from "$features/auto-update/auto-update.store.svelte";
import { takeEveryFromElectronChannel } from "$lib/store/utils/ipc-channel";
import { call, fork } from "typed-redux-saga";

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
  }
}

export function* watchAutoUpdateUpToDateSaga() {
  yield* takeEveryFromElectronChannel<UpToDateEvent>("auto-update:up-to-date", function* (data) {
    if (autoUpdateStore.toastVisible) {
      return;
    }

    yield* call(showUpToDateToast, data);
  });
}

export function* autoUpdateSaga() {
  yield* fork(watchAutoUpdateUpToDateSaga);
}