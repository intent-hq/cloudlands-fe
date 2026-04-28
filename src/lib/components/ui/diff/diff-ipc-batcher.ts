/**
 * Request coalescer for `git:diff` and `git:show-file`.
 *
 * Wave 3 perf work: each TrackedChangeDiffViewer used to issue its own
 * `invoke('git:diff', { paths: [filePath] })` at mount. With N diffs in the
 * "all changes" view that's N main→renderer round-trips.
 *
 * This batcher groups same-tick requests that share a workspace + `staged`
 * flag into a single `git:diff` IPC. For `git:show-file` it still dedupes
 * concurrent calls for the same `(workspace, ref, path)` into one promise.
 *
 * Results are NOT cached across calls — callers are responsible for their own
 * invalidation (the existing file-watcher path already triggers a re-fetch).
 */
import { invoke } from '$lib/electron-bridge';

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

async function fetchSingleDiffChunk(
  workspaceId: string,
  staged: boolean,
  filePath: string,
): Promise<DiffChunk | undefined> {
  const result = (await invoke('git:diff', {
    workspaceId,
    staged,
    paths: [filePath],
  })) as GitDiffResponse;

  const chunks = result?.success && Array.isArray(result.data) ? result.data : [];
  return findChunkForPath(chunks, filePath);
}

async function flushDiffGroup(key: string) {
  const pending = pendingDiffs.get(key);
  if (!pending) return;
  pendingDiffs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  const [wsId, stagedStr] = key.split('::');
  const paths = Array.from(pending.paths);

  try {
    const result = (await invoke('git:diff', {
      workspaceId: wsId,
      staged: stagedStr === '1',
      paths,
    })) as GitDiffResponse;

    const chunks = result?.success && Array.isArray(result.data) ? result.data : [];

    const missingPaths = new Set<string>();

    for (const [path, resolvers] of pending.resolvers) {
      const chunk = findChunkForPath(chunks, path);
      if (!chunk && paths.length > 1 && chunks.length > 0) {
        missingPaths.add(path);
        continue;
      }
      for (const resolve of resolvers) resolve(chunk);
    }

    if (missingPaths.size > 0) {
      const retryResults = await Promise.all(
        Array.from(missingPaths, async (path) => ({
          path,
          chunk: await fetchSingleDiffChunk(wsId, stagedStr === '1', path).catch(() => undefined),
        })),
      );

      for (const { path, chunk } of retryResults) {
        const resolvers = pending.resolvers.get(path) ?? [];
        for (const resolve of resolvers) resolve(chunk);
      }
    }
  } catch (err) {
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
 * Request a `git:diff` chunk for one file; same-tick requests for the same
 * `(workspaceId, staged)` are merged into a single IPC call. Returns the
 * matching chunk, or `undefined` if the backend returned no entry for it.
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
 * Deduped `git:show-file` fetch. Concurrent callers for the same
 * `(workspace, ref, path)` share a single in-flight IPC.
 */
export function dedupedShowFile(
  workspaceId: string,
  ref: string,
  filePath: string,
): Promise<ShowFileResponse> {
  const key = showKey(workspaceId, ref, filePath);
  const existing = pendingShows.get(key);
  if (existing) return existing.promise;

  const promise = (invoke('git:show-file', {
    workspaceId,
    ref,
    filePath,
  }) as Promise<ShowFileResponse>).finally(() => {
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
