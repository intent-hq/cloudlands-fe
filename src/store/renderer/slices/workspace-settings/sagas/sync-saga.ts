import {
  call,
  join,
  put,
  takeEvery,
} from "typed-redux-saga";
import type { Task } from "redux-saga";
import {
  syncWorkspaceSettings,
  refreshAutoCommitSettings,
  loadAutoCommitSettings,
} from "../workspace-settings-slice";
import { selectAutoCommitEnabled } from "../workspace-settings-selectors";
import { invoke } from "$lib/electron-bridge";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import {
  initSaga,
  getGlobalAutoCommitDefault,
} from "./init-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";

/**
 * Track which workspaces have been synced this session.
 * This is saga-local state (not in Redux) since it's session-only.
 */
const syncedWorkspaces = new Set<string>();

/**
 * Sync autoCommit setting to main process for a workspace.
 */
async function syncToWorkspace(workspaceId: string, autoCommitEnabled: boolean): Promise<void> {
  try {
    await invoke(WORKSPACE_CHANNELS.UPDATE_SETTINGS, {
      id: workspaceId,
      settings: { autoCommitEnabled },
    });
  } catch (error) {
    console.warn("[WorkspaceSettings] Failed to sync settings to workspace", {
      workspaceId,
      autoCommitEnabled,
      error,
    });
  }
}

/**
 * Watches for syncWorkspaceSettings actions.
 * Only syncs once per workspace per session.
 */
export function* syncSaga(initTask: Task) {
  // Trigger syncWorkspaceSettings on workspace mount so components don't need to dispatch it
  yield* takeEvery(
    workspaceMounted,
    function* (action: ReturnType<typeof workspaceMounted>) {
      const [workspaceId] = action.payload;
      yield* put(syncWorkspaceSettings(workspaceId));
    }
  );

  yield* takeEvery(
    syncWorkspaceSettings,
    function* (action: ReturnType<typeof syncWorkspaceSettings>) {
      const [workspaceId] = action.payload;
      if (syncedWorkspaces.has(workspaceId)) return;
      syncedWorkspaces.add(workspaceId);
      yield* join(initTask);
      // Initialize this workspace's settings from the global default
      yield* put(loadAutoCommitSettings(workspaceId, getGlobalAutoCommitDefault()));
      const autoCommitEnabled = yield* selectAutoCommitEnabled.effect(workspaceId);
      yield* call(syncToWorkspace, workspaceId, autoCommitEnabled);
    }
  );

  yield* takeEvery(
    refreshAutoCommitSettings,
    function* () {
      const previouslySynced = [...syncedWorkspaces];
      // Clear synced workspaces so all workspaces re-sync on next access
      syncedWorkspaces.clear();
      // Reload from IPC
      yield* call(initSaga);

      for (const workspaceId of previouslySynced) {
        syncedWorkspaces.add(workspaceId);
        yield* put(loadAutoCommitSettings(workspaceId, getGlobalAutoCommitDefault()));
        const autoCommitEnabled = yield* selectAutoCommitEnabled.effect(workspaceId);
        yield* call(syncToWorkspace, workspaceId, autoCommitEnabled);
      }
    }
  );
}

