import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

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

interface DiscoveryOverrides {
  resource?: string;
  authorizationServer?: string;
  metadataIssuer?: string;
  authorizationEndpoint?: string;
  authorizationResponseIssuerSupported?: boolean;
  tokenEndpointAuthMethods?: string[];
  registrationStatus?: number;
  registrationClient?: Record<string, unknown>;
  includeChallengeMetadata?: boolean;
}

function stubDiscovery(overrides: DiscoveryOverrides = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
      if (url === 'https://mcp.example.com/mcp') {
        const challenge =
          overrides.includeChallengeMetadata === false
            ? 'Bearer'
            : 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"';
        return new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': challenge },
        });
      }
      if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
        return Response.json({
          resource: overrides.resource ?? 'https://mcp.example.com/mcp',
          authorization_servers: [overrides.authorizationServer ?? 'https://auth.example.com'],
        });
      }
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: overrides.metadataIssuer ?? 'https://auth.example.com',
          authorization_endpoint:
            overrides.authorizationEndpoint ?? 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: overrides.tokenEndpointAuthMethods,
          authorization_response_iss_parameter_supported:
            overrides.authorizationResponseIssuerSupported,
        });
      }
      if (url === 'https://auth.example.com/register') {
        const status = overrides.registrationStatus ?? 201;
        return status === 201
          ? Response.json(overrides.registrationClient ?? { client_id: 'intent-client' }, {
              status,
            })
          : new Response(null, { status });
      }
      if (url === 'https://auth.example.com/token') {
        return Response.json({ access_token: 'access-value', token_type: 'Bearer' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

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
          authorization_response_iss_parameter_supported: true,
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
      const response = await realFetch(
        `${redirectUri}?code=authorization-code&state=${state}&iss=https%3A%2F%2Fauth.example.com`,
      );
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
      client_name: 'Intent',
      client_uri: 'https://intentapp.dev',
      redirect_uris: [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)],
      token_endpoint_auth_method: 'none',
    });
    expect(tokenBody?.has('client_secret')).toBe(false);
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

  it('registers Intent with client_secret_post for Figma metadata and uses the DCR secret', async () => {
    const clientSecret = randomBytes(32).toString('base64url');
    let authorizationUrl: URL | undefined;
    let registrationBody: Record<string, unknown> | undefined;
    let tokenBody: URLSearchParams | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      switch (String(input)) {
        case 'https://mcp.figma.com/mcp':
          return new Response(null, {
            status: 401,
            headers: {
              'WWW-Authenticate':
                'Bearer resource_metadata="https://mcp.figma.com/.well-known/oauth-protected-resource"',
            },
          });
        case 'https://mcp.figma.com/.well-known/oauth-protected-resource':
          return Response.json({
            resource: 'https://mcp.figma.com/mcp',
            authorization_servers: ['https://api.figma.com'],
            scopes_supported: ['mcp:connect'],
          });
        case 'https://api.figma.com/.well-known/oauth-authorization-server':
          return Response.json({
            issuer: 'https://api.figma.com',
            authorization_endpoint: 'https://www.figma.com/oauth/mcp',
            token_endpoint: 'https://api.figma.com/v1/oauth/token',
            registration_endpoint: 'https://api.figma.com/v1/oauth/mcp/register',
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            code_challenge_methods_supported: ['S256'],
            authorization_response_iss_parameter_supported: true,
          });
        case 'https://api.figma.com/v1/oauth/mcp/register':
          registrationBody = JSON.parse(String(init?.body));
          return Response.json(
            {
              client_id: 'intent-figma-client',
              client_secret: clientSecret,
              token_endpoint_auth_method: 'client_secret_post',
            },
            { status: 201 },
          );
        case 'https://api.figma.com/v1/oauth/token':
          tokenBody = new URLSearchParams(String(init?.body));
          expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
          return Response.json({ access_token: 'access-value', refresh_token: 'refresh-value' });
        default:
          throw new Error(`Unexpected fetch: ${String(input)}`);
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    openExternalMock.mockImplementationOnce(async (value: string) => {
      authorizationUrl = new URL(value);
      const callback = new URL(authorizationUrl.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({
        code: 'authorization-code',
        state: authorizationUrl.searchParams.get('state')!,
        iss: 'https://api.figma.com',
      }).toString();
      expect((await realFetch(callback)).status).toBe(200);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    await expect(initiateMcpOAuth('srv-figma', 'https://mcp.figma.com/mcp')).resolves.toEqual({
      success: true,
    });

    expect(registrationBody).toEqual({
      client_name: 'Intent',
      client_uri: 'https://intentapp.dev',
      redirect_uris: [expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(`${authorizationUrl?.origin}${authorizationUrl?.pathname}`).toBe(
      'https://www.figma.com/oauth/mcp',
    );
    expect(authorizationUrl?.searchParams.get('scope')).toBe('mcp:connect');
    expect(authorizationUrl?.searchParams.get('resource')).toBe('https://mcp.figma.com/mcp');
    expect(authorizationUrl?.searchParams.has('client_secret')).toBe(false);
    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(tokenBody!.get('code_verifier')!).digest('base64url'),
    );
    expect(Object.fromEntries(tokenBody!)).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: authorizationUrl?.searchParams.get('redirect_uri'),
      client_id: 'intent-figma-client',
      client_secret: clientSecret,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      resource: 'https://mcp.figma.com/mcp',
    });
    expect(requestMock).toHaveBeenCalledExactlyOnceWith('mcp.oauth.set', {
      serverId: 'srv-figma',
      tokenBag: {
        access_token: 'access-value',
        refresh_token: 'refresh-value',
        expires_at: undefined,
        token_type: 'Bearer',
        token_endpoint: 'https://api.figma.com/v1/oauth/token',
        client_id: 'intent-figma-client',
        client_secret: clientSecret,
        scope: 'mcp:connect',
      },
    });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
    }
  });

  it.each([
    { methods: undefined, selected: 'none' },
    { methods: ['none'], selected: 'none' },
    { methods: ['client_secret_basic', 'none'], selected: 'none' },
    { methods: ['client_secret_post'], selected: 'client_secret_post' },
    { methods: ['none', 'client_secret_post'], selected: 'client_secret_post' },
  ])('requests $selected for advertised methods $methods', async ({ methods, selected }) => {
    stubDiscovery({ tokenEndpointAuthMethods: methods, registrationStatus: 403 });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-provider', 'https://mcp.example.com/mcp');

    const registrations = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/register'));
    expect(registrations).toHaveLength(1);
    expect(JSON.parse(String(registrations[0][1]?.body))).toMatchObject({
      client_name: 'Intent',
      client_uri: 'https://intentapp.dev',
      token_endpoint_auth_method: selected,
    });
    expect(result).toEqual({ success: false, error: m.mcp_oauth_registrationRestricted_error() });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    { methods: ['client_secret_basic'] },
    { methods: ['private_key_jwt'] },
    { methods: [] },
  ])('rejects unsupported method metadata $methods before registration', async ({ methods }) => {
    stubDiscovery({ tokenEndpointAuthMethods: methods });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-provider', 'https://mcp.example.com/mcp');

    expect(result).toEqual({
      success: false,
      error: m.mcp_oauth_tokenAuthUnsupported_error(),
    });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/register'))).toBe(
      false,
    );
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', secret: undefined },
    { label: 'empty', secret: '' },
    { label: 'null', secret: null },
    { label: 'non-string', secret: 42 },
  ])('rejects a $label client_secret for client_secret_post before consent', async ({ secret }) => {
    stubDiscovery({
      tokenEndpointAuthMethods: ['client_secret_post'],
      registrationClient: { client_id: 'intent-client', client_secret: secret },
    });
    openExternalMock.mockRejectedValueOnce(new Error('Unexpected browser launch'));
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-provider', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/registration/i) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/token'))).toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects protected-resource metadata for a different resource', async () => {
    stubDiscovery({ resource: 'https://attacker.example/mcp' });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/resource/i) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('validates resource identity for well-known metadata fallback', async () => {
    stubDiscovery({
      includeChallengeMetadata: false,
      resource: 'https://attacker.example/mcp',
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/resource/i) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects authorization metadata for a different issuer', async () => {
    stubDiscovery({ metadataIssuer: 'https://attacker.example' });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/issuer/i) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects an issuer with a query before fetching authorization metadata', async () => {
    stubDiscovery({ authorizationServer: 'https://auth.example.com?tenant=one' });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/query/i) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects an authorization endpoint that does not use HTTPS', async () => {
    stubDiscovery({ authorizationEndpoint: 'intent-test://authorize' });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/HTTPS/) });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('validates the authorization response issuer when the provider supports it', async () => {
    stubDiscovery({ authorizationResponseIssuerSupported: true });
    openExternalMock.mockImplementationOnce(async (value: string) => {
      const authorizationUrl = new URL(value);
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const state = authorizationUrl.searchParams.get('state')!;
      const response = await realFetch(
        `${redirectUri}?code=authorization-code&state=${state}&iss=https%3A%2F%2Fattacker.example`,
      );
      expect(response.status).toBe(400);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/issuer/i) });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('requires an authorization response issuer when the provider advertises it', async () => {
    stubDiscovery({ authorizationResponseIssuerSupported: true });
    openExternalMock.mockImplementationOnce(async (value: string) => {
      const authorizationUrl = new URL(value);
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const state = authorizationUrl.searchParams.get('state')!;
      const response = await realFetch(`${redirectUri}?code=authorization-code&state=${state}`);
      expect(response.status).toBe(400);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/issuer/i) });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects an OAuth error response from a different issuer', async () => {
    stubDiscovery({ authorizationResponseIssuerSupported: true });
    openExternalMock.mockImplementationOnce(async (value: string) => {
      const authorizationUrl = new URL(value);
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const state = authorizationUrl.searchParams.get('state')!;
      const response = await realFetch(
        `${redirectUri}?error=access_denied&state=${state}&iss=https%3A%2F%2Fattacker.example`,
      );
      expect(response.status).toBe(400);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/issuer/i) });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('handles an OAuth error response after validating its matching issuer', async () => {
    stubDiscovery({ authorizationResponseIssuerSupported: true });
    openExternalMock.mockImplementationOnce(async (value: string) => {
      const authorizationUrl = new URL(value);
      const redirectUri = authorizationUrl.searchParams.get('redirect_uri')!;
      const state = authorizationUrl.searchParams.get('state')!;
      const response = await realFetch(
        `${redirectUri}?error=access_denied&error_description=User%20cancelled&state=${state}&iss=https%3A%2F%2Fauth.example.com`,
      );
      expect(response.status).toBe(400);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toEqual({ success: false, error: 'User cancelled' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('rejects an OAuth error response with a mismatched state', async () => {
    stubDiscovery({ authorizationResponseIssuerSupported: true });
    openExternalMock.mockImplementationOnce(async (value: string) => {
      const redirectUri = new URL(value).searchParams.get('redirect_uri')!;
      const response = await realFetch(
        `${redirectUri}?error=access_denied&state=wrong&iss=https%3A%2F%2Fauth.example.com`,
      );
      expect(response.status).toBe(400);
    });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/state/i) });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('appends OIDC discovery to an authorization server path issuer', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://mcp.example.com/mcp') {
        return new Response(null, { status: 401 });
      }
      if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
        return Response.json({
          resource: 'https://mcp.example.com/mcp',
          authorization_servers: ['https://auth.example.com/tenant'],
        });
      }
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server/tenant') {
        return new Response(null, { status: 404 });
      }
      if (url === 'https://auth.example.com/tenant/.well-known/openid-configuration') {
        return Response.json({
          issuer: 'https://auth.example.com/tenant',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
        });
      }
      if (url === 'https://auth.example.com/register') {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example.com/tenant/.well-known/openid-configuration',
      expect.any(Object),
    );
    expect(result).toEqual({
      success: false,
      error: m.mcp_oauth_registrationRestricted_error(),
    });
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('reports provider-restricted dynamic registration without opening sign-in', async () => {
    stubDiscovery({ registrationStatus: 403 });
    const { initiateMcpOAuth } = await import('../main/mcp-oauth');

    const result = await initiateMcpOAuth('srv-figma', 'https://mcp.example.com/mcp');

    expect(result).toEqual({
      success: false,
      error: m.mcp_oauth_registrationRestricted_error(),
    });
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
