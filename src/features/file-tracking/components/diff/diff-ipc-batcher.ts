import { getPhysicalRequestCompletion } from '$shared/event-recovery/session';
import {
  gitReadDrained,
  gitReadFailureDrained,
  observeGitReadFailure,
} from '../../git-recovery-read-lane';
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
import { store as appStore } from '$store/renderer/store';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { isMissingWorkingTreeFile } from './is-missing-working-tree-file';
import { gitlinkSidesFromHunks, gitlinkSidesFromShas, isGitlinkDiffChunk } from './gitlink';

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
  gitRootId?: string;
  transport?: GitReadTransport;
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
  /**
   * True when the daemon rejected the read with the typed `not-a-file` error
   * (`-32602`, `data.code: "not-a-file"`): the path resolves to a non-blob
   * tree entry — a gitlink (mode 160000) or a directory — so no file content
   * exists at any ref (intent-hq/monorepo#1739). Callers route these to the
   * submodule presentation instead of logging an error.
   */
  notAFile?: boolean;
}

/** Duck-typed check for the daemon's typed `not-a-file` error payload. */
function isNotAFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, data } = error as { code?: unknown; data?: { code?: unknown } };
  return code === 'not-a-file' || data?.code === 'not-a-file';
}

/**
 * Submodule pin SHAs from a `git.status` mode-160000 entry
 * (intent-hq/monorepo#1739). Callers that know a request path is a gitlink
 * pass this so enrichment composes the pin sides from the SHAs instead of
 * issuing content reads that can only fail.
 */
interface GitlinkMeta {
  oldSha?: string;
  newSha?: string;
}

export interface GitReadTransport {
  key: object;
  onFailure?(error: unknown): void;
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}
const transportIds = new WeakMap<object, number>();
let nextTransportId = 0;
function transportId(transport?: GitReadTransport): number {
  if (!transport) return 0;
  let id = transportIds.get(transport.key);
  if (id === undefined) {
    id = ++nextTransportId;
    transportIds.set(transport.key, id);
  }
  return id;
}

interface DiffReadPolicy {
  transport?: GitReadTransport;
  signal?: AbortSignal;
  canRead?: () => boolean;
}

interface PendingDiff {
  transport?: GitReadTransport;
  callers: Map<string, Array<() => boolean>>;
  transports: Map<string, Array<{ transport: GitReadTransport; canRead: () => boolean }>>;
  paths: Set<string>;
  resolvers: Map<string, Array<(chunk: DiffChunk | undefined) => void>>;
  rejecters: Array<(err: unknown) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Original request path → the (possibly worktree-relative-normalized) path
   * sent on the wire; used by the `git.diffs` batcher only. */
  wirePaths?: Map<string, string>;
  /** Original request path → caller-provided gitlink metadata; used by the
   * `git.diffs` batcher only (#1739). */
  gitlinks?: Map<string, GitlinkMeta>;
  gitRootPath?: string;
}

/** A shared read remains authorized while at least one caller still needs this path. */
function hasActiveCaller(pending: PendingDiff, path: string): boolean {
  return pending.callers.get(path)?.some((canRead) => canRead()) ?? false;
}

/** Capture each participating owner's observer before dispatch, without changing batching identity. */
function batchTransport(
  pending: PendingDiff,
  paths = [...pending.callers.keys()],
): GitReadTransport | undefined {
  const transports = paths.flatMap((path) =>
    (pending.transports.get(path) ?? [])
      .filter((caller) => caller.canRead())
      .map((caller) => caller.transport),
  );
  const first = transports[0];
  if (!first) return pending.transport;
  const observers = new Set(transports.map((transport) => transport.onFailure));
  const onFailure = (error: unknown) => {
    for (const observer of observers) observer?.(error);
  };
  return {
    key: first.key,
    onFailure,
    request: <T>(method: string, params?: unknown) =>
      observeGitReadFailure(first.request<T>(method, params), onFailure),
  };
}

function resolveAbortedGroup(pending: PendingDiff): void {
  for (const resolvers of pending.resolvers.values()) {
    for (const resolve of resolvers) resolve(undefined);
  }
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
        chunk?.file && (filePath.endsWith(`/${chunk.file}`) || chunk.file.endsWith(`/${filePath}`)),
    )
  );
}

function diffGroupKey(workspaceId: string, staged: boolean, gitRootId?: string): string {
  return JSON.stringify([workspaceId, staged, gitRootId ?? '']);
}

/** True when a request path cannot be worktree-relative — absolute POSIX
 * (`/...`), home-relative (`~` / `~/...`), Windows drive (`C:\...` / `C:/...`)
 * or UNC (`\\...`) forms — i.e. a caller failed to normalize before
 * requesting. Daemon-side `paths[]` narrowing (PROTOCOL §5.6) matches literal
 * worktree-relative paths, so these can never match server-side. */
function isSuspiciousDiffPath(filePath: string): boolean {
  return (
    filePath.startsWith('/') ||
    filePath === '~' ||
    filePath.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(filePath) ||
    filePath.startsWith('\\\\')
  );
}

/** Read-only resolution of the workspace's checkout root from the store
 * (worktree, else repository path — same precedence as
 * TrackedChangeDiffViewer). '' when the workspace row is not loaded (yet). */
function workspaceWorktreeRoot(workspaceId: string): string {
  try {
    const workspace = getItem(appStore.state.workspace.workspaces, workspaceId as Workspace['id']);
    return workspace?.worktreePath || workspace?.repositoryPath || '';
  } catch {
    return '';
  }
}

/**
 * Convert a mis-normalized request path (see `isSuspiciousDiffPath`) that lies
 * under the workspace root into its worktree-relative form, so the daemon-side
 * `paths[]` narrowing (PROTOCOL §5.6) can match it without a full-tree
 * recovery read. `~`-prefixed paths are resolved by matching the components
 * after `~/` against the longest slash-boundary suffix of the root (the
 * renderer does not know the home directory). Returns `null` when the path
 * does not lie under the root.
 */
function toWorktreeRelative(filePath: string, root: string): string | null {
  if (!root) return null;
  const normRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normRoot) return null;
  const normPath = filePath.replaceAll('\\', '/');
  if (normPath.startsWith(`${normRoot}/`)) {
    const relative = normPath.slice(normRoot.length + 1);
    return relative.length > 0 ? relative : null;
  }
  if (normPath.startsWith('~/')) {
    const rest = normPath.slice(2);
    const rootParts = normRoot.split('/').filter(Boolean);
    for (let i = 0; i < rootParts.length; i++) {
      const prefix = `${rootParts.slice(i).join('/')}/`;
      if (rest.startsWith(prefix)) {
        const relative = rest.slice(prefix.length);
        return relative.length > 0 ? relative : null;
      }
    }
  }
  return null;
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
 * Scoped failures propagate unless the daemon confirms a missing file;
 * unscoped reads retain the legacy empty-content fallback. */
async function readWorkingTreeContent(
  workspaceId: string,
  filePath: string,
  gitRootId?: string,
  transport?: GitReadTransport,
): Promise<ShowFileResponse> {
  try {
    const result = await (transport?.request ?? backendRequest)<unknown>('file.read', {
      workspaceId,
      path: filePath,
      ...(gitRootId ? { gitRootId } : {}),
    });
    const content =
      typeof result === 'string'
        ? result
        : typeof (result as { content?: unknown } | null)?.content === 'string'
          ? (result as { content: string }).content
          : '';
    return { success: true, data: content };
  } catch (error) {
    if (
      getPhysicalRequestCompletion(error) ||
      ((transport || gitRootId) && !isMissingWorkingTreeFile(error))
    )
      throw error;
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
 *
 * Gitlink (submodule) chunks (intent-hq/monorepo#1739) are composed from
 * their `Subproject commit <sha>` hunk lines instead: a gitlink has no blob,
 * so `git.showFile` rejects it with the typed `-32602` `not-a-file` error
 * and `file.read` hits a directory. A status-marked gitlink whose hunks did
 * not structurally classify (e.g. a dirty-worktree entry with no pin move)
 * composes from the caller-provided `git.status` pin SHAs instead of issuing
 * those reads at all.
 */
async function enrichChunkContents(
  workspaceId: string,
  staged: boolean,
  chunk: DiffChunk,
  gitlink?: GitlinkMeta,
  gitRootId?: string,
  gitRootPath?: string,
  transport?: GitReadTransport,
): Promise<void> {
  if (isGitlinkDiffChunk(chunk)) {
    const sides = gitlinkSidesFromHunks(chunk.chunks ?? []);
    chunk.oldContent = sides.oldContent;
    chunk.newContent = sides.newContent;
    return;
  }
  if (gitlink) {
    const sides = gitlinkSidesFromShas(gitlink);
    chunk.oldContent = sides.oldContent;
    chunk.newContent = sides.newContent;
    return;
  }
  const showOptions = { gitRootId, transport };
  const sides = await Promise.allSettled([
    dedupedShowFile(workspaceId, staged ? 'HEAD' : ':0', chunk.file, showOptions),
    staged
      ? dedupedShowFile(workspaceId, ':0', chunk.file, showOptions)
      : readWorkingTreeContent(
          workspaceId,
          !gitRootId && gitRootPath
            ? `${gitRootPath.replace(/\/$/, '')}/${chunk.file}`
            : chunk.file,
          gitRootId,
          transport,
        ),
  ]);
  await Promise.all(
    sides.map((side) =>
      side.status === 'rejected' ? gitReadFailureDrained(side.reason) : undefined,
    ),
  );
  for (const side of sides) if (side.status === 'rejected') throw side.reason;
  const [oldRes, newRes] = sides.map(
    (side) => (side as PromiseFulfilledResult<ShowFileResponse>).value,
  );
  if (oldRes.success) chunk.oldContent = oldRes.data ?? '';
  else if (oldRes.notAFile) {
    // Typed not-a-file rejection (#1739): a gitlink/directory entry whose
    // hunks didn't structurally classify above — expected, not a failure.
    logger.debug('git.showFile old side is not a file (gitlink/directory)', {
      workspaceId,
      filePath: chunk.file,
      staged,
    });
  } else
    logger.warn('git.showFile failed for old diff side', {
      workspaceId,
      filePath: chunk.file,
      staged,
      error: oldRes.error,
    });
  if (newRes.success) chunk.newContent = newRes.data ?? '';
  else if (newRes.notAFile) {
    logger.debug('git.showFile new side is not a file (gitlink/directory)', {
      workspaceId,
      filePath: chunk.file,
      staged,
    });
  } else
    logger.warn('content read failed for new diff side', {
      workspaceId,
      filePath: chunk.file,
      staged,
      error: newRes.error,
    });
}

const pendingFullTreeReads = new Map<string, Promise<DiffChunk[]>>();

/** Full-tree `git.diffs` recovery read (no `paths`), single-flight per
 * `(workspaceId, staged)`: concurrent flush groups awaiting recovery share one
 * in-flight daemon read instead of issuing duplicates. */
function sharedFullTreeDiffRead(
  workspaceId: string,
  staged: boolean,
  gitRootId?: string,
  transport?: GitReadTransport,
): Promise<DiffChunk[]> {
  const key = JSON.stringify([
    diffGroupKey(workspaceId, staged, gitRootId),
    transportId(transport),
  ]);
  const existing = pendingFullTreeReads.get(key);
  if (existing) return observeGitReadFailure(existing, transport?.onFailure);

  const promise = (transport?.request ?? backendRequest)<unknown>(
    'git.diffs',
    staged
      ? { workspaceId, staged: true, ...(gitRootId ? { gitRootId } : {}) }
      : { workspaceId, ...(gitRootId ? { gitRootId } : {}) },
  ).then(toDaemonDiffChunks);
  void gitReadDrained(promise, () => {
    pendingFullTreeReads.delete(key);
  });

  pendingFullTreeReads.set(key, promise);
  return observeGitReadFailure(promise, transport?.onFailure);
}

async function flushDiffGroup(key: string) {
  const pending = pendingDiffs.get(key);
  if (!pending) return;
  pendingDiffs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  const [group] = JSON.parse(key) as [string, number];
  const [wsId, staged, gitRootId] = JSON.parse(group) as [string, boolean, string];

  try {
    // One hunk read serves the whole group: the batch's collected file set is
    // sent as `paths` (PROTOCOL §5.6) so the daemon pathspec-narrows the walk
    // to exactly the requested files (unstaged includes untracked files)
    // instead of scanning the whole tree; N same-tick requests still collapse
    // into a single daemon read.
    // Sorted so the wire payload is deterministic regardless of request
    // arrival order within the tick.
    const paths = [
      ...new Set(
        [...pending.resolvers.keys()]
          .filter((path) => hasActiveCaller(pending, path))
          .map((path) => pending.wirePaths?.get(path) ?? path),
      ),
    ].sort();
    if (paths.length === 0) {
      resolveAbortedGroup(pending);
      return;
    }
    const transport = batchTransport(pending);
    const result = await (transport?.request ?? backendRequest)<unknown>(
      'git.diffs',
      staged
        ? { workspaceId: wsId, staged: true, paths, ...(gitRootId ? { gitRootId } : {}) }
        : { workspaceId: wsId, paths, ...(gitRootId ? { gitRootId } : {}) },
    );
    const chunks = toDaemonDiffChunks(result);

    // Client-side matching stays as a safety net on top of the daemon-side
    // narrowing (e.g. suffix matches for path-prefix mismatches). Callers'
    // promises are keyed by their ORIGINAL request path; matching runs against
    // the path actually sent on the wire (worktree-relative when the request
    // path was normalized at enqueue time).
    const wirePathOf = (path: string) => pending.wirePaths?.get(path) ?? path;
    const matches = new Map<string, DiffChunk | undefined>();
    for (const path of pending.resolvers.keys()) {
      if (!hasActiveCaller(pending, path)) continue;
      const wirePath = wirePathOf(path);
      matches.set(
        path,
        findChunkForPath(chunks, wirePath) ??
          (wirePath === path ? undefined : findChunkForPath(chunks, path)),
      );
    }

    // A mis-normalized (non-worktree-relative) request path that could not be
    // normalized against the workspace root can never match a literal pathspec
    // on the daemon side, so the narrowed read returns nothing for it. Recover
    // with one full-tree read (no `paths`) — single-flight per
    // (workspaceId, staged) — and re-run the suffix-match fallback against it.
    // Well-formed relative paths that simply have no diff do NOT trigger this.
    const suspiciousUnmatched = [...matches.keys()].filter(
      (path) =>
        hasActiveCaller(pending, path) &&
        matches.get(path) === undefined &&
        isSuspiciousDiffPath(wirePathOf(path)),
    );
    if (suspiciousUnmatched.length > 0) {
      logger.warn(
        `git.diffs group had non-worktree-relative request paths unmatched after daemon-side narrowing; retrying once without paths: ${suspiciousUnmatched.join(', ')}`,
        { workspaceId: wsId, staged, paths: suspiciousUnmatched },
      );
      try {
        const recoveryChunks = await sharedFullTreeDiffRead(wsId, staged, gitRootId, transport);
        for (const path of suspiciousUnmatched) {
          matches.set(path, findChunkForPath(recoveryChunks, path));
        }
      } catch (recoveryErr) {
        if (pending.transport || getPhysicalRequestCompletion(recoveryErr)) throw recoveryErr;
        logger.warn('git.diffs full-tree recovery read failed; resolving undefined', {
          workspaceId: wsId,
          staged,
          paths: suspiciousUnmatched,
          error: recoveryErr,
        });
      }
    }

    // Enrichment runs once over the union of narrowed + recovered matches
    // (the Set dedupes), so no chunk is enriched twice. Each chunk carries
    // the gitlink metadata of the request path it matched (if any), so
    // status-marked gitlinks skip the failing content reads (#1739).
    const matchedChunks = new Set(
      [...matches.entries()]
        .filter(([path]) => hasActiveCaller(pending, path))
        .map(([, chunk]) => chunk)
        .filter((chunk): chunk is DiffChunk => chunk !== undefined),
    );
    const gitlinkByChunk = new Map<DiffChunk, GitlinkMeta>();
    for (const [path, chunk] of matches) {
      const gitlink = pending.gitlinks?.get(path);
      if (chunk && gitlink && !gitlinkByChunk.has(chunk)) gitlinkByChunk.set(chunk, gitlink);
    }
    const enriched = await Promise.allSettled(
      [...matchedChunks].map((chunk) =>
        enrichChunkContents(
          wsId,
          staged,
          chunk,
          gitlinkByChunk.get(chunk),
          gitRootId,
          pending.gitRootPath,
          batchTransport(
            pending,
            [...matches].filter(([, match]) => match === chunk).map(([path]) => path),
          ),
        ),
      ),
    );

    await Promise.all(
      enriched.map((result) =>
        result.status === 'rejected' ? gitReadFailureDrained(result.reason) : undefined,
      ),
    );
    for (const result of enriched) if (result.status === 'rejected') throw result.reason;
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
  return JSON.stringify([workspaceId, baseRef ?? '', baseCommitSha ?? '']);
}

async function flushBranchBaseDiffGroup(key: string) {
  const pending = pendingBranchBaseDiffs.get(key);
  if (!pending) return;
  pendingBranchBaseDiffs.delete(key);
  if (pending.timer) clearTimeout(pending.timer);

  const [group] = JSON.parse(key) as [string, number];
  const [wsId, baseRef, baseCommitSha] = JSON.parse(group) as string[];
  const paths = [...pending.resolvers.keys()].filter((path) => hasActiveCaller(pending, path));
  if (paths.length === 0) {
    resolveAbortedGroup(pending);
    return;
  }

  try {
    const params = {
      workspaceId: wsId,
      paths,
      baseRef: baseRef || undefined,
      baseCommitSha: baseCommitSha || undefined,
      targetRef: 'HEAD',
    };
    const transport = batchTransport(pending);
    const result: GitDiffResponse = transport
      ? { success: true, data: await transport.request('git.branchDiff', params) }
      : ((await invoke('git:diff', params)) as GitDiffResponse);

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
 * (plus the per-file content enrichment). A request path that is absolute (or
 * `~`-prefixed) and lies under the workspace root is normalized to its
 * worktree-relative form before joining the batch `paths`, so the daemon-side
 * narrowing matches it; the caller's promise still resolves against the
 * original path. Returns the matching chunk, or `undefined` if the daemon
 * returned no entry for it.
 *
 * `options.gitlink` marks the path as a `git.status` mode-160000 submodule
 * entry (#1739): its chunk's sides are composed from the pin SHAs when the
 * hunks don't structurally classify, instead of `git.showFile`/`file.read`
 * calls that can only fail on a gitlink.
 */
export function batchedGitDiff(
  workspaceId: string,
  staged: boolean,
  filePath: string,
  options?: {
    gitlink?: GitlinkMeta;
    gitRootId?: string;
    gitRootPath?: string;
  } & DiffReadPolicy,
): Promise<DiffChunk | undefined> {
  const key = JSON.stringify([
    diffGroupKey(workspaceId, staged, options?.gitRootId),
    transportId(options?.transport),
  ]);
  const existing = pendingDiffs.get(key);
  const pending: PendingDiff = existing ?? {
    paths: new Set(),
    resolvers: new Map(),
    callers: new Map(),
    transports: new Map(),
    rejecters: [],
    timer: null,
    wirePaths: new Map(),
    gitlinks: new Map(),
    gitRootPath: options?.gitRootPath,
    transport: options?.transport,
  };
  if (!existing) {
    pendingDiffs.set(key, pending);
    // Flush at end of current microtask window. setTimeout(_, 0) gives
    // same-frame mounts a chance to join the same IPC without blocking.
    pending.timer = setTimeout(() => flushDiffGroup(key), 0);
  }
  const wirePath = isSuspiciousDiffPath(filePath)
    ? (toWorktreeRelative(filePath, options?.gitRootPath || workspaceWorktreeRoot(workspaceId)) ??
      filePath)
    : filePath;
  pending.paths.add(wirePath);
  pending.wirePaths?.set(filePath, wirePath);
  if (options?.gitlink) pending.gitlinks?.set(filePath, options.gitlink);

  return new Promise<DiffChunk | undefined>((resolve, reject) => {
    let resolvers = pending.resolvers.get(filePath);
    if (!resolvers) {
      resolvers = [];
      pending.resolvers.set(filePath, resolvers);
    }
    const canRead = () => !options?.signal?.aborted && (options?.canRead?.() ?? true);
    const callers = pending.callers.get(filePath) ?? [];
    if (options?.transport) {
      const transports = pending.transports.get(filePath) ?? [];
      transports.push({ transport: options.transport, canRead });
      pending.transports.set(filePath, transports);
    }
    callers.push(canRead);
    pending.callers.set(filePath, callers);
    resolvers.push((chunk) => resolve(canRead() ? chunk : undefined));
    pending.rejecters.push((err) => (canRead() ? reject(err) : resolve(undefined)));
  });
}

/**
 * Request a committed branch diff chunk for one file. Same-tick requests sharing
 * `(workspaceId, baseRef, baseCommitSha)` are merged into one side-effect-free
 * `git:diff` IPC call that compares the resolved branch base to `HEAD`.
 */
export function batchedGitBranchBaseDiff(
  workspaceId: string,
  options: BranchBaseDiffOptions & DiffReadPolicy,
  filePath: string,
): Promise<DiffChunk | undefined> {
  const key = JSON.stringify([
    branchBaseDiffGroupKey(workspaceId, options.baseRef, options.baseCommitSha),
    transportId(options.transport),
  ]);
  const existing = pendingBranchBaseDiffs.get(key);
  const pending: PendingDiff = existing ?? {
    paths: new Set(),
    resolvers: new Map(),
    callers: new Map(),
    transports: new Map(),
    rejecters: [],
    timer: null,
    transport: options.transport,
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
    const canRead = () => !options?.signal?.aborted && (options?.canRead?.() ?? true);
    const callers = pending.callers.get(filePath) ?? [];
    if (options?.transport) {
      const transports = pending.transports.get(filePath) ?? [];
      transports.push({ transport: options.transport, canRead });
      pending.transports.set(filePath, transports);
    }
    callers.push(canRead);
    pending.callers.set(filePath, callers);
    resolvers.push((chunk) => resolve(canRead() ? chunk : undefined));
    pending.rejecters.push((err) => (canRead() ? reject(err) : resolve(undefined)));
  });
}

/* ------------------------------- show-file ------------------------------- */

interface PendingShow {
  promise: Promise<ShowFileResponse>;
}

const pendingShows = new Map<string, PendingShow>();
const pendingNumstats = new Map<string, Promise<NumstatEntry[]>>();

function showKey(workspaceId: string, ref: string, filePath: string, gitRootId?: string): string {
  return JSON.stringify([workspaceId, ref, filePath, gitRootId ?? '']);
}

/**
 * Deduped daemon `git.showFile` fetch (PROTOCOL §5.6: file content at a
 * revision, index ref ':0' supported; a path missing at the ref folds to ''
 * on the daemon side). Concurrent callers for the same `(workspace, ref,
 * path, gitRootId)` share a single in-flight request; `opts.gitRootId`
 * scopes the read to a registered secondary git root and is omitted
 * from the wire call when unset, keeping the primary-root request
 * byte-identical. Deadline failures carrying physical completion propagate so
 * callers retain outstanding work. Other unscoped daemon/transport errors fold
 * into `{ success: false, error }`, preserving the legacy handler's envelope; the
 * typed `not-a-file` rejection (gitlink/directory entry, #1739) additionally
 * sets `notAFile: true` so callers can route it instead of treating it as a
 * failure.
 */
export function dedupedShowFile(
  workspaceId: string,
  ref: string,
  filePath: string,
  opts?: { gitRootId?: string; transport?: GitReadTransport },
): Promise<ShowFileResponse> {
  const key = JSON.stringify([
    showKey(workspaceId, ref, filePath, opts?.gitRootId),
    transportId(opts?.transport),
  ]);
  const existing = pendingShows.get(key);
  if (existing) return observeGitReadFailure(existing.promise, opts?.transport?.onFailure);

  const promise = (opts?.transport?.request ?? backendRequest)<{ content?: unknown }>(
    'git.showFile',
    {
      workspaceId,
      filePath,
      ref,
      ...(opts?.gitRootId ? { gitRootId: opts.gitRootId } : {}),
    },
  )
    .then((result): ShowFileResponse => ({
      success: true,
      data: typeof result?.content === 'string' ? result.content : '',
    }))
    .catch((error): ShowFileResponse => {
      if (getPhysicalRequestCompletion(error) || (opts?.transport && !isNotAFileError(error)))
        throw error;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        ...(isNotAFileError(error) ? { notAFile: true } : {}),
      };
    });
  void gitReadDrained(promise, () => {
    pendingShows.delete(key);
  });

  pendingShows.set(key, { promise });
  return observeGitReadFailure(promise, opts?.transport?.onFailure);
}

function numstatKey(workspaceId: string, options: NumstatOptions): string {
  return JSON.stringify([
    workspaceId,
    options.staged === undefined ? '' : options.staged ? '1' : '0',
    options.baseRef ?? '',
    options.baseCommitSha ?? '',
    options.targetRef ?? '',
    options.gitRootId ?? '',
    transportId(options.transport),
  ]);
}

export function dedupedGitNumstat(
  workspaceId: string,
  options: NumstatOptions = {},
): Promise<NumstatEntry[]> {
  if (options.gitRootId) return Promise.reject(new Error('Secondary-root numstat is unavailable'));
  const key = numstatKey(workspaceId, options);
  const existing = pendingNumstats.get(key);
  if (existing) return observeGitReadFailure(existing, options.transport?.onFailure);

  const { transport, ...params } = options;
  const promise = (
    transport
      ? transport
          .request<NumstatEntry[]>('git.numstat', { workspaceId, ...params })
          .then((data) => ({ success: true, data }))
      : (invoke('git:numstat', { workspaceId, ...params }) as Promise<GitNumstatResponse>)
  ).then((result) => (result?.success && Array.isArray(result.data) ? result.data : []));
  void gitReadDrained(promise, () => {
    pendingNumstats.delete(key);
  });

  pendingNumstats.set(key, promise);
  return observeGitReadFailure(promise, options.transport?.onFailure);
}
