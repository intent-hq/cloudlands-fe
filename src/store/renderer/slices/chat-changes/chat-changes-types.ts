import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type AgentFileRefreshEntry = {
  path: string;
  version: number;
};

export type ChatChangesWorkspaceState = {
  refreshes: Collection<AgentFileRefreshEntry, 'path'>;
};

export type ChatChangesState = {
  byWorkspaceId: Record<string, ChatChangesWorkspaceState>;
};
