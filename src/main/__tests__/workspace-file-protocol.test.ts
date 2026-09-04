import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * workspace-file://{workspaceId}/{percent-encoded-path} — URL validation and
 * the daemon-backed handler. Bytes come from `file.readChunk` (PROTOCOL §5.9:
 * params { workspaceId, path, offset, length } → { content (base64),
 * bytesRead, size }); the handler assembles multi-chunk reads and serves a
 * narrow image/video MIME allowlist (SVG excluded).
 *
 * Both this handler and workspace-asset:// (note assets via `note.readAsset`,
 * PROTOCOL §5.2) issue their RPC on the backend that owns the workspace
 * (monorepo#3501): the workspace's hosting window resolves to its stamped
 * backend's pooled client. The app-primary compatibility client is the
 * fallback when no hosting window is known (after a short retry for the
 * initial-navigation race) or when the stamped backend is the implicit local
 * one; a stamped named backend without a pooled client fails closed (404).
 *
 * A request whose URL carries the requesting window's backend (`?backend=`,
 * stamped by the `webRequest` redirect in `setupWorkspaceMediaBackendHinting`)
 * is served by that backend only — no window-map lookup, no ownership probe,
 * fail closed when it is disconnected.
 */

const {
  protocolHandle,
  onBeforeRequest,
  mockRequest,
  pooledRequests,
  windowBackends,
  workspaceWindows,
  webContentsWindows,
} = vi.hoisted(() => ({
  protocolHandle: vi.fn(),
  onBeforeRequest: vi.fn(),
  mockRequest: vi.fn(),
  /** backendId → pooled client `request` mock. */
  pooledRequests: new Map<string, ReturnType<typeof vi.fn>>(),
  /** windowId → stamped backendId. */
  windowBackends: new Map<number, string>(),
  /** workspaceId → hosting windowIds. */
  workspaceWindows: new Map<string, number[]>(),
  /** webContentsId → owning windowId (absent = not a BrowserWindow). */
  webContentsWindows: new Map<number, number>(),
}));

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app') },
  protocol: { handle: protocolHandle },
  session: { defaultSession: { webRequest: { onBeforeRequest } } },
  webContents: {
    fromId: (id: number) =>
      webContentsWindows.has(id) ? { id, isDestroyed: () => false } : undefined,
  },
  BrowserWindow: {
    fromId: (id: number) => (windowBackends.has(id) ? { id, isDestroyed: () => false } : null),
    fromWebContents: (contents: { id: number }) => {
      const windowId = webContentsWindows.get(contents.id);
      return windowId === undefined ? null : { id: windowId, isDestroyed: () => false };
    },
  },
}));

vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
  getBackendClientForConnection: (id: string) => {
    const request = pooledRequests.get(id);
    return request ? { request } : undefined;
  },
  getLiveBackendIds: () => [...pooledRequests.keys()],
}));

vi.mock('../../features/system/main/system.ipc', () => ({
  getWindowIdsForWorkspace: (workspaceId: string) => workspaceWindows.get(workspaceId) ?? [],
}));

vi.mock('../window-backend', () => ({
  getBackendIdForWindow: (window: { id: number }) => windowBackends.get(window.id) ?? 'local',
}));

import {
  imageMimeTypeForPath,
  parseWorkspaceFileRequest,
  parseWorkspaceMediaBackendHint,
  withWorkspaceMediaBackendHint,
  workspaceFileMimeTypeForPath,
} from '../utils/workspace-file-url';
import {
  createWorkspaceOwnershipProber,
  resolveWorkspaceBackendClient,
  resolveWorkspaceBackendClientWithRetry,
} from '../utils/workspace-backend-client';
import { JsonRpcError } from '../../features/backend/main/json-rpc-errors';
import {
  setupWorkspaceAssetProtocolHandler,
  setupWorkspaceFileProtocolHandler,
  setupWorkspaceMediaBackendHinting,
  WORKSPACE_FILE_CHUNK_BYTES,
  WORKSPACE_FILE_MAX_BYTES,
  workspaceMediaBackendRedirect,
} from '../protocol-handlers';

describe('imageMimeTypeForPath', () => {
  it('maps allowlisted image extensions case-insensitively', () => {
    expect(imageMimeTypeForPath('a/b.png')).toBe('image/png');
    expect(imageMimeTypeForPath('a/b.PNG')).toBe('image/png');
    expect(imageMimeTypeForPath('a.jpg')).toBe('image/jpeg');
    expect(imageMimeTypeForPath('a.jpeg')).toBe('image/jpeg');
    expect(imageMimeTypeForPath('a.gif')).toBe('image/gif');
    expect(imageMimeTypeForPath('a.webp')).toBe('image/webp');
  });

  it('returns null for everything else (SVG excluded in v1)', () => {
    expect(imageMimeTypeForPath('a.svg')).toBeNull();
    expect(imageMimeTypeForPath('a.txt')).toBeNull();
    expect(imageMimeTypeForPath('a.png.html')).toBeNull();
    expect(imageMimeTypeForPath('no-extension')).toBeNull();
  });
});

describe('workspaceFileMimeTypeForPath', () => {
  it('preserves the image allowlist and adds only MP4 and WebM video', () => {
    expect(workspaceFileMimeTypeForPath('preview.PNG')).toBe('image/png');
    expect(workspaceFileMimeTypeForPath('preview.mp4')).toBe('video/mp4');
    expect(workspaceFileMimeTypeForPath('preview.WEBM')).toBe('video/webm');
    expect(workspaceFileMimeTypeForPath('preview.mov')).toBeNull();
    expect(workspaceFileMimeTypeForPath('preview.ogg')).toBeNull();
    expect(workspaceFileMimeTypeForPath('preview.svg')).toBeNull();
  });
});

describe('parseWorkspaceFileRequest', () => {
  it('accepts a nested percent-encoded image path', () => {
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png');
    expect(parsed).toEqual({
      ok: true,
      workspaceId: 'ws-1',
      filePath: 'docs/my pic.png',
      mimeType: 'image/png',
      backendId: null,
    });
  });

  it('accepts the backend hint without leaking it into the daemon path', () => {
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png?backend=conn-b'),
    ).toEqual({
      ok: true,
      workspaceId: 'ws-1',
      filePath: 'docs/my pic.png',
      mimeType: 'image/png',
      backendId: 'conn-b',
    });
    // The hint must not defeat the raw-segment traversal check.
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/docs%2F..%2Fsecret.png?backend=conn-b'),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('accepts the cache-busting token alone or with the backend hint in either order', () => {
    const expected = {
      ok: true,
      workspaceId: 'ws-1',
      filePath: 'docs/my pic.png',
      mimeType: 'image/png',
    };
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png?v=abc-1')).toEqual({
      ...expected,
      backendId: null,
    });
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png?v=abc-1&backend=conn-b'),
    ).toEqual({ ...expected, backendId: 'conn-b' });
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png?backend=conn-b&v=abc-1'),
    ).toEqual({ ...expected, backendId: 'conn-b' });
    // The token must not defeat the raw-segment traversal check.
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/docs%2F..%2Fsecret.png?v=abc-1'),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects any other query string, including a duplicated or malformed hint', () => {
    for (const query of [
      '?download=1',
      '?backend=conn-b&download=1',
      '?backend=conn-b&backend=conn-c',
      '?backend=',
      '?backend=conn%2Fb',
      '?backend=conn-b#frag',
      '?v=',
      '?v=a&v=b',
      '?v=a%2Fb',
      '?v=abc-1&download=1',
      '?v=abc-1#frag',
    ]) {
      expect(parseWorkspaceFileRequest(`workspace-file://ws-1/a.png${query}`)).toMatchObject({
        ok: false,
        status: 400,
      });
    }
  });

  it('accepts only allowlisted video paths with the correct MIME type', () => {
    expect(parseWorkspaceFileRequest('workspace-file://ws-2/artifacts/demo%20clip.mp4')).toEqual({
      ok: true,
      workspaceId: 'ws-2',
      filePath: 'artifacts/demo clip.mp4',
      mimeType: 'video/mp4',
      backendId: null,
    });
    expect(parseWorkspaceFileRequest('workspace-file://ws-2/artifacts/demo.webm')).toMatchObject({
      ok: true,
      workspaceId: 'ws-2',
      mimeType: 'video/webm',
    });
  });

  it('rejects traversal segments with 403 (encoded slashes bypass URL dot-segment normalization)', () => {
    // Plain and percent-encoded dot segments are consumed by WHATWG URL
    // parsing, but `%2F..%2F` survives it and decodes to `../` client-side.
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/a%2F..%2Fsecret.png');
    expect(parsed).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects plain dot segments before URL normalization can hide them', () => {
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/a/../../b.png');
    expect(parsed).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects percent-encoded dot segments before URL normalization can hide them', () => {
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/%2e%2e/secret.png')).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/a/%2e%2e/%2e%2e/secret.png'),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects non-allowlisted extensions with 415', () => {
    for (const p of ['a.svg', 'a.txt', 'a']) {
      expect(parseWorkspaceFileRequest(`workspace-file://ws-1/${p}`)).toMatchObject({
        ok: false,
        status: 415,
      });
    }
  });

  it('rejects malformed inputs with 400', () => {
    // Empty path, missing host, bad percent-encoding, null byte, backslash.
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/')).toMatchObject({ status: 400 });
    expect(parseWorkspaceFileRequest('workspace-file:///a.png')).toMatchObject({ status: 400 });
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/%ZZ.png')).toMatchObject({
      status: 400,
    });
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/a%00.png')).toMatchObject({
      status: 400,
    });
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/a%5Cb.png')).toMatchObject({
      status: 400,
    });
    expect(parseWorkspaceFileRequest('not a url')).toMatchObject({ status: 400 });
    expect(parseWorkspaceFileRequest('https://ws-1/a.png')).toMatchObject({ status: 400 });
    expect(parseWorkspaceFileRequest('workspace-file://user@ws-1/a.png')).toMatchObject({
      status: 400,
    });
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/a.png?download=1')).toMatchObject({
      status: 400,
    });
  });
});

describe('parseWorkspaceMediaBackendHint', () => {
  it('treats an empty query as unhinted and accepts one well-formed backend param', () => {
    expect(parseWorkspaceMediaBackendHint('')).toEqual({ ok: true, backendId: null });
    expect(parseWorkspaceMediaBackendHint('?backend=local')).toEqual({
      ok: true,
      backendId: 'local',
    });
    expect(parseWorkspaceMediaBackendHint('?backend=6f1c2d3e-0000-4000-8000-000000000000')).toEqual(
      { ok: true, backendId: '6f1c2d3e-0000-4000-8000-000000000000' },
    );
  });

  it('accepts one cache-busting token, alone or combined with the backend hint', () => {
    expect(parseWorkspaceMediaBackendHint('?v=m1abc-2')).toEqual({ ok: true, backendId: null });
    expect(parseWorkspaceMediaBackendHint('?v=m1abc-2&backend=local')).toEqual({
      ok: true,
      backendId: 'local',
    });
    expect(parseWorkspaceMediaBackendHint('?backend=local&v=m1abc-2')).toEqual({
      ok: true,
      backendId: 'local',
    });
  });

  it('rejects arbitrary, duplicated, empty, or malformed parameters', () => {
    for (const query of [
      '?x=1',
      '?backend=a&x=1',
      '?backend=a&backend=b',
      '?backend=',
      '?backend=a b',
      '?v=',
      '?v=a&v=b',
      '?v=a b',
      '?v=a&x=1',
      '?v=a&backend=a&backend=b',
    ]) {
      expect(parseWorkspaceMediaBackendHint(query)).toMatchObject({ ok: false });
    }
  });
});

describe('withWorkspaceMediaBackendHint', () => {
  it('stamps unhinted workspace media URLs of both schemes', () => {
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a%20b.png', 'conn-b')).toBe(
      'workspace-file://ws-1/a%20b.png?backend=conn-b',
    );
    expect(withWorkspaceMediaBackendHint('workspace-asset://ws-1/asset-1', 'local')).toBe(
      'workspace-asset://ws-1/asset-1?backend=local',
    );
  });

  it('appends the hint after a renderer cache-busting token', () => {
    expect(
      withWorkspaceMediaBackendHint('workspace-file://ws-1/a%20b.png?v=m1abc-2', 'conn-b'),
    ).toBe('workspace-file://ws-1/a%20b.png?v=m1abc-2&backend=conn-b');
  });

  it('overwrites a hint naming another backend, preserving the cache-busting token', () => {
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png?backend=x', 'y')).toBe(
      'workspace-file://ws-1/a.png?backend=y',
    );
    expect(
      withWorkspaceMediaBackendHint('workspace-file://ws-1/a%20b.png?v=m1abc-2&backend=x', 'y'),
    ).toBe('workspace-file://ws-1/a%20b.png?v=m1abc-2&backend=y');
    expect(
      withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png?backend=x&v=m1abc-2', 'y'),
    ).toBe('workspace-file://ws-1/a.png?v=m1abc-2&backend=y');
    expect(withWorkspaceMediaBackendHint('workspace-asset://ws-1/asset-1?backend=x', 'local')).toBe(
      'workspace-asset://ws-1/asset-1?backend=local',
    );
  });

  it('leaves matching hints, fragments, other schemes, unknown queries, and bad backend ids alone', () => {
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png?backend=y', 'y')).toBeNull();
    expect(
      withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png?v=m1abc-2&backend=y', 'y'),
    ).toBeNull();
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png#f', 'y')).toBeNull();
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png?x=1', 'y')).toBeNull();
    expect(withWorkspaceMediaBackendHint('https://ws-1/a.png', 'y')).toBeNull();
    expect(withWorkspaceMediaBackendHint('workspace-file://ws-1/a.png', 'a b')).toBeNull();
  });
});

describe('workspaceMediaBackendRedirect', () => {
  beforeEach(() => {
    windowBackends.clear();
    webContentsWindows.clear();
    onBeforeRequest.mockReset();
  });

  it('registers a webRequest listener scoped to the two workspace media schemes', () => {
    setupWorkspaceMediaBackendHinting();
    expect(onBeforeRequest).toHaveBeenCalledTimes(1);
    const [filter, listener] = onBeforeRequest.mock.calls[0];
    expect(filter).toEqual({ urls: ['workspace-file://*/*', 'workspace-asset://*/*'] });

    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    const callback = vi.fn();
    listener({ url: 'workspace-file://ws-1/a.png', webContentsId: 42 }, callback);
    expect(callback).toHaveBeenCalledWith({
      redirectURL: 'workspace-file://ws-1/a.png?backend=conn-b',
    });
  });

  it('redirects to the same URL stamped with the owning window backend', () => {
    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    expect(workspaceMediaBackendRedirect('workspace-asset://ws-1/asset-1', 42)).toEqual({
      redirectURL: 'workspace-asset://ws-1/asset-1?backend=conn-b',
    });
  });

  it('passes through when there is no window to attribute the request to', () => {
    expect(workspaceMediaBackendRedirect('workspace-file://ws-1/a.png', undefined)).toEqual({});
    expect(workspaceMediaBackendRedirect('workspace-file://ws-1/a.png', 99)).toEqual({});
  });

  it('never re-stamps a URL already hinted with the requester backend (no redirect loop)', () => {
    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    expect(workspaceMediaBackendRedirect('workspace-file://ws-1/a.png?backend=conn-b', 42)).toEqual(
      {},
    );
    expect(
      workspaceMediaBackendRedirect('workspace-file://ws-1/a.png?v=m1abc-2&backend=conn-b', 42),
    ).toEqual({});
  });

  it('overwrites a hint naming another backend with the requester backend', () => {
    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    expect(
      workspaceMediaBackendRedirect('workspace-file://ws-1/a.png?backend=conn-other', 42),
    ).toEqual({ redirectURL: 'workspace-file://ws-1/a.png?backend=conn-b' });
    expect(
      workspaceMediaBackendRedirect('workspace-asset://ws-1/asset-1?backend=conn-other', 42),
    ).toEqual({ redirectURL: 'workspace-asset://ws-1/asset-1?backend=conn-b' });
  });

  it('preserves the cache-busting token when overwriting a foreign hint, then settles', () => {
    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    const first = workspaceMediaBackendRedirect(
      'workspace-file://ws-1/a.png?v=m1abc-2&backend=conn-other',
      42,
    );
    expect(first).toEqual({ redirectURL: 'workspace-file://ws-1/a.png?v=m1abc-2&backend=conn-b' });
    expect(workspaceMediaBackendRedirect(first.redirectURL!, 42)).toEqual({});
  });

  it('passes a foreign hint through when there is no window to attribute the request to', () => {
    expect(
      workspaceMediaBackendRedirect('workspace-file://ws-1/a.png?backend=conn-other', undefined),
    ).toEqual({});
  });

  it('stamps a cache-busted URL exactly once, preserving the token', () => {
    windowBackends.set(7, 'conn-b');
    webContentsWindows.set(42, 7);
    const first = workspaceMediaBackendRedirect('workspace-file://ws-1/a.png?v=m1abc-2', 42);
    expect(first).toEqual({ redirectURL: 'workspace-file://ws-1/a.png?v=m1abc-2&backend=conn-b' });
    expect(workspaceMediaBackendRedirect(first.redirectURL!, 42)).toEqual({});
  });
});

function getHandler(): (request: Request) => Promise<Response> {
  setupWorkspaceFileProtocolHandler();
  const call = protocolHandle.mock.calls.find(([scheme]) => scheme === 'workspace-file');
  expect(call).toBeDefined();
  return call![1];
}

function getAssetHandler(): (request: Request) => Promise<Response> {
  setupWorkspaceAssetProtocolHandler();
  const call = protocolHandle.mock.calls.find(([scheme]) => scheme === 'workspace-asset');
  expect(call).toBeDefined();
  return call![1];
}

function chunk(bytes: Buffer, bytesRead: number, size: number) {
  return { content: bytes.toString('base64'), bytesRead, size };
}

function appRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { Origin: 'app://workspaces', ...headers } });
}

/** Bind `workspaceId` to a live pooled backend client and return its request mock. */
function bindWorkspaceToBackend(workspaceId: string, backendId: string, windowId = 7) {
  const request = vi.fn();
  pooledRequests.set(backendId, request);
  windowBackends.set(windowId, backendId);
  workspaceWindows.set(workspaceId, [windowId]);
  return request;
}

describe('resolveWorkspaceBackendClient', () => {
  const lookup = (overrides: {
    windows?: number[];
    backendOf?: (windowId: number) => string | null;
    clients?: Record<string, string>;
    fallbackAllowed?: (backendId: string) => boolean;
  }) => ({
    getWindowIdsForWorkspace: () => overrides.windows ?? [],
    getBackendIdForWindowId: overrides.backendOf ?? (() => null),
    getClientForBackend: (id: string) => overrides.clients?.[id],
    getPrimaryClient: () => 'primary',
    isPrimaryFallbackAllowed: overrides.fallbackAllowed ?? ((id: string) => id === 'local'),
  });

  it('picks the pooled client of the first hosting window with a live backend', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({
        windows: [1, 2],
        backendOf: (id) => (id === 1 ? 'conn-dead' : 'conn-2'),
        clients: { 'conn-2': 'pooled-2' },
      }),
    });
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2', fallback: null });
  });

  it('falls back to the primary client when no window hosts the workspace', () => {
    expect(resolveWorkspaceBackendClient('ws-1', lookup({}))).toEqual({
      client: 'primary',
      backendId: null,
      fallback: 'no-hosting-window',
      attemptedBackendIds: [],
    });
  });

  it('falls back to the primary client when an unpooled backend allows the fallback', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({ windows: [1], backendOf: () => 'local' }),
    });
    expect(resolved).toEqual({
      client: 'primary',
      backendId: null,
      fallback: 'unpooled-backend',
      attemptedBackendIds: ['local'],
    });
  });

  it('fails closed when the stamped backend is disconnected and not fallback-eligible', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({ windows: [1], backendOf: () => 'conn-gone' }),
    });
    expect(resolved).toEqual({
      client: null,
      backendId: 'conn-gone',
      fallback: 'backend-disconnected',
      attemptedBackendIds: ['conn-gone'],
    });
  });

  it('skips dead windows (null backend id)', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({
        windows: [1, 2],
        backendOf: (id) => (id === 1 ? null : 'conn-2'),
        clients: { 'conn-2': 'pooled-2' },
      }),
    });
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2', fallback: null });
  });

  describe('with a backend hint', () => {
    /** ws-1 hosted by two windows bound to backends A and B, both live. */
    const collision = () =>
      lookup({
        windows: [1, 2],
        backendOf: (id) => (id === 1 ? 'conn-a' : 'conn-b'),
        clients: { 'conn-a': 'pooled-a', 'conn-b': 'pooled-b' },
      });

    it('resolves to the hinted backend even when another hosting backend is live first', () => {
      const onAmbiguousHosting = vi.fn();
      expect(
        resolveWorkspaceBackendClient(
          'ws-1',
          { ...collision(), onAmbiguousHosting },
          { backendIdHint: 'conn-b' },
        ),
      ).toEqual({ client: 'pooled-b', backendId: 'conn-b', fallback: null });
      expect(onAmbiguousHosting).not.toHaveBeenCalled();
    });

    it('fails closed when the hinted backend is disconnected instead of using backend A', () => {
      expect(
        resolveWorkspaceBackendClient(
          'ws-1',
          lookup({
            windows: [1, 2],
            backendOf: (id) => (id === 1 ? 'conn-a' : 'conn-b'),
            clients: { 'conn-a': 'pooled-a' },
          }),
          { backendIdHint: 'conn-b' },
        ),
      ).toEqual({
        client: null,
        backendId: 'conn-b',
        fallback: 'backend-disconnected',
        attemptedBackendIds: ['conn-b'],
      });
    });

    it('ignores the window map entirely: an unhosted workspace still resolves to the hint', () => {
      const getWindowIdsForWorkspace = vi.fn(() => []);
      expect(
        resolveWorkspaceBackendClient(
          'ws-1',
          { ...lookup({ clients: { 'conn-b': 'pooled-b' } }), getWindowIdsForWorkspace },
          { backendIdHint: 'conn-b' },
        ),
      ).toEqual({ client: 'pooled-b', backendId: 'conn-b', fallback: null });
      expect(getWindowIdsForWorkspace).not.toHaveBeenCalled();
    });

    it('allows the primary fallback only for a fallback-eligible (local) hint', () => {
      expect(resolveWorkspaceBackendClient('ws-1', lookup({}), { backendIdHint: 'local' })).toEqual(
        {
          client: 'primary',
          backendId: null,
          fallback: 'unpooled-backend',
          attemptedBackendIds: ['local'],
        },
      );
    });

    it('reports multi-backend hosting only for unhinted requests', () => {
      const onAmbiguousHosting = vi.fn();
      const resolved = resolveWorkspaceBackendClient('ws-1', {
        ...collision(),
        onAmbiguousHosting,
      });
      expect(resolved).toEqual({ client: 'pooled-a', backendId: 'conn-a', fallback: null });
      expect(onAmbiguousHosting).toHaveBeenCalledWith('ws-1', ['conn-a', 'conn-b']);
    });

    it('does not report a single backend hosted by several windows as ambiguous', () => {
      const onAmbiguousHosting = vi.fn();
      resolveWorkspaceBackendClient('ws-1', {
        ...lookup({ windows: [1, 2], backendOf: () => 'conn-a', clients: { 'conn-a': 'p' } }),
        onAmbiguousHosting,
      });
      expect(onAmbiguousHosting).not.toHaveBeenCalled();
    });
  });
});

describe('resolveWorkspaceBackendClientWithRetry', () => {
  it('returns immediately (no sleep) when a hosting window is known', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolved = await resolveWorkspaceBackendClientWithRetry(
      'ws-1',
      {
        getWindowIdsForWorkspace: () => [1],
        getBackendIdForWindowId: () => 'conn-2',
        getClientForBackend: () => 'pooled-2',
        getPrimaryClient: () => 'primary',
        isPrimaryFallbackAllowed: () => false,
      },
      { attempts: 5, delayMs: 200, sleep },
    );
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2', fallback: null });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries while no hosting window is known and picks up a late-arriving mapping', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const windows: number[] = [];
    const resolvedPromise = resolveWorkspaceBackendClientWithRetry(
      'ws-1',
      {
        getWindowIdsForWorkspace: () => windows,
        getBackendIdForWindowId: () => 'conn-2',
        getClientForBackend: () => 'pooled-2',
        getPrimaryClient: () => 'primary',
        isPrimaryFallbackAllowed: () => false,
      },
      {
        attempts: 5,
        delayMs: 200,
        sleep: sleep.mockImplementation(async () => {
          if (sleep.mock.calls.length === 2) windows.push(1);
        }),
      },
    );
    const resolved = await resolvedPromise;
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2', fallback: null });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and returns the primary fallback', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolved = await resolveWorkspaceBackendClientWithRetry(
      'ws-1',
      {
        getWindowIdsForWorkspace: () => [],
        getBackendIdForWindowId: () => null,
        getClientForBackend: () => undefined,
        getPrimaryClient: () => 'primary',
        isPrimaryFallbackAllowed: () => false,
      },
      { attempts: 3, delayMs: 200, sleep },
    );
    expect(resolved).toMatchObject({ client: 'primary', fallback: 'no-hosting-window' });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a fail-closed (backend-disconnected) resolution', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolved = await resolveWorkspaceBackendClientWithRetry(
      'ws-1',
      {
        getWindowIdsForWorkspace: () => [1],
        getBackendIdForWindowId: () => 'conn-gone',
        getClientForBackend: () => undefined,
        getPrimaryClient: () => 'primary',
        isPrimaryFallbackAllowed: () => false,
      },
      { attempts: 5, delayMs: 200, sleep },
    );
    expect(resolved).toMatchObject({ client: null, fallback: 'backend-disconnected' });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('createWorkspaceOwnershipProber', () => {
  const proberLookup = (clients: Map<string, string>, owners: Set<string>) => ({
    getLiveBackendIds: () => [...clients.keys()],
    getClientForBackend: (id: string) => clients.get(id),
    confirmOwnership: vi.fn(async (client: string) => {
      if (client === 'client-broken') throw new Error('probe transport failed');
      return owners.has(client);
    }),
  });

  it('confirms the owning backend and caches it so repeat lookups skip probing', async () => {
    const clients = new Map([
      ['local', 'client-local'],
      ['conn-remote', 'client-remote'],
    ]);
    const lookup = proberLookup(clients, new Set(['client-remote']));
    const prober = createWorkspaceOwnershipProber(lookup);

    const first = await prober.probeOwner('ws-a');
    expect(first).toEqual({ client: 'client-remote', backendId: 'conn-remote' });
    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(2);

    const second = await prober.probeOwner('ws-a');
    expect(second).toEqual({ client: 'client-remote', backendId: 'conn-remote' });
    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(2);
  });

  it('returns null when no live backend confirms ownership and never caches the miss', async () => {
    const clients = new Map([['local', 'client-local']]);
    const lookup = proberLookup(clients, new Set());
    const prober = createWorkspaceOwnershipProber(lookup);

    expect(await prober.probeOwner('ws-a')).toBeNull();
    expect(await prober.probeOwner('ws-a')).toBeNull();
    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(2);
  });

  it('fails closed when multiple backends confirm ownership, reporting the collision uncached', async () => {
    const clients = new Map([
      ['conn-a', 'client-a'],
      ['conn-b', 'client-b'],
    ]);
    const onAmbiguousOwnership = vi.fn();
    const lookup = {
      ...proberLookup(clients, new Set(['client-a', 'client-b'])),
      onAmbiguousOwnership,
    };
    const prober = createWorkspaceOwnershipProber(lookup);

    expect(await prober.probeOwner('ws-a')).toBeNull();
    expect(onAmbiguousOwnership).toHaveBeenCalledWith('ws-a', ['conn-a', 'conn-b']);

    // Nothing cached: the next lookup re-probes (and fails closed again).
    expect(await prober.probeOwner('ws-a')).toBeNull();
    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(4);
    expect(onAmbiguousOwnership).toHaveBeenCalledTimes(2);
  });

  it('treats a rejecting probe on one backend as not-the-owner without killing resolution', async () => {
    const clients = new Map([
      ['conn-broken', 'client-broken'],
      ['conn-owner', 'client-owner'],
    ]);
    const lookup = proberLookup(clients, new Set(['client-owner']));
    const prober = createWorkspaceOwnershipProber(lookup);

    expect(await prober.probeOwner('ws-a')).toEqual({
      client: 'client-owner',
      backendId: 'conn-owner',
    });
  });

  it('self-invalidates a cached owner whose backend lost its live client', async () => {
    const clients = new Map([['conn-remote', 'client-remote']]);
    const lookup = proberLookup(clients, new Set(['client-remote']));
    const prober = createWorkspaceOwnershipProber(lookup);

    await prober.probeOwner('ws-a');
    clients.delete('conn-remote');

    expect(await prober.probeOwner('ws-a')).toBeNull();
  });

  it('re-probes from scratch after invalidate()', async () => {
    const clients = new Map([['conn-remote', 'client-remote']]);
    const lookup = proberLookup(clients, new Set(['client-remote']));
    const prober = createWorkspaceOwnershipProber(lookup);

    await prober.probeOwner('ws-a');
    prober.invalidate('ws-a');
    await prober.probeOwner('ws-a');

    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent probes for the same workspace into one fan-out', async () => {
    const clients = new Map([['conn-remote', 'client-remote']]);
    const lookup = proberLookup(clients, new Set(['client-remote']));
    const prober = createWorkspaceOwnershipProber(lookup);

    const [a, b] = await Promise.all([prober.probeOwner('ws-a'), prober.probeOwner('ws-a')]);

    expect(a).toEqual(b);
    expect(lookup.confirmOwnership).toHaveBeenCalledTimes(1);
  });
});

describe('setupWorkspaceFileProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
    pooledRequests.clear();
    windowBackends.clear();
    workspaceWindows.clear();
    // Stamp ws-1 to a local-backend window with no pooled client: the
    // resolution takes the immediate primary fallback (unpooled local), so
    // these tests exercise the primary client without the no-hosting-window
    // retry delay.
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-1', [7]);
  });

  it('rejects hostile, null, and arbitrary localhost origins before daemon access', async () => {
    const handler = getHandler();

    for (const origin of ['https://evil.example', 'null', 'http://localhost:5190']) {
      const res = await handler(
        new Request('workspace-file://ws-secret/images/pic.png', {
          headers: { Origin: origin },
        }),
      );
      expect(res.status).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('allows only the configured development renderer origin', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PORT', '5197');
    try {
      const bytes = Buffer.from('dev');
      mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

      const allowed = await getHandler()(
        new Request('workspace-file://ws-1/dev.png', {
          headers: { Origin: 'http://127.0.0.1:5197' },
        }),
      );
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5197');

      const denied = await getHandler()(
        new Request('workspace-file://ws-1/dev.png', {
          headers: { Origin: 'http://127.0.0.1:5198' },
        }),
      );
      expect(denied.status).toBe(403);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps origin-less media loads non-CORS-readable', async () => {
    const bytes = Buffer.from('image');
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(new Request('workspace-file://ws-1/direct.png'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('serves a single-chunk image with the exact file.readChunk wire params', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(appRequest('workspace-file://ws-1/images/pic.png'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws-1',
      path: 'images/pic.png',
      offset: 0,
      length: WORKSPACE_FILE_CHUNK_BYTES,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('app://workspaces');
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('serves a bounded MP4 byte range with correct playback headers', async () => {
    const allBytes = Buffer.from('0123456789');
    mockRequest
      .mockResolvedValueOnce(chunk(allBytes.subarray(0, 1), 1, allBytes.length))
      .mockResolvedValueOnce(chunk(allBytes.subarray(2, 6), 4, allBytes.length));

    const res = await getHandler()(
      appRequest('workspace-file://ws-1/artifacts/demo.mp4', { Range: 'bytes=2-5' }),
    );

    expect(mockRequest).toHaveBeenNthCalledWith(1, 'file.readChunk', {
      workspaceId: 'ws-1',
      path: 'artifacts/demo.mp4',
      offset: 0,
      length: 1,
    });
    expect(mockRequest).toHaveBeenNthCalledWith(2, 'file.readChunk', {
      workspaceId: 'ws-1',
      path: 'artifacts/demo.mp4',
      offset: 2,
      length: 4,
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('app://workspaces');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('2345');
  });

  it('supports WebM suffix ranges without reading outside the selected bytes', async () => {
    const allBytes = Buffer.from('0123456789');
    mockRequest
      .mockResolvedValueOnce(chunk(allBytes.subarray(0, 1), 1, allBytes.length))
      .mockResolvedValueOnce(chunk(allBytes.subarray(7), 3, allBytes.length));

    const res = await getHandler()(
      appRequest('workspace-file://ws-1/artifacts/demo.webm', { Range: 'bytes=-3' }),
    );

    expect(mockRequest.mock.calls[1][1]).toMatchObject({ offset: 7, length: 3 });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Type')).toBe('video/webm');
    expect(res.headers.get('Content-Range')).toBe('bytes 7-9/10');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('789');
  });

  it('rejects invalid and unsatisfiable ranges safely', async () => {
    const handler = getHandler();
    const invalid = await handler(
      appRequest('workspace-file://ws-1/demo.mp4', { Range: 'bytes=0-1,4-5' }),
    );
    expect(invalid.status).toBe(416);
    expect(mockRequest).not.toHaveBeenCalled();

    mockRequest.mockResolvedValueOnce(chunk(Buffer.from('x'), 1, 4));
    const unsatisfiable = await handler(
      appRequest('workspace-file://ws-1/demo.mp4', { Range: 'bytes=4-' }),
    );
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get('Content-Range')).toBe('bytes */4');
  });

  it('assembles multi-chunk reads by advancing offset until size is reached', async () => {
    const first = Buffer.from('first-half');
    const second = Buffer.from('second');
    const size = first.length + second.length;
    const concatSpy = vi.spyOn(Buffer, 'concat');
    mockRequest
      .mockResolvedValueOnce(chunk(first, first.length, size))
      .mockResolvedValueOnce(chunk(second, second.length, size));

    try {
      const res = await getHandler()(appRequest('workspace-file://ws-1/big.webp'));

      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(mockRequest.mock.calls[1][1]).toMatchObject({ offset: first.length });
      expect(concatSpy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/webp');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('first-halfsecond');
    } finally {
      concatSpy.mockRestore();
    }
  });

  it('serves an empty file as an empty 200 body', async () => {
    mockRequest.mockResolvedValueOnce({ content: '', bytesRead: 0, size: 0 });

    const res = await getHandler()(appRequest('workspace-file://ws-1/empty.gif'));

    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('rejects traversal and non-image URLs without issuing an RPC', async () => {
    const handler = getHandler();

    const traversal = await handler(appRequest('workspace-file://ws-1/a%2F..%2Fx.png'));
    expect(traversal.status).toBe(403);

    const nonImage = await handler(appRequest('workspace-file://ws-1/notes.md'));
    expect(nonImage.status).toBe(415);

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses oversized files with 413', async () => {
    const bytes = Buffer.from('x');
    mockRequest.mockResolvedValueOnce(chunk(bytes, 1, WORKSPACE_FILE_MAX_BYTES + 1));

    const res = await getHandler()(appRequest('workspace-file://ws-1/huge.jpeg'));

    expect(res.status).toBe(413);
  });

  it('maps daemon errors to 404', async () => {
    mockRequest.mockRejectedValueOnce(new Error('path is outside the workspace'));

    const res = await getHandler()(appRequest('workspace-file://ws-1/missing.png'));

    expect(res.status).toBe(404);
  });

  it('fails closed with 404 when bytesRead disagrees with the decoded content length', async () => {
    const bytes = Buffer.from('abcdef');
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length + 3, bytes.length + 3));

    const res = await getHandler()(appRequest('workspace-file://ws-1/spliced.png'));

    expect(res.status).toBe(404);
  });

  it('issues file.readChunk on the backend of the window hosting the workspace', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const remoteRequest = bindWorkspaceToBackend('ws-remote', 'conn-2');
    remoteRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(new Request('workspace-file://ws-remote/pic.png'));

    expect(remoteRequest).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws-remote',
      path: 'pic.png',
      offset: 0,
      length: WORKSPACE_FILE_CHUNK_BYTES,
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('falls back to the primary client when the local hosting backend has no pooled client', async () => {
    const bytes = Buffer.from('png-bytes');
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(new Request('workspace-file://ws-1/pic.png'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('fails closed with 404 when the hosting named backend is disconnected', async () => {
    windowBackends.set(7, 'conn-disconnected');
    workspaceWindows.set('ws-1', [7]);

    const res = await getHandler()(new Request('workspace-file://ws-1/pic.png'));

    expect(res.status).toBe(404);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rescues a disconnected-backend resolution by probing the live backends for the owner', async () => {
    // Stamped backend is gone, but the workspace's real owner is live in the
    // pool: the ownership probe (workspace.get) finds it and the read serves.
    windowBackends.set(7, 'conn-disconnected');
    workspaceWindows.set('ws-probe-bd', [7]);
    const bytes = Buffer.from('rescued-bytes');
    const remoteRequest = vi.fn(async (method: string) => {
      if (method === 'workspace.get') return { workspace: { id: 'ws-probe-bd' } };
      return chunk(bytes, bytes.length, bytes.length);
    });
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getHandler()(new Request('workspace-file://ws-probe-bd/pic.png'));

    expect(remoteRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-probe-bd' });
    expect(remoteRequest).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws-probe-bd',
      path: 'pic.png',
      offset: 0,
      length: WORKSPACE_FILE_CHUNK_BYTES,
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('heals a wrong-stamp read: primary refuses with workspace-unknown, confirmed owner serves', async () => {
    // The workspace resolves to the primary client (unpooled local stamp),
    // which does not know it — the daemon surfaces this from file.readChunk
    // as -32603 (root resolution fails; the router puts the cause in `data`):
    // the probe confirms the remote owner and the read retries there. Unique
    // workspace id: the module-level prober cache persists across tests.
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-heal-file', [7]);
    mockRequest.mockRejectedValueOnce(
      new JsonRpcError({
        code: -32603,
        message: 'Internal error',
        data: 'Access denied: path outside workspace',
      }),
    );
    const bytes = Buffer.from('healed-bytes');
    const remoteRequest = vi.fn(async (method: string) => {
      if (method === 'workspace.get') return { workspace: { id: 'ws-heal-file' } };
      return chunk(bytes, bytes.length, bytes.length);
    });
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getHandler()(appRequest('workspace-file://ws-heal-file/pic.png'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(remoteRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-heal-file' });
    expect(remoteRequest).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws-heal-file',
      path: 'pic.png',
      offset: 0,
      length: WORKSPACE_FILE_CHUNK_BYTES,
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('does not rescue a workspace-unknown failure after bytes were already assembled', async () => {
    // A mid-file rescue would splice chunks from two daemons into one body:
    // once any bytes are buffered, a workspace-unknown error is fatal (404).
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-midfile', [7]);
    const first = Buffer.alloc(WORKSPACE_FILE_CHUNK_BYTES, 1);
    mockRequest
      .mockResolvedValueOnce(chunk(first, first.length, first.length + 4))
      .mockRejectedValueOnce(
        new JsonRpcError({
          code: -32603,
          message: 'Internal error',
          data: 'Access denied: path outside workspace',
        }),
      );
    const remoteRequest = vi.fn(async () => ({ workspace: { id: 'ws-midfile' } }));
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getHandler()(appRequest('workspace-file://ws-midfile/big.png'));

    expect(res.status).toBe(404);
    expect(remoteRequest).not.toHaveBeenCalled();
  });

  it('keeps the 404 when no live backend confirms ownership of an unknown workspace', async () => {
    // Unique workspace id: the module-level prober cache persists across tests.
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-no-owner', [7]);
    mockRequest.mockRejectedValueOnce(
      new JsonRpcError({ code: -32602, message: 'workspace not found' }),
    );
    const remoteRequest = vi.fn(async () => {
      throw new JsonRpcError({ code: -32602, message: 'workspace not found' });
    });
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getHandler()(appRequest('workspace-file://ws-no-owner/pic.png'));

    expect(res.status).toBe(404);
    expect(remoteRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-no-owner' });
    expect(remoteRequest).toHaveBeenCalledTimes(1);
  });

  it('does not probe on non-workspace-unknown read errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('transport dropped'));
    const remoteRequest = vi.fn();
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getHandler()(appRequest('workspace-file://ws-1/pic.png'));

    expect(res.status).toBe(404);
    expect(remoteRequest).not.toHaveBeenCalled();
  });

  describe('with a backend hint', () => {
    it('serves from the hinted backend when the same workspace id is hosted on two backends', async () => {
      // Windows 1 and 2 both host ws-dup, bound to backends A and B (both
      // live); the request from window 2 carries B and must not read from A.
      const requestA = vi.fn();
      const bytes = Buffer.from('backend-b-bytes');
      const requestB = vi.fn().mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));
      pooledRequests.set('conn-a', requestA);
      pooledRequests.set('conn-b', requestB);
      windowBackends.set(1, 'conn-a');
      windowBackends.set(2, 'conn-b');
      workspaceWindows.set('ws-dup', [1, 2]);

      const res = await getHandler()(appRequest('workspace-file://ws-dup/pic.png?backend=conn-b'));

      expect(requestB).toHaveBeenCalledWith('file.readChunk', {
        workspaceId: 'ws-dup',
        path: 'pic.png',
        offset: 0,
        length: WORKSPACE_FILE_CHUNK_BYTES,
      });
      expect(requestA).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });

    it('serves a cache-busted, hinted URL with the token stripped from the daemon path', async () => {
      const bytes = Buffer.from('fresh-bytes');
      const requestB = vi.fn().mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));
      pooledRequests.set('conn-b', requestB);
      windowBackends.set(2, 'conn-b');
      workspaceWindows.set('ws-dup', [2]);

      const res = await getHandler()(
        appRequest('workspace-file://ws-dup/pic.png?v=m1abc-2&backend=conn-b'),
      );

      expect(requestB).toHaveBeenCalledWith('file.readChunk', {
        workspaceId: 'ws-dup',
        path: 'pic.png',
        offset: 0,
        length: WORKSPACE_FILE_CHUNK_BYTES,
      });
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });

    it('fails closed with 404 when the hinted backend is disconnected — no probe, no other backend', async () => {
      const requestA = vi.fn(async () => ({ workspace: { id: 'ws-hint-down' } }));
      pooledRequests.set('conn-a', requestA);
      windowBackends.set(1, 'conn-a');
      workspaceWindows.set('ws-hint-down', [1]);

      const res = await getHandler()(
        appRequest('workspace-file://ws-hint-down/pic.png?backend=conn-b'),
      );

      expect(res.status).toBe(404);
      expect(requestA).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('never runs the ownership probe when the hinted backend refuses the read', async () => {
      // Unhinted, a -32602 refusal triggers workspace.get on every live
      // backend; a hinted request names its backend and simply 404s.
      const requestB = vi
        .fn()
        .mockRejectedValueOnce(new JsonRpcError({ code: -32602, message: 'workspace not found' }));
      const requestA = vi.fn(async () => ({ workspace: { id: 'ws-hint-refused' } }));
      pooledRequests.set('conn-a', requestA);
      pooledRequests.set('conn-b', requestB);

      const res = await getHandler()(
        appRequest('workspace-file://ws-hint-refused/pic.png?backend=conn-b'),
      );

      expect(res.status).toBe(404);
      expect(requestB).toHaveBeenCalledTimes(1);
      expect(requestA).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('serves a hinted local request from the primary client when the local pool is empty', async () => {
      const bytes = Buffer.from('local-bytes');
      mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));
      workspaceWindows.clear();

      const res = await getHandler()(appRequest('workspace-file://ws-1/pic.png?backend=local'));

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
    });
  });
});

describe('setupWorkspaceAssetProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
    pooledRequests.clear();
    windowBackends.clear();
    workspaceWindows.clear();
    // See the workspace-file beforeEach: unpooled-local stamping avoids the
    // no-hosting-window retry delay in primary-client tests.
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-1', [7]);
  });

  const asset = (data: Buffer, mimeType = 'image/png') => ({
    assetId: 'asset-1',
    mimeType,
    data: data.toString('base64'),
    sizeKb: Math.ceil(data.length / 1024),
  });

  it('serves an asset via note.readAsset on the primary client for an unpooled local backend', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockRequest.mockResolvedValueOnce(asset(bytes));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/asset-1'));

    expect(mockRequest).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws-1',
      asset: 'asset-1',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('retries resolution then serves via the primary client when no window ever hosts the workspace', async () => {
    // Exercises the initial-navigation race path end-to-end: the bounded
    // retry (real timers) exhausts, then the primary fallback serves.
    const bytes = Buffer.from('late-bytes');
    mockRequest.mockResolvedValueOnce(asset(bytes));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-unknown/asset-1'));

    expect(mockRequest).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws-unknown',
      asset: 'asset-1',
    });
    expect(res.status).toBe(200);
  });

  it('rescues a no-hosting-window resolution by probing the live backends for the owner', async () => {
    // No window maps the workspace, but a live remote backend positively
    // confirms ownership: the probe routes the read there instead of the
    // blind primary fallback (v2.123.1 remote broken-images regression).
    const bytes = Buffer.from('probed-asset');
    const remoteRequest = vi.fn(async (method: string) => {
      if (method === 'workspace.get') return { workspace: { id: 'ws-orphan' } };
      return asset(bytes);
    });
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getAssetHandler()(new Request('workspace-asset://ws-orphan/asset-1'));

    expect(remoteRequest).toHaveBeenCalledWith('workspace.get', { workspaceId: 'ws-orphan' });
    expect(remoteRequest).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws-orphan',
      asset: 'asset-1',
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('heals a wrong-stamp asset read from the confirmed owner after a workspace-unknown error', async () => {
    // note.readAsset surfaces an unknown workspace as -32603 (internal error;
    // the router puts the cause in `data`). Unique workspace id: the
    // module-level prober cache persists across tests.
    windowBackends.set(7, 'local');
    workspaceWindows.set('ws-heal-asset', [7]);
    mockRequest.mockRejectedValueOnce(
      new JsonRpcError({
        code: -32603,
        message: 'Internal error',
        data: 'Failed to read asset: not found',
      }),
    );
    const bytes = Buffer.from('healed-asset');
    const remoteRequest = vi.fn(async (method: string) => {
      if (method === 'workspace.get') return { workspace: { id: 'ws-heal-asset' } };
      return asset(bytes);
    });
    pooledRequests.set('conn-remote', remoteRequest);

    const res = await getAssetHandler()(new Request('workspace-asset://ws-heal-asset/asset-1'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(remoteRequest).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws-heal-asset',
      asset: 'asset-1',
    });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('issues note.readAsset on the backend of the window hosting the workspace', async () => {
    const bytes = Buffer.from('asset-bytes');
    const remoteRequest = bindWorkspaceToBackend('ws-remote', 'conn-2');
    remoteRequest.mockResolvedValueOnce(asset(bytes, 'image/webp'));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-remote/asset-1'));

    expect(remoteRequest).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws-remote',
      asset: 'asset-1',
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('falls back to the primary client when the local hosting backend has no pooled client', async () => {
    const bytes = Buffer.from('asset-bytes');
    mockRequest.mockResolvedValueOnce(asset(bytes));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/asset-1'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('fails closed with 404 when the hosting named backend is disconnected', async () => {
    windowBackends.set(7, 'conn-disconnected');
    workspaceWindows.set('ws-1', [7]);

    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/asset-1'));

    expect(res.status).toBe(404);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps daemon errors to 404', async () => {
    mockRequest.mockRejectedValueOnce(new Error('asset not found'));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/asset-1'));

    expect(res.status).toBe(404);
  });

  it('rejects asset ids with path separators without issuing an RPC', async () => {
    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/a%2Fb'));

    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  describe('with a backend hint', () => {
    it('serves from the hinted backend, never probing the other live backend', async () => {
      const bytes = Buffer.from('asset-b');
      const requestA = vi.fn(async () => ({ workspace: { id: 'ws-dup-asset' } }));
      const requestB = vi.fn().mockResolvedValueOnce(asset(bytes));
      pooledRequests.set('conn-a', requestA);
      pooledRequests.set('conn-b', requestB);
      windowBackends.set(1, 'conn-a');
      windowBackends.set(2, 'conn-b');
      workspaceWindows.set('ws-dup-asset', [1, 2]);

      const res = await getAssetHandler()(
        new Request('workspace-asset://ws-dup-asset/asset-1?backend=conn-b'),
      );

      expect(requestB).toHaveBeenCalledWith('note.readAsset', {
        workspaceId: 'ws-dup-asset',
        asset: 'asset-1',
      });
      expect(requestA).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });

    it('fails closed with 404 when the hinted backend is disconnected, without probing', async () => {
      const requestA = vi.fn(async () => ({ workspace: { id: 'ws-1' } }));
      pooledRequests.set('conn-a', requestA);

      const res = await getAssetHandler()(
        new Request('workspace-asset://ws-1/asset-1?backend=conn-b'),
      );

      expect(res.status).toBe(404);
      expect(requestA).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('does not probe when the hinted backend refuses the read', async () => {
      const requestB = vi
        .fn()
        .mockRejectedValueOnce(
          new JsonRpcError({ code: -32603, message: 'Internal error', data: 'not found' }),
        );
      const requestA = vi.fn(async () => ({ workspace: { id: 'ws-hint-asset-refused' } }));
      pooledRequests.set('conn-a', requestA);
      pooledRequests.set('conn-b', requestB);

      const res = await getAssetHandler()(
        new Request('workspace-asset://ws-hint-asset-refused/asset-1?backend=conn-b'),
      );

      expect(res.status).toBe(404);
      expect(requestB).toHaveBeenCalledTimes(1);
      expect(requestA).not.toHaveBeenCalled();
    });

    it('rejects any query string other than the backend hint', async () => {
      for (const query of ['?x=1', '?backend=conn-b&x=1', '?backend=']) {
        const res = await getAssetHandler()(new Request(`workspace-asset://ws-1/asset-1${query}`));
        expect(res.status).toBe(400);
      }
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });
});
