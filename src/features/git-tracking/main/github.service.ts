/**
 * GitHub Service
 *
 * Routes every GitHub data call through the intentd daemon's `github.*` JSON-RPC
 * namespace (PROTOCOL §5.27 — replaces the deleted Augment Cloud proxy). The
 * live consumer is `workspace.service.ts`, which drives the periodic PR refresh.
 * The wire DTOs are camelCase (`headRef`, `htmlUrl`, …) and are mapped here
 * into the FE's snake-/camel-mixed `PullRequest` / `GitHubIssue` shapes
 * consumed by the renderer.
 *
 * Surface gaps vs. the old Augment proxy: `github.*` does not expose
 * explicit-addressed equivalents of the old `agents/run-remote-tool` calls for
 * check-runs and review verdicts (the `pr.getReviews` / `pr.listCheckRuns` in
 * §5.7 are workspace-scoped and cannot be reached with `(owner, repo, …)`).
 * `getCheckRuns` and `getReviews` therefore degrade to empty results so callers
 * fall back to "unknown CI / no decision" instead of erroring.
 */

import { Logger } from '../../../shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { githubAuthService } from '../../github-auth/main/github-auth.service';
import type { PullRequest, GitHubIssue } from '../types';

const logger = new Logger('GitHubService');

// The FE-side `GitHubUser` (snake_case `avatar_url`) lives in
// `../../github-auth/types` and is what auth-side callers use for the
// authenticated identity. The `github.*` wire surface in §5.27 uses a smaller
// camelCase `GithubUser` (`avatarUrl` / `htmlUrl`) embedded inside PR / issue
// payloads, so the wire shape is defined locally to keep the mapping explicit.

/** Wire shape of `github.GithubUser` (PROTOCOL §5.27 DTO schemas). */
interface WireUser {
  login: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

/** Wire shape of `github.GithubPullRequest` (PROTOCOL §5.27 DTO schemas). */
interface WirePullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  closedAt?: string;
  user: WireUser;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  merged: boolean;
  draft: boolean;
  mergeable?: boolean | null;
  mergeableState?: string;
  labels: string[];
  assignees?: WireUser[];
  comments: number;
  reviewComments: number;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** Wire shape of `github.GithubIssue` (PROTOCOL §5.27 DTO schemas). */
interface WireIssue {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  user: WireUser;
  labels: string[];
  comments: number;
  owner?: string;
  repo?: string;
}

/** Wire shape of `github.GithubRepo` (PROTOCOL §5.27 DTO schemas). */
interface WireRepo {
  owner: string;
  name: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  defaultBranch?: string;
}

/** Map a `WirePullRequest` into the FE's `PullRequest` shape. */
function toPullRequest(pr: WirePullRequest): PullRequest {
  const derivedState: 'open' | 'closed' | 'merged' | 'draft' = pr.merged
    ? 'merged'
    : pr.draft
      ? 'draft'
      : (pr.state as 'open' | 'closed');
  return {
    id: pr.number.toString(),
    number: pr.number,
    title: pr.title,
    description: pr.body || undefined,
    state: derivedState,
    url: pr.htmlUrl,
    htmlUrl: pr.htmlUrl,
    sourceBranch: pr.headRef,
    targetBranch: pr.baseRef,
    author: {
      login: pr.user?.login || 'unknown',
      name: undefined,
      avatarUrl: pr.user?.avatarUrl,
    },
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt || undefined,
    closedAt: pr.closedAt || undefined,
    mergeable: pr.mergeable ?? undefined,
    mergeableState: pr.mergeableState ?? undefined,
    reviews: [],
    checks: [],
    labels: pr.labels || [],
    assignees: (pr.assignees || []).map((a) => a.login),
    milestone: undefined,
    commits: pr.commits || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changedFiles: pr.changedFiles || 0,
    headSha: pr.headSha || undefined,
  };
}

/** Map a `WireIssue` into the FE's `GitHubIssue` shape. */
function toIssue(issue: WireIssue, owner: string, repo: string): GitHubIssue {
  return {
    id: issue.number.toString(),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    url: issue.htmlUrl,
    htmlUrl: issue.htmlUrl,
    author: {
      login: issue.user?.login || 'unknown',
      name: undefined,
      avatarUrl: issue.user?.avatarUrl,
    },
    labels: issue.labels || [],
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    comments: issue.comments || 0,
    owner: issue.owner ?? owner,
    repo: issue.repo ?? repo,
  };
}

export class GitHubService {
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Check if authenticated via the daemon's GitHub auth (PROTOCOL §5.27
   * `github.authStatus`, surfaced through `githubAuthService`).
   */
  async isAuthenticated(): Promise<boolean> {
    return githubAuthService.isAuthenticated();
  }

  /**
   * Refresh the client (clears cache).
   * Call this after the user authenticates to ensure fresh data.
   */
  async refreshClient(): Promise<void> {
    this.cache.clear();
    logger.info('GitHub service cache cleared');
  }

  /**
   * Get branches for a repository — `github.branches.list` + `github.repos.get`
   * (the latter supplies `defaultBranch`).
   */
  async getBranches(
    owner: string,
    repo: string,

    _options?: { per_page?: number },
  ): Promise<{ branches: string[]; defaultBranch: string } | null> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      return null;
    }

    const cacheKey = `branches:${owner}/${repo}`;
    const cached = this.getFromCache<{ branches: string[]; defaultBranch: string }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const client = getBackendClient();
      const [branchesResult, repoResult] = await Promise.all([
        client.request<{ branches: string[]; nextToken?: string }>(
          'github.branches.list',
          { owner, repo },
        ),
        client.request<{ repo: WireRepo | null }>('github.repos.get', { owner, repo }),
      ]);

      const result = {
        branches: branchesResult?.branches ?? [],
        defaultBranch: repoResult?.repo?.defaultBranch || 'main',
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('Failed to get branches', error as Error);
      return null;
    }
  }

  /**
   * Get pull requests for a repository — `github.pulls.list` (PROTOCOL §5.27).
   */
  async getPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      head?: string;
      base?: string;
      sort?: 'created' | 'updated' | 'popularity' | 'long-running';
      direction?: 'asc' | 'desc';
      per_page?: number;
      force?: boolean;
    },
  ): Promise<PullRequest[]> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty PR list');
      return [];
    }

    // Destructure force/per_page out so the cache key & wire params are clean.
    const { force, per_page, ...rest } = options || {};
    const cacheKey = `prs:${owner}/${repo}:${JSON.stringify({ ...rest, per_page })}`;
    if (!force) {
      const cached = this.getFromCache<PullRequest[]>(cacheKey);
      if (cached) {
        logger.debug('Returning cached PRs', { owner, repo, count: cached.length });
        return cached;
      }
    }

    try {
      logger.info('Fetching PRs via github.pulls.list', { owner, repo, options: rest });
      const params: Record<string, unknown> = { owner, repo, ...rest };
      if (per_page !== undefined) params.limit = per_page;
      const response = await getBackendClient().request<{
        pulls: WirePullRequest[];
        nextToken?: string;
      }>('github.pulls.list', params);

      const pullRequests: PullRequest[] = (response?.pulls ?? []).map(toPullRequest);
      this.setCache(cacheKey, pullRequests);
      logger.info('Fetched PRs successfully', { owner, repo, count: pullRequests.length });
      return pullRequests;
    } catch (error) {
      logger.error('Failed to fetch pull requests', error as Error, { owner, repo });
      return [];
    }
  }

  /**
   * Search pull requests for a repository — `github.pulls.search` (PROTOCOL §5.27).
   * Supports filter on author/assignee/review-requested/involves, free-text
   * `query`, and cursor pagination (`nextToken`). Returns the
   * `{ pulls, nextToken }` page envelope.
   */
  async searchPullRequests(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      query?: string;
      nextToken?: string;
      per_page?: number;
      force?: boolean;
    },
  ): Promise<{ pulls: PullRequest[]; nextToken: string | null }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty PR search results');
      return { pulls: [], nextToken: null };
    }

    // `rest` (incl. query/nextToken) participates in the cache key so distinct
    // searches and pages are never served each other's results.
    const { force, per_page, ...rest } = options || {};
    const cacheKey = `prs-search:${owner}/${repo}:${JSON.stringify({ ...rest, per_page })}`;
    if (!force) {
      const cached = this.getFromCache<{ pulls: PullRequest[]; nextToken: string | null }>(
        cacheKey,
      );
      if (cached) {
        logger.debug('Returning cached PR search results', {
          owner,
          repo,
          count: cached.pulls.length,
        });
        return cached;
      }
    }

    try {
      logger.info('Searching PRs via github.pulls.search', { owner, repo, options: rest });
      const params: Record<string, unknown> = { owner, repo, ...rest };
      if (per_page !== undefined) params.limit = per_page;
      const response = await getBackendClient().request<{
        pulls: WirePullRequest[];
        nextToken?: string;
      }>('github.pulls.search', params);

      const result = {
        pulls: (response?.pulls ?? []).map(toPullRequest),
        nextToken: typeof response?.nextToken === 'string' ? response.nextToken : null,
      };
      this.setCache(cacheKey, result);
      logger.info('Searched PRs successfully', { owner, repo, count: result.pulls.length });
      return result;
    } catch (error) {
      logger.error('Failed to search pull requests', error as Error, { owner, repo });
      return { pulls: [], nextToken: null };
    }
  }

  /**
   * Get a single pull request — `github.pulls.get` (PROTOCOL §5.27).
   */
  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
    options: { force?: boolean } = {},
  ): Promise<PullRequest | null> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      return null;
    }

    const cacheKey = `pr:${owner}/${repo}/${number}`;
    if (!options.force) {
      const cached = this.getFromCache<PullRequest>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const response = await getBackendClient().request<{ pull: WirePullRequest | null }>(
        'github.pulls.get',
        { owner, repo, number },
      );
      if (!response?.pull) {
        return null;
      }

      const pullRequest = toPullRequest(response.pull);
      this.setCache(cacheKey, pullRequest);
      return pullRequest;
    } catch (error) {
      logger.error('Failed to get pull request', error as Error, { owner, repo, number });
      return null;
    }
  }

  /**
   * Create a pull request — `github.pulls.create` (PROTOCOL §5.27).
   */
  async createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string;
      head: string;
      base: string;
      body?: string;
      draft?: boolean;
    },
  ): Promise<PullRequest | null> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      throw new Error('GitHub not authenticated');
    }

    try {
      const response = await getBackendClient().request<{ pull: WirePullRequest | null }>(
        'github.pulls.create',
        {
          owner,
          repo,
          title: options.title,
          body: options.body ?? '',
          head: options.head,
          base: options.base,
          draft: options.draft,
        },
      );

      if (!response?.pull) {
        throw new Error('Failed to create pull request');
      }

      // Clear cache so subsequent reads see the new PR.
      this.clearCacheForRepo(owner, repo);
      return toPullRequest(response.pull);
    } catch (error) {
      logger.error('Failed to create pull request', error as Error, { owner, repo, options });
      throw error;
    }
  }

  /**
   * Merge a pull request — `github.pulls.merge` (PROTOCOL §5.27).
   */
  async mergePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: {
      mergeMethod?: 'merge' | 'squash' | 'rebase';
      commitTitle?: string;
      commitMessage?: string;
    },
  ): Promise<{ merged: boolean; message: string; sha?: string }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      throw new Error('GitHub not authenticated. Please connect to GitHub first.');
    }

    try {
      const result = await getBackendClient().request<{
        merged: boolean;
        message: string;
        sha?: string;
      }>('github.pulls.merge', {
        owner,
        repo,
        number: pullNumber,
        mergeMethod: options?.mergeMethod,
        commitTitle: options?.commitTitle,
        commitMessage: options?.commitMessage,
      });

      // Clear cache so PR status refreshes correctly
      this.clearCacheForRepo(owner, repo);
      return result;
    } catch (error) {
      logger.error('Failed to merge pull request', error as Error, { owner, repo, pullNumber });
      throw error;
    }
  }

  /**
   * Get issues for a repository — `github.issues.list` (PROTOCOL §5.27).
   * The daemon already filters PRs out of the GitHub `issues` endpoint
   * server-side.
   */
  async getIssues(
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      assignee?: string;
      creator?: string;
      labels?: string;
      sort?: 'created' | 'updated' | 'comments';
      direction?: 'asc' | 'desc';
      per_page?: number;
    },
  ): Promise<GitHubIssue[]> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty issues list');
      return [];
    }

    const cacheKey = `issues:${owner}/${repo}:${JSON.stringify(options || {})}`;
    const cached = this.getFromCache<GitHubIssue[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached issues', { owner, repo, count: cached.length });
      return cached;
    }

    try {
      logger.info('Fetching issues via github.issues.list', { owner, repo, options });
      const { per_page, ...rest } = options || {};
      const params: Record<string, unknown> = { owner, repo, ...rest };
      if (per_page !== undefined) params.limit = per_page;
      const response = await getBackendClient().request<{
        issues: WireIssue[];
        nextToken?: string;
      }>('github.issues.list', params);

      const issues: GitHubIssue[] = (response?.issues ?? []).map((issue) =>
        toIssue(issue, owner, repo),
      );

      // Only cache non-empty results to avoid caching failed fetches.
      if (issues.length > 0) {
        this.setCache(cacheKey, issues);
      }
      logger.info('Fetched issues successfully', { owner, repo, count: issues.length });
      return issues;
    } catch (error) {
      logger.error('Failed to fetch issues', error as Error, { owner, repo });
      return [];
    }
  }

  /**
   * Search issues for a repository — `github.issues.search` (PROTOCOL §5.27).
   * Uses `is:issue` filter server-side to exclude PRs. Supports free-text
   * `query` and cursor pagination (`nextToken`). Returns the
   * `{ issues, nextToken }` page envelope.
   */
  async searchIssues(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      query?: string;
      nextToken?: string;
      per_page?: number;
    },
  ): Promise<{ issues: GitHubIssue[]; nextToken: string | null }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty issue search results');
      return { issues: [], nextToken: null };
    }

    // Options (incl. query/nextToken) participate in the cache key so distinct
    // searches and pages are never served each other's results.
    const cacheKey = `issues-search:${owner}/${repo}:${JSON.stringify(options || {})}`;
    const cached = this.getFromCache<{ issues: GitHubIssue[]; nextToken: string | null }>(
      cacheKey,
    );
    if (cached) {
      logger.debug('Returning cached issue search results', {
        owner,
        repo,
        count: cached.issues.length,
      });
      return cached;
    }

    try {
      logger.info('Searching issues via github.issues.search', { owner, repo, options });
      const { per_page, ...rest } = options || {};
      const params: Record<string, unknown> = { owner, repo, ...rest };
      if (per_page !== undefined) params.limit = per_page;
      const response = await getBackendClient().request<{
        issues: WireIssue[];
        nextToken?: string;
      }>('github.issues.search', params);

      const result = {
        issues: (response?.issues ?? []).map((issue) => toIssue(issue, owner, repo)),
        nextToken: typeof response?.nextToken === 'string' ? response.nextToken : null,
      };

      if (result.issues.length > 0) {
        this.setCache(cacheKey, result);
      }
      logger.info('Searched issues successfully', { owner, repo, count: result.issues.length });
      return result;
    } catch (error) {
      logger.error('Failed to search issues', error as Error, { owner, repo });
      return { issues: [], nextToken: null };
    }
  }

  /**
   * Get CI check runs for a commit.
   *
   * The intentd `github.*` namespace (PROTOCOL §5.27) has no explicit-addressed
   * check-runs method; the `pr.listCheckRuns` extension (§5.7) is
   * workspace-scoped (operates on the workspace's active PR) and cannot be
   * reached with `(owner, repo, commitSha)`. Until the daemon adds an
   * explicit-addressed equivalent, this method degrades to "unknown CI" so
   * callers fall back gracefully (PR status pills render in a neutral state)
   * instead of erroring.
   */
  async getCheckRuns(
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<{ total: number; passed: number; failed: number; pending: number }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty check runs');
      return { total: 0, passed: 0, failed: 0, pending: 0 };
    }

    logger.debug(
      'getCheckRuns: no explicit-addressed github.* equivalent — returning empty result',
      { owner, repo, commitSha },
    );
    return { total: 0, passed: 0, failed: 0, pending: 0 };
  }

  /**
   * Get PR reviews to determine the review decision.
   *
   * The intentd `github.*` namespace (PROTOCOL §5.27) exposes inline review
   * comments and review threads but no review-verdict aggregator; the
   * `pr.getReviews` extension (§5.7) is workspace-scoped and cannot be reached
   * with `(owner, repo, prNumber)`. Until the daemon adds an explicit-addressed
   * equivalent, this method degrades to "no decision" so callers fall back to
   * "review required / unknown" instead of erroring.
   */
  async getReviews(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{
    reviewDecision: string | null;
    approvalCount: number;
    changesRequestedCount: number;
    approvedBy: string[];
  }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty reviews');
      return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
    }

    logger.debug(
      'getReviews: no explicit-addressed github.* equivalent — returning empty result',
      { owner, repo, prNumber },
    );
    return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
  }

  // Cache helpers

  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data as T;
    }
    return null;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private clearCacheForRepo(owner: string, repo: string): void {
    const prefix = `${owner}/${repo}`;
    for (const key of this.cache.keys()) {
      if (key.includes(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton instance to ensure cache is shared across all usages.
// This prevents multiple instances from each having their own cache,
// which would cause GitHub API rate-limit exhaustion under load.
export const githubService = new GitHubService();
