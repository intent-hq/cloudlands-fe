/**
 * Token usage saga — refresh orchestration for the tokenUsage slice.
 *
 * On `refreshRequested`: skips when a scan for that workspace is already in
 * flight or the last scan is fresher than TOKEN_USAGE_REFRESH_INTERVAL_MS
 * (renderer keeps the cached state); otherwise runs the scanner with the
 * current cached `byAgentId` map and dispatches `scanCompleted`, which is
 * broadcast to renderer windows on the TOKEN_USAGE CHANGED channel.
 *
 * Cache pruning: `agent:deleted` workspace events drop that agent's entry;
 * `workspaceDeleting` drops the whole workspace entry.
 *
 * Uses dynamic imports for scanner/Electron deps to keep test bundles clean.
 */

import { call, put, takeEvery } from "typed-redux-saga";

import type {
  CachedAgentTokens,
  WorkspaceTokenScanResult,
  WorkspaceTokenUsageSnapshot,
} from "../../../../../features/token-usage/token-usage-types";
import { isAgentDeletedEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../../workspace-events/workspace-events-slice";
import { workspaceDeleting } from "../../workspace-lifecycle-events/workspace-lifecycle-events-slice";
import {
  agentRemoved,
  refreshRequested,
  scanCompleted,
  scanFailed,
  scanStarted,
  workspaceCleanedUp,
} from "../token-usage-slice";
import { selectWorkspaceTokenUsage } from "../token-usage-selectors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between full scans per workspace (refresh throttle). */
export const TOKEN_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Async helpers (dynamic imports keep fs/Electron deps out of test bundles)
// ---------------------------------------------------------------------------

/** Run the scanner service with the current per-agent cache. */
export async function runWorkspaceTokenScan(
  workspaceId: string,
  cache: Record<string, CachedAgentTokens>,
): Promise<WorkspaceTokenScanResult> {
  const { scanWorkspaceTokenUsage } = await import(
    "../../../../../features/token-usage/main/token-usage-scanner"
  );
  return scanWorkspaceTokenUsage(workspaceId, cache);
}

/** Broadcast the updated snapshot to renderer windows viewing the workspace. */
export async function broadcastTokenUsageChanged(
  snapshot: WorkspaceTokenUsageSnapshot,
): Promise<void> {
  const { sendToWorkspaceWindows } = await import(
    "../../../../../features/system/main/system.ipc"
  );
  const { TOKEN_USAGE_CHANNELS } = await import(
    "../../../../../shared/ipc/channels"
  );
  sendToWorkspaceWindows(snapshot.workspaceId, TOKEN_USAGE_CHANNELS.CHANGED, snapshot);
}

// ---------------------------------------------------------------------------
// Refresh orchestration
// ---------------------------------------------------------------------------

export function* handleRefreshRequested(
  action: ReturnType<typeof refreshRequested>,
) {
  const [wsId] = action.payload;
  const ws = yield* selectWorkspaceTokenUsage.effect(wsId);

  // No overlapping scans per workspace.
  if (ws.status === "scanning") return;

  // Throttle: serve cached state when the last scan is fresh enough.
  if (
    ws.lastScanAt !== null &&
    Date.now() - ws.lastScanAt < TOKEN_USAGE_REFRESH_INTERVAL_MS
  ) {
    return;
  }

  yield* put(scanStarted(wsId));
  try {
    const result = yield* call(runWorkspaceTokenScan, wsId, ws.byAgentId);
    yield* put(scanCompleted(wsId, result, Date.now()));
  } catch {
    // Release the in-flight guard; cached data stays untouched.
    yield* put(scanFailed(wsId));
  }
}

// ---------------------------------------------------------------------------
// Broadcast on scan completion
// ---------------------------------------------------------------------------

export function* handleScanCompleted(
  action: ReturnType<typeof scanCompleted>,
) {
  const [wsId] = action.payload;
  const ws = yield* selectWorkspaceTokenUsage.effect(wsId);
  yield* call(broadcastTokenUsageChanged, {
    workspaceId: wsId,
    byAgentId: ws.byAgentId,
    totals: ws.totals,
    byModel: ws.byModel,
    lastScanAt: ws.lastScanAt,
    status: ws.status,
  });
}

// ---------------------------------------------------------------------------
// Cache pruning
// ---------------------------------------------------------------------------

export function* handleAgentDeletedForTokenUsage(
  action: ReturnType<typeof workspaceEventAccepted>,
) {
  const [event] = action.payload;
  if (!isAgentDeletedEvent(event)) return;
  if (!event.workspaceId) return;
  yield* put(agentRemoved(event.workspaceId, event.data.agentId));
}

export function* handleWorkspaceDeletingForTokenUsage(
  action: ReturnType<typeof workspaceDeleting>,
) {
  const [data] = action.payload;
  yield* put(workspaceCleanedUp(data.workspaceId));
}

// ---------------------------------------------------------------------------
// Static registry entry
// ---------------------------------------------------------------------------

export function* tokenUsageSaga() {
  yield* takeEvery(refreshRequested, handleRefreshRequested);
  yield* takeEvery(scanCompleted, handleScanCompleted);
  yield* takeEvery(workspaceEventAccepted, handleAgentDeletedForTokenUsage);
  yield* takeEvery(workspaceDeleting, handleWorkspaceDeletingForTokenUsage);
}

