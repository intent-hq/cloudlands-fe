/**
 * Augment API Client
 *
 * Client for making authenticated calls to Augment's backend API.
 * Uses the session.json from ~/.augment/ for authentication.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import { Logger } from '../logger';

const logger = new Logger('AugmentApiClient');

/**
 * Normalize a value that might be a Date object (from js-yaml) to a string.
 * js-yaml automatically parses YAML timestamps into Date objects.
 */
function normalizeToString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Check if a value is a plain object (not null, not an array).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AugmentSession {
  accessToken: string;
  tenantURL: string;
  scopes?: string[];
}

export interface GitHubAuthStatus {
  isConfigured: boolean;
  oauthUrl: string;
  configuredButNeedsUpdate: boolean;
  updatedScopes: string;
}

/**
 * Read the Augment session from ~/.augment/session.json
 */
export function getAugmentSession(): AugmentSession | null {
  const sessionPath = join(homedir(), '.augment', 'session.json');

  if (!existsSync(sessionPath)) {
    logger.debug('Augment session file not found', { path: sessionPath });
    return null;
  }

  try {
    const content = readFileSync(sessionPath, 'utf8');
    const session = JSON.parse(content) as AugmentSession;

    if (!session.accessToken || !session.tenantURL) {
      logger.warn('Augment session file is missing required fields');
      return null;
    }

    return session;
  } catch (error) {
    logger.error('Failed to read Augment session', error as Error);
    return null;
  }
}

/**
 * Check if the user is authenticated with Augment
 */
export function isAugmentAuthenticated(): boolean {
  const session = getAugmentSession();
  return session !== null;
}

// Cache for PR details to avoid N+1 fetches across different filter searches
// Key format: "owner/repo/number"
const prDetailsCache = new Map<string, { data: GithubPullRequest; timestamp: number }>();
const PR_DETAILS_CACHE_DURATION_MS = 60000; // 1 minute

function getPRDetailsCacheKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}/${number}`;
}

function getCachedPRDetails(
  owner: string,
  repo: string,
  number: number,
): GithubPullRequest | null {
  const key = getPRDetailsCacheKey(owner, repo, number);
  const cached = prDetailsCache.get(key);
  if (cached && Date.now() - cached.timestamp < PR_DETAILS_CACHE_DURATION_MS) {
    return cached.data;
  }
  return null;
}

function setCachedPRDetails(
  owner: string,
  repo: string,
  number: number,
  data: GithubPullRequest,
): void {
  const key = getPRDetailsCacheKey(owner, repo, number);
  prDetailsCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Augment API Client for making authenticated RPC calls
 */
export class AugmentApiClient {
  private session: AugmentSession | null = null;

  constructor() {
    this.refreshSession();
  }

  /**
   * Refresh the session from disk
   */
  refreshSession(): void {
    this.session = getAugmentSession();
  }

  /**
   * Check if we have a valid session
   */
  hasSession(): boolean {
    return this.session !== null;
  }

  /**
   * Get the base URL for API calls (tenant URL)
   */
  private getBaseUrl(): string {
    if (!this.session) {
      throw new Error('No Augment session available');
    }
    // Remove trailing slash if present
    return this.session.tenantURL.replace(/\/$/, '');
  }

  /**
   * Make an authenticated API call to Augment's API
   * Uses simple endpoint paths like VSCode client (e.g., "github/is-user-configured")
   */
  async callEndpoint<T>(endpoint: string, request: object = {}): Promise<T> {
    if (!this.session) {
      throw new Error('No Augment session available');
    }

    const url = `${this.getBaseUrl()}/${endpoint}`;

    logger.debug('Making Augment API call', { endpoint, url });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.session.accessToken}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Augment API error: ${response.status} ${response.statusText}`;

      // Try to parse the error for more details
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = `${errorMessage} - ${errorJson.error}`;
        }
        if (errorJson.message) {
          errorMessage = `${errorMessage} - ${errorJson.message}`;
        }
        if (errorJson.details) {
          errorMessage = `${errorMessage} (${JSON.stringify(errorJson.details)})`;
        }
      } catch {
        // Not JSON, use raw error text
        if (errorText) {
          errorMessage = `${errorMessage} - ${errorText}`;
        }
      }

      logger.error('Augment API call failed', {
        endpoint,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        request: JSON.stringify(request).substring(0, 500),
      });
      throw new Error(errorMessage);
    }

    return (await response.json()) as T;
  }

  /**
   * Check if the user has GitHub OAuth configured through Augment
   * Uses both github/is-user-configured and agents/list-remote-tools
   * The oauth_url comes from the listRemoteTools API, not is-user-configured
   */
  async checkGitHubAuthStatus(): Promise<GitHubAuthStatus> {
    try {
      // First check configuration status
      const configResponse = await this.callEndpoint<{
        is_configured?: boolean;
        oauth_url?: string;
        configured_but_needs_update?: boolean;
        updated_scopes?: string;
      }>('github/is-user-configured', {});

      // DIAGNOSTIC: Log the full response to understand what Augment API is returning (debug level to reduce noise)
      logger.debug('GitHub auth status response (DIAGNOSTIC)', {
        is_configured: configResponse.is_configured,
        configured_but_needs_update: configResponse.configured_but_needs_update,
        updated_scopes: configResponse.updated_scopes,
        has_oauth_url_in_response: !!configResponse.oauth_url,
        full_response: JSON.stringify(configResponse),
      });

      // If not configured or needs update, get the OAuth URL from listRemoteTools
      // When configured_but_needs_update is true, the user needs to re-authorize with new scopes
      let oauthUrl = '';
      if (!configResponse.is_configured || configResponse.configured_but_needs_update) {
        oauthUrl = await this.getGitHubOAuthUrl();
        logger.debug('Fetched OAuth URL (DIAGNOSTIC)', {
          hasUrl: !!oauthUrl,
          urlPrefix: oauthUrl ? `${oauthUrl.substring(0, 50)  }...` : 'none',
        });
      }

      const result = {
        isConfigured: configResponse.is_configured ?? false,
        oauthUrl,
        configuredButNeedsUpdate: configResponse.configured_but_needs_update ?? false,
        updatedScopes: configResponse.updated_scopes ?? '',
      };

      logger.info('Returning GitHub auth status (DIAGNOSTIC)', result);

      return result;
    } catch (error) {
      logger.error('Failed to check GitHub auth status', error as Error);
      return {
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
      };
    }
  }

  /**
   * Get the GitHub OAuth URL from the listRemoteTools API
   * This is how VSCode gets the OAuth URL for GitHub authentication
   */
  async getGitHubOAuthUrl(): Promise<string> {
    try {
      // RemoteToolId.GitHubApi = 8
      const GITHUB_API_TOOL_ID = 8;

      const response = await this.callEndpoint<{
        tools?: Array<{
          tool_definition?: unknown;
          remote_tool_id?: number;
          availability_status?: number;
          oauth_url?: string;
        }>;
      }>('agents/list-remote-tools', {
        tool_id_list: {
          tool_ids: [GITHUB_API_TOOL_ID],
        },
      });

      const githubTool = response.tools?.find((t) => t.remote_tool_id === GITHUB_API_TOOL_ID);
      const oauthUrl = githubTool?.oauth_url ?? '';

      logger.info('Got GitHub OAuth URL from listRemoteTools', {
        hasUrl: !!oauthUrl,
        toolCount: response.tools?.length ?? 0,
      });

      return oauthUrl;
    } catch (error) {
      logger.error('Failed to get GitHub OAuth URL', error as Error);
      return '';
    }
  }

  /**
   * Revoke GitHub access through Augment
   * This disconnects the GitHub OAuth integration
   */
  async revokeGitHubAccess(): Promise<boolean> {
    try {
      // RemoteToolId.GitHubApi = 8
      const GITHUB_API_TOOL_ID = 8;

      const response = await this.callEndpoint<{
        status?: number;
      }>('agents/revoke-tool-access', {
        tool_id: GITHUB_API_TOOL_ID,
      });

      // Status 0 = Success, Status 1 = NotActive (already disconnected)
      const success = response.status === 0 || response.status === 1;
      logger.info('Revoked GitHub access', { status: response.status, success });
      return success;
    } catch (error) {
      logger.error('Failed to revoke GitHub access', error as Error);
      return false;
    }
  }

  // ============================================================================
  // User Info Methods
  // ============================================================================

  /**
   * Get user info (email, id, tenant) from the /get-models endpoint
   * This is the same endpoint used by VSCode to get user identification
   */
  async getUserInfo(): Promise<{
    id: string;
    email: string | null;
    tenantId: string | null;
    tenantName: string | null;
  } | null> {
    try {
      const response = await this.callEndpoint<{
        user?: {
          id?: string;
          email?: string;
          tenant_id?: string;
          tenant_name?: string;
        };
      }>('get-models', {});

      if (!response.user) {
        logger.debug('No user info in get-models response');
        return null;
      }

      return {
        id: response.user.id ?? '',
        email: response.user.email ?? null,
        tenantId: response.user.tenant_id ?? null,
        tenantName: response.user.tenant_name ?? null,
      };
    } catch (error) {
      logger.error('Failed to get user info', error as Error);
      return null;
    }
  }

  // ============================================================================
  // Linear Authentication Methods
  // ============================================================================

  /**
   * Check Linear authentication status
   * Returns whether Linear is configured and the OAuth URL if not
   */
  async checkLinearAuthStatus(): Promise<{
    isConfigured: boolean;
    oauthUrl: string;
    availabilityStatus?: number;
  }> {
    try {
      const LINEAR_TOOL_ID = 12;

      const response = await this.callEndpoint<{
        tools?: Array<{
          tool_definition?: unknown;
          remote_tool_id?: number;
          availability_status?: number;
          oauth_url?: string;
        }>;
      }>('agents/list-remote-tools', {
        tool_id_list: {
          tool_ids: [LINEAR_TOOL_ID],
        },
      });

      // Log raw response for debugging
      logger.info('Linear list-remote-tools raw response', {
        toolCount: response.tools?.length ?? 0,
        rawTools: JSON.stringify(response.tools),
      });

      const linearTool = response.tools?.find((t) => t.remote_tool_id === LINEAR_TOOL_ID);
      const availabilityStatus = linearTool?.availability_status ?? 0;
      // ToolAvailabilityStatus: 0=UNKNOWN, 1=AVAILABLE, 2=USER_CONFIG_REQUIRED
      const isConfigured = availabilityStatus === 1;
      const oauthUrl = linearTool?.oauth_url ?? '';

      logger.info('Linear auth status parsed', {
        isConfigured,
        availabilityStatus,
        hasOauthUrl: !!oauthUrl,
        foundTool: !!linearTool,
      });

      return { isConfigured, oauthUrl, availabilityStatus };
    } catch (error) {
      logger.error('Failed to check Linear auth status', error as Error);
      return { isConfigured: false, oauthUrl: '' };
    }
  }

  /**
   * Get the Linear OAuth URL from the listRemoteTools API
   */
  async getLinearOAuthUrl(): Promise<string> {
    const status = await this.checkLinearAuthStatus();
    return status.oauthUrl;
  }

  /**
   * Revoke Linear access through Augment
   * This disconnects the Linear OAuth integration
   */
  async revokeLinearAccess(): Promise<boolean> {
    try {
      const LINEAR_TOOL_ID = 12;

      const response = await this.callEndpoint<{
        status?: number;
      }>('agents/revoke-tool-access', {
        tool_id: LINEAR_TOOL_ID,
      });

      // Status 0 = Success, Status 1 = NotActive (already disconnected)
      const success = response.status === 0 || response.status === 1;
      logger.info('Revoked Linear access', { status: response.status, success });
      return success;
    } catch (error) {
      logger.error('Failed to revoke Linear access', error as Error);
      return false;
    }
  }

  // ============================================================================
  // Linear API Methods (via run-remote-tool - for future use)
  // ============================================================================

  /**
   * Run a Linear tool operation through Augment's remote tool API
   * This is the generic method for all Linear operations
   * @param toolInputJson - JSON string containing the tool input
   */
  async runLinearTool<T>(toolInputJson: string): Promise<T | null> {
    try {
      const LINEAR_TOOL_ID = 12;

      logger.info('Running Linear tool', { toolInputJson });

      const response = await this.callEndpoint<{
        result?: T;
        tool_output?: string;
        error?: string;
      }>('agents/run-remote-tool', {
        tool_id: LINEAR_TOOL_ID,
        tool_input_json: toolInputJson,
      });

      logger.info('Linear tool raw response', {
        hasResult: !!response.result,
        hasToolOutput: !!response.tool_output,
        hasError: !!response.error,
        responseKeys: Object.keys(response),
        response: JSON.stringify(response).substring(0, 500),
      });

      if (response.error) {
        logger.error('Linear tool error', { error: response.error });
        return null;
      }

      // The response may have tool_output instead of result
      if (response.tool_output) {
        return response.tool_output as unknown as T;
      }

      return response.result ?? null;
    } catch (error) {
      logger.error('Failed to run Linear tool', error as Error);
      return null;
    }
  }

  // ============================================================================
  // GitHub API Methods (proxied through Augment)
  // ============================================================================

  /**
   * List GitHub repositories for the authenticated user
   * If fetchAll is true, fetches all pages (up to a limit of 10 pages / ~300 repos)
   */
  async listGitHubRepos(page?: number, fetchAll = true): Promise<GithubRepo[]> {
    try {
      const allRepos: GithubRepo[] = [];
      let currentPage = page ?? 1;
      const maxPages = 10; // Safety limit to avoid infinite loops

      do {
        const response = await this.callEndpoint<{
          repos?: GithubRepo[];
          has_next_page?: boolean;
          next_page?: number;
        }>('github/list-repos', { page: currentPage });

        logger.info('listGitHubRepos response', {
          page: currentPage,
          repoCount: response.repos?.length ?? 0,
          hasNextPage: response.has_next_page,
          nextPage: response.next_page,
          responseKeys: Object.keys(response),
          sampleResponse: JSON.stringify(response).substring(0, 500),
        });

        if (response.repos) {
          allRepos.push(...response.repos);
        }

        // If fetchAll is false, only fetch one page
        if (!fetchAll || !response.has_next_page || !response.next_page) {
          break;
        }

        currentPage = response.next_page;
      } while (currentPage <= maxPages);

      logger.info('listGitHubRepos total', { totalRepos: allRepos.length });
      return allRepos;
    } catch (error) {
      logger.error('Failed to list GitHub repos', error as Error);
      throw error;
    }
  }

  /**
   * Get a GitHub repository
   */
  async getGitHubRepo(owner: string, name: string): Promise<GithubRepo | null> {
    try {
      const response = await this.callEndpoint<{ repo?: GithubRepo }>('github/get-repo', {
        repo: { owner, name },
      });
      return response.repo ?? null;
    } catch (error) {
      logger.error('Failed to get GitHub repo', error as Error);
      return null;
    }
  }

  /**
   * List branches for a GitHub repository
   */
  async listGitHubBranches(
    owner: string,
    name: string,
    page?: number,
  ): Promise<{ branches: string[]; hasNextPage: boolean }> {
    try {
      const response = await this.callEndpoint<{
        branches?: Array<{ name: string }>;
        has_next_page?: boolean;
      }>('github/list-branches', {
        repo: { owner, name },
        page,
      });

      return {
        branches: response.branches?.map((b) => b.name) ?? [],
        hasNextPage: response.has_next_page ?? false,
      };
    } catch (error) {
      logger.error('Failed to list GitHub branches', error as Error);
      return { branches: [], hasNextPage: false };
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(options: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<GithubPullRequest | null> {
    try {
      // Check GitHub auth status before attempting to create PR
      const authStatus = await this.checkGitHubAuthStatus();
      logger.info('GitHub auth status before PR creation', {
        isConfigured: authStatus.isConfigured,
        configuredButNeedsUpdate: authStatus.configuredButNeedsUpdate,
        updatedScopes: authStatus.updatedScopes,
      });

      if (!authStatus.isConfigured) {
        throw new Error('GitHub is not configured. Please authenticate with GitHub in Settings.');
      }

      // Note: We proceed even if configuredButNeedsUpdate is true, because:
      // - The "needs update" flag typically means optional scopes like `user:email` are missing
      // - PR creation only requires the `repo` scope which is included in base OAuth
      // - The Augment backend has a known issue where this flag doesn't clear after re-auth
      if (authStatus.configuredButNeedsUpdate) {
        logger.warn('GitHub needs scope update but proceeding with PR creation', {
          updatedScopes: authStatus.updatedScopes,
        });
      }

      const requestPayload = {
        repo: { owner: options.owner, name: options.repo },
        title: options.title,
        body: options.body || undefined, // Don't send empty string, send undefined
        head: options.head,
        base: options.base,
        draft: options.draft ?? false,
      };

      logger.info('Creating pull request via Augment API', {
        owner: options.owner,
        repo: options.repo,
        head: options.head,
        base: options.base,
        title: options.title,
        hasBody: !!options.body,
      });

      // Use the remote tool endpoint (github-api) which bypasses the buggy CreatePullRequest backend code
      // The backend's CreatePullRequest incorrectly prefixes the head branch with username
      // even when the branch is pushed directly to the target repo (not a fork)
      const pr = await this.createPullRequestViaRemoteTool(options);
      return pr;
    } catch (error) {
      logger.error('Failed to create pull request', error as Error);
      throw error;
    }
  }

  /**
   * Create a pull request using the github-api remote tool
   * This bypasses the buggy CreatePullRequest backend endpoint which incorrectly
   * prefixes branch names with the user's login
   */
  private async createPullRequestViaRemoteTool(options: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<GithubPullRequest | null> {
    // GitHub API endpoint for creating PRs
    const path = `/repos/${options.owner}/${options.repo}/pulls`;

    // Construct the tool_input_json matching GitHubAPIInput schema
    const toolInput = {
      summary: `Create pull request: ${options.title}`,
      method: 'POST',
      path,
      data: {
        title: options.title,
        body: options.body || '',
        head: options.head,
        base: options.base,
        draft: options.draft ?? false,
      },
      details: true, // Get full PR details in response
    };

    logger.info('Creating PR via github-api remote tool', {
      path,
      head: options.head,
      base: options.base,
    });

    const response = await this.callEndpoint<{
      tool_output: string;
      tool_result_message: string;
      status: number;
    }>('agents/run-remote-tool', {
      tool_name: 'github-api',
      tool_input_json: JSON.stringify(toolInput),
      tool_id: 8, // GITHUB_API = 8
    });

    logger.info('Remote tool response', {
      status: response.status,
      message: response.tool_result_message,
    });

    // Status 1 = TOOL_EXECUTION_OK, anything else is an error
    if (response.status !== 1) {
      const errorMessage = response.tool_output || response.tool_result_message || 'Unknown error';
      logger.error('Remote tool failed', { status: response.status, output: errorMessage });
      throw new Error(`GitHub API error: ${errorMessage}`);
    }

    // Parse the YAML response from the tool
    // The github-api tool returns YAML formatted output
    try {
      const output = response.tool_output;
      logger.debug('Raw tool output', { output });

      // Parse YAML using js-yaml library
      const rawParsed = yaml.load(output);
      if (!isPlainObject(rawParsed)) {
        throw new Error(`Expected YAML to parse as object, got: ${typeof rawParsed}`);
      }
      const parsed = rawParsed;
      const user = (parsed.user as Record<string, unknown>) || {};
      const head = (parsed.head as Record<string, unknown>) || {};
      const base = (parsed.base as Record<string, unknown>) || {};


      // Convert to GithubPullRequest format
      const pr: GithubPullRequest = {
        number: parsed.number as number,
        title: (parsed.title as string) || options.title,
        body: (parsed.body as string) || options.body,
        state: (parsed.state as string) || 'open',
        html_url: parsed.html_url as string,
        created_at: normalizeToString(parsed.created_at) || new Date().toISOString(),
        updated_at: normalizeToString(parsed.updated_at) || new Date().toISOString(),
        merged_at: normalizeToString(parsed.merged_at),
        closed_at: normalizeToString(parsed.closed_at),
        user: {
          login: (user.login as string) || 'unknown',
          avatar_url: (user.avatar_url as string) || '',
          html_url: (user.html_url as string) || '',
        },
        head_ref: options.head,
        base_ref: options.base,
        head_sha: (head.sha as string) || '',
        base_sha: (base.sha as string) || '',
        merged: (parsed.merged as boolean) || false,
        draft: (parsed.draft as boolean) || options.draft || false,
        labels: [],
        comments: 0,
        review_comments: 0,
        commits: 0,
        additions: 0,
        deletions: 0,
        changed_files: 0,
      };

      logger.info('Successfully created PR via remote tool', {
        number: pr.number,
        html_url: pr.html_url,
      });

      return pr;
    } catch (parseError) {
      logger.error('Failed to parse remote tool response', parseError as Error);
      // If parsing fails but we got a success status, try to extract the URL from the raw output
      const urlMatch = response.tool_output.match(/html_url:\s*["']?(https:\/\/[^\s"']+)["']?/);
      const numberMatch = response.tool_output.match(/number:\s*(\d+)/);

      if (urlMatch && numberMatch) {
        return {
          number: parseInt(numberMatch[1], 10),
          title: options.title,
          body: options.body,
          state: 'open',
          html_url: urlMatch[1],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user: { login: 'unknown', avatar_url: '', html_url: '' },
          head_ref: options.head,
          base_ref: options.base,
          head_sha: '',
          base_sha: '',
          merged: false,
          draft: options.draft || false,
          labels: [],
          comments: 0,
          review_comments: 0,
          commits: 0,
          additions: 0,
          deletions: 0,
          changed_files: 0,
        };
      }

      throw parseError;
    }
  }

  /**
   * List pull requests for a repository using the github-api remote tool
   * This bypasses the missing list-pull-requests backend endpoint
   */
  async listGitHubPullRequests(
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      head?: string;
      base?: string;
      sort?: 'created' | 'updated' | 'popularity' | 'long-running';
      direction?: 'asc' | 'desc';
      per_page?: number;
    },
  ): Promise<GithubPullRequest[]> {
    // Build query params for GitHub API
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.head) params.set('head', options.head);
    if (options?.base) params.set('base', options.base);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);
    if (options?.per_page) params.set('per_page', options.per_page.toString());

    const queryString = params.toString();
    const path = `/repos/${owner}/${repo}/pulls${queryString ? `?${queryString}` : ''}`;

    const toolInput = {
      summary: `List pull requests for ${owner}/${repo}`,
      method: 'GET',
      path,
      details: true,
    };

    logger.info('Listing PRs via github-api remote tool', { path });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('List PRs remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('List PRs remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`GitHub API error: ${errorMessage}`);
      }

      // Parse the YAML response - it's a list of PRs
      return this.parseYamlPullRequestList(response.tool_output);
    } catch (error) {
      logger.error('Failed to list pull requests via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * Search for pull requests using GitHub's search API
   * This allows filtering by author:@me, assignee:@me, review-requested:@me, or involves:@me
   */
  async searchGitHubPullRequests(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      per_page?: number;
    },
  ): Promise<GithubPullRequest[]> {
    // Build search query for GitHub search API
    // Format: q=is:pr repo:owner/repo is:open author:@me
    const queryParts = [`is:pr`, `repo:${owner}/${repo}`];

    if (options?.state) {
      queryParts.push(`is:${options.state}`);
    } else {
      queryParts.push('is:open');
    }

    // Add author/assignee/review-requested/involves filter - @me is resolved by GitHub API for authenticated user
    if (options?.filter === 'assigned') {
      queryParts.push('assignee:@me');
    } else if (options?.filter === 'created') {
      queryParts.push('author:@me');
    } else if (options?.filter === 'review-requested') {
      queryParts.push('review-requested:@me');
    } else if (options?.filter === 'involves') {
      queryParts.push('involves:@me');
    }

    const params = new URLSearchParams();
    params.set('q', queryParts.join(' '));
    if (options?.per_page) params.set('per_page', options.per_page.toString());
    params.set('sort', 'updated');
    params.set('order', 'desc');

    const path = `/search/issues?${params.toString()}`;

    const toolInput = {
      summary: `Search pull requests for ${owner}/${repo} (${options?.filter || 'all'})`,
      method: 'GET',
      path,
      details: true,
    };

    logger.info('Searching PRs via github-api remote tool', { path, filter: options?.filter });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('Search PRs remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('Search PRs remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`GitHub API error: ${errorMessage}`);
      }

      // Parse the YAML response - search results format is slightly different
      const searchResults = this.parseYamlSearchResults(response.tool_output);

      // Note: The search API doesn't return head_ref/base_ref, but we no longer fetch
      // full PR details eagerly. The branch info is only used for display purposes
      // and can be fetched lazily when a specific PR is selected.
      // This avoids N+1 API calls when loading PR lists.

      return searchResults;
    } catch (error) {
      logger.error('Failed to search pull requests via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * Search for issues using GitHub's search API with is:issue filter
   * This ensures we only get actual issues, not PRs (since /issues endpoint returns both)
   */
  async searchGitHubIssues(
    owner: string,
    repo: string,
    options?: {
      filter?: 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';
      state?: 'open' | 'closed';
      per_page?: number;
    },
  ): Promise<GithubIssue[]> {
    // Build search query for GitHub search API
    // Format: q=is:issue repo:owner/repo is:open assignee:@me
    const queryParts = [`is:issue`, `repo:${owner}/${repo}`];

    if (options?.state) {
      queryParts.push(`is:${options.state}`);
    } else {
      queryParts.push('is:open');
    }

    // Add author/assignee/involves filter - @me is resolved by GitHub API for authenticated user
    // Note: review-requested doesn't apply to issues, so we treat it like 'all' for issues
    if (options?.filter === 'assigned') {
      queryParts.push('assignee:@me');
    } else if (options?.filter === 'created') {
      queryParts.push('author:@me');
    } else if (options?.filter === 'involves') {
      queryParts.push('involves:@me');
    }
    // 'review-requested' is not applicable to issues, so no filter is added

    const params = new URLSearchParams();
    params.set('q', queryParts.join(' '));
    if (options?.per_page) params.set('per_page', options.per_page.toString());
    params.set('sort', 'updated');
    params.set('order', 'desc');

    const path = `/search/issues?${params.toString()}`;

    const toolInput = {
      summary: `Search issues for ${owner}/${repo} (${options?.filter || 'all'})`,
      method: 'GET',
      path,
      details: true,
    };

    logger.info('Searching issues via github-api remote tool', { path, filter: options?.filter });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('Search issues remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('Search issues remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`GitHub API error: ${errorMessage}`);
      }

      // Parse the YAML response - search results format
      return this.parseYamlIssueSearchResults(response.tool_output, owner, repo);
    } catch (error) {
      logger.error('Failed to search issues via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * Parse YAML output from GitHub search API into Issues
   */
  private parseYamlIssueSearchResults(
    yamlOutput: string,
    owner: string,
    repo: string,
  ): GithubIssue[] {
    const issues: GithubIssue[] = [];

    if (!yamlOutput) return issues;

    // The search results have items array, parse each item
    const lines = yamlOutput.split('\n');
    let currentItem: Record<string, unknown> = {};
    let inItems = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for items array start
      if (line.startsWith('items:')) {
        inItems = true;
        continue;
      }

      if (!inItems) continue;

      // New item starts with "- " at some indentation
      if (line.match(/^\s*-\s+\w+:/)) {
        // Save previous item if exists
        if (currentItem.number) {
          const issue = this.normalizeSearchIssue(currentItem, owner, repo);
          if (issue) issues.push(issue);
        }
        currentItem = {};
      }

      // Parse field from search result
      const fieldMatch = line.match(/^\s*-?\s*(\w+):\s*(.*)$/);
      if (fieldMatch) {
        const [, key, value] = fieldMatch;
        const trimmedValue = value.trim().replace(/^['"]|['"]$/g, '');

        switch (key) {
          case 'number':
            currentItem.number = parseInt(trimmedValue, 10);
            break;
          case 'title':
            currentItem.title = trimmedValue;
            break;
          case 'html_url':
            currentItem.html_url = trimmedValue;
            break;
          case 'state':
            currentItem.state = trimmedValue;
            break;
          case 'body':
            currentItem.body = trimmedValue;
            break;
          case 'created_at':
            currentItem.created_at = trimmedValue;
            break;
          case 'updated_at':
            currentItem.updated_at = trimmedValue;
            break;
          case 'login':
            // User login
            if (!currentItem.user) currentItem.user = {};
            (currentItem.user as Record<string, string>).login = trimmedValue;
            break;
          case 'comments':
            currentItem.comments = parseInt(trimmedValue, 10) || 0;
            break;
        }
      }
    }

    // Don't forget the last item
    if (currentItem.number) {
      const issue = this.normalizeSearchIssue(currentItem, owner, repo);
      if (issue) issues.push(issue);
    }

    logger.info('Parsed issue search results', { count: issues.length });
    return issues;
  }

  /**
   * Normalize a search result into a GithubIssue
   */
  private normalizeSearchIssue(
    item: Record<string, unknown>,
    owner: string,
    repo: string,
  ): GithubIssue | null {
    if (!item.number) return null;
    const userObj = item.user as Record<string, string> | undefined;
    return {
      number: item.number as number,
      title: (item.title as string) || '',
      body: (item.body as string) || '',
      state: ((item.state as string) || 'open') as 'open' | 'closed',
      html_url: (item.html_url as string) || '',
      created_at: (item.created_at as string) || '',
      updated_at: (item.updated_at as string) || '',
      user: {
        login: userObj?.login || '',
        avatar_url: userObj?.avatar_url || '',
        html_url: userObj?.html_url || '',
      },
      labels: (item.labels as string[]) || [],
      comments: (item.comments as number) || 0,
      owner,
      repo,
    };
  }

  /**
   * Parse YAML output from GitHub search API into PRs
   */
  private parseYamlSearchResults(yamlOutput: string): GithubPullRequest[] {
    const prs: GithubPullRequest[] = [];

    if (!yamlOutput) return prs;

    // The search results have items array, parse each item
    const lines = yamlOutput.split('\n');
    let currentItem: Partial<GithubPullRequest> = {};
    let inItems = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for items array start
      if (line.startsWith('items:')) {
        inItems = true;
        continue;
      }

      if (!inItems) continue;

      // New item starts with "- " at some indentation
      if (line.match(/^\s*-\s+\w+:/)) {
        // Save previous item if exists
        if (currentItem.number) {
          prs.push(this.normalizeSearchResult(currentItem));
        }
        currentItem = {};
      }

      // Parse field from search result
      const fieldMatch = line.match(/^\s*-?\s*(\w+):\s*(.*)$/);
      if (fieldMatch) {
        const [, key, value] = fieldMatch;
        const trimmedValue = value.trim().replace(/^['"]|['"]$/g, '');

        switch (key) {
          case 'number':
            currentItem.number = parseInt(trimmedValue, 10);
            break;
          case 'title':
            currentItem.title = trimmedValue;
            break;
          case 'html_url':
            currentItem.html_url = trimmedValue;
            break;
          case 'state':
            currentItem.state = trimmedValue;
            break;
          case 'body':
            currentItem.body = trimmedValue;
            break;
          case 'created_at':
            currentItem.created_at = trimmedValue;
            break;
          case 'updated_at':
            currentItem.updated_at = trimmedValue;
            break;
          case 'login':
            // User login - set as author
            if (!currentItem.user)
              currentItem.user = { login: '', avatar_url: '', html_url: '' };
            currentItem.user.login = trimmedValue;
            break;
        }
      }
    }

    // Don't forget the last item
    if (currentItem.number) {
      prs.push(this.normalizeSearchResult(currentItem));
    }

    logger.info('Parsed search results', { count: prs.length });
    return prs;
  }

  /**
   * Normalize a search result into a GithubPullRequest
   */
  private normalizeSearchResult(item: Partial<GithubPullRequest>): GithubPullRequest {
    return {
      number: item.number || 0,
      title: item.title || '',
      body: item.body || '',
      state: item.state || 'open',
      html_url: item.html_url || '',
      created_at: item.created_at || '',
      updated_at: item.updated_at || '',
      user: item.user || { login: '', avatar_url: '', html_url: '' },
      head_ref: item.head_ref || '',
      base_ref: item.base_ref || '',
      head_sha: item.head_sha || '',
      base_sha: item.base_sha || '',
      merged: item.merged || false,
      draft: item.draft || false,
      labels: item.labels || [],
      assignees: item.assignees || [],
      comments: item.comments || 0,
      review_comments: item.review_comments || 0,
      commits: item.commits || 0,
      additions: item.additions || 0,
      deletions: item.deletions || 0,
      changed_files: item.changed_files || 0,
    };
  }

  /**
   * Get a single pull request using the github-api remote tool
   * Uses module-level cache to avoid redundant API calls across different filter searches
   */
  async getGitHubPullRequest(
    owner: string,
    repo: string,
    number: number,
    options?: { force?: boolean },
  ): Promise<GithubPullRequest | null> {
    // Check cache first to avoid redundant API calls (unless force is true)
    if (!options?.force) {
      const cached = getCachedPRDetails(owner, repo, number);
      if (cached) {
        logger.debug('Returning cached PR details', { owner, repo, number });
        return cached;
      }
    }

    const path = `/repos/${owner}/${repo}/pulls/${number}`;

    const toolInput = {
      summary: `Get pull request #${number} for ${owner}/${repo}`,
      method: 'GET',
      path,
      details: true,
    };

    logger.info('Getting PR via github-api remote tool', { path });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('Get PR remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        return null;
      }

      // Parse the YAML response - it's a single PR object
      const prs = this.parseYamlPullRequestList(response.tool_output);
      const pr = prs.length > 0 ? prs[0] : null;

      // Cache the result for future requests
      if (pr) {
        setCachedPRDetails(owner, repo, number, pr);
      }

      return pr;
    } catch (error) {
      logger.error('Failed to get pull request via remote tool', error as Error);
      return null;
    }
  }

  /**
   * Merge a pull request on GitHub using the github-api remote tool
   * Uses PUT /repos/{owner}/{repo}/pulls/{number}/merge
   */
  async mergePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: {
      merge_method?: 'merge' | 'squash' | 'rebase';
      commit_title?: string;
      commit_message?: string;
    },
  ): Promise<{ merged: boolean; message: string; sha?: string }> {
    const path = `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`;

    const data: Record<string, unknown> = {
      merge_method: options?.merge_method || 'merge',
    };
    if (options?.commit_title) data.commit_title = options.commit_title;
    if (options?.commit_message) data.commit_message = options.commit_message;

    const toolInput = {
      summary: `Merge pull request #${pullNumber} for ${owner}/${repo}`,
      method: 'PUT',
      path,
      data,
    };

    logger.info('Merging PR via github-api remote tool', { path, options });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('Merge PR remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('Merge PR remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`Failed to merge PR: ${errorMessage}`);
      }

      // Parse the YAML response
      const parsed = yaml.load(response.tool_output) as Record<string, unknown>;
      return {
        merged: (parsed?.merged as boolean) ?? false,
        message: (parsed?.message as string) || '',
        sha: parsed?.sha as string | undefined,
      };
    } catch (error) {
      logger.error('Failed to merge pull request via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * Update a pull request branch with latest changes from the base branch
   * Uses PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
   * Note: GitHub API only supports merging (not rebasing) via this endpoint
   * @param expectedHeadSha - Optional SHA of the PR's current HEAD commit. Recommended to prevent race conditions.
   */
  async updatePullRequestBranch(
    owner: string,
    repo: string,
    pullNumber: number,
    expectedHeadSha?: string,
  ): Promise<{ message: string; url?: string }> {
    const path = `/repos/${owner}/${repo}/pulls/${pullNumber}/update-branch`;

    const data: Record<string, unknown> = {};
    if (expectedHeadSha) {
      data.expected_head_sha = expectedHeadSha;
    }

    const toolInput = {
      summary: `Update branch for pull request #${pullNumber} in ${owner}/${repo}`,
      method: 'PUT',
      path,
      data: Object.keys(data).length > 0 ? data : undefined,
    };

    logger.info('Updating PR branch via github-api remote tool', { path });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('Update PR branch remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('Update PR branch remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`Failed to update PR branch: ${errorMessage}`);
      }

      // Parse the YAML response
      const parsed = yaml.load(response.tool_output) as Record<string, unknown>;
      return {
        message: (parsed?.message as string) || 'Branch updated successfully',
        url: parsed?.url as string | undefined,
      };
    } catch (error) {
      logger.error('Failed to update pull request branch via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * List issues for a repository using the github-api remote tool
   */
  async listGitHubIssues(
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
  ): Promise<GithubIssue[]> {
    // Build query params for GitHub API
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.assignee) params.set('assignee', options.assignee);
    if (options?.creator) params.set('creator', options.creator);
    if (options?.labels) params.set('labels', options.labels);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.direction) params.set('direction', options.direction);
    if (options?.per_page) params.set('per_page', options.per_page.toString());

    const queryString = params.toString();
    const path = `/repos/${owner}/${repo}/issues${queryString ? `?${queryString}` : ''}`;

    const toolInput = {
      summary: `List issues for ${owner}/${repo}`,
      method: 'GET',
      path,
      details: true,
    };

    logger.info('Listing issues via github-api remote tool', { path });

    try {
      const response = await this.callEndpoint<{
        tool_output: string;
        tool_result_message: string;
        status: number;
      }>('agents/run-remote-tool', {
        tool_name: 'github-api',
        tool_input_json: JSON.stringify(toolInput),
        tool_id: 8, // GITHUB_API = 8
      });

      logger.debug('List issues remote tool response', {
        status: response.status,
        message: response.tool_result_message,
        outputLength: response.tool_output?.length,
      });

      // Status 1 = TOOL_EXECUTION_OK
      if (response.status !== 1) {
        const errorMessage =
          response.tool_output || response.tool_result_message || 'Unknown error';
        logger.error('List issues remote tool failed', {
          status: response.status,
          output: errorMessage,
        });
        throw new Error(`GitHub API error: ${errorMessage}`);
      }

      // Parse the YAML response - it's a list of issues
      return this.parseYamlIssueList(response.tool_output, owner, repo);
    } catch (error) {
      logger.error('Failed to list issues via remote tool', error as Error);
      throw error;
    }
  }

  /**
   * Parse YAML output from github-api tool into Issue objects
   * The GitHub Issues API returns issues in a list format
   */
  private parseYamlIssueList(yamlOutput: string, owner: string, repo: string): GithubIssue[] {
    if (!yamlOutput || yamlOutput.trim() === '') {
      logger.info('parseYamlIssueList: empty output');
      return [];
    }

    logger.info('parseYamlIssueList: parsing issue YAML', {
      length: yamlOutput.length,
      preview: yamlOutput.substring(0, 200),
    });

    // Check if it's a "no results" message
    if (
      yamlOutput.includes('No issues found') ||
      yamlOutput.includes('empty') ||
      yamlOutput.trim() === '[]'
    ) {
      logger.info('parseYamlIssueList: no issues message detected');
      return [];
    }

    try {
      // Parse YAML using js-yaml library
      const parsed = yaml.load(yamlOutput);

      // Handle both array and single object responses
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const issues: GithubIssue[] = [];
      for (const item of items) {
        if (item && typeof item === 'object') {
          // Skip pull requests (GitHub issues API returns both issues and PRs)
          if ((item as Record<string, unknown>).pull_request) {
            continue;
          }
          const issue = this.convertParsedToIssue(item as Record<string, unknown>, owner, repo);
          if (issue) issues.push(issue);
        }
      }

      logger.info('Parsed GitHub issues', { count: issues.length });
      return issues;
    } catch (error) {
      logger.error('Failed to parse YAML issue list', error as Error);
      return [];
    }
  }

  /**
   * Convert parsed YAML object to GithubIssue
   */
  private convertParsedToIssue(
    parsed: Record<string, unknown>,
    owner: string,
    repo: string,
  ): GithubIssue | null {
    const number = parsed.number as number;
    if (!number) return null;

    return {
      number,
      title: (parsed.title as string) || `Issue #${number}`,
      body: parsed.body as string | undefined,
      state: (parsed.state as 'open' | 'closed') || 'open',
      html_url:
        (parsed.html_url as string) || `https://github.com/${owner}/${repo}/issues/${number}`,
      created_at: normalizeToString(parsed.created_at) || new Date().toISOString(),
      updated_at: normalizeToString(parsed.updated_at) || new Date().toISOString(),
      closed_at: normalizeToString(parsed.closed_at),
      user: {
        login: ((parsed.user as Record<string, unknown>)?.login as string) || 'unknown',
        avatar_url: ((parsed.user as Record<string, unknown>)?.avatar_url as string) || '',
        html_url: ((parsed.user as Record<string, unknown>)?.html_url as string) || '',
      },
      labels: Array.isArray(parsed.labels)
        ? parsed.labels
        : typeof parsed.labels === 'string'
          ? parsed.labels.split(',').map((l: string) => l.trim())
          : [],
      comments: (parsed.comments as number) || 0,
      owner,
      repo,
    };
  }

  /**
   * Parse YAML output from github-api tool into PullRequest objects
   */
  private parseYamlPullRequestList(yamlOutput: string): GithubPullRequest[] {
    if (!yamlOutput || yamlOutput.trim() === '') {
      return [];
    }

    // Check if it's a "no results" message - be specific to avoid false positives
    // (e.g., GitHub API responses may contain fields like "allow_empty_commits")
    const trimmedOutput = yamlOutput.trim();
    if (
      trimmedOutput === '[]' ||
      trimmedOutput === 'No pull requests found' ||
      trimmedOutput === 'empty' ||
      trimmedOutput.startsWith('No pull requests found')
    ) {
      return [];
    }

    try {
      // Parse YAML using js-yaml library
      const parsed = yaml.load(yamlOutput);

      // Handle both array and single object responses
      const items = Array.isArray(parsed) ? parsed : [parsed];

      const prs: GithubPullRequest[] = [];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const pr = this.convertParsedToPullRequest(item as Record<string, unknown>);
          if (pr) prs.push(pr);
        }
      }

      logger.info('Parsed GitHub pull requests', { count: prs.length });
      return prs;
    } catch (error) {
      logger.error('Failed to parse YAML pull request list', error as Error);
      return [];
    }
  }

  /**
   * Convert parsed YAML object to GithubPullRequest
   */
  private convertParsedToPullRequest(parsed: Record<string, unknown>): GithubPullRequest | null {
    if (!parsed.number) {
      return null;
    }

    // Determine state - GitHub API returns 'open' or 'closed', we also track 'merged' and 'draft'
    // A PR is merged if: merged === true OR merged_at has a value (not null/undefined)
    let state = (parsed.state as string) || 'open';
    const mergedAtValue = normalizeToString(parsed.merged_at);
    const isMerged =
      parsed.merged === true ||
      (mergedAtValue !== undefined && mergedAtValue !== null && mergedAtValue !== 'null');

    logger.info('PR state determination (DEBUG)', {
      originalState: parsed.state,
      merged: parsed.merged,
      merged_at: parsed.merged_at,
      isMerged,
      finalState: isMerged ? 'merged' : state,
    });

    if (isMerged) {
      state = 'merged';
    } else if (parsed.draft === true && state === 'open') {
      state = 'draft';
    }

    return {
      number: parsed.number as number,
      title: (parsed.title as string) || '',
      body: (parsed.body as string) || '',
      state,
      html_url: (parsed.html_url as string) || '',
      created_at: normalizeToString(parsed.created_at) || '',
      updated_at: normalizeToString(parsed.updated_at) || '',
      merged_at: mergedAtValue,
      closed_at: normalizeToString(parsed.closed_at),
      user: {
        login: ((parsed.user as Record<string, unknown>)?.login as string) || 'unknown',
        avatar_url: ((parsed.user as Record<string, unknown>)?.avatar_url as string) || '',
        html_url: ((parsed.user as Record<string, unknown>)?.html_url as string) || '',
      },
      head_ref: ((parsed.head as Record<string, unknown>)?.ref as string) || (parsed.head_ref as string) || '',
      base_ref: ((parsed.base as Record<string, unknown>)?.ref as string) || (parsed.base_ref as string) || '',
      head_sha: ((parsed.head as Record<string, unknown>)?.sha as string) || (parsed.head_sha as string) || '',
      base_sha: ((parsed.base as Record<string, unknown>)?.sha as string) || (parsed.base_sha as string) || '',
      merged: !!isMerged,
      draft: (parsed.draft as boolean) || false,
      mergeable: parsed.mergeable != null ? (parsed.mergeable as boolean) : undefined,
      mergeable_state: (parsed.mergeable_state as string) || undefined,
      labels: [],
      comments: (parsed.comments as number) || 0,
      review_comments: (parsed.review_comments as number) || 0,
      commits: (parsed.commits as number) || 0,
      additions: (parsed.additions as number) || 0,
      deletions: (parsed.deletions as number) || 0,
      changed_files: (parsed.changed_files as number) || 0,
    };
  }
}

// ============================================================================
// GitHub Types (from Augment API)
// ============================================================================

export interface GithubRepo {
  owner: string;
  name: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  default_branch?: string;
}

export interface GithubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  closed_at?: string;
  user: GithubUser;
  head_ref: string;
  base_ref: string;
  head_sha: string;
  base_sha: string;
  merged: boolean;
  draft: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  labels: string[];
  assignees?: GithubUser[];
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GithubIssue {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  user: GithubUser;
  labels: string[];
  comments: number;
  /** Repository owner */
  owner?: string;
  /** Repository name */
  repo?: string;
}

// Singleton instance
export const augmentApiClient = new AugmentApiClient();
