import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * workspace-file://{workspaceId}/{percent-encoded-path} — URL validation and
 * the daemon-backed handler. Bytes come from `file.readChunk` (PROTOCOL §5.9:
 * params { workspaceId, path, offset, length } → { content (base64),
 * bytesRead, size }); the handler assembles multi-chunk reads and serves an
 * image-only MIME allowlist (SVG excluded in v1).
 *
 * Both this handler and workspace-asset:// (note assets via `note.readAsset`,
 * PROTOCOL §5.2) issue their RPC on the backend that owns the workspace
 * (monorepo#3501): the workspace's hosting window resolves to its stamped
 * backend's pooled client, and the app-primary compatibility client is the
 * fallback when no hosting window (or pooled client) exists.
 */

const { protocolHandle, mockRequest, pooledRequests, windowBackends, workspaceWindows } =
  vi.hoisted(() => ({
    protocolHandle: vi.fn(),
    mockRequest: vi.fn(),
    /** backendId → pooled client `request` mock. */
    pooledRequests: new Map<string, ReturnType<typeof vi.fn>>(),
    /** windowId → stamped backendId. */
    windowBackends: new Map<number, string>(),
    /** workspaceId → hosting windowIds. */
    workspaceWindows: new Map<string, number[]>(),
  }));

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app') },
  protocol: { handle: protocolHandle },
  BrowserWindow: {
    fromId: (id: number) => (windowBackends.has(id) ? { id, isDestroyed: () => false } : null),
  },
}));

vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
  getBackendClientForConnection: (id: string) => {
    const request = pooledRequests.get(id);
    return request ? { request } : undefined;
  },
}));

vi.mock('../../features/system/main/system.ipc', () => ({
  getWindowIdsForWorkspace: (workspaceId: string) => workspaceWindows.get(workspaceId) ?? [],
}));

vi.mock('../window', () => ({
  getBackendIdForWindow: (window: { id: number }) => windowBackends.get(window.id) ?? 'local',
}));

import { imageMimeTypeForPath, parseWorkspaceFileRequest } from '../utils/workspace-file-url';
import { resolveWorkspaceBackendClient } from '../utils/workspace-backend-client';
import {
  setupWorkspaceAssetProtocolHandler,
  setupWorkspaceFileProtocolHandler,
  WORKSPACE_FILE_CHUNK_BYTES,
  WORKSPACE_FILE_MAX_BYTES,
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

describe('parseWorkspaceFileRequest', () => {
  it('accepts a nested percent-encoded image path', () => {
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/docs/my%20pic.png');
    expect(parsed).toEqual({
      ok: true,
      workspaceId: 'ws-1',
      filePath: 'docs/my pic.png',
      mimeType: 'image/png',
    });
  });

  it('rejects traversal segments with 403 (encoded slashes bypass URL dot-segment normalization)', () => {
    // Plain and percent-encoded dot segments are consumed by WHATWG URL
    // parsing, but `%2F..%2F` survives it and decodes to `../` client-side.
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/a%2F..%2Fsecret.png');
    expect(parsed).toMatchObject({ ok: false, status: 403 });
  });

  it('neutralizes plain dot segments via URL normalization', () => {
    const parsed = parseWorkspaceFileRequest('workspace-file://ws-1/a/../../b.png');
    expect(parsed).toMatchObject({ ok: true, filePath: 'b.png' });
  });

  it('neutralizes percent-encoded dot segments via URL normalization (pins WHATWG behavior)', () => {
    // `%2e%2e` segments are consumed during URL parsing and clamp at the
    // root, so they never reach the traversal check. Pinned so a swap away
    // from WHATWG `new URL` semantics cannot silently regress containment.
    expect(parseWorkspaceFileRequest('workspace-file://ws-1/%2e%2e/secret.png')).toMatchObject({
      ok: true,
      filePath: 'secret.png',
    });
    expect(
      parseWorkspaceFileRequest('workspace-file://ws-1/a/%2e%2e/%2e%2e/secret.png'),
    ).toMatchObject({ ok: true, filePath: 'secret.png' });
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
  }) => ({
    getWindowIdsForWorkspace: () => overrides.windows ?? [],
    getBackendIdForWindowId: overrides.backendOf ?? (() => null),
    getClientForBackend: (id: string) => overrides.clients?.[id],
    getPrimaryClient: () => 'primary',
  });

  it('picks the pooled client of the first hosting window with a live backend', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({
        windows: [1, 2],
        backendOf: (id) => (id === 1 ? 'conn-dead' : 'conn-2'),
        clients: { 'conn-2': 'pooled-2' },
      }),
    });
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2' });
  });

  it('falls back to the primary client when no window hosts the workspace', () => {
    expect(resolveWorkspaceBackendClient('ws-1', lookup({}))).toEqual({
      client: 'primary',
      backendId: null,
    });
  });

  it('falls back to the primary client when hosting backends have no pooled client', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({ windows: [1], backendOf: () => 'conn-gone' }),
    });
    expect(resolved).toEqual({ client: 'primary', backendId: null });
  });

  it('skips dead windows (null backend id)', () => {
    const resolved = resolveWorkspaceBackendClient('ws-1', {
      ...lookup({
        windows: [1, 2],
        backendOf: (id) => (id === 1 ? null : 'conn-2'),
        clients: { 'conn-2': 'pooled-2' },
      }),
    });
    expect(resolved).toEqual({ client: 'pooled-2', backendId: 'conn-2' });
  });
});

describe('setupWorkspaceFileProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
    pooledRequests.clear();
    windowBackends.clear();
    workspaceWindows.clear();
  });

  it('serves a single-chunk image with the exact file.readChunk wire params', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(new Request('workspace-file://ws-1/images/pic.png'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws-1',
      path: 'images/pic.png',
      offset: 0,
      length: WORKSPACE_FILE_CHUNK_BYTES,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    // Required for renderer fetch() reads across origins (corsEnabled scheme).
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  });

  it('assembles multi-chunk reads by advancing offset until size is reached', async () => {
    const first = Buffer.from('first-half');
    const second = Buffer.from('second');
    const size = first.length + second.length;
    mockRequest
      .mockResolvedValueOnce(chunk(first, first.length, size))
      .mockResolvedValueOnce(chunk(second, second.length, size));

    const res = await getHandler()(new Request('workspace-file://ws-1/big.webp'));

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ offset: first.length });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.concat([first, second]));
  });

  it('serves an empty file as an empty 200 body', async () => {
    mockRequest.mockResolvedValueOnce({ content: '', bytesRead: 0, size: 0 });

    const res = await getHandler()(new Request('workspace-file://ws-1/empty.gif'));

    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('rejects traversal and non-image URLs without issuing an RPC', async () => {
    const handler = getHandler();

    const traversal = await handler(new Request('workspace-file://ws-1/a%2F..%2Fx.png'));
    expect(traversal.status).toBe(403);

    const nonImage = await handler(new Request('workspace-file://ws-1/notes.md'));
    expect(nonImage.status).toBe(415);

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses oversized files with 413', async () => {
    const bytes = Buffer.from('x');
    mockRequest.mockResolvedValueOnce(chunk(bytes, 1, WORKSPACE_FILE_MAX_BYTES + 1));

    const res = await getHandler()(new Request('workspace-file://ws-1/huge.jpeg'));

    expect(res.status).toBe(413);
  });

  it('maps daemon errors to 404', async () => {
    mockRequest.mockRejectedValueOnce(new Error('path is outside the workspace'));

    const res = await getHandler()(new Request('workspace-file://ws-1/missing.png'));

    expect(res.status).toBe(404);
  });

  it('fails closed with 404 when bytesRead disagrees with the decoded content length', async () => {
    const bytes = Buffer.from('abcdef');
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length + 3, bytes.length + 3));

    const res = await getHandler()(new Request('workspace-file://ws-1/spliced.png'));

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

  it('falls back to the primary client when the hosting backend has no pooled client', async () => {
    const bytes = Buffer.from('png-bytes');
    windowBackends.set(7, 'conn-disconnected');
    workspaceWindows.set('ws-1', [7]);
    mockRequest.mockResolvedValueOnce(chunk(bytes, bytes.length, bytes.length));

    const res = await getHandler()(new Request('workspace-file://ws-1/pic.png'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});

describe('setupWorkspaceAssetProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
    pooledRequests.clear();
    windowBackends.clear();
    workspaceWindows.clear();
  });

  const asset = (data: Buffer, mimeType = 'image/png') => ({
    assetId: 'asset-1',
    mimeType,
    data: data.toString('base64'),
    sizeKb: Math.ceil(data.length / 1024),
  });

  it('serves an asset via note.readAsset on the primary client when no window hosts the workspace', async () => {
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

  it('falls back to the primary client when the hosting backend has no pooled client', async () => {
    const bytes = Buffer.from('asset-bytes');
    windowBackends.set(7, 'conn-disconnected');
    workspaceWindows.set('ws-1', [7]);
    mockRequest.mockResolvedValueOnce(asset(bytes));

    const res = await getAssetHandler()(new Request('workspace-asset://ws-1/asset-1'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
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
});
