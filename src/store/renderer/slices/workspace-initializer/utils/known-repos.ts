import { getRecentRepoIdentity } from '$lib/components/workspace/initializer/recent-repo-display';
import type {
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRecentRepoRefresh,
} from '../workspace-initializer-types';
import { recentRepoKey } from './recent-repo-key';

/** Refresh slot shared by the command palette (pickers keep their own per-mount slots). */
export const KNOWN_REPOS_REFRESH_ID = 'known-repos';

/** A finished full load is reused for this long before a new palette open reloads. */
export const KNOWN_REPOS_RELOAD_AFTER_MS = 60_000;

/**
 * `all`: every known repo, in the full load's recency order (form picker, palette).
 * `recent`: the saved list updated by the load, first 9 (legacy tabbed picker).
 */
type KnownReposMode = 'all' | 'recent';

export interface KnownReposInput {
  saved: readonly WorkspaceInitializerRecentRepo[];
  /** The admitted full load; omit when there is none for the current admission. */
  source?: Pick<WorkspaceInitializerRecentRepoRefresh, 'repos'> | null;
  dismissed: Readonly<Record<string, true>>;
  mode: KnownReposMode;
}

/** The one repo list merge shared by the New Workspace picker and the command palette. */
export function mergeKnownRepos({
  saved,
  source,
  dismissed,
  mode,
}: KnownReposInput): WorkspaceInitializerRecentRepo[] {
  if (!source) return [...saved];
  const merged = new Map<string, WorkspaceInitializerRecentRepo>();
  if (mode === 'all') {
    // The load already includes saved entries in usage order; first entry wins.
    for (const repo of [...source.repos, ...saved]) {
      const key = recentRepoKey(repo);
      if (!merged.has(key)) merged.set(key, repo);
    }
  } else {
    for (const repo of saved) merged.set(recentRepoKey(repo), repo);
    for (const repo of source.repos) merged.set(recentRepoKey(repo), repo);
  }
  const visible = [...merged.values()].filter((repo) => !dismissed[recentRepoKey(repo)]);
  return mode === 'all' ? visible : visible.slice(0, 9);
}

/** Last-used time in ms, or 0 when unknown. */
export function knownRepoLastUsedMs(repo: Pick<WorkspaceInitializerRecentRepo, 'lastUsedAt'>) {
  const time = repo.lastUsedAt ? Date.parse(repo.lastUsedAt) : NaN;
  return Number.isFinite(time) ? time : 0;
}

export type KnownReposLoadDecision = 'skip' | 'reuse' | 'load';

/**
 * Whether a palette open starts the shared full load: never while workspace
 * creation is hidden, reuse a running load, skip a load that finished ready
 * less than {@link KNOWN_REPOS_RELOAD_AFTER_MS} ago, otherwise load.
 */
export function decideKnownReposLoad({
  visible,
  admission,
  entry,
  readyAt,
  now,
}: {
  visible: boolean;
  admission: string | null | undefined;
  entry:
    | Pick<WorkspaceInitializerRecentRepoRefresh, 'requestId' | 'admission' | 'status'>
    | null
    | undefined;
  /** When the load with `requestId` finished ready (tracked by the saga). */
  readyAt: { requestId: string; at: number } | null;
  now: number;
}): KnownReposLoadDecision {
  if (!visible || !admission) return 'skip';
  if (!entry || entry.admission !== admission) return 'load';
  if (entry.status === 'pending') return 'reuse';
  if (
    entry.status === 'ready' &&
    readyAt?.requestId === entry.requestId &&
    now - readyAt.at < KNOWN_REPOS_RELOAD_AFTER_MS
  )
    return 'skip';
  return 'load';
}

/** The `workspace-prefill` entry that opens New Workspace with `repo` selected. */
export type KnownRepoPrefill =
  | { repoPath: string }
  | { githubUrl: string }
  | { repositoryCheckoutDraft: { instanceBaseUrl: string; projectPath: string } };

export function prefillForRepo(
  repo: WorkspaceInitializerRecentRepo,
  gitlabInstance?: string,
): KnownRepoPrefill {
  if (repo.type === 'local') return { repoPath: repo.path };
  const identity = getRecentRepoIdentity(repo, gitlabInstance);
  if (identity?.provider === 'gitlab') {
    return {
      repositoryCheckoutDraft: {
        instanceBaseUrl: identity.instanceBaseUrl,
        projectPath: identity.projectPath,
      },
    };
  }
  if (identity) return { githubUrl: `https://github.com/${identity.projectPath}` };
  return { githubUrl: repo.githubUrl || `https://github.com/${repo.path}` };
}
