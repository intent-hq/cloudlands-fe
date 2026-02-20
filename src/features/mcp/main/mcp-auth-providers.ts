/**
 * MCP Authentication Providers
 *
 * Registry of authentication providers for MCP servers.
 * When a user adds an MCP server that matches a known service,
 * we automatically inject authentication from our existing auth stores.
 *
 * To add a new provider:
 * 1. Create a provider object implementing McpAuthProvider
 * 2. Add it to the AUTH_PROVIDERS array
 */

import { Logger } from '../../../shared/logger';
import { getMcpAuthHeaderAsync } from './mcp-oauth';

const logger = new Logger('McpAuthProviders');

/**
 * Authentication provider for MCP servers
 */
export interface McpAuthProvider {
  /** Unique identifier for this provider */
  name: string;

  /** Human-readable display name */
  displayName: string;

  /**
   * Check if this provider handles the given URL
   * @param url - The MCP server URL
   * @returns true if this provider should handle auth for this URL
   */
  matchesUrl(url: string): boolean;

  /**
   * Get authentication headers for this service
   * @param serverName - Optional server name for looking up OAuth tokens
   * @returns Headers to inject, or null if not authenticated
   */
  getAuthHeaders(serverName?: string): Promise<Record<string, string> | null>;

  /**
   * Optional: Get a hint message when auth is missing
   */
  getAuthHint?(): string;
}

// =============================================================================
// Provider Implementations
// =============================================================================

/**
 * Sentry MCP authentication provider
 * First checks for OAuth tokens from the MCP OAuth flow,
 * then falls back to the API token stored in our sentry-auth electron-store
 */
const sentryProvider: McpAuthProvider = {
  name: 'sentry',
  displayName: 'Sentry',

  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.includes('sentry.dev') || parsed.hostname.includes('sentry.io');
    } catch {
      return false;
    }
  },

  async getAuthHeaders(serverName?: string): Promise<Record<string, string> | null> {
    logger.info('Getting auth headers for Sentry MCP', { serverName });

    // 1. First try OAuth tokens from MCP OAuth flow (preferred for MCP servers)
    if (serverName) {
      try {
        logger.info('Checking for OAuth tokens...', { serverName });
        const oauthHeader = await getMcpAuthHeaderAsync(serverName);
        if (oauthHeader) {
          logger.info('Using OAuth token for Sentry MCP', { serverName });
          return { Authorization: oauthHeader };
        }
        logger.info('No OAuth tokens found, falling back to API token', { serverName });
      } catch (error) {
        logger.warn('Failed to get OAuth token for Sentry MCP', {
          serverName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. Fall back to Sentry API token from integrations settings
    try {
      const ElectronStore = (await import('electron-store')).default;
      const configStore = new ElectronStore({ name: 'sentry-auth' });
      const config = configStore.get('sentry-config') as { apiToken?: string } | undefined;

      if (config?.apiToken) {
        logger.debug('Using Sentry API token (fallback)', { serverName });
        return { Authorization: `Bearer ${config.apiToken}` };
      }
    } catch (error) {
      logger.debug('Failed to read Sentry auth', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  },

  getAuthHint(): string {
    return 'Click "Authenticate" to sign in with Sentry, or configure Sentry in Settings > Integrations';
  },
};

// =============================================================================
// Provider Registry
// =============================================================================

/**
 * Registry of all MCP authentication providers
 * Add new providers here to enable automatic auth injection
 */
const AUTH_PROVIDERS: McpAuthProvider[] = [sentryProvider];

/**
 * Find an auth provider that matches the given URL
 */
export function findAuthProvider(url: string): McpAuthProvider | null {
  for (const provider of AUTH_PROVIDERS) {
    if (provider.matchesUrl(url)) {
      return provider;
    }
  }
  return null;
}

/**
 * Find an auth provider by name
 */
export function getAuthProviderByName(name: string): McpAuthProvider | null {
  return AUTH_PROVIDERS.find((p) => p.name === name) ?? null;
}

/**
 * Get all registered auth provider names
 */
export function getAuthProviderNames(): string[] {
  return AUTH_PROVIDERS.map((p) => p.name);
}

/**
 * Result of checking auth requirements for a URL
 */
export interface AuthCheckResult {
  /** Whether the URL requires authentication */
  requiresAuth: boolean;
  /** The auth provider name if auth is required */
  providerName?: string;
  /** Human-readable display name of the provider */
  providerDisplayName?: string;
  /** Whether auth credentials are available */
  hasAuth: boolean;
  /** Hint for how to authenticate if missing */
  authHint?: string;
}

/**
 * Check if a URL requires authentication and whether we have it
 * Used by the UI to prompt users to authenticate before adding a server
 */
export async function checkMcpAuthRequirement(url: string): Promise<AuthCheckResult> {
  const provider = findAuthProvider(url);

  if (!provider) {
    return { requiresAuth: false, hasAuth: false };
  }

  const authHeaders = await provider.getAuthHeaders();

  return {
    requiresAuth: true,
    providerName: provider.name,
    providerDisplayName: provider.displayName,
    hasAuth: authHeaders !== null,
    authHint: provider.getAuthHint?.(),
  };
}

// =============================================================================
// Auth Injection
// =============================================================================

/**
 * Config type that may have URL and headers (HTTP/SSE servers)
 */
interface ConfigWithUrl {
  url: string;
  headers?: Record<string, string>;
  authProvider?: string;
}

/**
 * Check if a config has a URL (is HTTP/SSE type)
 */
function hasUrl(config: unknown): config is ConfigWithUrl {
  return (
    typeof config === 'object' &&
    config !== null &&
    'url' in config &&
    typeof (config as Record<string, unknown>).url === 'string'
  );
}

/**
 * Inject authentication headers into an MCP server config
 *
 * This function:
 * 1. Checks if the config has an explicit authProvider specified
 * 2. Otherwise, auto-detects the provider from the URL
 * 3. If a provider is found, injects auth headers (if available)
 *
 * @param config - The MCP server configuration
 * @param serverName - Server name for logging
 * @returns Config with auth headers injected (or original if no auth needed/available)
 */
export async function injectMcpAuth<T>(config: T, serverName: string): Promise<T> {
  // Only handle configs with URLs (HTTP/SSE servers)
  if (!hasUrl(config)) {
    return config;
  }

  // Skip if Authorization header is already set
  if (config.headers?.Authorization) {
    logger.debug('MCP server already has Authorization header', { serverName });
    return config;
  }

  // Find the auth provider (explicit or auto-detected)
  let provider: McpAuthProvider | null = null;

  if (config.authProvider) {
    provider = getAuthProviderByName(config.authProvider);
    if (!provider) {
      logger.warn('Unknown auth provider specified', {
        serverName,
        authProvider: config.authProvider,
        availableProviders: getAuthProviderNames(),
      });
    }
  } else {
    provider = findAuthProvider(config.url);
  }

  if (!provider) {
    return config;
  }

  // Get auth headers from the provider (passing serverName for OAuth token lookup)
  const authHeaders = await provider.getAuthHeaders(serverName);

  if (authHeaders) {
    logger.info('Injecting auth headers for MCP server', {
      serverName,
      provider: provider.name,
    });

    return {
      ...config,
      headers: {
        ...config.headers,
        ...authHeaders,
      },
    } as T;
  } else {
    logger.warn('MCP server requires auth but credentials not found', {
      serverName,
      provider: provider.name,
      hint: provider.getAuthHint?.() ?? 'Please authenticate with this service',
    });
  }

  return config;
}
