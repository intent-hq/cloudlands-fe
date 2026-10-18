import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { LocalFileChange } from '$lib/components/chat/types';

export type ChatChangesInput = {
  changes: LocalFileChange[];
  agentId?: string | null;
  showStagingControls: boolean;
  isAggregate: boolean;
  groupByCommit: boolean;
  nodeOwnedPaths: boolean;
  branchBaseRef?: string;
  branchBaseCommitSha?: string;
  gitRootId?: string;
  gitRootPath?: string;
};

export type ChatChangeEntry = { id: string; change: LocalFileChange };
export type ChatFileRefresh = {
  path: string;
  requestId: string;
  status: 'pending' | 'ready' | 'failed';
  refreshedAt: number;
  mutationRequestId?: string;
  queuedMutationRequestId?: string;
};

export type ChatChangesConsumer = {
  id: string;
  resourceKey: string;
  changesKey: string;
  requestId: string;
  options: Omit<ChatChangesInput, 'changes'>;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
  changes: Collection<ChatChangeEntry, 'id'>;
  fileRefreshes: Collection<ChatFileRefresh, 'path'>;
  completedMutationRequestId?: string;
};

export type AgentFileRefreshEntry = {
  path: string;
  version: number;
};

export type ChatChangesWorkspaceState = {
  refreshes: Collection<AgentFileRefreshEntry, 'path'>;
  consumers: Collection<ChatChangesConsumer, 'id'>;
};

export type ChatChangesState = {
  byWorkspaceId: Record<string, ChatChangesWorkspaceState>;
};
