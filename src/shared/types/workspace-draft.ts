import type { ContextLink } from '../types';

export type DraftPhase = 'editing' | 'promoting' | 'promoted' | 'failed';

export type DraftSource =
  | {
      kind: 'local';
      path: string;
      branch?: string;
      isolation: 'worktree' | 'in-place';
    }
  | {
      kind: 'github';
      url: string;
      owner: string;
      name: string;
      branch?: string;
    }
  | {
      kind: 'newFolder';
      parentPath: string;
      name: string;
    };

export interface DraftDelivery {
  state: 'none' | 'pending' | 'sent' | 'unknown';
  messageId?: string;
  error?: string;
}

export interface WorkspaceDraftConfig {
  model?: string;
  setupScript?: string;
  isRemote?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceDraftCreateInput {
  ownerClientId?: string;
  title?: string;
  intentText?: string;
  source?: DraftSource | null;
  contextLinks?: ContextLink[];
  attachments?: unknown[];
  config?: WorkspaceDraftConfig;
}

export interface WorkspaceDraftUpdatePatch {
  title?: string | null;
  intentText?: string;
  source?: DraftSource | null;
  contextLinks?: ContextLink[];
  attachments?: unknown[];
  config?: WorkspaceDraftConfig;
}

/** Daemon-owned `workspaceDraft.*` resource, reproduced without renderer defaults. */
export interface WorkspaceDraft {
  id: string;
  ownerClientId: string;
  revision: number;
  phase: DraftPhase;
  title?: string;
  intentText: string;
  source: DraftSource | null;
  contextLinks: ContextLink[];
  attachments: unknown[];
  config: WorkspaceDraftConfig;
  operationKey: string;
  promotedWorkspaceId?: string;
  initialAgentId?: string;
  delivery: DraftDelivery;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

/** Authoritative setup result persisted on `Workspace`. */
export interface SetupResult {
  state: 'none' | 'running' | 'succeeded' | 'failed' | 'unknown';
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
