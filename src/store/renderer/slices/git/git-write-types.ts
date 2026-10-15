import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { GitCommitParams, MutationResult } from '$lib/client/app-client';

type GitWriteSource = 'sidebar' | 'changes' | 'localChanges' | 'diff' | 'chat' | 'timeline';

export type GitWriteOperation = (
  | { kind: 'stage' | 'unstage' | 'discard'; paths: string[]; openDiff?: boolean }
  | { kind: 'stageHunk' | 'unstageHunk'; filePath: string; hunkPatch: string }
  | {
      kind: 'commit';
      params: GitCommitParams;
      /** Stable principal/root identity for receipt visibility; independent of connection epochs. */
      authorityKey?: string;
      /** Host-owned preflight comparison only; never forwarded as a commit files list. */
      reviewedPaths?: string[];
    }
  | { kind: 'amend'; message: string; cwd: string; wasPushed?: boolean }
  | {
      kind: 'partialCommit';
      paths: string[];
      section: 'staged' | 'unstaged';
      message: string;
      groupKey?: string;
      agentId?: string | null;
    }
) & {
  source?: GitWriteSource;
  consumerId?: string;
  sourceAgentId?: string;
  admissionContext?: string;
};

export interface GitWriteEntry {
  id: string;
  operation: GitWriteOperation;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  result?: MutationResult;
  /** Presentation retired; current-index receipts and pending transport ownership survive. */
  consumerReleased?: boolean;
}

export interface GitWriteWorkspaceState {
  operations: Collection<GitWriteEntry, 'id'>;
}

export interface GitWriteState {
  byWorkspaceId: Record<string, GitWriteWorkspaceState>;
}
