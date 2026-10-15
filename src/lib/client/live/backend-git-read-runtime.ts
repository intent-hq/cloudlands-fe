import { toCommitInfo } from './utils/commit-history-wire';
import { createBackendCommitHistoryReader } from './backend-commit-history-reader';
import type { CommitHistoryPageOptions } from '../commit-history-types';
import { GitFileStatus } from '$shared/types';
import type { FileStatus, GitStatus, PullRequestInfo, PullRequestStatus } from '$shared/types';
import { ChangeStage } from '../../../features/file-tracking/types';
import type {
  CommitInfo,
  FileChangeStatus,
  TrackedChange,
} from '../../../features/file-tracking/types';
import type { PrRefreshResult } from '../lifecycle-read-client-types';
import { BackendError } from './backend-transport-types';

interface GitReadRuntimeDependencies {
  readonly request: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
  /** Present only on a runtime owned by one already-acquired physical scope. */
  readonly isCurrent?: () => boolean;
}

/** Coerce a raw daemon git-status object into the renderer `GitStatus` shape. */
function normalizeGitStatus(raw: Record<string, unknown>): GitStatus {
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const files: FileStatus[] = rawFiles.map((f) => {
    const file = f as Record<string, unknown>;
    const entry: FileStatus = {
      path: String(file.path ?? ''),
      status: (typeof file.status === 'string'
        ? file.status.trim() || GitFileStatus.Modified
        : GitFileStatus.Modified) as GitFileStatus,
      staged: Boolean(file.staged),
    };
    // Gitlink (submodule) marking — present only on 160000 entries (#1739).
    if (typeof file.mode === 'string') entry.mode = file.mode;
    if (typeof file.oldSha === 'string') entry.oldSha = file.oldSha;
    if (typeof file.newSha === 'string') entry.newSha = file.newSha;
    return entry;
  });
  return {
    branch: String(raw.branch ?? ''),
    ahead: Number(raw.ahead ?? 0),
    behind: Number(raw.behind ?? 0),
    diverged: Boolean(raw.diverged),
    files,
    hasUncommittedChanges: Boolean(raw.hasUncommittedChanges),
    hasUntrackedFiles: Boolean(raw.hasUntrackedFiles),
  };
}

/** Wire stage values (§5.19) — a 1:1 match with the renderer `ChangeStage` enum. */
const WIRE_CHANGE_STAGES: ReadonlySet<string> = new Set(Object.values(ChangeStage));
const WIRE_CHANGE_STATUSES: ReadonlySet<string> = new Set([
  'added',
  'modified',
  'deleted',
  'renamed',
]);

/**
 * Map a daemon `file-tracking.getChanges` entry (§5.19 `TrackedChange`:
 * id/file/relativePath/stage/status?/stats/attribution) into the renderer
 * `TrackedChange`. The wire shape mirrors the renderer type, so fields are
 * carried through with type guards rather than re-derived.
 */
function toTrackedChange(raw: unknown): TrackedChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const file = typeof r.file === 'string' ? r.file : '';
  const relativePath = typeof r.relativePath === 'string' ? r.relativePath : file;
  if (!file && !relativePath) return null;
  const stage =
    typeof r.stage === 'string' && WIRE_CHANGE_STAGES.has(r.stage)
      ? (r.stage as ChangeStage)
      : ChangeStage.Unstaged;
  const status =
    typeof r.status === 'string' && WIRE_CHANGE_STATUSES.has(r.status)
      ? (r.status as FileChangeStatus)
      : undefined;
  const rawStats = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<
    string,
    unknown
  >;
  const rawAttribution = (
    r.attribution && typeof r.attribution === 'object' ? r.attribution : {}
  ) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : relativePath || file,
    file: file || relativePath,
    relativePath: relativePath || file,
    stage,
    stats: {
      additions: typeof rawStats.additions === 'number' ? rawStats.additions : 0,
      deletions: typeof rawStats.deletions === 'number' ? rawStats.deletions : 0,
    },
    ...(status ? { status } : {}),
    attribution: {
      ...(rawAttribution.agent && typeof rawAttribution.agent === 'object'
        ? { agent: rawAttribution.agent as TrackedChange['attribution']['agent'] }
        : {}),
      ...(typeof rawAttribution.manual === 'boolean' ? { manual: rawAttribution.manual } : {}),
      timestamp: typeof rawAttribution.timestamp === 'number' ? rawAttribution.timestamp : 0,
    },
    ...(typeof r.commitHash === 'string' ? { commitHash: r.commitHash } : {}),
  };
}

/** One status flight map per runtime. Source uses one module instance; scoped callers use one per acquisition. */
export function createBackendGitReadRuntime(dependencies: GitReadRuntimeDependencies) {
  function assertCurrent(): void {
    if (dependencies.isCurrent && !dependencies.isCurrent()) {
      // i18n-ignore (internal captured-route diagnostic)
      throw new BackendError({
        code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
        message: 'Captured Git scope unavailable',
      });
    }
  }
  /** Concurrent ordinary readers for one workspace share one fresh wire snapshot. */
  const statusReadsInFlight = new Map<string, Promise<GitStatus | null>>();

  function fetchStatus(
    workspaceId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<GitStatus | null> {
    assertCurrent();
    if (!options?.forceRefresh) {
      const existing = statusReadsInFlight.get(workspaceId);
      if (existing) return existing;
    }

    const request = dependencies
      .request<unknown>('git.status', {
        workspaceId,
        ...(options?.forceRefresh ? { forceRefresh: true } : {}),
      })
      .then((result) => {
        assertCurrent();
        if (!result || typeof result !== 'object') return null;
        return normalizeGitStatus(result as Record<string, unknown>);
      })
      .catch((error) => {
        if (dependencies.isCurrent && !dependencies.isCurrent()) throw error;
        return null;
      });
    statusReadsInFlight.set(workspaceId, request);
    const finished = () => {
      if (statusReadsInFlight.get(workspaceId) === request) {
        statusReadsInFlight.delete(workspaceId);
      }
    };
    void request.then(finished, finished);
    return request;
  }

  async function trackedChanges(workspaceId: string): Promise<TrackedChange[] | null> {
    try {
      assertCurrent();
      const result = await dependencies.request<{ changes?: unknown[] }>(
        'file-tracking.getChanges',
        {
          workspaceId,
        },
      );
      assertCurrent();
      const changes = Array.isArray(result?.changes) ? result.changes : [];
      return changes.map(toTrackedChange).filter((c): c is TrackedChange => c !== null);
    } catch (error) {
      if (dependencies.isCurrent && !dependencies.isCurrent()) throw error;
      return null;
    }
  }

  const readHistoryPage = createBackendCommitHistoryReader(dependencies);

  async function commitsWithBoundary(
    workspaceId: string,
    includeOlder?: boolean,
    options?: Omit<CommitHistoryPageOptions, 'includeOlder'>,
  ): Promise<{
    commits: CommitInfo[];
    boundarySha: string | null;
    nextToken: string | null;
  }> {
    if (options)
      return readHistoryPage(workspaceId, { ...options, includeOlder: includeOlder ?? false });
    try {
      assertCurrent();
      const result = await dependencies.request<{
        commits?: unknown[];
        boundarySha?: unknown;
        nextToken?: unknown;
      }>('file-tracking.loadCommits', {
        workspaceId,
        ...(includeOlder !== undefined ? { includeOlder } : {}),
      });
      assertCurrent();
      const commits = Array.isArray(result?.commits) ? result.commits : [];
      // Runtime validation: boundarySha and nextToken must be string | null.
      // Untrusted payloads from backendRequest could send any shape.
      const boundarySha =
        result?.boundarySha === null || typeof result?.boundarySha === 'string'
          ? result.boundarySha
          : null;
      const nextToken =
        result?.nextToken === null || typeof result?.nextToken === 'string'
          ? result.nextToken
          : null;
      return {
        commits: commits.map(toCommitInfo).filter((c): c is CommitInfo => c !== null),
        boundarySha,
        nextToken,
      };
    } catch (error) {
      if (dependencies.isCurrent && !dependencies.isCurrent()) throw error;
      return { commits: [], boundarySha: null, nextToken: null };
    }
  }

  async function prRefresh(
    workspaceId: string,
    options?: { automatic: boolean },
  ): Promise<PrRefreshResult | null> {
    try {
      assertCurrent();
      const result = await dependencies.request<Record<string, unknown>>('pr.refresh', {
        workspaceId,
        ...options,
      });
      assertCurrent();
      if (!result || typeof result !== 'object' || typeof result.outcome !== 'string') return null;
      const outcomes: readonly string[] = ['skipped', 'unchanged', 'linked', 'updated', 'unlinked'];
      if (!outcomes.includes(result.outcome)) return null;
      return {
        outcome: result.outcome as PrRefreshResult['outcome'],
        prNumber: typeof result.prNumber === 'number' ? result.prNumber : undefined,
        prUrl: typeof result.prUrl === 'string' ? result.prUrl : undefined,
        prStatus:
          typeof result.prStatus === 'string' ? (result.prStatus as PullRequestStatus) : undefined,
        pullRequests: Array.isArray(result.pullRequests)
          ? (result.pullRequests as PullRequestInfo[])
          : [],
      };
    } catch (error) {
      // An acquired publication scope owns terminal failure settlement; never erase its error.
      if (dependencies.isCurrent) throw error;
      return null;
    }
  }

  return { status: fetchStatus, trackedChanges, commitsWithBoundary, prRefresh };
}
