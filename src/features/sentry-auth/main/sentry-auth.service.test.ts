import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The service persists config via the daemon (`settings.update`); stub the
// dynamically imported client so tests never touch a socket.
const request = vi.fn().mockResolvedValue({});
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));

import { SentryAuthService } from './sentry-auth.service';

/** Build a Response-like object for the mocked `fetch`. */
function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}

const WIRE_ISSUE = {
  id: '1',
  shortId: 'WEB-1',
  title: 'TypeError',
  status: 'unresolved',
};

// PROTOCOL §5.29 pagination: `nextToken` carries Sentry's opaque `cursor`
// extracted from the REST `Link` response header, `null` on the last page.
describe('SentryAuthService Link-header pagination (§5.29)', () => {
  let service: SentryAuthService;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    service = new SentryAuthService();
    // Authenticate: saveConfig validates against /organizations/{org}/.
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'Acme' }));
    await service.saveConfig('acme', 'token-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts the next cursor from a rel="next"; results="true" Link segment', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([WIRE_ISSUE], {
        link:
          '<https://sentry.io/api/0/organizations/acme/issues/?cursor=100:-1:1>; rel="previous"; results="false"; cursor="100:-1:1", ' +
          '<https://sentry.io/api/0/organizations/acme/issues/?cursor=100:1:0>; rel="next"; results="true"; cursor="100:1:0"',
      }),
    );

    const page = await service.fetchIssues({ status: 'unresolved' });

    expect(page.issues).toHaveLength(1);
    expect(page.issues[0]).toMatchObject({ id: '1', shortId: 'WEB-1' });
    expect(page.nextToken).toBe('100:1:0');
  });

  it('folds a rel="next"; results="false" last page to nextToken: null', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([WIRE_ISSUE], {
        link:
          '<https://sentry.io/api/0/organizations/acme/issues/?cursor=100:-1:1>; rel="previous"; results="true"; cursor="100:-1:1", ' +
          '<https://sentry.io/api/0/organizations/acme/issues/?cursor=100:1:0>; rel="next"; results="false"; cursor="100:1:0"',
      }),
    );

    const page = await service.fetchIssues();
    expect(page.nextToken).toBeNull();
  });

  it('treats a missing Link header as the last page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([WIRE_ISSUE]));

    const page = await service.fetchIssues();
    expect(page.nextToken).toBeNull();
  });

  it('forwards request.nextToken as the cursor query param', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await service.fetchIssues({ status: 'unresolved', nextToken: '100:1:0' });

    const url = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('cursor=100%3A1%3A0');
  });

  it('searchIssues threads query/project/nextToken through fetchIssues', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([], {
        link: '<https://sentry.io/x?cursor=200:1:0>; rel="next"; results="true"; cursor="200:1:0"',
      }),
    );

    const page = await service.searchIssues('TypeError', 'web', { nextToken: '100:1:0' });

    const url = fetchMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('query=');
    expect(url).toContain('cursor=100%3A1%3A0');
    expect(page.nextToken).toBe('200:1:0');
  });

  it('degrades to an empty page when not authenticated', async () => {
    const fresh = new SentryAuthService();
    expect(await fresh.fetchIssues()).toEqual({ issues: [], nextToken: null });
  });
});
