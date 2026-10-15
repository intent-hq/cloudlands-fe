import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { GitWriteState } from './git-write-types';
export function getGitWriteOperation(
  state: { gitWrite: GitWriteState },
  workspaceId: string,
  requestId: string,
) {
  const operations = state.gitWrite.byWorkspaceId[workspaceId]?.operations;
  return operations ? getItem(operations, requestId) : undefined;
}
export function getGitWriteOperations(state: { gitWrite: GitWriteState }, workspaceId: string) {
  const operations = state.gitWrite.byWorkspaceId[workspaceId]?.operations;
  return operations ? getItems(operations) : [];
}
export function getGitWritePending(state: { gitWrite: GitWriteState }, workspaceId: string) {
  return getGitWriteOperations(state, workspaceId).some(
    (entry) => entry.status === 'queued' || entry.status === 'running',
  );
}

/** Match the initiating principal/root; unkeyed source receipts require an omitted key. */
export function getGitCurrentIndexCommit(
  state: { gitWrite: GitWriteState },
  workspaceId: string,
  authorityKey?: string | null,
) {
  const commits = getGitWriteOperations(state, workspaceId).filter(
    (entry) =>
      entry.operation.kind === 'commit' &&
      entry.operation.params.currentIndex &&
      entry.operation.authorityKey === authorityKey,
  );
  return (
    commits.find(
      (entry) =>
        entry.status === 'queued' || entry.status === 'running' || entry.status === 'unknown',
    ) ?? commits.at(-1)
  );
}
