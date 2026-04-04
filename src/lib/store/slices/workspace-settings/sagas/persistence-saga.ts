import { call, takeEvery } from "typed-redux-saga";
import { setAutoCommitEnabled } from "../workspace-settings-slice";
import { selectAutoCommitEnabled } from "../workspace-settings-selectors";
import { invoke } from "$lib/electron-bridge";
import { WORKSPACE_CHANNELS, SETTINGS_CHANNELS } from "$shared/ipc/channels";

/**
 * Sync autoCommit setting to main process for a workspace.
 * Also persists to electron-store so it survives app restarts.
 */
async function syncToMainProcess(workspaceId: string, autoCommitEnabled: boolean): Promise<void> {
  // Update workspace-level settings
  try {
    await invoke(WORKSPACE_CHANNELS.UPDATE_SETTINGS, {
      id: workspaceId,
      settings: { autoCommitEnabled },
    });
  } catch (error) {
    console.warn("[WorkspaceSettings] Failed to sync autoCommit to main process", {
      workspaceId,
      autoCommitEnabled,
      error,
    });
  }

  // Persist to electron-store so the setting survives app restarts
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await window.electronAPI.invoke(SETTINGS_CHANNELS.SET, {
        key: "autoCommit",
        value: autoCommitEnabled,
      });
    }
  } catch (error) {
    console.warn("[WorkspaceSettings] Failed to persist autoCommit to electron-store", {
      autoCommitEnabled,
      error,
    });
  }
}

/**
 * Watches for autoCommit setting changes and persists via IPC.
 */
export function* persistenceSaga() {
  yield* takeEvery(
    setAutoCommitEnabled.type,
    function* (action: ReturnType<typeof setAutoCommitEnabled>) {
      const [workspaceId] = action.payload;
      const autoCommitEnabled = yield* selectAutoCommitEnabled.effect(workspaceId);
      yield* call(syncToMainProcess, workspaceId, autoCommitEnabled);
    }
  );
}

