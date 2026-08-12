/**
 * Transport-aware attachment placement (monorepo#2144): sourcePath arm on
 * the local sidecar, base64 data arm against a remote backend, and the
 * daemon error-detail extraction behind the failed pill/toast copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const placeAttachmentMock = vi.hoisted(() => vi.fn());
const mockState = vi.hoisted(() => ({
  daemonHealth: {
    hostLocality: null as 'local' | 'remote' | null,
    transport: null as { mode: string } | null,
  },
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: invokeMock }));
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
  isRemoteBackend,
  MAX_REMOTE_ATTACHMENT_BYTES,
  placeAttachmentViaTransport,
} from './attachment-placement';

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

  it('reads base64 bytes off the FE host and uses the data arm when remote', async () => {
    mockState.daemonHealth.hostLocality = 'remote';
    invokeMock.mockResolvedValueOnce({ success: true, data: { content: 'aGVsbG8=' } });
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
  });

  it('propagates the file:read failure reason (e.g. oversized file) when remote', async () => {
    mockState.daemonHealth.hostLocality = 'remote';
    invokeMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'FILE_TOO_LARGE', message: 'File exceeds maximum size' },
    });

    await expect(
      placeAttachmentViaTransport('ws-1', 'big.bin', { sourcePath: '/home/user/big.bin' }),
    ).rejects.toThrow('File exceeds maximum size');
    expect(placeAttachmentMock).not.toHaveBeenCalled();
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
});
