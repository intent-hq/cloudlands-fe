import type {
  DiffMapDocument,
  DiffMapFile,
  DiffMapSource,
  DiffMapSourceIdentity,
  ReviewSlice,
  ReviewSliceEntry,
} from './types';

export type ViewedFreshness = 'unviewed' | 'viewed' | 'changed-since-viewed';

function sourceIdentity(source: DiffMapSource): DiffMapSourceIdentity {
  switch (source.kind) {
    case 'working-tree':
      return { kind: source.kind, workspaceId: source.workspaceId };
    case 'commit':
      return { kind: source.kind, commitHash: source.commitHash };
    case 'range':
      return { kind: source.kind, base: source.base, head: source.head };
    case 'pr':
      return { kind: source.kind, repository: source.repository, prNumber: source.prNumber };
    case 'chat-turn':
      return { kind: source.kind, sessionId: source.sessionId, turnId: source.turnId };
  }
}

function fallbackHash(file: DiffMapFile, snapshotId: string): string {
  return [snapshotId, file.path, file.status, file.additions, file.deletions].join(':');
}

export function diffMapFileContentHash(file: DiffMapFile, snapshotId: string): string {
  return file.contentHash ?? fallbackHash(file, snapshotId);
}

export function createReviewSlice(
  document: DiffMapDocument,
  selectedPaths: ReadonlySet<string>,
): ReviewSlice {
  return {
    source: sourceIdentity(document.source),
    snapshotId: document.source.snapshotId,
    entries: document.files
      .filter((file) => selectedPaths.has(file.path))
      .map((file) => ({
        path: file.path,
        ...(file.hunks?.length ? { hunks: file.hunks } : {}),
        contentHash: diffMapFileContentHash(file, document.source.snapshotId),
      })),
  };
}

export function getStaleReviewSliceEntries(
  slice: ReviewSlice,
  document: DiffMapDocument,
): ReviewSliceEntry[] {
  if (JSON.stringify(slice.source) !== JSON.stringify(sourceIdentity(document.source))) {
    return slice.entries;
  }
  const files = new Map(document.files.map((file) => [file.path, file]));
  return slice.entries.filter((entry) => {
    const current = files.get(entry.path);
    return (
      !current || diffMapFileContentHash(current, document.source.snapshotId) !== entry.contentHash
    );
  });
}

export function getViewedFreshness(
  viewedFiles: Readonly<Record<string, string>>,
  path: string,
  contentHash: string,
): ViewedFreshness {
  const viewedHash = viewedFiles[path];
  if (viewedHash === undefined) return 'unviewed';
  return viewedHash === contentHash ? 'viewed' : 'changed-since-viewed';
}
