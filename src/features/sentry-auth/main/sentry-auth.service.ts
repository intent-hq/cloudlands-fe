/**
 * Sentry Authentication Service
 *
 * Manages Sentry authentication using a user-provided API token.
 * Makes REST API calls to Sentry's API to fetch issues and projects.
 */

import { Logger } from '../../../shared/logger';
import { SENTRY_API_BASE_URL } from '../constants';
import type {
  FetchIssuesRequest,
  SaveConfigResult,
  SentryAuthState,
  SentryConfig,
  SentryIssue,
  SentryIssueResult,
  SentryProject,
} from '../types';

const logger = new Logger('SentryAuthService');

// Config store for Sentry credentials
let configStore: any = null;
const STORE_KEY = 'sentry-config';

/**
 * Initialize electron-store for config persistence
 */
async function initStore(): Promise<void> {
  if (!configStore) {
    try {
      const ElectronStore = (await import('electron-store')).default;
      configStore = new ElectronStore({ name: 'sentry-auth' });
      logger.info('Initialized electron-store for Sentry config');
    } catch (err) {
      logger.error('Failed to initialize electron-store for Sentry', err as Error);
    }
  }
}

export class SentryAuthService {
  private config: SentryConfig | null = null;
  private cachedProjects: SentryProject[] = [];
  private projectsCacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor() {
    // Load config on initialization
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    await initStore();
    if (configStore) {
      const saved = configStore.get(STORE_KEY);
      if (saved && saved.organization && saved.apiToken) {
        this.config = saved;
        logger.debug('Loaded Sentry config from store', { organization: saved.organization });
      }
    }
  }

  /**
   * Check if user has configured Sentry credentials
   */
  async isAuthenticated(): Promise<boolean> {
    await this.loadConfig();
    return this.config !== null && !!this.config.organization && !!this.config.apiToken;
  }

  /**
   * Save Sentry configuration and validate it
   */
  async saveConfig(organization: string, apiToken: string): Promise<SaveConfigResult> {
    logger.info('Saving Sentry configuration', { organization });

    if (!organization || !apiToken) {
      return { success: false, error: 'Organization and API token are required' };
    }

    // Validate by trying to fetch organization details
    try {
      const response = await fetch(`${SENTRY_API_BASE_URL}/organizations/${organization}/`, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: 'Invalid API token' };
        }
        if (response.status === 403) {
          return {
            success: false,
            error:
              'This endpoint may require a user auth token for some token types. If you\'re using an integration/org token, try a user token — or as a workaround, expand scopes (org:write) if your token type supports it.',
          };
        }
        if (response.status === 404) {
          return { success: false, error: 'Organization not found' };
        }
        return { success: false, error: `Validation failed: ${response.statusText}` };
      }

      const orgData = await response.json();

      // Save config
      this.config = { organization, apiToken };
      await initStore();
      if (configStore) {
        configStore.set(STORE_KEY, this.config);
      }

      logger.info('Sentry configuration saved successfully', {
        organization,
        orgName: orgData.name,
      });

      return { success: true, organizationName: orgData.name };
    } catch (error) {
      logger.error('Failed to validate Sentry config', error as Error);
      return { success: false, error: 'Failed to connect to Sentry API' };
    }
  }

  /**
   * Get the current authentication state
   */
  async getAuthState(): Promise<SentryAuthState> {
    await this.loadConfig();

    if (!this.config) {
      return { isAuthenticated: false };
    }

    return {
      isAuthenticated: true,
      organization: this.config.organization,
    };
  }

  /**
   * Clear saved Sentry configuration
   */
  async logout(): Promise<void> {
    logger.info('Clearing Sentry configuration');
    this.config = null;
    this.cachedProjects = [];
    await initStore();
    if (configStore) {
      configStore.delete(STORE_KEY);
    }
  }

  /**
   * Fetch projects for the configured organization
   */
  async fetchProjects(): Promise<SentryProject[]> {
    if (!this.config) {
      logger.warn('Cannot fetch projects - not authenticated');
      return [];
    }

    // Return cached if still valid
    if (this.cachedProjects.length > 0 && Date.now() - this.projectsCacheTime < this.CACHE_TTL) {
      return this.cachedProjects;
    }

    try {
      const response = await this.apiCall(`/organizations/${this.config.organization}/projects/`);
      this.cachedProjects = response.map((p: any) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        platform: p.platform,
        isMember: p.isMember,
      }));
      this.projectsCacheTime = Date.now();
      return this.cachedProjects;
    } catch (error) {
      logger.error('Failed to fetch Sentry projects', error as Error);
      return [];
    }
  }

  /**
   * Fetch issues for the configured organization
   */
  async fetchIssues(request: FetchIssuesRequest = {}): Promise<SentryIssueResult[]> {
    if (!this.config) {
      logger.warn('Cannot fetch issues - not authenticated');
      return [];
    }

    try {
      const params = new URLSearchParams();

      // Add status filter
      if (request.status && request.status !== 'all') {
        params.set('query', `is:${request.status}`);
      } else if (!request.query) {
        params.set('query', 'is:unresolved');
      }

      // Add search query
      if (request.query) {
        const existingQuery = params.get('query') || '';
        params.set('query', existingQuery ? `${existingQuery} ${request.query}` : request.query);
      }

      // Add project filter
      if (request.project) {
        params.set('project', request.project);
      }

      // Limit results
      params.set('limit', String(request.limit || 100));

      const endpoint = `/organizations/${this.config.organization}/issues/?${params.toString()}`;
      const issues = await this.apiCall(endpoint);

      return issues.map((issue: SentryIssue) => this.mapIssueToResult(issue));
    } catch (error) {
      logger.error('Failed to fetch Sentry issues', error as Error);
      return [];
    }
  }

  /**
   * Search issues by query
   */
  async searchIssues(query: string, project?: string): Promise<SentryIssueResult[]> {
    return this.fetchIssues({ query, project, limit: 50 });
  }

  /**
   * Get a specific issue by ID
   */
  async getIssue(issueId: string): Promise<SentryIssueResult | null> {
    if (!this.config) {
      return null;
    }

    try {
      const issue = await this.apiCall(`/issues/${issueId}/`);
      return this.mapIssueToResult(issue);
    } catch (error) {
      logger.error('Failed to get Sentry issue', error as Error, { issueId });
      return null;
    }
  }

  /**
   * Make an authenticated API call to Sentry
   */
  private async apiCall(endpoint: string): Promise<any> {
    if (!this.config) {
      throw new Error('Not authenticated with Sentry');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${SENTRY_API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Map a Sentry issue to simplified result format
   */
  private mapIssueToResult(issue: SentryIssue): SentryIssueResult {
    return {
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      status: issue.status,
      level: issue.level,
      count: issue.count,
      userCount: issue.userCount,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      projectName: issue.project?.name || '',
      projectSlug: issue.project?.slug || '',
      url: issue.permalink,
      type: issue.metadata?.type,
      value: issue.metadata?.value,
      filename: issue.metadata?.filename,
      function: issue.metadata?.function,
    };
  }
}

// Singleton instance
export const sentryAuthService = new SentryAuthService();
