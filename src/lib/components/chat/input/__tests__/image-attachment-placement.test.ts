/**
 * In-memory image placement → attachment-reference blocks (monorepo#3338):
 * small images take the single-shot data arm, oversized ones the chunked
 * upload session, failures reject with per-image detail, and existing
 * reference blocks pass through without re-uploading.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  base64DecodedBytes,
  placeImageAttachment,
  toImageReferenceBlocks,
  type ImagePlacementApi,
} from '../image-attachment-placement';

const placedResult = (attachmentId: string, mimeType?: string) => ({
  ok: true,
  path: `.intent/attachments/${attachmentId}.png`,
  fileName: `${attachmentId}.png`,
  size: 3,
  attachmentId,
  mimeType,
  uploadedAt: '2026-08-24T00:00:00Z',
});

function makeApi(overrides: Partial<ImagePlacementApi> = {}): ImagePlacementApi {
  return {
    placeAttachment: vi.fn(async () => placedResult('att-1', 'image/png')),
    beginAttachmentUpload: vi.fn(async () => ({
      uploadId: 'up-1',
      maxChunkBytes: 16 * 1024 * 1024,
    })),
    sendAttachmentUploadChunk: vi.fn(async (uploadId: string, seq: number) => ({
      uploadId,
      seq,
      receivedBytes: 0,
    })),
    commitAttachmentUpload: vi.fn(async () => placedResult('att-chunked', 'image/png')),
    abortAttachmentUpload: vi.fn(async (uploadId: string) => ({ uploadId, aborted: true })),
    ...overrides,
  };
}

describe('base64DecodedBytes', () => {
  it('computes decoded lengths including padding variants', () => {
    expect(base64DecodedBytes(btoa('a'))).toBe(1);
    expect(base64DecodedBytes(btoa('ab'))).toBe(2);
    expect(base64DecodedBytes(btoa('abc'))).toBe(3);
    expect(base64DecodedBytes('')).toBe(0);
  });
});

describe('placeImageAttachment', () => {
  it('uses the single-shot data arm below the 25MB threshold', async () => {
    const api = makeApi();
    const result = await placeImageAttachment(
      'ws-1',
      'shot.png',
      { data: btoa('abc'), mimeType: 'image/png' },
      api,
    );
    expect(result.attachmentId).toBe('att-1');
    expect(api.placeAttachment).toHaveBeenCalledWith('ws-1', 'shot.png', {
      data: btoa('abc'),
      mimeType: 'image/png',
    });
    expect(api.beginAttachmentUpload).not.toHaveBeenCalled();
  });

  it('aborts the chunked session when a chunk send fails', async () => {
    // Force the chunked path with a data string whose decoded size exceeds
    // the threshold — stub the API so no real 25MB buffer is needed.
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3); // 30 MiB decoded
    const api = makeApi({
      sendAttachmentUploadChunk: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    await expect(
      placeImageAttachment('ws-1', 'big.png', { data: bigData, mimeType: 'image/png' }, api),
    ).rejects.toThrow('connection reset');
    expect(api.abortAttachmentUpload).toHaveBeenCalledWith('up-1');
    expect(api.commitAttachmentUpload).not.toHaveBeenCalled();
  });

  it('chunks an oversized image through begin → chunk → commit', async () => {
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3); // 30 MiB decoded
    const api = makeApi();
    const result = await placeImageAttachment(
      'ws-1',
      'big.png',
      { data: bigData, mimeType: 'image/png' },
      api,
    );
    expect(result.attachmentId).toBe('att-chunked');
    expect(api.beginAttachmentUpload).toHaveBeenCalledWith(
      'ws-1',
      'big.png',
      30 * 1024 * 1024,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      'image/png',
    );
    // 30 MiB at 16 MiB per chunk = 2 chunks, then commit.
    expect(api.sendAttachmentUploadChunk).toHaveBeenCalledTimes(2);
    expect(api.commitAttachmentUpload).toHaveBeenCalledWith('up-1');
  });
});

describe('toImageReferenceBlocks', () => {
  it('places inline blocks and returns reference blocks in order', async () => {
    const api = makeApi();
    const blocks = await toImageReferenceBlocks(
      'ws-1',
      [{ type: 'image', data: btoa('abc'), mimeType: 'image/png' }],
      api,
    );
    expect(blocks).toEqual([{ type: 'image', attachmentId: 'att-1', mimeType: 'image/png' }]);
  });

  it('passes existing reference blocks through without re-uploading', async () => {
    const api = makeApi();
    const blocks = await toImageReferenceBlocks(
      'ws-1',
      [{ type: 'image', attachmentId: 'att-existing', mimeType: 'image/webp' }],
      api,
    );
    expect(blocks).toEqual([
      { type: 'image', attachmentId: 'att-existing', mimeType: 'image/webp' },
    ]);
    expect(api.placeAttachment).not.toHaveBeenCalled();
  });

  it('rejects with per-image failure detail instead of dropping images', async () => {
    const api = makeApi({
      placeAttachment: vi.fn(async () => {
        throw Object.assign(new Error('Internal error'), {
          data: { detail: 'disk full' },
        });
      }),
    });
    await expect(
      toImageReferenceBlocks(
        'ws-1',
        [{ type: 'image', data: btoa('abc'), mimeType: 'image/png' }],
        api,
      ),
    ).rejects.toThrow(/image-.*\.png \(disk full\)/);
  });
});
