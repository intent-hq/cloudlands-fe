import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { GitCommitParams, MutationResult } from '$lib/client';

type GitWriteSource = 'sidebar' | 'changes' | 'localChanges' | 'diff' | 'chat' | 'timeline';

export type GitWriteOperation = (
  | { kind: 'stage' | 'unstage' | 'discard'; paths: string[]; openDiff?: boolean }
  | { kind: 'stageHunk' | 'unstageHunk'; filePath: string; hunkPatch: string }
  | { kind: 'commit'; params: GitCommitParams }
  | { kind: 'amend'; message: string; cwd: string; wasPushed?: boolean }
  | {
      kind: 'partialCommit';
      paths: string[];
      section: 'staged' | 'unstaged';
      message: string;
      groupKey?: string;
      agentId?: string | null;
    }
) & { source?: GitWriteSource; consumerId?: string; sourceAgentId?: string };

export interface GitWriteEntry {
  id: string;
  operation: GitWriteOperation;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  result?: MutationResult;
}

export interface GitWriteWorkspaceState {
  operations: Collection<GitWriteEntry, 'id'>;
}

export interface GitWriteState {
  byWorkspaceId: Record<string, GitWriteWorkspaceState>;
}
