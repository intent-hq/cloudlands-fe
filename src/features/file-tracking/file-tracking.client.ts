/**
 * File Tracking Client
 *
 * Daemon-backed line-stats read (PROTOCOL §5.19 `file-tracking.getLineStats`).
 *
 * Formerly invoked `file-tracking:get-line-stats` IPC against the local
 * main-process tracker — a split-brain store daemon-spawned agents never fed.
 * The read now goes over `backendRequest` so the title bar reflects the
 * daemon's real-time totals across unstaged + staged + local commits. Errors
 * fold to zeros — the badge is informational and must never throw into the UI.
 */

import { backendRequest } from '$lib/client/live/backend-transport';

export interface LineStats {
  additions: number;
  deletions: number;
}

/**
 * Get line change statistics for a workspace (PROTOCOL §5.19).
 * Returns real-time additions/deletions calculated by the daemon from:
 * - Unstaged changes
 * - Staged changes
 * - Local commits (not yet pushed)
 */
export async function getLineStats(workspaceId: string): Promise<LineStats> {
  try {
    const result = await backendRequest<Record<string, unknown>>('file-tracking.getLineStats', {
      workspaceId,
    });
    return {
      additions: typeof result?.additions === 'number' ? result.additions : 0,
      deletions: typeof result?.deletions === 'number' ? result.deletions : 0,
    };
  } catch {
    return { additions: 0, deletions: 0 };
  }
}
