import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for MCP OAuth token persistence (PROTOCOL.md §5.22).
 *
 * `mcp-oauth.ts` no longer touches `electron-store`; token bags are pushed to
 * the daemon via `mcp.oauth.set` / `mcp.oauth.delete`. The daemon never echoes
 * raw bag contents back over the wire (§5.22.1), so the module keeps an
 * in-memory cache for the current process lifetime — a restart drops it.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

const openExternalMock = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ shell: { openExternal: openExternalMock } }));

const realFetch = globalThis.fetch;

describe('mcp-oauth ↔ daemon mcp.oauth.* (PROTOCOL.md §5.22)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ serverId: 'srv-figma', value: '********' });
    openExternalMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('clearMcpOAuthTokens forwards to mcp.oauth.delete', async () => {
    const { clearMcpOAuthTokens } = await import('../main/mcp-oauth');
    await clearMcpOAuthTokens('srv-linear');
    expect(requestMock).toHaveBeenCalledWith('mcp.oauth.delete', {
      serverId: 'srv-linear',
    });
  });

  it('clearMcpOAuthTokens tolerates daemon failure', async () => {
    requestMock.mockRejectedValueOnce(new Error('daemon down'));
    const { clearMcpOAuthTokens } = await import('../main/mcp-oauth');
    await expect(clearMcpOAuthTokens('srv-linear')).resolves.toBeUndefined();
  });

  it('getMcpOAuthTokensAsync only reads the in-memory cache (no daemon round-trip)', async () => {
    const { getMcpOAuthTokensAsync } = await import('../main/mcp-oauth');
    const result = await getMcpOAuthTokensAsync('srv-unknown');
    expect(result).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('uses PKCE and persists the token bag under the daemon-assigned server id', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000);
    let authorizationUrl: URL | undefined;
    let registrationBody: Record<string, unknown> | undefined;
    let tokenBody: URLSearchParams | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
      if (url === 'https://mcp.example.com/mcp') {
        return new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
          },
        });
      }
      if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
        return Response.json({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://auth.example.com'],
          scopes_supported: ['mcp:read', 'mcp:write'],
        });
      }
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url === 'https://auth.example.com/register') {
        registrationBody = JSON.parse(String(init?.body));
        return Response.json({ client_id: 'intent-client' }, { status: 201 });
      }
      if (url === 'https://auth.example.com/token') {
        tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({
          access_token: 'access-value',
          refresh_token: 'refresh-value',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'mcp:read mcp:write',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    openExternalMock.mockImplementationOnce(async (value: string) => {
      authorizationUrl = new URL(value);
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const state = authorizationUrl.searchParams.get('state')!;
      const response = await realFetch(`${redirectUri}?code=authorization-code&state=${state}`);
      expect(response.status).toBe(200);
    });

    const { initiateMcpOAuth } = await import('../main/mcp-oauth');
    await expect(initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp')).resolves.toEqual({
      success: true,
    });

    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl?.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl?.searchParams.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(authorizationUrl?.searchParams.get('scope')).toBe('mcp:read mcp:write');
    expect(registrationBody).toMatchObject({
      redirect_uris: [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)],
      token_endpoint_auth_method: 'none',
    });
    expect(tokenBody?.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(tokenBody?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requestMock).toHaveBeenCalledExactlyOnceWith('mcp.oauth.set', {
      serverId: 'srv-figma',
      tokenBag: {
        access_token: 'access-value',
        refresh_token: 'refresh-value',
        expires_at: 1_750_003_600_000,
        token_type: 'bearer',
        token_endpoint: 'https://auth.example.com/token',
        client_id: 'intent-client',
        client_secret: undefined,
        scope: 'mcp:read mcp:write',
      },
    });
    now.mockRestore();
  });
});
