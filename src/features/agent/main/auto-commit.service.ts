/**
 * Auto-Commit Service
 *
 * The FE no longer drives auto-commit on agent idle — the daemon owns that path.
 * What remains here is the per-agent status history that the renderer queries
 * via the git.ipc `GET_AUTO_COMMIT_STATUS` channel on mount.
 */

/**
 * Per-agent auto-commit status history.
 * Stores all auto-commit results for each agent as an ordered list so the renderer
 * can display them anchored to the correct turn (domain events are ephemeral and
 * missed if the component isn't mounted yet).
 */
export type AutoCommitStatusData =
  | { state: 'committing'; agentName?: string }
  | { state: 'committed'; hash: string; message: string; fileCount: number; agentName?: string }
  | { state: 'hook-failure'; status: 'waking-agent' | 'retries-exhausted'; retryCount: number; agentName?: string };

const autoCommitHistory = new Map<string, AutoCommitStatusData[]>();

/**
 * Get all auto-commit statuses for a given agent.
 * Called by the IPC handler so the renderer can query on mount.
 */
export function getAutoCommitStatuses(agentId: string): AutoCommitStatusData[] {
  return autoCommitHistory.get(agentId) ?? [];
}
