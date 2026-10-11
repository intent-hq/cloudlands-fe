import type {
  GitHubPullRequestDetails,
  GitHubIssueDetails,
} from '$shared/types/github-link-preview';
import type { GitHubUser } from '../../features/github-auth/types';
import type { LinearIssueResult } from '../../features/linear-auth/types';
import type { SentryIssueResult } from '../../features/sentry-auth/types';

/**
 * GitHub-URL branch listing (`github.branches.list` + `github.repos.get`,
 * §5.27) for a repo the user has not cloned yet: remote branch names plus the
 * repo's default branch when the metadata read succeeds.
 */
export interface GitHubBranchListing {
  branches: string[];
  defaultBranch?: string;
}

/**
 * Cached-refs branch listing (`github.branches.listCached`, §5.27): branch
 * names read from the daemon's local repo cache (`source: "cache"`) — or,
 * on a cache miss, from the daemon's one-round-trip `git ls-remote`
 * fallback (`source: "ls-remote"` with `cached: false`). A failed fallback
 * folds to the plain miss — `{ cached: false, branches: [] }` with `source`
 * omitted — the same shape pre-fallback daemons always return (`source` is
 * absent on older daemons).
 */
export interface GitHubCachedBranchListing {
  cached: boolean;
  branches: string[];
  defaultBranch?: string;
  source?: 'cache' | 'ls-remote';
}

/**
 * Remote repo-config read (`github.repoConfig.get`, §5.27) for a GitHub
 * repo with no local checkout: the committed `.intent/config.json` fetched
 * via the contents API. `config` is null when the file (or repo/ref) is
 * missing; a present but invalid file folds tolerantly to `{}` on the daemon.
 */
export interface GitHubRepoConfigResult {
  config: Record<string, unknown> | null;
  exists: boolean;
}

export interface IntegrationsClient {
  captureRepositoryCheckout(
    query: import('$shared/types/repository-checkout').CheckoutCaptureQuery,
  ): Promise<
    import('$shared/types/repository-checkout').CheckoutResult<
      import('$shared/types/repository-checkout').RepositoryCheckoutSession
    >
  >;
  /** Admitted GitLab details on the original workspace connection; never falls back. */
  captureRepositoryResource(
    workspaceId: string,
  ): Promise<import('$shared/types/repository-resource-read').RepositoryResourceSession>;
  githubUser(workspaceId?: string): Promise<GitHubUser | null>;
  /**
   * One pull request by number (`github.pulls.get`, §5.27). THROWS on
   * transport/daemon errors (e.g. "GitHub is not configured.") and when the
   * daemon reports no such PR, so the link hover card renders an explicit
   * URL-only fallback — never a fabricated card.
   */
  githubPullRequest(
    owner: string,
    repo: string,
    number: number,
    workspaceId?: string,
  ): Promise<GitHubPullRequestDetails>;
  /**
   * One issue by number (`github.issues.get`, §5.27). Same THROWS contract as
   * `githubPullRequest`.
   */
  githubIssue(
    owner: string,
    repo: string,
    number: number,
    workspaceId?: string,
  ): Promise<GitHubIssueDetails>;
  /**
   * Remote branch names for a GitHub repo (`github.branches.list`, §5.27),
   * with the default branch from `github.repos.get` (best-effort). Unlike the
   * issue reads this THROWS on transport/daemon errors (e.g. "GitHub is not
   * configured.") so the workspace-initializer BranchSelector can render an
   * explicit error/auth state — never a fabricated branch list. An optional
   * `prefix` narrows the listing server-side (GitHub's `refs/heads/{prefix}`
   * matching-refs semantics) so branches beyond the first page are findable.
   */
  githubBranches(
    owner: string,
    repo: string,
    prefix?: string,
    workspaceId?: string,
  ): Promise<GitHubBranchListing>;
  /**
   * Branch names from the daemon's local repo cache — or its `git ls-remote`
   * fallback on a cache miss (`github.branches.listCached`, §5.27) — purely
   * a fast first paint for the BranchSelector. NEVER throws: failures fold
   * to a cold-cache miss (`{ cached: false, branches: [] }`) so
   * `githubBranches` stays the only error authority.
   */
  githubBranchesCached(
    owner: string,
    repo: string,
    workspaceId?: string,
  ): Promise<GitHubCachedBranchListing>;
  /**
   * The repo's committed `.intent/config.json` (`github.repoConfig.get`,
   * §5.27) for a GitHub repo without a local checkout. `ref` defaults to
   * the repo's default branch on the daemon when omitted. THROWS on
   * transport/daemon errors (e.g. unauthenticated private repo); the
   * setup-script probe folds failures to "no script" at the call site.
   */
  githubRepoConfig(
    owner: string,
    repo: string,
    ref?: string,
    workspaceId?: string,
  ): Promise<GitHubRepoConfigResult>;
  linearIssues(workspaceId?: string): Promise<LinearIssueResult[]>;
  sentryIssues(workspaceId?: string): Promise<SentryIssueResult[]>;
  subscribe(handler: (snapshot: { githubUser: GitHubUser | null }) => void): () => void;
}
