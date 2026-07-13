/**
 * MCP OAuth Flow
 *
 * Handles OAuth authentication for MCP servers by:
 * 1. Discovering OAuth metadata from the server
 * 2. Starting a local callback server
 * 3. Opening the browser for authentication
 * 4. Handling the callback and storing tokens
 */

import express from 'express';
import type { Server } from 'http';
import { shell } from 'electron';
import { Logger } from '$shared/logger';

const logger = new Logger('McpOAuth');

// Store pending OAuth states (for PKCE verification)
const pendingAuthStates = new Map<
  string,
  {
    codeVerifier: string;
    state: string;
    redirectUri: string;
    serverMetadata: OAuthServerMetadata;
    client: OAuthClient;
    resolve: (tokens: OAuthTokens) => void;
    reject: (error: Error) => void;
  }
>();

// Store OAuth tokens per MCP server (in-memory cache). Raw bags are held in
// memory only for the current process lifetime so `getMcpAuthHeaderAsync`
// can build Authorization headers; persistence is delegated to the daemon
// (PROTOCOL.md §5.22, `mcp.oauth.*`). Per §5.22.1 the daemon never echoes the
// raw bag back over the wire, so a restart drops the cache and the user must
// re-run the OAuth flow — matching the P3 canonical-persistence posture where
// electron-store is retired.
const tokenStore = new Map<string, OAuthTokens>();

/**
 * Persist a token bag on the daemon via `mcp.oauth.set`. Best-effort: a
 * failure is logged but does not abort the OAuth flow because the in-memory
 * cache still lets the current process build auth headers.
 */
async function persistTokensOnDaemon(mcpName: string, tokens: OAuthTokens): Promise<void> {
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('mcp.oauth.set', {
      serverId: mcpName,
      tokenBag: tokens,
    });
  } catch (error) {
    logger.error('Failed to persist OAuth tokens on daemon:', error);
  }
}

/**
 * Drop a persisted bag on the daemon via `mcp.oauth.delete`. Idempotent on
 * the daemon side, so unknown servers succeed silently.
 */
async function deleteTokensOnDaemon(mcpName: string): Promise<void> {
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('mcp.oauth.delete', { serverId: mcpName });
  } catch (error) {
    logger.error('Failed to delete OAuth tokens on daemon:', error);
  }
}

/**
 * Clear OAuth tokens for an MCP server (in-memory cache + daemon store).
 * Used when the user disconnects an integration.
 */
export async function clearMcpOAuthTokens(mcpName: string): Promise<void> {
  logger.info('Clearing OAuth tokens for:', mcpName);
  tokenStore.delete(mcpName);
  await deleteTokensOnDaemon(mcpName);
}

interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

interface OAuthClient {
  client_id: string;
  client_secret?: string;
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
}

/**
 * Generate a random string for PKCE code verifier
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate code challenge from verifier (S256)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate random state parameter
 */
function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Discover OAuth metadata from MCP server URL
 */
async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthServerMetadata | null> {
  logger.info('Discovering OAuth metadata for:', serverUrl);
  const url = new URL(serverUrl);

  // Try well-known OAuth endpoints
  const wellKnownPaths = [
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
  ];

  for (const path of wellKnownPaths) {
    try {
      const metadataUrl = new URL(path, url.origin);
      logger.debug('Trying OAuth metadata URL:', metadataUrl.toString());
      const response = await fetch(metadataUrl.toString(), {
        headers: { Accept: 'application/json' },
      });

      logger.debug('OAuth metadata response:', { status: response.status, ok: response.ok });

      if (response.ok) {
        const metadata = await response.json();
        if (metadata.authorization_endpoint && metadata.token_endpoint) {
          logger.info('Discovered OAuth metadata:', { issuer: metadata.issuer });
          return metadata as OAuthServerMetadata;
        }
      }
    } catch  {
      // Continue trying other paths
    }
  }

  logger.warn('No OAuth metadata found for:', serverUrl);
  return null;
}

/**
 * Dynamically register a client with the OAuth server.
 *
 * Aligned with the sidecar implementation (clients/sidecar/libs/src/mcp/auth/mcp-oauth.ts)
 * to handle non-conformant OAuth servers (Figma, Stripe, Linear, Ramp, etc.).
 */
async function registerClient(
  metadata: OAuthServerMetadata,
  redirectUri: string,
): Promise<OAuthClient | null> {
  if (!metadata.registration_endpoint) {
    logger.warn('No registration endpoint available');
    return null;
  }

  try {
    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'Augment Code',
        client_uri: 'https://augmentcode.com',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });

    // Some servers (e.g. Stripe, Ramp) return 200 instead of 201 on success
    const effectiveStatus = response.status === 200 ? 201 : response.status;

    if (effectiveStatus !== 201) {
      const errorBody = await response.text().catch(() => '');
      logger.error('Client registration failed:', {
        status: response.status,
        body: errorBody,
      });
      return null;
    }

    const client = await response.json();

    // Some servers (e.g. Linear) omit client_secret_expires_at — not fatal, just log
    if (!client.client_secret_expires_at) {
      logger.debug('Registration response missing client_secret_expires_at, defaulting to 0');
    }

    const clientSecret = client.client_secret || undefined;

    logger.info('Registered OAuth client:', { client_id: client.client_id });
    return {
      client_id: client.client_id,
      client_secret: clientSecret,
    };
  } catch (error) {
    logger.error('Client registration error:', error);
    return null;
  }
}

/**
 * Create a local callback server for OAuth redirect
 */
function createCallbackServer(
  mcpName: string,
  onCallback: (params: URLSearchParams) => Promise<void>,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const app = express();

    app.get('/callback', (req, res) => {
      void (async () => {
        logger.info('OAuth callback received for:', mcpName);
        const params = new URLSearchParams(req.query as Record<string, string>);

        try {
          await onCallback(params);
          res.send(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1>✓ Authentication Successful</h1>
                  <p>You can close this window and return to Workspaces.</p>
                </div>
              </body>
            </html>
          `);
        } catch (error) {
          res.status(500).send(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1>✗ Authentication Failed</h1>
                  <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
                </div>
              </body>
            </html>
          `);
        }

        // Close server after response
        setTimeout(() => server.close(), 2000);
      })();
    });

    const server = app.listen(0, 'localhost', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const port = addr.port;
      logger.info('OAuth callback server started on port:', port);

      // Timeout after 5 minutes
      setTimeout(
        () => {
          logger.warn('OAuth callback timeout for:', mcpName);
          server.close();
        },
        5 * 60 * 1000,
      );

      resolve({ server, port });
    });

    server.on('error', reject);
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: codeVerifier,
  });

  if (client.client_secret) {
    body.set('client_secret', client.client_secret);
  }

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokens = await response.json();
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
    token_type: tokens.token_type || 'Bearer',
  };
}

export interface InitiateOAuthResult {
  success: boolean;
  error?: string;
}

/**
 * Initiate OAuth flow for an MCP server
 * Opens browser for authentication and returns when complete
 */
export async function initiateMcpOAuth(
  mcpName: string,
  serverUrl: string,
): Promise<InitiateOAuthResult> {
  logger.info('Initiating OAuth for MCP server:', { mcpName, serverUrl });

  try {
    // 1. Discover OAuth metadata
    const metadata = await discoverOAuthMetadata(serverUrl);
    if (!metadata) {
      return {
        success: false,
        error:
          'This server does not support OAuth. Please configure authentication headers manually.',
      };
    }

    // 2. Create callback server
    let callbackServer!: { server: Server; port: number };

    const tokenPromise = new Promise<OAuthTokens>((resolve, reject) => {
      createCallbackServer(mcpName, async (params) => {
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');

        if (error) {
          reject(new Error(params.get('error_description') || error));
          return;
        }

        if (!code) {
          reject(new Error('No authorization code received'));
          return;
        }

        // Get pending auth state
        const authState = pendingAuthStates.get(mcpName);
        if (!authState) {
          reject(new Error('No pending auth state found'));
          return;
        }

        // Verify state
        if (state !== authState.state) {
          reject(new Error('State mismatch - possible CSRF attack'));
          return;
        }

        // Exchange code for tokens
        const newTokens = await exchangeCodeForTokens(
          authState.serverMetadata,
          authState.client,
          code,
          authState.redirectUri,
          authState.codeVerifier,
        );

        pendingAuthStates.delete(mcpName);
        resolve(newTokens);
      })
        .then((result) => {
          callbackServer = result;
        })
        .catch(reject);
    });

    // Wait for callback server to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 3. Register client (or use existing)
    const redirectUri = `http://localhost:${callbackServer.port}/callback`;
    const client = await registerClient(metadata, redirectUri);
    if (!client) {
      callbackServer.server.close();
      return {
        success: false,
        error: 'Failed to register OAuth client. Please configure authentication headers manually.',
      };
    }

    // 4. Build authorization URL with PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store auth state for callback verification
    pendingAuthStates.set(mcpName, {
      codeVerifier,
      state,
      redirectUri,
      serverMetadata: metadata,
      client,
      resolve: () => {},
      reject: () => {},
    });

    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // 5. Open browser
    logger.info('Opening browser for OAuth:', authUrl.toString());
    await shell.openExternal(authUrl.toString());

    // 6. Wait for callback
    const tokens = await tokenPromise;

    // 7. Store tokens (in memory and persistent storage)
    tokenStore.set(mcpName, tokens);
    await persistTokensOnDaemon(mcpName, tokens);
    logger.info('OAuth completed successfully for:', mcpName);

    return { success: true };
  } catch (error) {
    logger.error('OAuth failed for:', mcpName, error);
    pendingAuthStates.delete(mcpName);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'OAuth failed',
    };
  }
}

/**
 * Get stored OAuth tokens for an MCP server. The daemon persists bags via
 * `mcp.oauth.*` but never echoes raw contents back (PROTOCOL.md §5.22.1), so
 * this only inspects the in-process memory cache populated by
 * `initiateMcpOAuth`. After a main-process restart callers must re-run the
 * OAuth flow. Kept `async` for call-site compat.
 */
export async function getMcpOAuthTokensAsync(mcpName: string): Promise<OAuthTokens | null> {
  return tokenStore.get(mcpName) ?? null;
}

/**
 * Get stored OAuth tokens for an MCP server (sync version, only checks memory)
 */
export function getMcpOAuthTokens(mcpName: string): OAuthTokens | null {
  return tokenStore.get(mcpName) || null;
}

/**
 * Check if we have valid OAuth tokens for an MCP server (async version)
 */
export async function hasMcpOAuthTokensAsync(mcpName: string): Promise<boolean> {
  const tokens = await getMcpOAuthTokensAsync(mcpName);
  if (!tokens) return false;

  // Check if expired
  if (tokens.expires_at && Date.now() > tokens.expires_at) {
    return false;
  }

  return true;
}

/**
 * Check if we have valid OAuth tokens for an MCP server (sync version)
 */
export function hasMcpOAuthTokens(mcpName: string): boolean {
  const tokens = tokenStore.get(mcpName);
  if (!tokens) return false;

  // Check if expired
  if (tokens.expires_at && Date.now() > tokens.expires_at) {
    return false;
  }

  return true;
}

/**
 * Get authorization header for an MCP server (async version that checks persistent storage)
 */
export async function getMcpAuthHeaderAsync(mcpName: string): Promise<string | null> {
  logger.info('getMcpAuthHeaderAsync called for:', mcpName);
  const tokens = await getMcpOAuthTokensAsync(mcpName);
  logger.info('getMcpAuthHeaderAsync tokens result:', {
    mcpName,
    hasTokens: !!tokens,
    tokenType: tokens?.token_type,
  });
  if (!tokens) return null;

  // Capitalize token type for Authorization header (OAuth servers may return "bearer" lowercase)
  const tokenType = tokens.token_type.toLowerCase() === 'bearer' ? 'Bearer' : tokens.token_type;
  const header = `${tokenType} ${tokens.access_token}`;
  logger.info('getMcpAuthHeaderAsync returning header:', {
    mcpName,
    headerPrefix: header.substring(0, 20),
  });
  return header;
}

/**
 * Get authorization header for an MCP server (sync version, only checks memory)
 */
export function getMcpAuthHeader(mcpName: string): string | null {
  const tokens = tokenStore.get(mcpName);
  if (!tokens) return null;

  // Capitalize token type for Authorization header (OAuth servers may return "bearer" lowercase)
  const tokenType = tokens.token_type.toLowerCase() === 'bearer' ? 'Bearer' : tokens.token_type;
  return `${tokenType} ${tokens.access_token}`;
}
