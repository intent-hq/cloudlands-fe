/**
 * Transport-aware attachment placement (monorepo#2144): sourcePath arm on
 * the local sidecar, base64 data arm against a remote backend (≤25MB),
 * the chunked `file.attachmentUpload.*` session above that (PROTOCOL §5.9,
 * v6.16), and the daemon error-detail extraction behind the failed
 * pill/toast copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const backendRequestMock = vi.hoisted(() => vi.fn());
const placeAttachmentMock = vi.hoisted(() => vi.fn());
const mockState = vi.hoisted(() => ({
  daemonHealth: {
    hostLocality: null as 'local' | 'remote' | null,
    transport: null as { mode: string } | null,
  },
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: invokeMock }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
}));
vi.mock('./context-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./context-api')>();
  return { ...actual, placeAttachment: placeAttachmentMock };
});
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mockState });
});

import {
  extractPlacementErrorDetail,
  isPlacementCancellation,
  isRemoteBackend,
  MAX_REMOTE_ATTACHMENT_BYTES,
  MAX_REMOTE_ATTACHMENT_TOTAL_BYTES,
  UPLOAD_CHUNK_BYTES,
  placeAttachmentViaTransport,
} from './attachment-placement';

/** 5-minute per-call bound for chunk sends and commit (see context-api.ts). */
const UPLOAD_TRANSFER_TIMEOUT = { timeoutMs: 5 * 60 * 1000 };

/** Route the size probe (1-byte `file:read-chunk`) to a fixed file size. */
function mockSizeProbe(size: number) {
  invokeMock.mockImplementation(async (channel: string, params: { length?: number }) => {
    if (channel === 'file:read-chunk' && params.length === 1) {
      return { success: true, data: { content: 'AA==', bytesRead: 1, size } };
    }
    throw new Error(`unexpected invoke: ${channel}`);
  });
}

const placedResult = {
  ok: true,
  path: '.intent/attachments/notes.txt',
  fileName: 'notes.txt',
  size: 1024,
  attachmentId: 'att-uuid-1',
  mimeType: 'text/plain',
  uploadedAt: '2026-08-12T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.daemonHealth.hostLocality = null;
  mockState.daemonHealth.transport = null;
});

describe('isRemoteBackend', () => {
  it('is false before any locality evidence (local sidecar default)', () => {
    expect(isRemoteBackend()).toBe(false);
  });

  it('honors the daemon-reported locality over the transport heuristic', () => {
    mockState.daemonHealth.hostLocality = 'remote';
    expect(isRemoteBackend()).toBe(true);
    mockState.daemonHealth.hostLocality = 'local';
    mockState.daemonHealth.transport = { mode: 'external-ws' };
    expect(isRemoteBackend()).toBe(false);
  });

  it('falls back to the transport mode before the first status poll', () => {
    mockState.daemonHealth.transport = { mode: 'external-ws' };
    expect(isRemoteBackend()).toBe(true);
  });
});

describe('placeAttachmentViaTransport', () => {
  it('uses the sourcePath arm against the local sidecar (no file read)', async () => {
    placeAttachmentMock.mockResolvedValueOnce(placedResult);

    const result = await placeAttachmentViaTransport('ws-1', 'notes.txt', {
      sourcePath: '/home/user/notes.txt',
      mimeType: 'text/plain',
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(placeAttachmentMock).toHaveBeenCalledWith('ws-1', 'notes.txt', {
      sourcePath: '/home/user/notes.txt',
      mimeType: 'text/plain',
    });
    expect(result).toEqual(placedResult);
  });

  it('reads base64 bytes off the FE host and uses the data arm when remote (≤25MB)', async () => {
    mockState.daemonHealth.hostLocality = 'remote';
    invokeMock.mockImplementation(async (channel: string, params: { length?: number }) => {
      if (channel === 'file:read-chunk' && params.length === 1) {
        return { success: true, data: { content: 'AA==', bytesRead: 1, size: 5 } };
      }
      if (channel === 'file:read') {
        return { success: true, data: { content: 'aGVsbG8=' } };
      }
      throw new Error(`unexpected invoke: ${channel}`);
    });
    placeAttachmentMock.mockResolvedValueOnce(placedResult);

    await placeAttachmentViaTransport('ws-1', 'notes.txt', {
      sourcePath: '/home/user/notes.txt',
      mimeType: 'text/plain',
    });

    expect(invokeMock).toHaveBeenCalledWith('file:read', {
      path: '/home/user/notes.txt',
      encoding: 'base64',
      maxSize: MAX_REMOTE_ATTACHMENT_BYTES,
      truncateIfLarge: false,
    });
    expect(placeAttachmentMock).toHaveBeenCalledWith('ws-1', 'notes.txt', {
      data: 'aGVsbG8=',
      mimeType: 'text/plain',
    });
    expect(backendRequestMock).not.toHaveBeenCalled();
  });

  it('propagates the file read failure reason when remote', async () => {
    mockState.daemonHealth.hostLocality = 'remote';
    invokeMock.mockResolvedValue({
      success: false,
      error: { code: 'FILE_READ_FAILED', message: 'File not found' },
    });

    await expect(
      placeAttachmentViaTransport('ws-1', 'big.bin', { sourcePath: '/home/user/big.bin' }),
    ).rejects.toThrow('File not found');
    expect(placeAttachmentMock).not.toHaveBeenCalled();
  });

  it('rejects files over the 1 GiB daemon cap with a clear oversize error', async () => {
    mockState.daemonHealth.hostLocality = 'remote';
    mockSizeProbe(MAX_REMOTE_ATTACHMENT_TOTAL_BYTES + 1);

    await expect(
      placeAttachmentViaTransport('ws-1', 'huge.bin', { sourcePath: '/home/user/huge.bin' }),
    ).rejects.toThrow(/too large/);
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    expect(backendRequestMock).not.toHaveBeenCalled();
  });
});

describe('placeAttachmentViaTransport — chunked upload (>25MB remote)', () => {
  const CHUNK = UPLOAD_CHUNK_BYTES;
  /** 2 full chunks + 1 partial → 3 chunks. */
  const FILE_SIZE = 2 * CHUNK + 1024;
  const SHA = 'a'.repeat(64);

  /** Wire up file:read-chunk (size probe + slices) and file:hash. */
  function mockChunkedIpc(size: number) {
    invokeMock.mockImplementation(
      async (channel: string, params: { offset?: number; length?: number }) => {
        if (channel === 'file:read-chunk') {
          if (params.length === 1) {
            return { success: true, data: { content: 'AA==', bytesRead: 1, size } };
          }
          const remaining = Math.max(0, size - (params.offset ?? 0));
          const bytesRead = Math.min(params.length ?? 0, remaining);
          return {
            success: true,
            data: { content: `b64-chunk-${(params.offset ?? 0) / CHUNK}`, bytesRead, size },
          };
        }
        if (channel === 'file:hash') {
          return { success: true, data: { sha256: SHA, size } };
        }
        throw new Error(`unexpected invoke: ${channel}`);
      },
    );
  }

  beforeEach(() => {
    mockState.daemonHealth.hostLocality = 'remote';
  });

  it('runs begin → sequential chunks → commit with exact wire shapes', async () => {
    mockChunkedIpc(FILE_SIZE);
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.chunk') {
        return { uploadId: 'upload-1', seq: 0, receivedBytes: 0 };
      }
      if (method === 'file.attachmentUpload.commit') {
        return { ...placedResult, fileName: 'big.bin', size: FILE_SIZE };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await placeAttachmentViaTransport('ws-1', 'big.bin', {
      sourcePath: '/home/user/big.bin',
      mimeType: 'application/octet-stream',
    });

    // Exact wire shapes per PROTOCOL §5.9 (v6.16).
    expect(backendRequestMock).toHaveBeenNthCalledWith(1, 'file.attachmentUpload.begin', {
      workspaceId: 'ws-1',
      fileName: 'big.bin',
      sizeBytes: FILE_SIZE,
      sha256: SHA,
      mimeType: 'application/octet-stream',
    });
    expect(backendRequestMock).toHaveBeenNthCalledWith(
      2,
      'file.attachmentUpload.chunk',
      { uploadId: 'upload-1', seq: 0, data: 'b64-chunk-0' },
      UPLOAD_TRANSFER_TIMEOUT,
    );
    expect(backendRequestMock).toHaveBeenNthCalledWith(
      3,
      'file.attachmentUpload.chunk',
      { uploadId: 'upload-1', seq: 1, data: 'b64-chunk-1' },
      UPLOAD_TRANSFER_TIMEOUT,
    );
    expect(backendRequestMock).toHaveBeenNthCalledWith(
      4,
      'file.attachmentUpload.chunk',
      { uploadId: 'upload-1', seq: 2, data: 'b64-chunk-2' },
      UPLOAD_TRANSFER_TIMEOUT,
    );
    expect(backendRequestMock).toHaveBeenNthCalledWith(
      5,
      'file.attachmentUpload.commit',
      { uploadId: 'upload-1' },
      UPLOAD_TRANSFER_TIMEOUT,
    );
    expect(backendRequestMock).toHaveBeenCalledTimes(5);
    // The single-shot data arm was never used.
    expect(placeAttachmentMock).not.toHaveBeenCalled();
    expect(result.size).toBe(FILE_SIZE);

    // Chunk reads were sequential 16 MiB slices at the right offsets.
    const chunkReads = invokeMock.mock.calls.filter(
      ([channel, params]) => channel === 'file:read-chunk' && params.length !== 1,
    );
    expect(chunkReads.map(([, p]) => p)).toEqual([
      { path: '/home/user/big.bin', offset: 0, length: CHUNK },
      { path: '/home/user/big.bin', offset: CHUNK, length: CHUNK },
      { path: '/home/user/big.bin', offset: 2 * CHUNK, length: CHUNK },
    ]);
  });

  it('reports chunk-acknowledged progress fractions', async () => {
    mockChunkedIpc(FILE_SIZE);
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.commit') return placedResult;
      return { uploadId: 'upload-1' };
    });

    const fractions: number[] = [];
    await placeAttachmentViaTransport(
      'ws-1',
      'big.bin',
      { sourcePath: '/home/user/big.bin' },
      (fraction) => fractions.push(fraction),
    );

    expect(fractions).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('aborts the session and rethrows the daemon reason when a chunk fails', async () => {
    mockChunkedIpc(FILE_SIZE);
    backendRequestMock.mockImplementation(async (method: string, params: { seq?: number }) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.chunk') {
        if (params.seq === 1) throw new Error('received bytes exceed the declared attachment size');
        return { uploadId: 'upload-1' };
      }
      if (method === 'file.attachmentUpload.abort') {
        return { uploadId: 'upload-1', aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await expect(
      placeAttachmentViaTransport('ws-1', 'big.bin', { sourcePath: '/home/user/big.bin' }),
    ).rejects.toThrow('received bytes exceed the declared attachment size');

    expect(backendRequestMock).toHaveBeenCalledWith('file.attachmentUpload.abort', {
      uploadId: 'upload-1',
    });
    const commitCalls = backendRequestMock.mock.calls.filter(
      ([m]) => m === 'file.attachmentUpload.commit',
    );
    expect(commitCalls).toHaveLength(0);
  });

  it('aborts on commit failure (e.g. checksum mismatch) and rethrows', async () => {
    mockChunkedIpc(FILE_SIZE);
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.chunk') return { uploadId: 'upload-1' };
      if (method === 'file.attachmentUpload.commit') {
        throw new Error('attachment checksum mismatch: expected sha256 aa, got bb');
      }
      if (method === 'file.attachmentUpload.abort') {
        return { uploadId: 'upload-1', aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    await expect(
      placeAttachmentViaTransport('ws-1', 'big.bin', { sourcePath: '/home/user/big.bin' }),
    ).rejects.toThrow('attachment checksum mismatch');
    expect(backendRequestMock).toHaveBeenCalledWith('file.attachmentUpload.abort', {
      uploadId: 'upload-1',
    });
  });

  it('surfaces the original error even when the abort itself fails', async () => {
    mockChunkedIpc(FILE_SIZE);
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.chunk') throw new Error('daemon went away');
      if (method === 'file.attachmentUpload.abort') throw new Error('abort also failed');
      throw new Error(`unexpected method: ${method}`);
    });

    await expect(
      placeAttachmentViaTransport('ws-1', 'big.bin', { sourcePath: '/home/user/big.bin' }),
    ).rejects.toThrow('daemon went away');
  });

  it('cancels mid-upload on signal abort: no further chunks, no commit, session aborted', async () => {
    mockChunkedIpc(FILE_SIZE);
    const aborter = new AbortController();
    backendRequestMock.mockImplementation(async (method: string, params: { seq?: number }) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-1', maxChunkBytes: CHUNK };
      }
      if (method === 'file.attachmentUpload.chunk') {
        // User removes the pill while the first chunk is in flight.
        if (params.seq === 0) aborter.abort();
        return { uploadId: 'upload-1', seq: params.seq, receivedBytes: 0 };
      }
      if (method === 'file.attachmentUpload.abort') {
        return { uploadId: 'upload-1', aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const rejection = placeAttachmentViaTransport(
      'ws-1',
      'big.bin',
      { sourcePath: '/home/user/big.bin' },
      undefined,
      aborter.signal,
    ).catch((error: unknown) => error);
    const error = await rejection;

    expect(isPlacementCancellation(error, aborter.signal)).toBe(true);
    const methods = backendRequestMock.mock.calls.map(([method]) => method);
    // Only chunk 0 was sent before the abort; the session was cleaned up.
    expect(
      methods.filter((methodName) => methodName === 'file.attachmentUpload.chunk'),
    ).toHaveLength(1);
    expect(methods).not.toContain('file.attachmentUpload.commit');
    expect(backendRequestMock).toHaveBeenCalledWith('file.attachmentUpload.abort', {
      uploadId: 'upload-1',
    });
  });

  it('cancels before begin when the signal is already aborted (no session opened)', async () => {
    mockChunkedIpc(FILE_SIZE);
    const aborter = new AbortController();
    aborter.abort();

    const error = await placeAttachmentViaTransport(
      'ws-1',
      'big.bin',
      { sourcePath: '/home/user/big.bin' },
      undefined,
      aborter.signal,
    ).catch((caught: unknown) => caught);

    expect(isPlacementCancellation(error, aborter.signal)).toBe(true);
    expect(backendRequestMock).not.toHaveBeenCalled();
  });

  it('honors a smaller daemon maxChunkBytes from begin', async () => {
    const smallCap = 8 * 1024 * 1024;
    // 26 MB: over the 25MB single-shot threshold, split by the daemon's
    // smaller 8 MiB cap → 4 chunks (3 full + 1 partial).
    const size = 26 * 1024 * 1024;
    invokeMock.mockImplementation(
      async (channel: string, params: { offset?: number; length?: number }) => {
        if (channel === 'file:read-chunk') {
          if (params.length === 1) {
            return { success: true, data: { content: 'AA==', bytesRead: 1, size } };
          }
          return {
            success: true,
            data: { content: `b64-${params.offset}`, bytesRead: params.length, size },
          };
        }
        if (channel === 'file:hash') return { success: true, data: { sha256: SHA, size } };
        throw new Error(`unexpected invoke: ${channel}`);
      },
    );
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === 'file.attachmentUpload.begin') {
        return { uploadId: 'upload-2', maxChunkBytes: smallCap };
      }
      if (method === 'file.attachmentUpload.commit') return placedResult;
      return { uploadId: 'upload-2' };
    });

    await placeAttachmentViaTransport('ws-1', 'big.bin', {
      sourcePath: '/home/user/big.bin',
    });

    const chunkSends = backendRequestMock.mock.calls.filter(
      ([m]) => m === 'file.attachmentUpload.chunk',
    );
    expect(chunkSends).toHaveLength(4);
    const chunkReads = invokeMock.mock.calls.filter(
      ([channel, params]) => channel === 'file:read-chunk' && params.length !== 1,
    );
    expect(chunkReads.map(([, p]) => p.length)).toEqual([smallCap, smallCap, smallCap, smallCap]);
  });
});

describe('extractPlacementErrorDetail', () => {
  it('prefers the structured error.data.detail', () => {
    const error = Object.assign(new Error('Internal error'), {
      data: { code: 'INTERNAL_ERROR', detail: 'sourcePath is a directory' },
    });
    expect(extractPlacementErrorDetail(error)).toBe('sourcePath is a directory');
  });

  it('falls back to a non-generic error message', () => {
    expect(extractPlacementErrorDetail(new Error('sourcePath does not exist'))).toBe(
      'sourcePath does not exist',
    );
  });

  it('returns undefined for the generic Internal error and non-errors', () => {
    expect(extractPlacementErrorDetail(new Error('Internal error'))).toBeUndefined();
    expect(extractPlacementErrorDetail(undefined)).toBeUndefined();
    expect(extractPlacementErrorDetail('boom')).toBeUndefined();
  });

  it('filters transport-generic fallback messages, not just the daemon -32603', () => {
    expect(extractPlacementErrorDetail(new Error('Backend request failed'))).toBeUndefined();
    expect(
      extractPlacementErrorDetail(new Error('file:read returned an unexpected response')),
    ).toBeUndefined();
    expect(extractPlacementErrorDetail(new Error('file:read failed'))).toBeUndefined();
  });
});
