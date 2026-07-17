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
 *
 * IPC handlers exist in main at workspace.ipc.ts (UPDATE_SETTINGS) and are
 * unchanged. Storage key "autoCommit" matches the deleted saga so existing
 * users' stored values are honored.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only IPC client,
 * slice actions, and safe logger — no selectors, no module-scope state reads.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { invoke } from "$shared/generated/ipc-client";
import { WORKSPACE_CHANNELS, SETTINGS_CHANNELS } from "$shared/ipc/channels";
import type { StoreState } from "../types";
import { setAutoCommitEnabled } from "../slices/workspace-settings/workspace-settings-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("WorkspaceSettingsPersistenceService");

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
    logger.warn("Failed to sync autoCommit to main process", {
      workspaceId,
      autoCommitEnabled,
      error,
    });
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
}

/**
 * Middleware giving workspace-settings persistence real handlers again.
 * Watches setAutoCommitEnabled and persists via IPC to main + electron-store.
 */
export function createWorkspaceSettingsPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    const result = next(action);
    if (action && action.type === setAutoCommitEnabled.type) {
      const [workspaceId, enabled] = (action as ReturnType<typeof setAutoCommitEnabled>).payload;
      // Read the updated state to confirm the reducer ran
      const state = api.getState() as StoreState;
      const autoCommitEnabled = state.workspaceSettings.byWorkspaceId[workspaceId]?.autoCommitEnabled ?? enabled;
      // Async persist (fire and forget, errors logged)
      void syncToMainProcess(workspaceId, autoCommitEnabled);
    }
    return result;
  };
}
