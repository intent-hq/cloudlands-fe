import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { getGitWorkspaceState } from './git-slice';
import type { GitState, GitReadResult, GitReadView } from './git-types';

export function getGitRead(
  state: { git: GitState },
  wsId: string,
  consumerId: string,
): GitReadView | undefined {
  const ws = getGitWorkspaceState(state.git, wsId);
  const consumer = getItem(ws.readConsumers, consumerId);
  const entry = consumer && getItem(ws.reads, consumer.readKey);
  if (!consumer || !entry) return undefined;
  const stored = entry.result;
  let result: GitReadResult | null = null;
  if (stored?.kind === 'diffs') result = { ...stored, chunks: getItems(stored.chunks) };
  else if (stored?.kind === 'commitDetails')
    result = {
      ...stored,
      details: stored.details
        ? { ...stored.details, fileDetails: getItems(stored.details.fileDetails) }
        : null,
    };
  else if (stored?.kind === 'numstat') result = { ...stored, entries: getItems(stored.entries) };
  else if (stored?.kind === 'autoCommitStatus')
    result = { ...stored, statuses: getItems(stored.statuses).map(({ status }) => status) };
  else result = stored;
  return {
    requestId: consumer.requestId,
    request: entry.request,
    loading: entry.loading,
    error: entry.error,
    result,
  };
}
