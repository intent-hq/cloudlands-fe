/** Standards-based OAuth flow for hosted MCP servers. */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { shell } from 'electron';
import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';

const logger = new Logger('McpOAuth');
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
}

interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
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
  token_endpoint: string;
  client_id: string;
  client_secret?: string;
  scope?: string;
}

interface CallbackServer {
  server: Server;
  port: number;
  completion: Promise<void>;
  close(): void;
}

export interface InitiateOAuthResult {
  success: boolean;
  error?: string;
}

const tokenStore = new Map<string, OAuthTokens>();

function requestSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function resourceMetadataFromChallenge(header: string | null): string | null {
  const match = header?.match(/\bresource_metadata\s*=\s*"([^"]+)"/i);
  return match?.[1] ?? null;
}

function protectedResourceWellKnown(serverUrl: string): string {
  const resource = new URL(serverUrl);
  const suffix = resource.pathname === '/' ? '' : resource.pathname;
  return new URL(`/.well-known/oauth-protected-resource${suffix}`, resource.origin).toString();
}

function authorizationServerWellKnown(issuer: string): string {
  const url = new URL(issuer);
  const suffix = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return new URL(`/.well-known/oauth-authorization-server${suffix}`, url.origin).toString();
}

async function fetchJson<T>(url: string): Promise<{ response: Response; value?: T }> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: requestSignal(),
  });
  if (!response.ok) return { response };
  return { response, value: (await response.json()) as T };
}

async function discoverProtectedResource(serverUrl: string): Promise<ProtectedResourceMetadata> {
  const challenge = await fetch(serverUrl, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream' },
    redirect: 'error',
    signal: requestSignal(),
  });
  const challengedUrl = resourceMetadataFromChallenge(challenge.headers.get('www-authenticate'));
  const metadataUrl = challengedUrl ?? protectedResourceWellKnown(serverUrl);
  const { response, value } = await fetchJson<ProtectedResourceMetadata>(metadataUrl);
  if (!response.ok || !value?.resource || !value.authorization_servers?.length) {
    throw new Error('The MCP server did not provide valid OAuth protected-resource metadata.');
  }
  return value;
}

async function discoverAuthorizationServer(issuer: string): Promise<OAuthServerMetadata> {
  const candidates = [
    authorizationServerWellKnown(issuer),
    new URL('/.well-known/openid-configuration', issuer).toString(),
  ];
  for (const candidate of candidates) {
    const { response, value } = await fetchJson<OAuthServerMetadata>(candidate);
    if (response.ok && value?.authorization_endpoint && value.token_endpoint) {
      if (
        value.code_challenge_methods_supported &&
        !value.code_challenge_methods_supported.includes('S256')
      ) {
        throw new Error('The OAuth provider does not support PKCE S256.');
      }
      return value;
    }
  }
  throw new Error('The MCP server OAuth provider did not publish valid authorization metadata.');
}

async function registerClient(
  metadata: OAuthServerMetadata,
  redirectUri: string,
): Promise<OAuthClient> {
  if (!metadata.registration_endpoint) {
    throw new Error('The OAuth provider does not support automatic client registration.');
  }
  const response = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Intent',
      client_uri: 'https://intentapp.dev',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    redirect: 'error',
    signal: requestSignal(),
  });
  if (response.status === 403) {
    throw new Error(m.mcp_oauth_registrationRestricted_error());
  }
  if (!response.ok) throw new Error(`OAuth client registration failed (HTTP ${response.status}).`);
  const value = (await response.json()) as Partial<OAuthClient>;
  if (!value.client_id)
    throw new Error('The OAuth provider returned an invalid client registration.');
  return { client_id: value.client_id, client_secret: value.client_secret };
}

async function exchangeCode(
  metadata: OAuthServerMetadata,
  client: OAuthClient,
  code: string,
  redirectUri: string,
  verifier: string,
  resource: string,
  requestedScope?: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: verifier,
    resource,
  });
  if (client.client_secret) body.set('client_secret', client.client_secret);
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'error',
    signal: requestSignal(),
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed (HTTP ${response.status}).`);
  const value = (await response.json()) as Record<string, unknown>;
  if (typeof value.access_token !== 'string' || !value.access_token) {
    throw new Error('The OAuth provider returned an invalid token response.');
  }
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : undefined;
  const scope = typeof value.scope === 'string' ? value.scope : requestedScope;
  return {
    access_token: value.access_token,
    refresh_token: typeof value.refresh_token === 'string' ? value.refresh_token : undefined,
    expires_at: expiresIn === undefined ? undefined : Date.now() + expiresIn * 1_000,
    token_type: typeof value.token_type === 'string' ? value.token_type : 'Bearer',
    token_endpoint: metadata.token_endpoint,
    client_id: client.client_id,
    client_secret: client.client_secret,
    scope,
  };
}

async function persistTokensOnDaemon(serverId: string, tokens: OAuthTokens): Promise<void> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  await getBackendClient().request('mcp.oauth.set', { serverId, tokenBag: tokens });
}

async function deleteTokensOnDaemon(serverId: string): Promise<void> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  await getBackendClient().request('mcp.oauth.delete', { serverId });
}

export async function clearMcpOAuthTokens(serverId: string): Promise<void> {
  tokenStore.delete(serverId);
  try {
    await deleteTokensOnDaemon(serverId);
  } catch (error) {
    logger.error('Failed to delete MCP OAuth tokens from the daemon', error);
  }
}

function startCallbackServer(
  handleCallback: (params: URLSearchParams) => Promise<void>,
): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<void>((done, failed) => {
      resolveCompletion = done;
      rejectCompletion = failed;
    });
    const server = createServer((request, response) => {
      void (async () => {
        try {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/callback') {
            response.statusCode = 404;
            response.end();
            return;
          }
          await handleCallback(url.searchParams);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(m.mcp_oauth_callbackComplete_message());
          settled = true;
          resolveCompletion();
        } catch (error) {
          response.statusCode = 400;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(m.mcp_oauth_callbackFailed_message());
          settled = true;
          rejectCompletion(error instanceof Error ? error : new Error('OAuth callback failed.'));
        } finally {
          if (settled) server.close();
        }
      })();
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      rejectCompletion(new Error('OAuth sign-in timed out.'));
    }, CALLBACK_TIMEOUT_MS);
    timeout.unref?.();
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        clearTimeout(timeout);
        server.close();
        reject(new Error('Could not start the OAuth callback server.'));
        return;
      }
      resolve({
        server,
        port: address.port,
        completion: completion.finally(() => clearTimeout(timeout)),
        close: () => {
          clearTimeout(timeout);
          server.close();
        },
      });
    });
  });
}

export async function initiateMcpOAuth(
  serverId: string,
  serverUrl: string,
): Promise<InitiateOAuthResult> {
  let callbackServer: CallbackServer | undefined;
  try {
    const resourceMetadata = await discoverProtectedResource(serverUrl);
    const metadata = await discoverAuthorizationServer(resourceMetadata.authorization_servers[0]);
    let callbackContext:
      | {
          client: OAuthClient;
          verifier: string;
          state: string;
          redirectUri: string;
          scope?: string;
        }
      | undefined;
    let tokens: OAuthTokens | undefined;
    callbackServer = await startCallbackServer(async (params) => {
      const error = params.get('error');
      if (error) throw new Error(params.get('error_description') || 'OAuth authorization failed.');
      const code = params.get('code');
      if (!code || !callbackContext) throw new Error('The OAuth callback was incomplete.');
      if (params.get('state') !== callbackContext.state) {
        throw new Error('OAuth state verification failed.');
      }
      tokens = await exchangeCode(
        metadata,
        callbackContext.client,
        code,
        callbackContext.redirectUri,
        callbackContext.verifier,
        resourceMetadata.resource,
        callbackContext.scope,
      );
    });
    const redirectUri = `http://127.0.0.1:${callbackServer.port}/callback`;
    const client = await registerClient(metadata, redirectUri);
    const verifier = randomBase64Url(32);
    const state = randomBase64Url(16);
    const scope = (resourceMetadata.scopes_supported ?? metadata.scopes_supported)?.join(' ');
    callbackContext = { client, verifier, state, redirectUri, scope };
    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', client.client_id);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge(verifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('resource', resourceMetadata.resource);
    if (scope) authorizationUrl.searchParams.set('scope', scope);
    await shell.openExternal(authorizationUrl.toString());
    await callbackServer.completion;
    if (!tokens) throw new Error('OAuth sign-in did not return tokens.');
    await persistTokensOnDaemon(serverId, tokens);
    tokenStore.set(serverId, tokens);
    return { success: true };
  } catch (error) {
    logger.error('MCP OAuth sign-in failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : m.mcp_oauth_signInFailed_error(),
    };
  } finally {
    callbackServer?.close();
  }
}

export async function getMcpOAuthTokensAsync(serverId: string): Promise<OAuthTokens | null> {
  return tokenStore.get(serverId) ?? null;
}

export async function getMcpAuthHeaderAsync(serverId: string): Promise<string | null> {
  const tokens = tokenStore.get(serverId);
  if (!tokens) return null;
  const tokenType = tokens.token_type.toLowerCase() === 'bearer' ? 'Bearer' : tokens.token_type;
  return `${tokenType} ${tokens.access_token}`;
}
