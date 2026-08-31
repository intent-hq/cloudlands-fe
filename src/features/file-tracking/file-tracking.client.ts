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
import { store as appStore } from '$store/renderer/store';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';

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

/** Fold a wire string[] into the slice's `Record<string, true>` lookup shape. */
export function toLockRecord(value: unknown): Record<string, true> {
  const record: Record<string, true> = {};
  if (!Array.isArray(value)) return record;
  for (const entry of value) {
    if (typeof entry === 'string') record[entry] = true;
  }
  return record;
}

/**
 * Hydrate a workspace's agent-lock snapshot from the daemon
 * (PROTOCOL §5.19 `file-tracking.getAgentLocks` — the hydration read for the
 * `changes:agent-locks` event, §6.5) and fold it into the agent-lock slice.
 * Errors are swallowed: a failed read leaves the current (default-empty,
 * unlocked) state, matching the daemon's own degrade-to-unlocked behavior.
 */
export async function hydrateAgentLocks(workspaceId: string): Promise<void> {
  try {
    const result = await backendRequest<Record<string, unknown>>('file-tracking.getAgentLocks', {
      workspaceId,
    });
    appStore.dispatch(
      setAgentLockState(
        workspaceId,
        toLockRecord(result?.lockedAgentIds),
        toLockRecord(result?.lockedFilePaths),
      ),
    );
  } catch {
    // Leave current state; the `changes:agent-locks` event converges it later.
  }
}
