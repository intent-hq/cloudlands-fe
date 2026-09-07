import type { CommitFile, FileChangeStatus, TrackedChange } from './types';
import { ChangeStage } from './types';

export interface CommitFileTrackedChangeOptions {
  id: string;
  stage?: ChangeStage;
  commitHash?: string;
  prNumber?: number;
  oldContent?: string;
  newContent?: string;
  timestamp?: number;
}

/** Normalize daemon and porcelain commit status spellings for diff open actions. */
export function normalizeCommitFileStatus(file: CommitFile): FileChangeStatus | undefined {
  if (file.renamedFrom) return 'renamed';

  const status = file.status?.trim();
  if (!status) return undefined;
  switch (status.toLowerCase()) {
    case 'a':
    case 'added':
    case 'c':
    case 'copied':
    case '?':
    case '??':
    case 'untracked':
      return 'added';
    case 'd':
    case 'deleted':
      return 'deleted';
    case 'm':
    case 'modified':
      return 'modified';
    case 'r':
    case 'renamed':
      return 'renamed';
    default:
      return /^r[0-9]+$/i.test(status) ? 'renamed' : undefined;
  }
}

export function commitFileToTrackedChange(
  file: CommitFile,
  options: CommitFileTrackedChangeOptions,
): TrackedChange {
  const status = normalizeCommitFileStatus(file);
  return {
    id: options.id,
    file: file.path,
    relativePath: file.path,
    stage: options.stage ?? ChangeStage.Committed,
    stats: {
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    },
    ...(status ? { status } : {}),
    ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
    ...(options.commitHash ? { commitHash: options.commitHash } : {}),
    ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
    content: {
      oldContent: options.oldContent,
      newContent: options.newContent,
      diff: '',
    },
    attribution: { timestamp: options.timestamp ?? Date.now() },
  };
}
