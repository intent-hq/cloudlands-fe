import {
  ChangeStage,
  type FileChangeStatus,
  type TrackedChange,
} from '$features/file-tracking/types';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import { LineType, type DiffChunk } from '$shared/types';
import { buildDiffMapDocument } from '../model/build-document';
import type { DiffMapDocument, DiffMapFileStatus, DiffMapSource } from '../model/types';

export interface PullRequestDiffFile {
  path: string;
  additions?: number;
  deletions?: number;
  status?: DiffMapFileStatus;
  renamedFrom?: string;
  oldContent?: string;
  newContent?: string;
}

export interface PullRequestDiffSource {
  repository: string;
  number: number;
  headSha?: string;
  updatedAt?: string;
  files: readonly PullRequestDiffFile[];
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
  oldContent?: string;
  newContent?: string;
}

interface NumstatEntry {
  filePath: string;
  additions: number;
  deletions: number;
}

function trackedChange(file: PullRequestDiffFile): TrackedChange {
  const status: FileChangeStatus =
    file.status === 'added' ||
    file.status === 'modified' ||
    file.status === 'deleted' ||
    file.status === 'renamed'
      ? file.status
      : 'modified';
  return {
    id: `diff-map:${file.path}`,
    file: file.path,
    relativePath: file.path,
    stage: ChangeStage.Committed,
    status,
    stats: {
      additions: file.additions ?? Number.NaN,
      deletions: file.deletions ?? Number.NaN,
      ...(file.status === 'binary' ? { binary: true } : {}),
    },
    attribution: { timestamp: 0 },
    content:
      file.oldContent !== undefined || file.newContent !== undefined
        ? {
            oldContent: file.oldContent,
            newContent: file.newContent,
            isFullFileContent: true,
          }
        : undefined,
  };
}

function buildSourceDocument(
  files: readonly PullRequestDiffFile[],
  source: DiffMapSource,
  patches?: ReadonlyMap<string, string>,
): DiffMapDocument {
  const sourceByPath = new Map(files.map((file) => [file.path, file]));
  const document = buildDiffMapDocument(files.map(trackedChange), { source, patches });
  return {
    ...document,
    files: document.files.map((file) => {
      const input = sourceByPath.get(file.path);
      const { attribution: _, ...withoutAttribution } = file;
      return {
        ...withoutAttribution,
        ...(input?.status ? { status: input.status } : {}),
        ...(input?.renamedFrom ? { renamedFrom: input.renamedFrom } : {}),
      };
    }),
  };
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

function patchFromChunk(chunk: DiffChunk): string {
  return chunk.chunks
    .map((hunk) => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    .join('\n');
}

export async function fromCommit(workspaceId: string, sha: string): Promise<DiffMapDocument> {
  const [details, chunks] = await Promise.all([
    appClient.git.commitDetails(workspaceId, sha),
    appClient.git.diffs(workspaceId, { commitHash: sha }),
  ]);
  const chunksByPath = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const detailsByPath = new Map(details?.fileDetails.map((file) => [file.path, file]) ?? []);
  const paths = new Set([
    ...(details?.files ?? []),
    ...(details?.fileDetails.map((file) => file.path) ?? []),
    ...chunks.map((chunk) => chunk.file),
  ]);
  const files = [...paths].map((path): PullRequestDiffFile => {
    const detail = detailsByPath.get(path);
    const chunk = chunksByPath.get(path);
    return {
      path,
      ...(detail ?? (chunk ? statsFromChunk(chunk) : {})),
      status: chunk ? statusFromChunk(chunk) : 'modified',
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
      status:
        entry?.oldContent === '' && entry.newContent !== ''
          ? 'added'
          : entry?.newContent === '' && entry.oldContent !== ''
            ? 'deleted'
            : 'modified',
    };
  });
  return buildSourceDocument(files, {
    kind: 'range',
    base,
    head,
    snapshotId: `${base}..${head}`,
  });
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
