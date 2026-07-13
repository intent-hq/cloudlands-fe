/**
 * Utility functions for comparing tracked changes
 *
 * These functions are extracted from the file tracking store for testability.
 */

import type { TrackedChange, StageTransition, CommitInfo } from './types';

/**
 * Check if two arrays of tracked changes have meaningful differences.
 *
 * This is used to determine if the UI should update when receiving new change data.
 * Returns true if there are differences, false if they are effectively identical.
 *
 * Compares:
 * - Array length
 * - File path + stage combinations
 * - Stats (additions/deletions)
 * - Status and stable attribution/content metadata
 *
 * Ignores volatile backend-generated change IDs and attribution timestamps so
 * semantically identical change lists do not trigger redundant UI updates.
 */
export function hasChangesDifference(
  existing: TrackedChange[],
  incoming: TrackedChange[],
): boolean {
  if (existing.length !== incoming.length) return true;

  // Create a map of existing changes by file path AND stage for quick lookup
  // A file can have both staged and unstaged entries (e.g., when you edit a staged file)
  const existingByPathAndStage = new Map(existing.map((c) => [`${c.relativePath}:${c.stage}`, c]));

  for (const newChange of incoming) {
    const key = `${newChange.relativePath}:${newChange.stage}`;
    const existingChange = existingByPathAndStage.get(key);

    if (!existingChange) return true;
    // Check if path or status changed
    if (existingChange.file !== newChange.file || existingChange.status !== newChange.status) {
      return true;
    }
    // Check if stats changed
    if (
      existingChange.stats?.additions !== newChange.stats?.additions ||
      existingChange.stats?.deletions !== newChange.stats?.deletions ||
      existingChange.stats?.binary !== newChange.stats?.binary
    ) {
      return true;
    }
    // Check stable attribution metadata while ignoring volatile timestamps
    if (!hasSameStableAttribution(existingChange, newChange)) {
      return true;
    }
    if (!hasSameContentMetadata(existingChange, newChange)) {
      return true;
    }
  }

  return false;
}

function hasSameStableAttribution(existing: TrackedChange, incoming: TrackedChange): boolean {
  const existingAgent = existing.attribution?.agent;
  const incomingAgent = incoming.attribution?.agent;

  return (
    existing.attribution?.manual === incoming.attribution?.manual &&
    existingAgent?.agentId === incomingAgent?.agentId &&
    existingAgent?.agentName === incomingAgent?.agentName &&
    existingAgent?.sessionId === incomingAgent?.sessionId &&
    existingAgent?.turnNumber === incomingAgent?.turnNumber &&
    existingAgent?.messageId === incomingAgent?.messageId &&
    existingAgent?.toolCallId === incomingAgent?.toolCallId
  );
}

function hasSameContentMetadata(existing: TrackedChange, incoming: TrackedChange): boolean {
  return (
    existing.content?.oldContentSha === incoming.content?.oldContentSha &&
    existing.content?.oldContent === incoming.content?.oldContent &&
    existing.content?.newContentSha === incoming.content?.newContentSha &&
    existing.content?.newContent === incoming.content?.newContent &&
    existing.content?.diffSha === incoming.content?.diffSha &&
    existing.content?.diff === incoming.content?.diff &&
    existing.content?.isFullFileContent === incoming.content?.isFullFileContent
  );
}

/**
 * Check if two arrays of stage transitions have meaningful differences.
 *
 * Transitions are append-only, so we just check if the last one matches.
 */
export function hasTransitionsDifference(
  existing: StageTransition[],
  incoming: StageTransition[],
): boolean {
  if (existing.length !== incoming.length) return true;
  if (existing.length === 0) return false;

  // Transitions are append-only, so just check the last one matches
  const lastExisting = existing[existing.length - 1];
  const lastIncoming = incoming[incoming.length - 1];
  return (
    lastExisting.changeId !== lastIncoming.changeId ||
    lastExisting.fromStage !== lastIncoming.fromStage ||
    lastExisting.toStage !== lastIncoming.toStage
  );
}

/**
 * Check if two arrays of commits have meaningful differences.
 */
export function hasCommitsDifference(existing: CommitInfo[], incoming: CommitInfo[]): boolean {
  if (existing.length !== incoming.length) return true;

  const existingByHash = new Map(existing.map((c) => [c.hash, c]));

  for (const commit of incoming) {
    const existingCommit = commit.hash ? existingByHash.get(commit.hash) : undefined;
    if (!existingCommit) return true;
    if (existingCommit.message !== commit.message) return true;
    if (existingCommit.timestamp !== commit.timestamp) return true;
    // Check isPushed status - important for push/undo-push operations
    if (existingCommit.isPushed !== commit.isPushed) return true;

    // Compare file counts - use filesChanged or fall back to files array length
    const existingFileCount = existingCommit.filesChanged ?? existingCommit.files?.length ?? 0;
    const incomingFileCount = commit.filesChanged ?? commit.files?.length ?? 0;
    if (existingFileCount !== incomingFileCount) {
      return true;
    }
  }

  return false;
}
