import { shell } from 'electron';
import {
  augmentApiClient,
  isAugmentAuthenticated,
} from '../../../shared/augment-api/augment-api.client';
import { Logger } from '../../../shared/logger';
import { getDefaultProviderConfig } from '$shared/config/provider-config';
import type { LinearAuthState, LinearAuthStatus, StartAuthResult } from '../types';

const logger = new Logger('LinearAuthService');

/**
 * Linear Authentication Service
 *
 * Manages Linear authentication through Augment's OAuth flow.
 * Uses the agents/list-remote-tools API to check status and get OAuth URL.
 *
 * Flow:
 * 1. Check if user is authenticated with Augment (session.json exists)
 * 2. Call list-remote-tools to check Linear tool availability
 * 3. If not configured, redirect user to oauth_url from the API
 * 4. After OAuth completes, the API will return availability_status: 1 (Available)
 */
export class LinearAuthService {
  private cachedStatus: LinearAuthStatus | null = null;
  private statusCacheTime: number = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Check if user is authenticated with Linear via Augment
   */
  async isAuthenticated(): Promise<boolean> {
    const status = await this.getLinearStatus();
    return status.isConfigured;
  }

  /**
   * Get Linear status from Augment API
   * Uses caching to avoid excessive API calls
   */
  async getLinearStatus(forceRefresh = false): Promise<LinearAuthStatus> {
    // Check Augment session first
    if (!isAugmentAuthenticated()) {
      return {
        isConfigured: false,
        oauthUrl: '',
      };
    }

    // Return cached status if still valid
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && now - this.statusCacheTime < this.CACHE_TTL) {
      return this.cachedStatus;
    }

    // Refresh session in case it was updated
    augmentApiClient.refreshSession();

    if (!augmentApiClient.hasSession()) {
      return {
        isConfigured: false,
        oauthUrl: '',
      };
    }

    try {
      const status = await augmentApiClient.checkLinearAuthStatus();
      this.cachedStatus = status;
      this.statusCacheTime = Date.now();

      // Log at info level for debugging the OAuth flow
      logger.info('Linear auth status from Augment API', {
        isConfigured: status.isConfigured,
        hasOauthUrl: !!status.oauthUrl,
        availabilityStatus: status.availabilityStatus,
        oauthUrl: status.oauthUrl ? `${status.oauthUrl.substring(0, 50)  }...` : 'none',
      });

      return status;
    } catch (error) {
      logger.error('Failed to get Linear status from Augment API', error as Error);
      return {
        isConfigured: false,
        oauthUrl: '',
      };
    }
  }

  /**
   * Start Linear authentication flow
   * Returns the OAuth URL for the user to visit
   */
  async startAuth(): Promise<StartAuthResult> {
    logger.info('Starting Linear authentication via Augment');

    // Check Augment session first
    if (!isAugmentAuthenticated()) {
      const defaultProvider = getDefaultProviderConfig();
      const loginHint = defaultProvider.loginCommandHint || `${defaultProvider.command} login`;
      return {
        success: false,
        error: `Please authenticate with Augment first. Run "${loginHint}" in your terminal.`,
      };
    }

    const status = await this.getLinearStatus(true);

    if (status.isConfigured) {
      logger.info('User already authenticated with Linear');
      return {
        success: true,
        alreadyAuthenticated: true,
      };
    }

    if (!status.oauthUrl) {
      return {
        success: false,
        error: 'Could not get Linear OAuth URL from Augment API',
      };
    }

    // Open the OAuth URL in the browser
    logger.info('Opening Linear OAuth URL in browser');
    await shell.openExternal(status.oauthUrl);

    return {
      success: true,
      oauthUrl: status.oauthUrl,
    };
  }

  /**
   * Check if authentication completed after user visited OAuth URL
   * This should be called periodically after startAuth()
   */
  async checkAuthComplete(): Promise<boolean> {
    const status = await this.getLinearStatus(true);
    return status.isConfigured;
  }

  /**
   * Revoke Linear access through Augment API
   */
  async revokeAccess(): Promise<boolean> {
    logger.info('Revoking Linear access');
    const success = await augmentApiClient.revokeLinearAccess();

    // Clear local cache regardless of API result
    this.cachedStatus = null;
    this.statusCacheTime = 0;

    if (success) {
      logger.info('Linear access revoked successfully');
    } else {
      logger.warn('Failed to revoke Linear access via API');
    }

    return success;
  }

  /**
   * Get the full authentication state for the UI
   * @param forceRefresh - If true, bypass cache and fetch fresh status from API
   */
  async getAuthState(forceRefresh = false): Promise<LinearAuthState> {
    const augmentAuthenticated = isAugmentAuthenticated();

    if (!augmentAuthenticated) {
      return {
        isAuthenticated: false,
        requiresAugmentAuth: true,
      };
    }

    const status = await this.getLinearStatus(forceRefresh);

    logger.debug('getAuthState result', {
      isConfigured: status.isConfigured,
      forceRefresh,
    });

    return {
      isAuthenticated: status.isConfigured,
      requiresAugmentAuth: false,
      oauthUrl: status.oauthUrl,
    };
  }

  /**
   * Fetch Linear issues based on filter type
   * Uses the run-remote-tool API with a natural language query
   * @param filter - The type of issues to fetch (defaults to 'assigned')
   */
  async fetchMyIssues(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
  ): Promise<LinearIssueResult[]> {
    if (!isAugmentAuthenticated()) {
      logger.warn('Cannot fetch Linear issues - not authenticated with Augment');
      return [];
    }

    const status = await this.getLinearStatus();
    if (!status.isConfigured) {
      logger.warn('Cannot fetch Linear issues - Linear not connected');
      return [];
    }

    // Define queries for each filter type
    // Note: Explicitly request fields since not all are included by default
    const fieldsToInclude =
      'Include the following fields for each issue: description, assignee, creator, labels, project, state, priority, createdAt, updatedAt.';
    const filterQueries: Record<string, { summary: string; query: string }> = {
      assigned: {
        summary: 'Fetch issues assigned to current user with full details',
        query: `List all issues assigned to me that are not completed or canceled. ${fieldsToInclude}`,
      },
      created: {
        summary: 'Fetch issues created by current user with full details',
        query: `List all issues I created that are not completed or canceled. ${fieldsToInclude}`,
      },
      subscribed: {
        summary: 'Fetch issues user is subscribed to with full details',
        query: `List all issues I am subscribed to that are not completed or canceled. ${fieldsToInclude}`,
      },
      team: {
        summary: 'Fetch all active issues from user teams with full details',
        query: `List all active issues from my teams that are not completed or canceled. ${fieldsToInclude}`,
      },
      all: {
        summary: 'Fetch all accessible issues with full details',
        query: `List all issues I have access to that are not completed or canceled. ${fieldsToInclude}`,
      },
    };

    const filterConfig = filterQueries[filter] || filterQueries.assigned;

    try {
      logger.info('Fetching Linear issues', { filter });

      // Use a natural language query that the Linear tool can process
      // The Linear tool requires both 'query' and 'summary' fields
      const query = JSON.stringify(filterConfig);

      const result = await augmentApiClient.runLinearTool<LinearToolResponse>(query);

      if (!result) {
        logger.warn('No result from Linear tool');
        return [];
      }

      // Log the raw result for debugging
      logger.info('Linear tool raw result', {
        resultType: typeof result,
        isArray: Array.isArray(result),
        preview:
          typeof result === 'string'
            ? result.substring(0, 200)
            : JSON.stringify(result).substring(0, 200),
      });

      // Parse the tool output - it comes back as a string that we need to parse
      const issues = this.parseLinearToolOutput(result);
      logger.info('Fetched Linear issues', { count: issues.length, filter });
      return issues;
    } catch (error) {
      logger.error('Failed to fetch Linear issues', error as Error);
      return [];
    }
  }

  /**
   * Search Linear issues by query
   */
  async searchIssues(searchQuery: string): Promise<LinearIssueResult[]> {
    if (!isAugmentAuthenticated() || !(await this.getLinearStatus()).isConfigured) {
      return [];
    }

    try {
      logger.info('Searching Linear issues', { query: searchQuery });

      const fieldsToInclude =
        'Include the following fields: description, assignee, creator, labels, project, state, priority, createdAt, updatedAt.';
      const query = JSON.stringify({
        summary: `Search Linear issues for: ${searchQuery}`,
        query: `Search for issues matching: ${searchQuery}. ${fieldsToInclude}`,
      });

      const result = await augmentApiClient.runLinearTool<LinearToolResponse>(query);
      return result ? this.parseLinearToolOutput(result) : [];
    } catch (error) {
      logger.error('Failed to search Linear issues', error as Error);
      return [];
    }
  }

  /**
   * Parse the Linear tool output into structured issue data
   * The tool returns results in various formats, so we need to be flexible
   */
  private parseLinearToolOutput(result: LinearToolResponse): LinearIssueResult[] {
    logger.debug('Parsing Linear tool output', {
      resultType: typeof result,
      isArray: Array.isArray(result),
    });

    // The tool output is typically a string describing the issues
    // We'll try to extract structured data if available, or parse the text
    if (typeof result === 'string') {
      // Try to parse as JSON first (might be a stringified object/array)
      try {
        const parsed = JSON.parse(result);
        return this.parseLinearToolOutput(parsed);
      } catch {
        return this.parseTextOutput(result);
      }
    }

    // Handle array of issues directly (common response format)
    if (Array.isArray(result)) {
      return result.map((issue) => this.mapIssue(issue));
    }

    // Handle nested structure: {issues: {nodes: [...]}} (GraphQL-style response)
    const resultObj = result as Record<string, unknown>;
    if (resultObj.issues && typeof resultObj.issues === 'object') {
      const issuesObj = resultObj.issues as Record<string, unknown>;
      if (Array.isArray(issuesObj.nodes)) {
        logger.debug('Found issues.nodes structure', { count: issuesObj.nodes.length });
        return issuesObj.nodes.map((issue: LinearIssueRaw) => this.mapIssue(issue));
      }
      // Handle flat array: {issues: [...]}
      if (Array.isArray(resultObj.issues)) {
        return (resultObj.issues as LinearIssueRaw[]).map((issue) => this.mapIssue(issue));
      }
    }

    // If we have a tool_output string, try to parse it
    if (resultObj.tool_output && typeof resultObj.tool_output === 'string') {
      // tool_output might be JSON or text
      try {
        const parsed = JSON.parse(resultObj.tool_output);
        return this.parseLinearToolOutput(parsed);
      } catch {
        return this.parseTextOutput(resultObj.tool_output);
      }
    }

    logger.warn('Could not parse Linear tool output', { resultKeys: Object.keys(resultObj) });
    return [];
  }

  /**
   * Map a raw issue object to LinearIssueResult
   */
  private mapIssue(issue: LinearIssueRaw): LinearIssueResult {
    // Parse labels - can be { nodes: [...] } or just an array
    let labels: string[] = [];
    if (issue.labels) {
      if ('nodes' in issue.labels && Array.isArray(issue.labels.nodes)) {
        labels = issue.labels.nodes.map((l) => l.name || '').filter(Boolean);
      } else if (Array.isArray(issue.labels)) {
        labels = issue.labels.map((l) => l.name || '').filter(Boolean);
      }
    }

    // Log the raw issue to see what fields are available
    logger.debug('Mapping raw issue', {
      id: issue.id,
      identifier: issue.identifier,
      hasDescription: !!issue.description,
      hasAssignee: !!issue.assignee,
      hasLabels: labels.length > 0,
      hasProject: !!issue.project,
      issueKeys: Object.keys(issue),
    });

    return {
      id: issue.id || '',
      identifier: issue.identifier || '',
      title: issue.title || '',
      description: issue.description,
      url: issue.url,
      teamName: issue.team?.name,
      teamKey: issue.team?.key || issue.identifier?.split('-')[0],
      state: issue.state?.name,
      priority: issue.priority,
      assignee: issue.assignee?.name,
      creator: issue.creator?.name,
      labels: labels.length > 0 ? labels : undefined,
      project: issue.project?.name,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  }

  /**
   * Parse text output from the Linear tool
   * Format typically: "- [TEAM-123] Issue Title (status)"
   */
  private parseTextOutput(text: string): LinearIssueResult[] {
    const issues: LinearIssueResult[] = [];
    const lines = text.split('\n');

    // Regex to match issue patterns like "TEAM-123" or "[TEAM-123]"
    const issuePattern = /\[?([A-Z]+-\d+)\]?\s*[:\-]?\s*(.+?)(?:\s*\(([^)]+)\))?$/;

    let currentTeam: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for team headers (e.g., "## Team Name" or "Team Name:")
      if (trimmed.startsWith('#') || trimmed.endsWith(':')) {
        currentTeam = trimmed
          .replace(/^#+\s*/, '')
          .replace(/:$/, '')
          .trim();
        continue;
      }

      // Try to match issue line
      const match = trimmed.match(issuePattern);
      if (match) {
        const [, identifier, title, state] = match;
        issues.push({
          id: identifier, // Use identifier as ID since we don't have the actual UUID
          identifier,
          title: title.trim(),
          state: state?.trim(),
          teamName: currentTeam,
          teamKey: identifier.split('-')[0],
        });
      }
    }

    return issues;
  }
}

/**
 * Simplified Linear issue result for the UI
 */
export interface LinearIssueResult {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  teamName?: string;
  teamKey?: string;
  state?: string;
  priority?: number;
  /** Assignee name */
  assignee?: string;
  /** Labels as array of names */
  labels?: string[];
  /** Project name */
  project?: string;
  /** Creator/author name */
  creator?: string;
  /** Created timestamp */
  createdAt?: string;
  /** Updated timestamp */
  updatedAt?: string;
}

/**
 * Response structure from Linear tool
 * Can be an array of issues, an object with issues, or a string
 */
type LinearToolResponse =
  | string
  | LinearIssueRaw[]
  | {
      tool_output?: string;
      issues?: LinearIssueRaw[];
    };

interface LinearIssueRaw {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string;
  url?: string;
  priority?: number;
  team?: { name?: string; key?: string; id?: string };
  state?: { name?: string; type?: string };
  assignee?: { name?: string; email?: string } | null;
  creator?: { name?: string; email?: string } | null;
  labels?: { nodes?: Array<{ name?: string }> } | Array<{ name?: string }>;
  project?: { name?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

// Singleton instance
export const linearAuthService = new LinearAuthService();
