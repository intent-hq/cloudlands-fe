import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * workspace-file://{workspaceId}/{percent-encoded-path} — URL validation and
 * the daemon-backed handler. Bytes come from `file.readChunk` (PROTOCOL §5.9:
 * params { workspaceId, path, offset, length } → { content (base64),
 * bytesRead, size }); the handler assembles multi-chunk reads and serves an
 * image-only MIME allowlist (SVG excluded in v1).
 */

const { protocolHandle, mockRequest } = vi.hoisted(() => ({
  protocolHandle: vi.fn(),
  mockRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/app') },
  protocol: { handle: protocolHandle },
}));

vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

import { imageMimeTypeForPath, parseWorkspaceFileRequest } from '../utils/workspace-file-url';
import {
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

function chunk(bytes: Buffer, bytesRead: number, size: number) {
  return { content: bytes.toString('base64'), bytesRead, size };
}

describe('setupWorkspaceFileProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
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
});
