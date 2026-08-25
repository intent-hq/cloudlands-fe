import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * workspace-file://{workspaceId}/{percent-encoded-path} — URL validation and
 * the daemon-backed handler. Bytes come from `file.readChunk` (PROTOCOL §5.9:
 * params { workspaceId, path, offset, length } → { content (base64),
 * bytesRead, size }); the handler assembles multi-chunk reads and serves a
 * narrow image/video MIME allowlist (SVG excluded).
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

import {
  imageMimeTypeForPath,
  parseWorkspaceFileRequest,
  workspaceFileMimeTypeForPath,
} from '../utils/workspace-file-url';
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
    });
  });

  it('accepts only allowlisted video paths with the correct MIME type', () => {
    expect(parseWorkspaceFileRequest('workspace-file://ws-2/artifacts/demo%20clip.mp4')).toEqual({
      ok: true,
      workspaceId: 'ws-2',
      filePath: 'artifacts/demo clip.mp4',
      mimeType: 'video/mp4',
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

function getHandler(): (request: Request) => Promise<Response> {
  setupWorkspaceFileProtocolHandler();
  const call = protocolHandle.mock.calls.find(([scheme]) => scheme === 'workspace-file');
  expect(call).toBeDefined();
  return call![1];
}

function chunk(bytes: Buffer, bytesRead: number, size: number) {
  return { content: bytes.toString('base64'), bytesRead, size };
}

function appRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { Origin: 'app://workspaces', ...headers } });
}

describe('setupWorkspaceFileProtocolHandler', () => {
  beforeEach(() => {
    protocolHandle.mockClear();
    mockRequest.mockReset();
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
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
        'http://127.0.0.1:5197',
      );

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
    mockRequest
      .mockResolvedValueOnce(chunk(first, first.length, size))
      .mockResolvedValueOnce(chunk(second, second.length, size));

    const res = await getHandler()(appRequest('workspace-file://ws-1/big.webp'));

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ offset: first.length });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.concat([first, second]));
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
});
