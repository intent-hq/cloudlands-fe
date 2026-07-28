/**
 * Agent Lock Utilities
 *
 * Shared utilities for determining if agent changes are "locked" and shouldn't be
 * manually staged/unstaged/reverted. This prevents users from accidentally interfering
 * with auto-commit when agents are working or have pending commits.
 *
 * A change is locked when:
 * 1. Auto-commit is globally enabled AND
 * 2. The change belongs to an agent that is either:
 *    - Actively working (streaming or task not in terminal status), OR
 *    - Has uncommitted changes that will be auto-committed
 */

import type { TrackedChange } from '$features/file-tracking/types';
import { m } from '$shared/paraglide/messages.js';

/**
 * The tooltip message to show when a file is locked.
 * Getter so the string re-resolves when the locale changes.
 */
export function getLockedTooltip(): string {
  return m.chat_changesPanel_lockedFile_tooltip();
}

/**
 * Check if a specific file path belongs to a locked agent.
 * @param filePath - The path of the file to check
 * @param staged - Whether to check staged or unstaged changes
 * @param changes - The list of changes to search in
 * @param lockedAgentIds - Set of agent IDs that are currently locked
 */
export function isFileLocked(
  filePath: string,
  staged: boolean,
  stagedChanges: TrackedChange[],
  unstagedChanges: TrackedChange[],
  lockedAgentIds: Set<string>,
): boolean {
  const changes = staged ? stagedChanges : unstagedChanges;
  const change = changes.find((c) => c.relativePath === filePath || c.file === filePath);
  if (!change) return false;
  const agentId = change.attribution?.agent?.agentId;
  return agentId ? lockedAgentIds.has(agentId) : false;
}

/**
 * Get the agent ID from a tracked change, if any.
 */
export function getAgentIdFromChange(change: TrackedChange): string | null {
  return change.attribution?.agent?.agentId ?? null;
}

/**
 * Filter changes to exclude those belonging to locked agents.
 */
export function filterUnlockedChanges(
  changes: TrackedChange[],
  lockedAgentIds: Set<string>,
): TrackedChange[] {
  return changes.filter((c) => {
    const agentId = c.attribution?.agent?.agentId;
    return !agentId || !lockedAgentIds.has(agentId);
  });
}
