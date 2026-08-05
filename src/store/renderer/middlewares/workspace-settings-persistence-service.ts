/**
 * Workspace-settings persistence service — restores the auto-commit IPC
 * persistence that the removed `workspace-settings/sagas/persistence-saga`
 * performed. With no saga listening, setAutoCommitEnabled dispatched from
 * CodeChangesPanel.svelte has NO EFFECT — the setting is not persisted to
 * main process or electron-store, so every restart reverts to default.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   - Watches setAutoCommitEnabled action
 *   - Invokes WORKSPACE_CHANNELS.UPDATE_SETTINGS with {id, settings:{autoCommitEnabled}}
 *   - Invokes SETTINGS_CHANNELS.SET with {key:"autoCommit", value} for electron-store persistence
 *   - If the daemon-backed UPDATE_SETTINGS rejects (e.g. -32602 for the
 *     virtual Chief workspace, PROTOCOL §5.1), the optimistic toggle is
 *     REVERTED to the previous value so the UI never presents a state the
 *     daemon refused to persist. The revert dispatch is loop-guarded so it
 *     is not itself re-persisted.
 *
 * IPC handlers exist in main at workspace.ipc.ts (UPDATE_SETTINGS) and are
 * unchanged. Storage key "autoCommit" matches the deleted saga so existing
 * users' stored values are honored.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only IPC client,
 * slice actions, and safe logger — no selectors, no module-scope state reads.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { invoke } from "$shared/generated/ipc-client";
import { WORKSPACE_CHANNELS, SETTINGS_CHANNELS } from "$shared/ipc/channels";
import type { StoreState } from "../types";
import { setAutoCommitEnabled } from "../slices/workspace-settings/workspace-settings-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("WorkspaceSettingsPersistenceService");

/** Workspace ids whose next setAutoCommitEnabled dispatch is a revert (skip persistence). */
const revertingWorkspaceIds = new Set<string>();

/**
 * Sync autoCommit setting to main process for a workspace.
 * Also persists to electron-store so it survives app restarts.
 * Returns whether the daemon-backed workspace-settings write succeeded.
 */
async function syncToMainProcess(workspaceId: string, autoCommitEnabled: boolean): Promise<boolean> {
  let synced = true;
  // Update workspace-level settings
  try {
    await invoke(WORKSPACE_CHANNELS.UPDATE_SETTINGS, {
      id: workspaceId,
      settings: { autoCommitEnabled },
    });
  } catch (error) {
    logger.warn("Failed to sync autoCommit to main process", {
      workspaceId,
      autoCommitEnabled,
      error,
    });
    synced = false;
  }

  // Persist to electron-store so the setting survives app restarts
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await invoke(SETTINGS_CHANNELS.SET, {
        key: "autoCommit",
        value: autoCommitEnabled,
      });
    }
  } catch (error) {
    logger.warn("Failed to persist autoCommit to electron-store", {
      autoCommitEnabled,
      error,
    });
  }
  return synced;
}

/**
 * Middleware giving workspace-settings persistence real handlers again.
 * Watches setAutoCommitEnabled and persists via IPC to main + electron-store;
 * reverts the toggle when the daemon rejects the write.
 */
export function createWorkspaceSettingsPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    if (action && action.type === setAutoCommitEnabled.type) {
      const [workspaceId, enabled] = (action as ReturnType<typeof setAutoCommitEnabled>).payload;
      if (revertingWorkspaceIds.has(workspaceId)) {
        // This dispatch undoes a failed persist — apply it without re-persisting.
        revertingWorkspaceIds.delete(workspaceId);
        return next(action);
      }
      const previousEnabled =
        (api.getState() as StoreState).workspaceSettings.byWorkspaceId[workspaceId]
          ?.autoCommitEnabled ?? true;
      const result = next(action);
      // Read the updated state to confirm the reducer ran
      const state = api.getState() as StoreState;
      const autoCommitEnabled = state.workspaceSettings.byWorkspaceId[workspaceId]?.autoCommitEnabled ?? enabled;
      // Async persist (errors logged); on daemon rejection revert the toggle
      // so the UI does not silently diverge from the persisted state.
      void syncToMainProcess(workspaceId, autoCommitEnabled).then((synced) => {
        if (!synced && previousEnabled !== autoCommitEnabled) {
          revertingWorkspaceIds.add(workspaceId);
          api.dispatch(setAutoCommitEnabled(workspaceId, previousEnabled));
        }
      });
      return result;
    }
    return next(action);
  };
}
