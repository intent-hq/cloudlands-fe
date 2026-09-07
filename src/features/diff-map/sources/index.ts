import type { CommitFile } from '$features/file-tracking/types';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import { LineType, type DiffChunk } from '$shared/types';
import { buildDiffMapDocument, serializeDiffMapHunkHeader } from '../model/build-document';
import type {
  DiffMapDocument,
  DiffMapExternalFileFacts,
  DiffMapFileStatus,
  DiffMapSource,
} from '../model/types';

type PullRequestDiffFile = DiffMapExternalFileFacts;

export interface PullRequestDiffSource {
  repository: string;
  number: number;
  headSha?: string;
  updatedAt?: string;
  files: readonly PullRequestDiffFile[];
}

export interface PullRequestRangeOptions {
  workspaceId: string;
  baseRef?: string;
  baseCommitSha?: string;
  targetRef?: string;
}

export interface ChatTurnDiffIdentity {
  sessionId: string;
  turnId: string;
  snapshotId?: string;
}

export interface RangeDiffOptions {
  workspaceId: string;
}

interface RangeDiffEntry {
  file: string;
  chunks: DiffChunk['chunks'];
  oldContent?: string;
  newContent?: string;
}

function statusFromRangeEntry(entry: RangeDiffEntry): DiffMapFileStatus {
  if (entry.oldContent === '' && entry.newContent === '') return 'unknown';
  if (entry.oldContent === '' && entry.newContent !== undefined) return 'added';
  if (entry.newContent === '' && entry.oldContent !== undefined) return 'deleted';
  return entry.oldContent !== undefined && entry.newContent !== undefined ? 'modified' : 'unknown';
}

interface NumstatEntry {
  filePath: string;
  additions: number;
  deletions: number;
}

function buildSourceDocument(
  files: readonly PullRequestDiffFile[],
  source: DiffMapSource,
  patches?: ReadonlyMap<string, string>,
): DiffMapDocument {
  return buildDiffMapDocument(
    files.map((file) => ({ ...file, isFullFileContent: true })),
    { source, patches },
  );
}

function statusFromChunk(chunk: DiffChunk): DiffMapFileStatus {
  if (chunk.isBinary) return 'binary';
  if (chunk.chunks.length > 0 && chunk.chunks.every((hunk) => hunk.oldLines === 0)) return 'added';
  if (chunk.chunks.length > 0 && chunk.chunks.every((hunk) => hunk.newLines === 0))
    return 'deleted';
  return 'modified';
}

function statsFromChunk(chunk: DiffChunk): Pick<PullRequestDiffFile, 'additions' | 'deletions'> {
  let additions = 0;
  let deletions = 0;
  for (const hunk of chunk.chunks) {
    for (const line of hunk.lines) {
      if (line.type === LineType.Addition) additions += 1;
      if (line.type === LineType.Deletion) deletions += 1;
    }
  }
  return { additions, deletions };
}

function patchFromChunk(chunk: Pick<DiffChunk, 'chunks'>): string {
  return chunk.chunks.map(serializeDiffMapHunkHeader).join('\n');
}

function commitStatus(status: string | undefined): DiffMapFileStatus | undefined {
  switch (status) {
    case 'A':
    case 'added':
      return 'added';
    case 'D':
    case 'deleted':
      return 'deleted';
    case 'R':
    case 'renamed':
      return 'renamed';
    case 'M':
    case 'modified':
      return 'modified';
    case 'binary':
    case 'mode':
      return status;
    default:
      return undefined;
  }
}

export async function fromCommit(
  workspaceId: string,
  sha: string,
  commitFiles: readonly CommitFile[] = [],
): Promise<DiffMapDocument> {
  const [details, chunks] = await Promise.all([
    commitFiles.length > 0 ? Promise.resolve(null) : appClient.git.commitDetails(workspaceId, sha),
    appClient.git.diffs(workspaceId, { commitHash: sha }),
  ]);
  const chunksByPath = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const detailsByPath = new Map(details?.fileDetails.map((file) => [file.path, file]) ?? []);
  const commitFilesByPath = new Map(commitFiles.map((file) => [file.path, file]));
  const paths = new Set([
    ...commitFiles.map((file) => file.path),
    ...(details?.files ?? []),
    ...(details?.fileDetails.map((file) => file.path) ?? []),
    ...chunks.map((chunk) => chunk.file),
  ]);
  const files = [...paths].map((path): PullRequestDiffFile => {
    const commitFile = commitFilesByPath.get(path);
    const detail = detailsByPath.get(path);
    const chunk = chunksByPath.get(path);
    return {
      path,
      ...(detail ?? commitFile ?? (chunk ? statsFromChunk(chunk) : {})),
      status:
        commitStatus(commitFile?.status) ??
        (commitFile?.renamedFrom ? 'renamed' : chunk ? statusFromChunk(chunk) : 'modified'),
      ...(commitFile?.renamedFrom ? { renamedFrom: commitFile.renamedFrom } : {}),
      ...(chunk?.isBinary ? { binary: true } : {}),
    };
  });
  const patches = new Map(chunks.map((chunk) => [chunk.file, patchFromChunk(chunk)]));
  return buildSourceDocument(files, { kind: 'commit', commitHash: sha, snapshotId: sha }, patches);
}

export async function fromRange(
  base: string,
  head: string,
  options: RangeDiffOptions,
): Promise<DiffMapDocument> {
  const params = { workspaceId: options.workspaceId, baseCommitSha: base, targetRef: head };
  const [entries, numstat] = await Promise.all([
    backendRequest<RangeDiffEntry[]>('git.branchDiff', params),
    backendRequest<NumstatEntry[]>('git.numstat', params),
  ]);
  const statsByPath = new Map(numstat.map((entry) => [entry.filePath, entry]));
  const entryByPath = new Map(entries.map((entry) => [entry.file, entry]));
  const paths = new Set([
    ...entries.map((entry) => entry.file),
    ...numstat.map((entry) => entry.filePath),
  ]);
  const files = [...paths].map((path): PullRequestDiffFile => {
    const entry = entryByPath.get(path);
    const stats = statsByPath.get(path);
    return {
      path,
      additions: stats?.additions,
      deletions: stats?.deletions,
      oldContent: entry?.oldContent,
      newContent: entry?.newContent,
      // Full-content asymmetry authoritatively identifies ordinary additions/deletions.
      // Empty-on-both-sides and missing branchDiff rows remain neutral until the daemon
      // exposes delta status and rename source on git.branchDiff.
      status: entry ? statusFromRangeEntry(entry) : 'unknown',
    };
  });
  const patches = new Map(entries.map((entry) => [entry.file, patchFromChunk(entry)]));
  return buildSourceDocument(
    files,
    {
      kind: 'range',
      base,
      head,
      snapshotId: `${base}..${head}`,
    },
    patches,
  );
}

export function fromPullRequest(pr: PullRequestDiffSource): DiffMapDocument {
  const fileSnapshot = pr.files
    .map(
      (file) =>
        `${file.path}:${file.additions ?? '?'}:${file.deletions ?? '?'}:${file.status ?? '?'}:${file.renamedFrom ?? '?'}`,
    )
    .sort()
    .join('|');
  const snapshotId = pr.headSha ?? pr.updatedAt ?? `${pr.repository}#${pr.number}:${fileSnapshot}`;
  return buildSourceDocument(pr.files, {
    kind: 'pr',
    repository: pr.repository,
    prNumber: pr.number,
    snapshotId,
  });
}

export async function fromPullRequestRange(
  pr: PullRequestDiffSource,
  options: PullRequestRangeOptions,
): Promise<DiffMapDocument> {
  const params = {
    workspaceId: options.workspaceId,
    ...(options.baseRef ? { baseRef: options.baseRef } : {}),
    ...(options.baseCommitSha ? { baseCommitSha: options.baseCommitSha } : {}),
    targetRef: options.targetRef ?? 'HEAD',
  };
  const entries =
    options.baseRef || options.baseCommitSha
      ? await backendRequest<RangeDiffEntry[]>('git.branchDiff', params)
      : [];
  const entriesByPath = new Map(entries.map((entry) => [entry.file, entry]));
  const statsByPath = new Map(pr.files.map((file) => [file.path, file]));
  const paths = new Set([...pr.files.map((file) => file.path), ...entriesByPath.keys()]);
  const files = [...paths].map((path): PullRequestDiffFile => {
    const stats = statsByPath.get(path);
    const entry = entriesByPath.get(path);
    return {
      path,
      additions: stats?.additions,
      deletions: stats?.deletions,
      oldContent: entry?.oldContent,
      newContent: entry?.newContent,
      status: entry ? statusFromRangeEntry(entry) : 'unknown',
    };
  });
  return fromPullRequest({ ...pr, files });
}

export function fromChatTurn(
  changes: ChatFileChange[],
  identity: ChatTurnDiffIdentity,
): DiffMapDocument {
  return buildDiffMapDocument(changes, {
    source: {
      kind: 'chat-turn',
      sessionId: identity.sessionId,
      turnId: identity.turnId,
      snapshotId: identity.snapshotId ?? identity.turnId,
    },
  });
}
