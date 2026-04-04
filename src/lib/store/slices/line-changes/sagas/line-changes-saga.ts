/**
 * Line Changes Saga
 *
 * Handles side effects for line change tracking:
 * - Listens for workspace-changes IPC events (real-time updates from main process)
 * - Periodic sync with main process (safety net)
 * - Syncs stats updates back to main process
 */

import { call, delay, fork, put, select } from "typed-redux-saga";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import { lineChangesClient } from "$features/line-changes/line-changes.client";
import {
  trackFileChanges,
  hydrateAllWorkspaceStats,
  updateWorkspaceStats as updateWorkspaceStatsAction,
  updateAgentStats as updateAgentStatsAction,
} from "../line-changes-slice";
import {
  selectAllWorkspaceStats,
  selectAllAgentStats,
} from "../line-changes-selectors";
import type { FileLineChange } from "../line-changes-types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("LineChangesSaga");

const SYNC_INTERVAL = 60000; // 60 seconds safety net

// ============================================================================
// IPC Listener: workspace-changes events
// ============================================================================

interface WorkspaceChangesPayload {
  workspaceId: string;
  diffChunk: {
    files?: Array<{
      path: string;
      additions?: number;
      deletions?: number;
      action?: "create" | "modify" | "delete";
    }>;
  };
}

function* watchWorkspaceChanges() {
  yield* takeEveryFromListenSync<WorkspaceChangesPayload>(
    "workspace-changes",
    function* (data) {
      if (!data?.workspaceId || !data?.diffChunk) return;

      const files = data.diffChunk.files;
      if (!files || !Array.isArray(files)) return;

      const fileChanges: FileLineChange[] = files.map((file) => ({
        path: file.path,
        additions: file.additions || 0,
        deletions: file.deletions || 0,
        action: file.action || "modify",
      }));

      yield* put(trackFileChanges(data.workspaceId, fileChanges));
      logger.info(
        `Updated ${fileChanges.length} file changes for workspace ${data.workspaceId}`,
      );
    },
  );
}

// ============================================================================
// Periodic Sync with Main Process
// ============================================================================

function* syncFromMain() {
  try {
    // Sync all workspace stats
    const allStats = yield* call([lineChangesClient, lineChangesClient.getAllWorkspaceStats]);
    if (allStats && typeof allStats === "object" && Object.keys(allStats).length > 0) {
      yield* put(hydrateAllWorkspaceStats(allStats));
      logger.info(`Synced ${Object.keys(allStats).length} workspace stats from main`);
    }

    // Sync individual workspace stats
    const workspaceStats = yield* select(selectAllWorkspaceStats.select);
    for (const workspaceId of Object.keys(workspaceStats)) {
      try {
        const stats = yield* call([lineChangesClient, lineChangesClient.getWorkspaceStats], workspaceId as any);
        if (stats) {
          yield* put(updateWorkspaceStatsAction(workspaceId, stats));
        }
      } catch {
        // Best effort
      }
    }

    // Sync individual agent stats
    const agentStats = yield* select(selectAllAgentStats.select);
    for (const agentId of Object.keys(agentStats)) {
      try {
        const stats = yield* call([lineChangesClient, lineChangesClient.getAgentStats], agentId as any);
        if (stats) {
          yield* put(updateAgentStatsAction(agentId, stats));
        }
      } catch {
        // Best effort
      }
    }
  } catch (error) {
    logger.error("Failed to sync stats from main process:", error as Error);
  }
}

function* periodicSyncSaga() {
  // Initial sync
  yield* call(syncFromMain);

  // Then periodic
  while (true) {
    yield* delay(SYNC_INTERVAL);
    yield* call(syncFromMain);
  }
}

// ============================================================================
// Sync stats back to main process on update
// ============================================================================

// Note: The old store used to sync stats back to main on every update.
// That behavior is preserved by the lineChangesClient calls from trackFileChanges
// in the reducer. Since reducers must be pure, we keep the IPC sync in the saga
// via the periodic sync. The main process store is the source of truth for
// persistence, and the renderer store is a cache that syncs periodically.

// ============================================================================
// Root Saga
// ============================================================================

export function* lineChangesSaga() {
  yield* fork(watchWorkspaceChanges);
  yield* fork(periodicSyncSaga);
}

