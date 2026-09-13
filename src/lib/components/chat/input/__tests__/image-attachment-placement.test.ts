/**
 * In-memory image placement → attachment-reference blocks (monorepo#3338):
 * small images take the single-shot data arm, oversized ones the chunked
 * upload session, failures reject with per-image detail, existing
 * reference blocks pass through without re-uploading, and keyed placement
 * (v9.13) recovers a lost reply through the `file.getAttachmentInfo` key arm.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  base64DecodedBytes,
  ImagePlacementError,
  imageRetryBlocks,
  placeImageAttachment,
  toImageReferenceBlocks,
  type ImagePlacementApi,
  type WireImageBlock,
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
    getAttachmentInfo: vi.fn(async () => {
      throw invalidParams('unknown idempotency key');
    }),
    // Pre-9.13 daemon by default: no key minted, wire shapes unchanged.
    mintIdempotencyKey: vi.fn(() => undefined),
    ...overrides,
  };
}

/** Daemon `-32602` as the transports surface it. */
function invalidParams(message: string) {
  return Object.assign(new Error(message), { code: 'INVALID_PARAMS', rpcCode: -32602 });
}

/** Transport-level failure (no `rpcCode`: the reply never arrived). */
function transportLoss() {
  return Object.assign(new Error('Request timed out'), { code: 'TRANSPORT_ERROR' });
}

const KEY = '3f2b6c1e-9d3a-4e7b-8a2c-5f1d0e9b7c64';

/** PROTOCOL §5.9 `file.getAttachmentInfo` row for a keyed placement. */
const recoveredRow = {
  attachmentId: 'att-recovered',
  fileName: 'shot.png',
  mimeType: 'image/png',
  size: 3,
  uploadedAt: '2026-08-24T00:00:00Z',
  path: '.intent/attachments/shot.png',
  exists: true,
};

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
      { mimeType: 'image/png' },
    );
    // 30 MiB at 16 MiB per chunk = 2 chunks, then commit.
    expect(api.sendAttachmentUploadChunk).toHaveBeenCalledTimes(2);
    expect(api.commitAttachmentUpload).toHaveBeenCalledWith('up-1');
  });
});

describe('placeImageAttachment — idempotencyKey (v9.13)', () => {
  it('threads the key onto the single-shot data arm', async () => {
    const api = makeApi();
    await placeImageAttachment(
      'ws-1',
      'shot.png',
      { data: btoa('abc'), mimeType: 'image/png', idempotencyKey: KEY },
      api,
    );
    expect(api.placeAttachment).toHaveBeenCalledWith('ws-1', 'shot.png', {
      data: btoa('abc'),
      mimeType: 'image/png',
      idempotencyKey: KEY,
    });
    expect(api.getAttachmentInfo).not.toHaveBeenCalled();
  });

  it('recovers a lost placeAttachment reply through the key lookup (one placement)', async () => {
    const api = makeApi({
      placeAttachment: vi.fn(async () => {
        throw transportLoss();
      }),
      getAttachmentInfo: vi.fn(async () => recoveredRow),
    });
    const result = await placeImageAttachment(
      'ws-1',
      'shot.png',
      { data: btoa('abc'), mimeType: 'image/png', idempotencyKey: KEY },
      api,
    );
    expect(api.placeAttachment).toHaveBeenCalledTimes(1);
    expect(api.getAttachmentInfo).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      idempotencyKey: KEY,
    });
    expect(result.attachmentId).toBe('att-recovered');
    expect(result.replayed).toBe(true);
  });

  it('surfaces the failure when the key is unknown, and skips the lookup on -32602', async () => {
    const lost = makeApi({
      placeAttachment: vi.fn(async () => {
        throw transportLoss();
      }),
    });
    await expect(
      placeImageAttachment('ws-1', 'shot.png', { data: btoa('abc'), idempotencyKey: KEY }, lost),
    ).rejects.toThrow('Request timed out');
    expect(lost.getAttachmentInfo).toHaveBeenCalledTimes(1);

    const refused = makeApi({
      placeAttachment: vi.fn(async () => {
        throw invalidParams('idempotencyKey already used with a different payload');
      }),
    });
    await expect(
      placeImageAttachment('ws-1', 'shot.png', { data: btoa('abc'), idempotencyKey: KEY }, refused),
    ).rejects.toThrow('different payload');
    expect(refused.getAttachmentInfo).not.toHaveBeenCalled();
  });

  it('threads the key onto begin and recovers a lost commit reply without aborting', async () => {
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3);
    const api = makeApi({
      commitAttachmentUpload: vi.fn(async () => {
        throw transportLoss();
      }),
      getAttachmentInfo: vi.fn(async () => ({
        ...recoveredRow,
        fileName: 'big.png',
        size: 30 * 1024 * 1024,
      })),
    });
    const result = await placeImageAttachment(
      'ws-1',
      'big.png',
      { data: bigData, mimeType: 'image/png', idempotencyKey: KEY },
      api,
    );
    expect(api.beginAttachmentUpload).toHaveBeenCalledWith(
      'ws-1',
      'big.png',
      30 * 1024 * 1024,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      { mimeType: 'image/png', idempotencyKey: KEY },
    );
    expect(api.commitAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(api.getAttachmentInfo).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      idempotencyKey: KEY,
    });
    expect(api.abortAttachmentUpload).not.toHaveBeenCalled();
    expect(result.attachmentId).toBe('att-recovered');
  });

  it('does not look the key up after a chunk failure', async () => {
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3);
    const api = makeApi({
      sendAttachmentUploadChunk: vi.fn(async () => {
        throw transportLoss();
      }),
    });
    await expect(
      placeImageAttachment('ws-1', 'big.png', { data: bigData, idempotencyKey: KEY }, api),
    ).rejects.toThrow('Request timed out');
    expect(api.getAttachmentInfo).not.toHaveBeenCalled();
    expect(api.abortAttachmentUpload).toHaveBeenCalledWith('up-1');
  });

  it('recovers through the lookup when begin says the key is already committed (lost commit reply)', async () => {
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3);
    const api = makeApi({
      beginAttachmentUpload: vi.fn(async () => {
        throw invalidParams(
          `idempotencyKey "${KEY}" already committed; look it up via file.getAttachmentInfo { workspaceId, idempotencyKey }`,
        );
      }),
      getAttachmentInfo: vi.fn(async () => ({
        ...recoveredRow,
        fileName: 'big.png',
        size: 30 * 1024 * 1024,
      })),
    });
    const result = await placeImageAttachment(
      'ws-1',
      'big.png',
      { data: bigData, mimeType: 'image/png', idempotencyKey: KEY },
      api,
    );
    expect(api.beginAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(api.getAttachmentInfo).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      idempotencyKey: KEY,
    });
    expect(api.sendAttachmentUploadChunk).not.toHaveBeenCalled();
    expect(api.commitAttachmentUpload).not.toHaveBeenCalled();
    expect(api.abortAttachmentUpload).not.toHaveBeenCalled();
    expect(result.attachmentId).toBe('att-recovered');
    expect(result.replayed).toBe(true);
  });

  it('rethrows other begin -32602 refusals without a lookup', async () => {
    const bigData = btoa('abc').repeat((30 * 1024 * 1024) / 3);
    const api = makeApi({
      beginAttachmentUpload: vi.fn(async () => {
        throw invalidParams('idempotencyKey already used with a different payload');
      }),
    });
    await expect(
      placeImageAttachment('ws-1', 'big.png', { data: bigData, idempotencyKey: KEY }, api),
    ).rejects.toThrow('different payload');
    expect(api.getAttachmentInfo).not.toHaveBeenCalled();
    expect(api.abortAttachmentUpload).not.toHaveBeenCalled();
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

  it('mints one key per inline block against a 9.13+ daemon and sends it', async () => {
    let n = 0;
    const api = makeApi({ mintIdempotencyKey: vi.fn(() => `key-${++n}`) });
    await toImageReferenceBlocks(
      'ws-1',
      [
        { type: 'image', data: btoa('abc'), mimeType: 'image/png' },
        { type: 'image', attachmentId: 'att-existing' },
        { type: 'image', data: btoa('def'), mimeType: 'image/png' },
      ],
      api,
    );
    expect(api.mintIdempotencyKey).toHaveBeenCalledTimes(2);
    const keys = (api.placeAttachment as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, , source]) => (source as { idempotencyKey?: string }).idempotencyKey,
    );
    expect(keys).toEqual(['key-1', 'key-2']);
  });

  it('sends no key when the daemon predates 9.13', async () => {
    const api = makeApi();
    await toImageReferenceBlocks(
      'ws-1',
      [{ type: 'image', data: btoa('abc'), mimeType: 'image/png' }],
      api,
    );
    const [, , source] = (api.placeAttachment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect('idempotencyKey' in (source as object)).toBe(false);
  });

  describe('retry identity', () => {
    /** 9.13+ daemon: reuses a retained key, mints `fresh-N` otherwise. */
    function keyed(overrides: Partial<ImagePlacementApi> = {}) {
      let n = 0;
      return makeApi({
        mintIdempotencyKey: vi.fn((existing?: string) => existing ?? `fresh-${++n}`),
        ...overrides,
      });
    }

    it('rejects with the retry blocks: references for placed images, keyed inline blocks for failed ones', async () => {
      const api = keyed({
        placeAttachment: vi.fn(async (_ws: string, fileName: string) => {
          if (fileName.endsWith('-2.png')) throw transportLoss();
          return placedResult('att-first', 'image/png');
        }),
      });
      const blocks: WireImageBlock[] = [
        { type: 'image', data: btoa('abc'), mimeType: 'image/png' },
        { type: 'image', data: btoa('def'), mimeType: 'image/png' },
        { type: 'image', attachmentId: 'att-existing', mimeType: 'image/webp' },
      ];

      const error: unknown = await toImageReferenceBlocks('ws-1', blocks, api).catch((e) => e);

      expect(error).toBeInstanceOf(ImagePlacementError);
      const retry = (error as ImagePlacementError).retryBlocks;
      const [, requestedName] = (api.placeAttachment as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(retry).toEqual([
        { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
        {
          type: 'image',
          data: btoa('def'),
          mimeType: 'image/png',
          placementIdempotencyKey: 'fresh-2',
          placementFileName: requestedName,
        },
        { type: 'image', attachmentId: 'att-existing', mimeType: 'image/webp' },
      ]);
      expect(imageRetryBlocks(error, blocks)).toBe(retry);
    });

    it('resends a tagged block with its retained key and file name (exact wire shape), placing nothing twice', async () => {
      const api = keyed();
      await toImageReferenceBlocks(
        'ws-1',
        [
          { type: 'image', attachmentId: 'att-first', mimeType: 'image/png' },
          {
            type: 'image',
            data: btoa('def'),
            mimeType: 'image/png',
            placementIdempotencyKey: KEY,
            placementFileName: 'image-1700000000000-2.png',
          },
        ],
        api,
      );
      expect(api.mintIdempotencyKey).toHaveBeenCalledWith(KEY);
      expect(api.placeAttachment).toHaveBeenCalledTimes(1);
      expect(api.placeAttachment).toHaveBeenCalledWith('ws-1', 'image-1700000000000-2.png', {
        data: btoa('def'),
        mimeType: 'image/png',
        idempotencyKey: KEY,
      });
    });

    it('drops a retained key when the daemon connected now predates 9.13', async () => {
      const api = makeApi();
      await toImageReferenceBlocks(
        'ws-1',
        [
          {
            type: 'image',
            data: btoa('def'),
            mimeType: 'image/png',
            placementIdempotencyKey: KEY,
            placementFileName: 'image-1700000000000-1.png',
          },
        ],
        api,
      );
      expect(api.placeAttachment).toHaveBeenCalledWith('ws-1', 'image-1700000000000-1.png', {
        data: btoa('def'),
        mimeType: 'image/png',
      });
    });

    it('imageRetryBlocks falls back to the attempted blocks for any other error', () => {
      const blocks: WireImageBlock[] = [
        { type: 'image', data: btoa('abc'), mimeType: 'image/png' },
      ];
      expect(imageRetryBlocks(new Error('boom'), blocks)).toBe(blocks);
    });
  });
});
