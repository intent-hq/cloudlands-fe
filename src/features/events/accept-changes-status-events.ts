const ACCEPT_CHANGES_STATUS_EVENT_FAMILIES = ['git:', 'pr:'] as const;
const ACCEPT_CHANGES_STATUS_EVENT_TYPES = ['changes:git-status'] as const;

export function isAcceptChangesStatusEvent(type: string): boolean {
  return (
    ACCEPT_CHANGES_STATUS_EVENT_FAMILIES.some((prefix) => type.startsWith(prefix)) ||
    ACCEPT_CHANGES_STATUS_EVENT_TYPES.includes(
      type as (typeof ACCEPT_CHANGES_STATUS_EVENT_TYPES)[number],
    )
  );
}
import type { WorkspaceGitStatus } from '$features/accept-changes/types';

export function isPushedAcceptChangesStatus(value: unknown): value is WorkspaceGitStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.branch === 'string' &&
    typeof status.trunkBranch === 'string' &&
    ['aheadOfTrunk', 'behindTrunk', 'uncommittedCount', 'stagedCount'].every(
      (key) => typeof status[key] === 'number',
    ) &&
    ['hasRemote', 'isPushed'].every((key) => typeof status[key] === 'boolean') &&
    Array.isArray(status.localCommits)
  );
}
