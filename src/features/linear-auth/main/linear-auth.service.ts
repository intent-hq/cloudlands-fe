import { Logger } from '../../../shared/logger';
import type { LinearAuthState, LinearAuthStatus, StartAuthResult } from '../types';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';

const logger = new Logger('LinearAuthService');

/** JSON-RPC "method not found" — the daemon has not (yet) wired a method. */
const METHOD_NOT_FOUND = -32601;

/** True when the error is a daemon "method not found" (`-32601`) response. */
function isMethodNotFound(error: unknown): boolean {
  return error instanceof JsonRpcError && error.rpcCode === METHOD_NOT_FOUND;
}

/**
 * Wire shape of `linear.authStatus` (PROTOCOL §5.28). The API key is never
 * carried over the wire — only the connection boolean and derived identity.
 */
interface LinearAuthStatusResponse {
  authenticated: boolean;
  login?: string;
  scopes: string[];
}

/**
 * Linear Authentication Service
 *
 * Talks to the intentd daemon's `linear.*` namespace (PROTOCOL §5.28) via the
 * shared JSON-RPC client — no external cloud. v1 Linear auth is env-key based
 * (`LINEAR_API_KEY`): there is no OAuth/connect/revoke wire method, so "connect"
 * is "set the key and restart" and "revoke" is a local forget. Status and issue
 * reads (`linear.authStatus` / `linear.listIssues` / `linear.searchIssues`)
 * round-trip to the daemon; a not-configured key or an un-wired method
 * (`-32601`) degrades to a not-connected / empty result instead of throwing.
 * The issue reads are cursor-paginated (§5.28): they accept `limit`/`nextToken`
 * and return the `{ issues, nextToken }` envelope.
 */
export class LinearAuthService {
  private cachedStatus: LinearAuthStatus | null = null;
  private statusCacheTime = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Check if user is authenticated with Linear.
   */
  async isAuthenticated(): Promise<boolean> {
    const status = await this.getLinearStatus();
    return status.isConfigured;
  }

  /**
   * Get Linear status from the daemon (`linear.authStatus`), with a short cache.
   * A not-configured key or an un-wired method reports not connected.
   */
  async getLinearStatus(forceRefresh = false): Promise<LinearAuthStatus> {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && now - this.statusCacheTime < this.CACHE_TTL) {
      return this.cachedStatus;
    }

    try {
      const response = await getBackendClient().request<LinearAuthStatusResponse>(
        'linear.authStatus',
      );
      const status: LinearAuthStatus = {
        isConfigured: !!response?.authenticated,
        oauthUrl: '',
      };
      this.cachedStatus = status;
      this.statusCacheTime = Date.now();
      logger.info('Linear auth status from daemon', { isConfigured: status.isConfigured });
      return status;
    } catch (error) {
      if (!isMethodNotFound(error)) {
        logger.error('Failed to get Linear status from daemon', error as Error);
      }
      return {
        isConfigured: false,
        oauthUrl: '',
      };
    }
  }

  /**
   * Start Linear authentication flow.
   *
   * v1 Linear auth is env-key based and has no daemon connect method, so this
   * attempts `linear.startAuth` for forward-compatibility and otherwise derives
   * the outcome from `linear.authStatus`: already-connected reports success, an
   * unconfigured key returns an actionable error (set `LINEAR_API_KEY`).
   */
  async startAuth(): Promise<StartAuthResult> {
    try {
      const result = await getBackendClient().request<StartAuthResult>('linear.startAuth');
      if (result && typeof result === 'object' && 'success' in result) {
        return result;
      }
    } catch (error) {
      if (!isMethodNotFound(error)) {
        logger.warn('linear.startAuth failed; falling back to authStatus', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const status = await this.getLinearStatus(true);
    if (status.isConfigured) {
      return {
        success: true,
        alreadyAuthenticated: true,
      };
    }

    return {
      success: false,
      error: 'Linear is not configured. Set LINEAR_API_KEY in the environment and restart.',
    };
  }

  /**
   * Check if authentication completed (forces a fresh status read).
   */
  async checkAuthComplete(): Promise<boolean> {
    const status = await this.getLinearStatus(true);
    return status.isConfigured;
  }

  /**
   * Revoke Linear access.
   *
   * v1 has no daemon revoke method (the key lives in the environment), so this
   * attempts `linear.revoke` for forward-compatibility, clears the local status
   * cache, and reports success — "revoke" is a local forget.
   */
  async revokeAccess(): Promise<boolean> {
    let success = true;
    try {
      const result = await getBackendClient().request<unknown>('linear.revoke');
      success = result !== false;
    } catch (error) {
      if (!isMethodNotFound(error)) {
        logger.warn('linear.revoke failed; treating as a local forget', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.cachedStatus = null;
    this.statusCacheTime = 0;
    return success;
  }

  /**
   * Get the full authentication state for the UI.
   * @param forceRefresh - If true, bypass the cache and read fresh status.
   */
  async getAuthState(forceRefresh = false): Promise<LinearAuthState> {
    const status = await this.getLinearStatus(forceRefresh);
    return {
      isAuthenticated: status.isConfigured,
      requiresDaemonAuth: false,
      oauthUrl: status.oauthUrl,
    };
  }

  /**
   * Fetch Linear issues for a filter via the daemon (`linear.listIssues`).
   * The daemon returns the `{ issues, nextToken }` envelope (§5.28) with the
   * flattened `LinearIssueResult[]`; a not-configured key or an un-wired
   * method degrades to an empty page.
   * @param filter - The type of issues to fetch (defaults to 'assigned')
   * @param options - Optional cursor pagination (`limit`, opaque `nextToken`)
   */
  async fetchMyIssues(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
    options?: LinearIssuePageOptions,
  ): Promise<LinearIssuePage> {
    try {
      const response = await getBackendClient().request<LinearIssuePage>('linear.listIssues', {
        filter,
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.nextToken ? { nextToken: options.nextToken } : {}),
      });
      return toIssuePage(response);
    } catch (error) {
      if (!isMethodNotFound(error)) {
        logger.error('Failed to fetch Linear issues from daemon', error as Error);
      }
      return { issues: [], nextToken: null };
    }
  }

  /**
   * Search Linear issues via the daemon (`linear.searchIssues`). The daemon
   * returns the `{ issues, nextToken }` envelope (§5.28); an empty query, a
   * not-configured key, or an un-wired method degrades to an empty page.
   */
  async searchIssues(
    searchQuery: string,
    options?: LinearIssuePageOptions,
  ): Promise<LinearIssuePage> {
    if (!searchQuery) {
      return { issues: [], nextToken: null };
    }

    try {
      const response = await getBackendClient().request<LinearIssuePage>('linear.searchIssues', {
        query: searchQuery,
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.nextToken ? { nextToken: options.nextToken } : {}),
      });
      return toIssuePage(response);
    } catch (error) {
      if (!isMethodNotFound(error)) {
        logger.error('Failed to search Linear issues from daemon', error as Error);
      }
      return { issues: [], nextToken: null };
    }
  }
}

/** Guard the daemon envelope into a well-formed page. */
function toIssuePage(response: LinearIssuePage | undefined): LinearIssuePage {
  return {
    issues: Array.isArray(response?.issues) ? response.issues : [],
    nextToken: typeof response?.nextToken === 'string' ? response.nextToken : null,
  };
}

/** Cursor-pagination options shared by the two issue reads (§5.28). */
export interface LinearIssuePageOptions {
  limit?: number;
  /** Opaque cursor from a previous page's `nextToken`. */
  nextToken?: string;
}

/** One page of the daemon's cursor-paginated issue reads (§5.28). */
export interface LinearIssuePage {
  issues: LinearIssueResult[];
  /** Opaque cursor for the next page, or `null` when this is the last page. */
  nextToken: string | null;
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

// Singleton instance
export const linearAuthService = new LinearAuthService();
