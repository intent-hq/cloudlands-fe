/**
 * Request coalescer / deduper for the diff viewers' git reads.
 *
 * Perf rationale: each TrackedChangeDiffViewer used to issue its own per-file
 * diff request at mount. With N diffs in the "all changes" view that's N
 * round-trips.
 *
 * This batcher groups same-tick requests that share a workspace + `staged`
 * flag into a single daemon `git.diffs` read (PROTOCOL §5.6). That read is
 * hunk-only by design, so the `oldContent`/`newContent` full-file enrichment
 * the consumers (ChatChangesPanel, TrackedChangeDiffViewer) rely on is
 * composed here from `git.showFile` (the HEAD / ':0' side) and `file.read`
 * (the working-tree side). `dedupedShowFile` resolves via `git.showFile` and
 * dedupes concurrent calls for the same `(workspace, ref, path)` into one
 * promise.
 *
 * Results are NOT cached across calls — callers are responsible for their own
 * invalidation (the existing file-watcher path already triggers a re-fetch).
 *
 * The branch-base committed diff (`git:diff` with baseRef/baseCommitSha) and
 * `git:numstat` (workdir line stats) stay on the legacy channels here; the
 * git bridge seeder routes them to the daemon `git.branchDiff` / `git.numstat`
 * (PROTOCOL §5.6).
 */
import { invoke } from '$lib/electron-bridge';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('diff-ipc-batcher');

interface DiffChunk {
  file: string;
  oldContent?: string;
  newContent?: string;
  chunks?: unknown[];
}

interface GitDiffResponse {
  success: boolean;
  data?: DiffChunk[];
  error?: string;
}

interface BranchBaseDiffOptions {
  baseRef?: string;
  baseCommitSha?: string;
}

interface NumstatOptions extends BranchBaseDiffOptions {
  staged?: boolean;
  targetRef?: string;
}

interface NumstatEntry {
  filePath: string;
  additions: number;
  deletions: number;
}

interface GitNumstatResponse {
  success: boolean;
  data?: NumstatEntry[];
  error?: string;
}

interface ShowFileResponse {
  success: boolean;
  data?: string;
  error?: string;
}

interface PendingDiff {
  paths: Set<string>;
  resolvers: Map<string, Array<(chunk: DiffChunk | undefined) => void>>;
  rejecters: Array<(err: unknown) => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingDiffs = new Map<string, PendingDiff>();
const pendingBranchBaseDiffs = new Map<string, PendingDiff>();

function findChunkForPath(chunks: DiffChunk[], filePath: string): DiffChunk | undefined {
  const byFile = new Map<string, DiffChunk>();
  for (const chunk of chunks) {
    if (chunk?.file) byFile.set(chunk.file, chunk);
  }

  return (
    byFile.get(filePath) ??
    chunks.find(
      (chunk) =>
        chunk?.file &&
        (filePath.endsWith(`/${chunk.file}`) || chunk.file.endsWith(`/${filePath}`)),
    )
  );
}

function diffGroupKey(workspaceId: string, staged: boolean): string {
  return `${workspaceId}::${staged ? '1' : '0'}`;
}

/** Map the daemon `git.diffs` bare-array result (`[{ path, hunks }]`) into the
 * batcher's `DiffChunk[]`; hunks pass through verbatim (they already carry the
 * renderer `DiffHunk` shape). */
function toDaemonDiffChunks(result: unknown): DiffChunk[] {
  const entries = Array.isArray(result) ? result : [];
  const chunks: DiffChunk[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { path?: unknown; hunks?: unknown };
    if (typeof e.path !== 'string' || !e.path) continue;
    chunks.push({ file: e.path, chunks: Array.isArray(e.hunks) ? e.hunks : [] });
  }
  return chunks;
}

/** Working-tree side of an unstaged diff via `file.read` (PROTOCOL §5.9). A
 * read failure folds to empty content (the file was deleted from the workdir),
 * mirroring the legacy handler's fallback. */
async function readWorkingTreeContent(
  workspaceId: string,
  filePath: string,
): Promise<ShowFileResponse> {
  try {
    const result = await backendRequest<unknown>('file.read', { workspaceId, path: filePath });
    const content =
      typeof result === 'string'
        ? result
        : typeof (result as { content?: unknown } | null)?.content === 'string'
          ? (result as { content: string }).content
          : '';
    return { success: true, data: content };
  } catch (error) {
    logger.debug('file.read failed for working-tree diff side (file deleted?)', {
      workspaceId,
      filePath,
      error,
    });
    return { success: true, data: '' };
  }
}

/**
 * Compose the full-file `oldContent`/`newContent` for one diff chunk. The
 * daemon `git.diffs` read is intentionally hunk-only, so the two sides come
 * from separate daemon reads:
 *   staged   → old = `git.showFile` at HEAD, new = `git.showFile` at ':0'
 *   unstaged → old = `git.showFile` at ':0', new = `file.read` (working tree)
 * A failed side stays `undefined` so consumers fall back to hunk-only
 * rendering (never a silently-empty full-file diff); the failure is logged.
 */
async function enrichChunkContents(
  workspaceId: string,
  staged: boolean,
  chunk: DiffChunk,
): Promise<void> {
  const [oldRes, newRes] = await Promise.all([
    dedupedShowFile(workspaceId, staged ? 'HEAD' : ':0', chunk.file),
    staged
      ? dedupedShowFile(workspaceId, ':0', chunk.file)
      : readWorkingTreeContent(workspaceId, chunk.file),
  ]);
  if (oldRes.success) chunk.oldContent = oldRes.data ?? '';
  else logger.warn('git.showFile failed for old diff side', {
    workspaceId,
    filePath: chunk.file,
    staged,
    error: oldRes.error,
  });
  if (newRes.success) chunk.newContent = newRes.data ?? '';
  else logger.warn('content read failed for new diff side', {
    workspaceId,
    filePath: chunk.file,
    staged,
    error: newRes.error,
  });
}

async function flushDiffGroup(key: string) {
  const pending = pendingDiffs.get(key);
  if (!pending) return;
  pendingDiffs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  const [wsId, stagedStr] = key.split('::');
  const staged = stagedStr === '1';

  try {
    // One hunk read serves the whole group: `git.diffs` without a `path`
    // filter returns every changed file for the selected staging area
    // (unstaged includes untracked files), so N same-tick requests collapse
    // into a single daemon read.
    const result = await backendRequest<unknown>(
      'git.diffs',
      staged ? { workspaceId: wsId, staged: true } : { workspaceId: wsId },
    );
    const chunks = toDaemonDiffChunks(result);

    const matches = new Map<string, DiffChunk | undefined>();
    for (const path of pending.resolvers.keys()) {
      matches.set(path, findChunkForPath(chunks, path));
    }
    const matchedChunks = new Set(
      [...matches.values()].filter((chunk): chunk is DiffChunk => chunk !== undefined),
    );
    await Promise.all(
      [...matchedChunks].map((chunk) => enrichChunkContents(wsId, staged, chunk)),
    );

    for (const [path, resolvers] of pending.resolvers) {
      const chunk = matches.get(path);
      for (const resolve of resolvers) resolve(chunk);
    }
  } catch (err) {
    logger.warn('git.diffs group fetch failed', { workspaceId: wsId, staged, error: err });
    for (const reject of pending.rejecters) reject(err);
    for (const resolvers of pending.resolvers.values()) {
      for (const resolve of resolvers) resolve(undefined);
    }
  }
}

function branchBaseDiffGroupKey(
  workspaceId: string,
  baseRef: string | undefined,
  baseCommitSha: string | undefined,
): string {
  return `${workspaceId}::${baseRef ?? ''}::${baseCommitSha ?? ''}`;
}

async function flushBranchBaseDiffGroup(key: string) {
  const pending = pendingBranchBaseDiffs.get(key);
  if (!pending) return;
  pendingBranchBaseDiffs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  const [wsId, baseRef, baseCommitSha] = key.split('::');
  const paths = Array.from(pending.paths);

  try {
    const result = (await invoke('git:diff', {
      workspaceId: wsId,
      paths,
      baseRef: baseRef || undefined,
      baseCommitSha: baseCommitSha || undefined,
      targetRef: 'HEAD',
    })) as GitDiffResponse;

    const chunks = result?.success && Array.isArray(result.data) ? result.data : [];
    for (const [path, resolvers] of pending.resolvers) {
      const chunk = findChunkForPath(chunks, path);
      for (const resolve of resolvers) resolve(chunk);
    }
  } catch (err) {
    for (const reject of pending.rejecters) reject(err);
    for (const resolvers of pending.resolvers.values()) {
      for (const resolve of resolvers) resolve(undefined);
    }
  }
}

/**
 * Request a diff chunk for one file; same-tick requests for the same
 * `(workspaceId, staged)` are merged into a single daemon `git.diffs` read
 * (plus the per-file content enrichment). Returns the matching chunk, or
 * `undefined` if the daemon returned no entry for it.
 */
export function batchedGitDiff(
  workspaceId: string,
  staged: boolean,
  filePath: string,
): Promise<DiffChunk | undefined> {
  const key = diffGroupKey(workspaceId, staged);
  const existing = pendingDiffs.get(key);
  const pending: PendingDiff = existing ?? {
    paths: new Set(),
    resolvers: new Map(),
    rejecters: [],
    timer: null,
  };
  if (!existing) {
    pendingDiffs.set(key, pending);
    // Flush at end of current microtask window. setTimeout(_, 0) gives
    // same-frame mounts a chance to join the same IPC without blocking.
    pending.timer = setTimeout(() => flushDiffGroup(key), 0);
  }
  pending.paths.add(filePath);

  return new Promise<DiffChunk | undefined>((resolve, reject) => {
    let resolvers = pending.resolvers.get(filePath);
    if (!resolvers) {
      resolvers = [];
      pending.resolvers.set(filePath, resolvers);
    }
    resolvers.push(resolve);
    pending.rejecters.push(reject);
  });
}

/**
 * Request a committed branch diff chunk for one file. Same-tick requests sharing
 * `(workspaceId, baseRef, baseCommitSha)` are merged into one side-effect-free
 * `git:diff` IPC call that compares the resolved branch base to `HEAD`.
 */
export function batchedGitBranchBaseDiff(
  workspaceId: string,
  options: BranchBaseDiffOptions,
  filePath: string,
): Promise<DiffChunk | undefined> {
  const key = branchBaseDiffGroupKey(workspaceId, options.baseRef, options.baseCommitSha);
  const existing = pendingBranchBaseDiffs.get(key);
  const pending: PendingDiff = existing ?? {
    paths: new Set(),
    resolvers: new Map(),
    rejecters: [],
    timer: null,
  };
  if (!existing) {
    pendingBranchBaseDiffs.set(key, pending);
    pending.timer = setTimeout(() => flushBranchBaseDiffGroup(key), 0);
  }
  pending.paths.add(filePath);

  return new Promise<DiffChunk | undefined>((resolve, reject) => {
    let resolvers = pending.resolvers.get(filePath);
    if (!resolvers) {
      resolvers = [];
      pending.resolvers.set(filePath, resolvers);
    }
    resolvers.push(resolve);
    pending.rejecters.push(reject);
  });
}

/* ------------------------------- show-file ------------------------------- */

interface PendingShow {
  promise: Promise<ShowFileResponse>;
}

const pendingShows = new Map<string, PendingShow>();
const pendingNumstats = new Map<string, Promise<NumstatEntry[]>>();

function showKey(workspaceId: string, ref: string, filePath: string): string {
  return `${workspaceId}::${ref}::${filePath}`;
}

/**
 * Deduped daemon `git.showFile` fetch (PROTOCOL §5.6: file content at a
 * revision, index ref ':0' supported; a path missing at the ref folds to ''
 * on the daemon side). Concurrent callers for the same `(workspace, ref,
 * path)` share a single in-flight request. Daemon/transport errors fold into
 * `{ success: false, error }`, preserving the legacy handler's envelope.
 */
export function dedupedShowFile(
  workspaceId: string,
  ref: string,
  filePath: string,
): Promise<ShowFileResponse> {
  const key = showKey(workspaceId, ref, filePath);
  const existing = pendingShows.get(key);
  if (existing) return existing.promise;

  const promise = backendRequest<{ content?: unknown }>('git.showFile', {
    workspaceId,
    filePath,
    ref,
  })
    .then(
      (result): ShowFileResponse => ({
        success: true,
        data: typeof result?.content === 'string' ? result.content : '',
      }),
    )
    .catch(
      (error): ShowFileResponse => ({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => {
      pendingShows.delete(key);
    });

  pendingShows.set(key, { promise });
  return promise;
}

function numstatKey(workspaceId: string, options: NumstatOptions): string {
  return [
    workspaceId,
    options.staged === undefined ? '' : options.staged ? '1' : '0',
    options.baseRef ?? '',
    options.baseCommitSha ?? '',
    options.targetRef ?? '',
  ].join('::');
}

export function dedupedGitNumstat(
  workspaceId: string,
  options: NumstatOptions = {},
): Promise<NumstatEntry[]> {
  const key = numstatKey(workspaceId, options);
  const existing = pendingNumstats.get(key);
  if (existing) return existing;

  const promise = (invoke('git:numstat', {
    workspaceId,
    ...options,
  }) as Promise<GitNumstatResponse>)
    .then((result) => (result?.success && Array.isArray(result.data) ? result.data : []))
    .finally(() => pendingNumstats.delete(key));

  pendingNumstats.set(key, promise);
  return promise;
}
