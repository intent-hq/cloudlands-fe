/**
 * GitHub Service
 *
 * Handles GitHub API interactions for pull request tracking and management.
 *
 * Authentication is handled through Augment's GitHub OAuth integration.
 * All GitHub API calls are proxied through Augment's backend API, which
 * manages the GitHub token securely.
 *
 * Note: Some features like PR reviews and checks are not yet available
 * through the Augment API and will return empty arrays.
 */

import {
  augmentApiClient,
  type GithubUser,
} from '../../../shared/augment-api/augment-api.client';
import { Logger } from '../../../shared/logger';
import { githubAuthService } from '../../github-auth/main/github-auth.service';
import type { PullRequest, GitHubIssue } from '../types';

const logger = new Logger('GitHubService');

export class GitHubService {
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Check if authenticated via GitHub OAuth through Augment
   */
  async isAuthenticated(): Promise<boolean> {
    return githubAuthService.isAuthenticated();
  }

  /**
   * Refresh the client (clears cache)
   * Call this after the user authenticates to ensure fresh data.
   */
  async refreshClient(): Promise<void> {
    this.cache.clear();
    augmentApiClient.refreshSession();
    logger.info('GitHub service cache cleared');
  }

  /**
   * Get branches for a repository
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
      // Fetch branches and repo info via Augment API
      const [branchesResult, repoData] = await Promise.all([
        augmentApiClient.listGitHubBranches(owner, repo),
        augmentApiClient.getGitHubRepo(owner, repo),
      ]);

      const result = {
        branches: branchesResult.branches,
        defaultBranch: repoData?.default_branch || 'main',
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('Failed to get branches', error as Error);
      return null;
    }
  }

  /**
   * Get pull requests for a repository
   * Uses the github-api remote tool to bypass the missing list-pull-requests endpoint
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

    // Destructure force out so cache key is consistent regardless of force flag
    const { force, ...cacheOptions } = options || {};
    const cacheKey = `prs:${owner}/${repo}:${JSON.stringify(cacheOptions)}`;
    if (!force) {
      const cached = this.getFromCache<PullRequest[]>(cacheKey);
      if (cached) {
        logger.debug('Returning cached PRs', { owner, repo, count: cached.length });
        return cached;
      }
    }

    try {
      logger.info('Fetching PRs via remote tool', { owner, repo, options: cacheOptions });
      const githubPrs = await augmentApiClient.listGitHubPullRequests(owner, repo, cacheOptions);

      // Convert GithubPullRequest to PullRequest type
      const pullRequests: PullRequest[] = githubPrs.map((pr) => {
        // Derive state: GitHub API returns state='closed' for merged PRs
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
        url: pr.html_url,
        htmlUrl: pr.html_url,
        sourceBranch: pr.head_ref,
        targetBranch: pr.base_ref,
        author: {
          login: pr.user?.login || 'unknown',
          name: undefined,
          avatarUrl: pr.user?.avatar_url,
        },
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at || undefined,
        closedAt: pr.closed_at || undefined,
        mergeable: undefined,
        mergeableState: undefined,
        reviews: [],
        checks: [],
        labels: pr.labels || [],
        assignees: (pr.assignees || []).map((a: GithubUser) => a.login),
        milestone: undefined,
        commits: pr.commits || 0,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
        headSha: pr.head_sha || undefined,
      };
      });

      this.setCache(cacheKey, pullRequests);
      logger.info('Fetched PRs successfully', { owner, repo, count: pullRequests.length });
      return pullRequests;
    } catch (error) {
      logger.error('Failed to fetch pull requests', error as Error, { owner, repo });
      return [];
    }
  }

  /**
   * Search pull requests for a repository with filter
   * Uses GitHub search API to filter by author:@me, assignee:@me, review-requested:@me, or involves:@me
   */
  async searchPullRequests(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      per_page?: number;
      force?: boolean;
    },
  ): Promise<PullRequest[]> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty PR search results');
      return [];
    }

    // Destructure force out so cache key is consistent regardless of force flag
    const { force, ...cacheOptions } = options || {};
    const cacheKey = `prs-search:${owner}/${repo}:${JSON.stringify(cacheOptions)}`;
    if (!force) {
      const cached = this.getFromCache<PullRequest[]>(cacheKey);
      if (cached) {
        logger.debug('Returning cached PR search results', { owner, repo, count: cached.length });
        return cached;
      }
    }

    try {
      logger.info('Searching PRs via remote tool', { owner, repo, options: cacheOptions });
      const githubPrs = await augmentApiClient.searchGitHubPullRequests(owner, repo, cacheOptions);

      // Convert GithubPullRequest to PullRequest type
      const pullRequests: PullRequest[] = githubPrs.map((pr) => {
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
          url: pr.html_url,
          htmlUrl: pr.html_url,
          sourceBranch: pr.head_ref,
          targetBranch: pr.base_ref,
          author: {
            login: pr.user?.login || 'unknown',
            name: undefined,
            avatarUrl: pr.user?.avatar_url,
          },
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at || undefined,
          closedAt: pr.closed_at || undefined,
          mergeable: undefined,
          mergeableState: undefined,
          reviews: [],
          checks: [],
          labels: pr.labels || [],
          assignees: (pr.assignees || []).map((a: GithubUser) => a.login),
          milestone: undefined,
          commits: pr.commits || 0,
          additions: pr.additions || 0,
          deletions: pr.deletions || 0,
          changedFiles: pr.changed_files || 0,
          headSha: pr.head_sha || undefined,
        };
      });

      this.setCache(cacheKey, pullRequests);
      logger.info('Searched PRs successfully', { owner, repo, count: pullRequests.length });
      return pullRequests;
    } catch (error) {
      logger.error('Failed to search pull requests', error as Error, { owner, repo });
      return [];
    }
  }

  /**
   * Get a single pull request
   * Uses the github-api remote tool to bypass the missing get-pull-request endpoint
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
      const pr = await augmentApiClient.getGitHubPullRequest(owner, repo, number, {
        force: options.force,
      });
      if (!pr) {
        return null;
      }

      // Derive state: GitHub API returns state='closed' for merged PRs,
      // so we check the merged flag to distinguish merged from closed.
      const derivedState: 'open' | 'closed' | 'merged' | 'draft' = pr.merged
        ? 'merged'
        : pr.draft
          ? 'draft'
          : (pr.state as 'open' | 'closed');

      const pullRequest: PullRequest = {
        id: pr.number.toString(),
        number: pr.number,
        title: pr.title,
        description: pr.body || undefined,
        state: derivedState,
        url: pr.html_url,
        htmlUrl: pr.html_url,
        sourceBranch: pr.head_ref,
        targetBranch: pr.base_ref,
        author: {
          login: pr.user?.login || 'unknown',
          name: undefined,
          avatarUrl: pr.user?.avatar_url,
        },
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at || undefined,
        closedAt: pr.closed_at || undefined,
        mergeable: pr.mergeable ?? undefined,
        mergeableState: pr.mergeable_state ?? undefined,
        reviews: [],
        checks: [],
        labels: pr.labels || [],
        assignees: [],
        milestone: undefined,
        commits: pr.commits || 0,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
        headSha: pr.head_sha || undefined,
      };

      this.setCache(cacheKey, pullRequest);
      return pullRequest;
    } catch (error) {
      logger.error('Failed to get pull request', error as Error, { owner, repo, number });
      return null;
    }
  }

  /**
   * Create a pull request
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
      const pr = await augmentApiClient.createPullRequest({
        owner,
        repo,
        title: options.title,
        body: options.body || '',
        head: options.head,
        base: options.base,
        draft: options.draft,
      });

      if (!pr) {
        throw new Error('Failed to create pull request');
      }

      // Clear cache
      this.clearCacheForRepo(owner, repo);

      // Convert Augment API response to our PullRequest type
      const derivedState: 'open' | 'closed' | 'merged' | 'draft' = pr.draft
        ? 'draft'
        : (pr.state as 'open' | 'closed');

      const pullRequest: PullRequest = {
        id: pr.number.toString(),
        number: pr.number,
        title: pr.title,
        description: pr.body || undefined,
        state: derivedState,
        url: pr.html_url,
        htmlUrl: pr.html_url,
        sourceBranch: pr.head_ref,
        targetBranch: pr.base_ref,
        author: {
          login: pr.user?.login || 'unknown',
          name: undefined,
          avatarUrl: pr.user?.avatar_url,
        },
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        mergedAt: pr.merged_at || undefined,
        closedAt: pr.closed_at || undefined,
        mergeable: undefined,
        mergeableState: undefined,
        reviews: [],
        checks: [],
        labels: pr.labels || [],
        assignees: [],
        milestone: undefined,
        commits: pr.commits || 0,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
      };

      return pullRequest;
    } catch (error) {
      logger.error('Failed to create pull request', error as Error, { owner, repo, options });
      throw error;
    }
  }

  /**
   * Merge a pull request on GitHub
   * Uses the github-api remote tool to call PUT /repos/{owner}/{repo}/pulls/{number}/merge
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
      const result = await augmentApiClient.mergePullRequest(owner, repo, pullNumber, {
        merge_method: options?.mergeMethod,
        commit_title: options?.commitTitle,
        commit_message: options?.commitMessage,
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
   * Get issues for a repository
   * Uses the github-api remote tool to fetch issues
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
      logger.info('Fetching issues via remote tool', { owner, repo, options });
      const githubIssues = await augmentApiClient.listGitHubIssues(owner, repo, options);

      // Convert GithubIssue to GitHubIssue type (filter out PRs - GitHub Issues API returns both)
      const issues: GitHubIssue[] = githubIssues
        .filter((issue) => !issue.html_url.includes('/pull/')) // Exclude PRs
        .map((issue) => ({
          id: issue.number.toString(),
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          url: issue.html_url,
          htmlUrl: issue.html_url,
          author: {
            login: issue.user?.login || 'unknown',
            name: undefined,
            avatarUrl: issue.user?.avatar_url,
          },
          labels: issue.labels || [],
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          closedAt: issue.closed_at,
          comments: issue.comments || 0,
          owner,
          repo,
        }));

      // Only cache non-empty results to avoid caching failed fetches
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
   * Search issues for a repository using GitHub search API
   * Uses is:issue filter to get only actual issues (not PRs)
   * Uses GitHub search API to filter by author:@me, assignee:@me, or involves:@me
   */
  async searchIssues(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      per_page?: number;
    },
  ): Promise<GitHubIssue[]> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty issue search results');
      return [];
    }

    const cacheKey = `issues-search:${owner}/${repo}:${JSON.stringify(options || {})}`;
    const cached = this.getFromCache<GitHubIssue[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached issue search results', { owner, repo, count: cached.length });
      return cached;
    }

    try {
      logger.info('Searching issues via remote tool', { owner, repo, options });
      const githubIssues = await augmentApiClient.searchGitHubIssues(owner, repo, options);

      // Convert GithubIssue to GitHubIssue type
      const issues: GitHubIssue[] = githubIssues.map((issue) => ({
        id: issue.number.toString(),
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        url: issue.html_url,
        htmlUrl: issue.html_url,
        author: {
          login: issue.user?.login || 'unknown',
          name: undefined,
          avatarUrl: issue.user?.avatar_url,
        },
        labels: issue.labels || [],
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
        comments: issue.comments || 0,
        owner,
        repo,
      }));

      // Only cache non-empty results to avoid caching failed fetches
      if (issues.length > 0) {
        this.setCache(cacheKey, issues);
      }
      logger.info('Searched issues successfully', { owner, repo, count: issues.length });
      return issues;
    } catch (error) {
      logger.error('Failed to search issues', error as Error, { owner, repo });
      return [];
    }
  }

  /**
   * Get CI check runs for a commit
   * Uses the github-api remote tool to call GET /repos/{owner}/{repo}/commits/{sha}/check-runs
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

    const cacheKey = `check-runs:${owner}/${repo}/${commitSha}`;
    const cached = this.getFromCache<{ total: number; passed: number; failed: number; pending: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const path = `/repos/${owner}/${repo}/commits/${commitSha}/check-runs`;
      const toolInput = {
        path,
        method: 'GET',
        details: true,
      };

      const response = await augmentApiClient.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_TOOL_ID
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        logger.warn('Failed to fetch check runs', { error: response.tool_output || response.tool_result_message });
        return { total: 0, passed: 0, failed: 0, pending: 0 };
      }

      if (!response.tool_output || response.tool_output.trim() === '') {
        return { total: 0, passed: 0, failed: 0, pending: 0 };
      }

      // Parse YAML response - use dynamic import to avoid bundling issues
      const yaml = await import('js-yaml');
      const parsed = yaml.load(response.tool_output) as { check_runs?: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }>, total_count?: number };

      if (!parsed || !parsed.check_runs) {
        return { total: 0, passed: 0, failed: 0, pending: 0 };
      }

      const checkRuns = parsed.check_runs;
      const total = checkRuns.length;
      let passed = 0;
      let failed = 0;
      let pending = 0;

      for (const cr of checkRuns) {
        if (cr.status !== 'completed') {
          pending++;
        } else if (cr.conclusion === 'success' || cr.conclusion === 'neutral' || cr.conclusion === 'skipped') {
          passed++;
        } else {
          // failure, cancelled, timed_out, action_required
          failed++;
        }
      }

      const result = { total, passed, failed, pending };
      this.setCache(cacheKey, result);
      logger.info('Fetched check runs successfully', { owner, repo, commitSha, ...result });
      return result;
    } catch (error) {
      logger.error('Failed to get check runs', error as Error, { owner, repo, commitSha });
      return { total: 0, passed: 0, failed: 0, pending: 0 };
    }
  }

  /**
   * Get PR reviews to determine review decision
   * Uses the github-api remote tool to call GET /repos/{owner}/{repo}/pulls/{number}/reviews
   */
  async getReviews(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<{ reviewDecision: string | null; approvalCount: number; changesRequestedCount: number; approvedBy: string[] }> {
    const isAuth = await this.isAuthenticated();
    if (!isAuth) {
      logger.debug('Not authenticated, returning empty reviews');
      return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
    }

    const cacheKey = `reviews:${owner}/${repo}/${prNumber}`;
    const cached = this.getFromCache<{ reviewDecision: string | null; approvalCount: number; changesRequestedCount: number; approvedBy: string[] }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const path = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
      const toolInput = {
        path,
        method: 'GET',
        data: { per_page: 100 },
      };

      const response = await augmentApiClient.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_TOOL_ID
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        logger.warn('Failed to fetch reviews', { error: response.tool_output || response.tool_result_message });
        return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
      }

      if (!response.tool_output || response.tool_output.trim() === '') {
        return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
      }

      // Parse YAML response
      const yaml = await import('js-yaml');
      const parsed = yaml.load(response.tool_output) as Array<{
        state: string;
        user?: { login: string };
        submitted_at?: string;
      }>;

      if (!Array.isArray(parsed)) {
        return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
      }

      // Track latest ACTIONABLE review per user (APPROVED, CHANGES_REQUESTED, or DISMISSED)
      // COMMENTED and PENDING states should not override an earlier approval/rejection
      // DISMISSED clears any prior actionable review for that user
      const latestReviewByUser = new Map<string, { state: string; submittedAt: string }>();
      for (const review of parsed) {
        const login = review.user?.login || 'unknown';
        const submittedAt = review.submitted_at || '';
        // DISMISSED overrides any prior actionable review for this user
        if (review.state === 'DISMISSED') {
          const existing = latestReviewByUser.get(login);
          if (!existing || submittedAt > existing.submittedAt) {
            latestReviewByUser.delete(login);
          }
          continue;
        }
        // Only consider actionable review states
        if (review.state !== 'APPROVED' && review.state !== 'CHANGES_REQUESTED') {
          continue;
        }
        const existing = latestReviewByUser.get(login);
        if (!existing || submittedAt > existing.submittedAt) {
          latestReviewByUser.set(login, { state: review.state, submittedAt });
        }
      }

      // Count approvals and changes requested from latest reviews, and collect approved usernames
      let approvalCount = 0;
      let changesRequestedCount = 0;
      const approvedBy: string[] = [];
      for (const [login, review] of latestReviewByUser.entries()) {
        if (review.state === 'APPROVED') {
          approvalCount++;
          approvedBy.push(login);
        } else if (review.state === 'CHANGES_REQUESTED') {
          changesRequestedCount++;
        }
      }

      // Determine overall decision
      let reviewDecision: string | null = null;
      if (changesRequestedCount > 0) {
        reviewDecision = 'CHANGES_REQUESTED';
      } else if (approvalCount > 0) {
        reviewDecision = 'APPROVED';
      }
      // If no actionable reviews exist, leave as null
      // (we can't determine REVIEW_REQUIRED without GraphQL access to branch protection rules)

      const result = { reviewDecision, approvalCount, changesRequestedCount, approvedBy };
      this.setCache(cacheKey, result);
      logger.info('Fetched reviews successfully', { owner, repo, prNumber, ...result });
      return result;
    } catch (error) {
      logger.error('Failed to get reviews', error as Error, { owner, repo, prNumber });
      return { reviewDecision: null, approvalCount: 0, changesRequestedCount: 0, approvedBy: [] };
    }
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

// Singleton instance to ensure cache is shared across all usages
// This prevents multiple instances from each having their own cache,
// which was causing GitHub API rate limit exhaustion
export const githubService = new GitHubService();
