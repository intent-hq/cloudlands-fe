/**
 * Live integrations domain backed by the intentd daemon
 * (PROTOCOL §5.27 `github.*`, §5.28 `linear.*`, §5.29 `sentry.*`).
 *
 * Backs the connections/Add-context seeding through the `AppClient` seam.
 * Issue reads are gated on the namespace auth probes (`linear.authStatus` /
 * `sentry.authStatus`) so an unconfigured integration degrades to an empty
 * list instead of surfacing the daemon's "not configured" RPC error;
 * `github.getUser` maps the daemon's camelCase derived identity to the FE's
 * snake_case `GitHubUser`. Every failure folds to null/empty so the pane
 * renders its auth-hint empty state — never mock fixtures.
 */
import type {
  AppClient,
  GitHubBranchListing,
  GitHubCachedBranchListing,
  GitHubIssueDetails,
  GitHubPullRequestDetails,
  GitHubPullRequestState,
  GitHubRepoConfigResult,
  IntegrationsClient,
  SubscriptionHandler,
  Unsubscribe,
} from '../app-client';
import type { GitHubUser } from '$features/github-auth/types';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type { SentryIssueResult } from '$features/sentry-auth/types';
import { backendRequest } from './backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('LiveIntegrationsClient');

/** Daemon `github.getUser` result — derived identity only, never the PAT. */
interface GithubGetUserResult {
  user?: { login?: string; avatarUrl?: string; htmlUrl?: string } | null;
}

/** Shared `authenticated` probe shape of `linear.authStatus` / `sentry.authStatus`. */
interface IntegrationAuthStatus {
  authenticated?: boolean;
}

/** Daemon `GithubUser` (§5.27 DTO schemas) — derived identity only. */
interface GithubUserWire {
  login: string;
}

/** Daemon `GithubPullRequest` (§5.27 DTO schemas — subset the preview consumes). */
interface GithubPullWire {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  user: GithubUserWire;
  headRef: string;
  baseRef: string;
  merged: boolean;
  draft: boolean;
}

/** Daemon `GithubIssue` (§5.27 DTO schemas — subset the preview consumes). */
interface GithubIssueWire {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  user: GithubUserWire;
}

/**
 * Collapse the wire's `state` + `merged` + `draft` into the FE's single state.
 * GitHub keeps `draft: true` on a closed draft PR, so `closed` wins over `draft`.
 */
function pullRequestState(pull: GithubPullWire): GitHubPullRequestState {
  if (pull.merged === true) return 'merged';
  if (pull.state === 'closed') return 'closed';
  if (pull.draft === true) return 'draft';
  return 'open';
}

export class LiveIntegrationsClient implements IntegrationsClient {
  async githubUser(): Promise<GitHubUser | null> {
    try {
      const result = await backendRequest<GithubGetUserResult>('github.getUser');
      const user = result?.user;
      if (!user || typeof user.login !== 'string' || user.login.length === 0) return null;
      // The wire carries login/avatarUrl/htmlUrl only; name/email have no
      // daemon source in the PAT-from-env model.
      return {
        login: user.login,
        name: null,
        email: null,
        avatar_url: typeof user.avatarUrl === 'string' ? user.avatarUrl : '',
      };
    } catch {
      return null;
    }
  }

  /**
   * `github.branches.list` (§5.27) for the branch names plus `github.repos.get`
   * for the repo's default branch, issued CONCURRENTLY (both are REST-backed,
   * so sequencing them doubles the settle time). Unlike the issue reads,
   * branch-list failures PROPAGATE: the BranchSelector must render an explicit
   * error/auth state, never an empty-or-fabricated list. The default-branch
   * read is best-effort — its failure degrades to `undefined`. A non-empty
   * `prefix` is forwarded so the daemon filters server-side (matching-refs);
   * empty/omitted keeps the unfiltered wire shape for older daemons. Prefix
   * searches SKIP the `github.repos.get` leg entirely — the default branch
   * can't change based on the filter and the caller discards it, so per-
   * keystroke searches cost one REST call, not two.
   */
  async githubBranches(owner: string, repo: string, prefix?: string): Promise<GitHubBranchListing> {
    const [result, defaultBranch] = await Promise.all([
      backendRequest<{ branches?: unknown }>('github.branches.list', {
        owner,
        repo,
        ...(prefix ? { prefix } : {}),
      }),
      prefix
        ? Promise.resolve(undefined)
        : backendRequest<{ repo?: { defaultBranch?: unknown } | null }>('github.repos.get', {
            owner,
            repo,
          }).then(
            (repoResult) => {
              const value = repoResult?.repo?.defaultBranch;
              return typeof value === 'string' && value.length > 0 ? value : undefined;
            },
            // Default branch is a nicety; the branch list alone is sufficient.
            () => undefined,
          ),
    ]);
    const branches = Array.isArray(result?.branches)
      ? result.branches.filter((branch): branch is string => typeof branch === 'string')
      : [];
    return { branches, defaultBranch };
  }

  /**
   * `github.branches.listCached` (§5.27) — branch names from the daemon's
   * local repo cache, or its one-round-trip `git ls-remote` fallback on a
   * cache miss (`source: "ls-remote"`). Purely a fast first paint for the
   * BranchSelector: failures fold to a cold-cache miss
   * (`{ cached: false, branches: [] }`) so the authoritative
   * `githubBranches` path stays the only error authority.
   */
  async githubBranchesCached(owner: string, repo: string): Promise<GitHubCachedBranchListing> {
    try {
      const result = await backendRequest<{
        cached?: unknown;
        branches?: unknown;
        defaultBranch?: unknown;
        source?: unknown;
      }>('github.branches.listCached', { owner, repo });
      const branches = Array.isArray(result?.branches)
        ? result.branches.filter((branch): branch is string => typeof branch === 'string')
        : [];
      const defaultBranch =
        typeof result?.defaultBranch === 'string' && result.defaultBranch.length > 0
          ? result.defaultBranch
          : undefined;
      const source =
        result?.source === 'cache' || result?.source === 'ls-remote' ? result.source : undefined;
      return { cached: result?.cached === true, branches, defaultBranch, source };
    } catch {
      return { cached: false, branches: [] };
    }
  }

  /**
   * `github.repoConfig.get` (§5.27 v2.4) — the repo's committed
   * `.intent/config.json` read via the contents API, no clone. `ref` is only
   * sent when provided (daemon defaults to the repo's default branch).
   * Failures PROPAGATE; the setup-script probe folds them to "no script".
   */
  async githubRepoConfig(
    owner: string,
    repo: string,
    ref?: string,
  ): Promise<GitHubRepoConfigResult> {
    const result = await backendRequest<{ config?: unknown; exists?: unknown }>(
      'github.repoConfig.get',
      ref ? { owner, repo, ref } : { owner, repo },
    );
    const config =
      result?.config && typeof result.config === 'object' && !Array.isArray(result.config)
        ? (result.config as Record<string, unknown>)
        : null;
    // §5.27 never pairs a non-object config with exists=true — surface a
    // daemon wire regression instead of silently degrading to "no script".
    if (config === null && result?.config != null) {
      logger.warn('github.repoConfig.get returned a non-object config; treating as null', {
        owner,
        repo,
      });
    }
    return { config, exists: result?.exists === true };
  }

  /**
   * `github.pulls.get` (§5.27) — one PR for the link hover card. Failures
   * PROPAGATE (and a `pull: null` result throws) so the card renders its
   * URL-only fallback instead of a fabricated preview.
   */
  async githubPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequestDetails> {
    const result = await backendRequest<{ pull?: GithubPullWire | null }>('github.pulls.get', {
      owner,
      repo,
      number,
    });
    const pull = result?.pull;
    if (!pull) throw new Error(`Pull request ${owner}/${repo}#${number} not found`);
    return {
      owner,
      repo,
      number: pull.number,
      title: pull.title,
      state: pullRequestState(pull),
      author: pull.user.login,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
      url: pull.htmlUrl,
      headRef: pull.headRef,
      baseRef: pull.baseRef,
    };
  }

  /**
   * `github.issues.get` (§5.27) — one issue for the link hover card. Same
   * propagate-failures contract as `githubPullRequest`.
   */
  async githubIssue(owner: string, repo: string, number: number): Promise<GitHubIssueDetails> {
    const result = await backendRequest<{ issue?: GithubIssueWire | null }>('github.issues.get', {
      owner,
      repo,
      number,
    });
    const issue = result?.issue;
    if (!issue) throw new Error(`Issue ${owner}/${repo}#${number} not found`);
    return {
      owner,
      repo,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user.login,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      url: issue.htmlUrl,
    };
  }

  async linearIssues(): Promise<LinearIssueResult[]> {
    try {
      const status = await backendRequest<IntegrationAuthStatus>('linear.authStatus');
      if (status?.authenticated !== true) return [];
      // §5.28: cursor-paginated `{ issues, nextToken }` envelope; the pane
      // consumes the first page only.
      const result = await backendRequest<{ issues: LinearIssueResult[] }>('linear.listIssues');
      return result.issues;
    } catch {
      return [];
    }
  }

  async sentryIssues(): Promise<SentryIssueResult[]> {
    try {
      const status = await backendRequest<IntegrationAuthStatus>('sentry.authStatus');
      if (status?.authenticated !== true) return [];
      // §5.29: cursor-paginated `{ issues, nextToken }` envelope; the pane
      // consumes the first page only.
      const result = await backendRequest<{ issues: SentryIssueResult[] }>('sentry.listIssues');
      return result.issues;
    } catch {
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<{ githubUser: GitHubUser | null }>): Unsubscribe {
    // No `github:*` change events exist on the wire yet (PROTOCOL §6), so the
    // subscription is a one-shot snapshot of the current derived identity.
    let cancelled = false;
    void this.githubUser().then((githubUser) => {
      if (!cancelled) handler({ githubUser });
    });
    return () => {
      cancelled = true;
    };
  }
}

// Tied to AppClient["integrations"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['integrations'] | undefined = undefined as
  LiveIntegrationsClient | undefined;
void _interfaceCheck;
