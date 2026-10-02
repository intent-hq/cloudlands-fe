import type { UserMessageIndexResult } from '$lib/client/app-client';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type ChatPanelUiStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface UserMessageIndexUiEntry {
  id: string;
  requestId: string;
  agentId: string;
  epoch: number;
  status: ChatPanelUiStatus;
  result?: UserMessageIndexResult;
  error?: string;
}

export interface RetryAgentUiEntry {
  id: string;
  requestId: string;
  agentId: string;
  status: ChatPanelUiStatus;
  error?: string;
}

export interface ChatPanelUiWorkspaceState {
  userMessageIndexes: Collection<UserMessageIndexUiEntry, 'id'>;
  retryAgents: Collection<RetryAgentUiEntry, 'id'>;
}

export interface ChatPanelUiState {
  byWorkspaceId: Record<string, ChatPanelUiWorkspaceState>;
}
