// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createBackendAttachmentPlacement } from './backend-attachment-placement';
import type { BackendTransport } from './backend-transport-types';
import type { AttachmentByteSource } from './attachment-upload-types';

const MiB = 1024 * 1024;
const placed = {
  ok: true,
  attachmentId: 'registered-attachment',
  path: '.intent/attachments/chosen-2.bin',
  fileName: 'chosen-2.bin',
  size: 4,
  mimeType: 'application/octet-stream',
  uploadedAt: '2026-10-14T00:00:00Z',
};
const { ok: _ok, ...registryFields } = placed;
const info = { ...registryFields, exists: true };
const KEY = 'attachment-attempt-1';
const timeout = { timeoutMs: 300000 };
const factory = (request: ReturnType<typeof vi.fn>) =>
  createBackendAttachmentPlacement(request as BackendTransport['request']);
const lost = () => Object.assign(new Error('reply lost'), { code: 'TRANSPORT_ERROR' });

function stagedRequest() {
  return vi.fn(async (method: string) => {
    switch (method) {
      case 'file.attachmentUpload.begin':
        return { uploadId: 'upload-1', maxChunkBytes: 16 * MiB };
      case 'file.attachmentUpload.chunk':
        return { uploadId: 'upload-1', seq: 0, receivedBytes: 1 };
      case 'file.attachmentUpload.commit':
      case 'file.placeAttachment':
        return placed;
      case 'file.attachmentUpload.abort':
        return { uploadId: 'upload-1', aborted: true };
      case 'file.getAttachmentInfo':
        return info;
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  });
}

/** A bounded source lets cancellation tests pause a stage without large allocations. */
function source(size = 26 * MiB): AttachmentByteSource {
  return {
    size,
    readBase64: vi.fn(async () => 'AA=='),
    sha256: vi.fn(async () => 'a'.repeat(64)),
  };
}

it('places genuine File bytes and returns the unchanged daemon placement', async () => {
  const request = vi.fn().mockResolvedValue(placed);
  const file = new File([new Uint8Array([0, 255, 1, 128])], 'chosen.bin', {
    type: 'application/octet-stream',
  });
  expect(
    await factory(request).place('workspace-a', file.name, file, {
      mimeType: file.type,
      idempotencyKey: KEY,
    }),
  ).toBe(placed);
  expect(request.mock.calls).toEqual([
    [
      'file.placeAttachment',
      {
        workspaceId: 'workspace-a',
        fileName: 'chosen.bin',
        data: 'AP8BgA==',
        mimeType: 'application/octet-stream',
        idempotencyKey: KEY,
      },
    ],
  ]);
});

it('keeps an exact 25 MiB file on the single-shot arm', async () => {
  const request = vi.fn().mockResolvedValue(placed);
  await factory(request).place('workspace-a', 'boundary.bin', new Blob([new Uint8Array(25 * MiB)]));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('file.placeAttachment');
  expect(Buffer.from(request.mock.calls[0][1].data, 'base64').byteLength).toBe(25 * MiB);
});

it.each([8, 32])(
  'uploads genuine Blob bytes with the smaller of daemon %i MiB and client 16 MiB caps',
  async (daemonCap) => {
    const bytes = new Uint8Array(26 * MiB);
    bytes[0] = 255;
    bytes[16 * MiB] = 123;
    bytes[bytes.length - 1] = 42;
    const expectedHash = createHash('sha256').update(bytes).digest('hex');
    const received: Buffer[] = [];
    const request = vi.fn(
      async (method: string, params: Record<string, unknown>, options?: { timeoutMs?: number }) => {
        if (method === 'file.attachmentUpload.begin') {
          expect(params).toEqual({
            workspaceId: 'workspace-a',
            fileName: 'large.bin',
            sizeBytes: bytes.length,
            sha256: expectedHash,
            idempotencyKey: KEY,
          });
          return { uploadId: 'upload-1', maxChunkBytes: daemonCap * MiB };
        }
        expect(options).toEqual(timeout);
        if (method === 'file.attachmentUpload.chunk') {
          expect(params.workspaceId).toBe('workspace-a');
          expect(params.uploadId).toBe('upload-1');
          expect(params.seq).toBe(received.length);
          const slice = Buffer.from(params.data as string, 'base64');
          expect(slice.length).toBeLessThanOrEqual(Math.min(daemonCap, 16) * MiB);
          received.push(slice);
          return {
            uploadId: 'upload-1',
            seq: params.seq,
            receivedBytes: received.reduce((n, b) => n + b.length, 0),
          };
        }
        expect(method).toBe('file.attachmentUpload.commit');
        expect(params).toEqual({ workspaceId: 'workspace-a', uploadId: 'upload-1' });
        return placed;
      },
    );
    const progress = vi.fn();
    const result = await factory(request).place('workspace-a', 'large.bin', new Blob([bytes]), {
      idempotencyKey: KEY,
      onProgress: progress,
    });
    expect(result).toBe(placed);
    expect(Buffer.concat(received).equals(Buffer.from(bytes))).toBe(true);
    expect(progress.mock.calls.map(([fraction]) => fraction)).toEqual(
      received.map((_, index) => (index + 1) / received.length),
    );
  },
);

it.each([1024 * MiB + 1, -1, NaN, Infinity, 1.5])(
  'rejects invalid total size %s before reads, hashing, or requests',
  async (size) => {
    const input = source(size);
    const request = stagedRequest();
    await expect(factory(request).place('workspace-a', 'oversize.bin', input)).rejects.toThrow();
    expect(input.readBase64).not.toHaveBeenCalled();
    expect(input.sha256).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  },
);

it('accepts the 1 GiB limit before hashing without reading beyond it', async () => {
  const input = source(1024 * MiB);
  const stop = new Error('hash sentinel');
  input.sha256 = vi.fn(async () => {
    throw stop;
  });
  await expect(factory(stagedRequest()).place('workspace-a', 'limit.bin', input)).rejects.toBe(
    stop,
  );
  expect(input.sha256).toHaveBeenCalledOnce();
  expect(input.readBase64).not.toHaveBeenCalled();
});

it.each([0, -1, NaN, Infinity, 0.5])(
  'rejects daemon chunk cap %s and aborts instead of looping or committing',
  async (cap) => {
    const request = stagedRequest().mockResolvedValueOnce({
      uploadId: 'upload-1',
      maxChunkBytes: cap,
    });
    const input = source();
    await expect(factory(request).place('workspace-a', 'large.bin', input)).rejects.toThrow(
      'chunk cap',
    );
    expect(input.readBase64).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'file.attachmentUpload.begin',
      'file.attachmentUpload.abort',
    ]);
    expect(request).toHaveBeenLastCalledWith('file.attachmentUpload.abort', {
      workspaceId: 'workspace-a',
      uploadId: 'upload-1',
    });
  },
);

it('recovers a lost single-shot reply with the original workspace and key', async () => {
  const request = vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce(info);
  expect(
    await factory(request).place('workspace-a', 'chosen.bin', new Blob(['abc']), {
      idempotencyKey: KEY,
    }),
  ).toEqual({ ...placed, replayed: true });
  expect(request).toHaveBeenLastCalledWith('file.getAttachmentInfo', {
    workspaceId: 'workspace-a',
    idempotencyKey: KEY,
  });
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(['begin', 'commit'])(
  'recovers a previously committed attachment after %s without abort or duplicate placement',
  async (phase) => {
    const request = stagedRequest();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method) => {
      if (method === `file.attachmentUpload.${phase}`) {
        throw phase === 'begin'
          ? Object.assign(new Error('already committed'), { rpcCode: -32602 })
          : lost();
      }
      return normal(method);
    });
    expect(
      await factory(request).place('workspace-a', 'large.bin', source(), { idempotencyKey: KEY }),
    ).toEqual({ ...placed, replayed: true });
    expect(request).toHaveBeenLastCalledWith('file.getAttachmentInfo', {
      workspaceId: 'workspace-a',
      idempotencyKey: KEY,
    });
    expect(
      request.mock.calls.some(
        ([method]) => method === 'file.attachmentUpload.abort' || method === 'file.placeAttachment',
      ),
    ).toBe(false);
  },
);

it('does not look up a daemon refusal or an unkeyed failure', async () => {
  for (const [error, key] of [
    [Object.assign(new Error('invalid params'), { rpcCode: -32602 }), KEY],
    [lost(), undefined],
  ] as const) {
    const request = vi.fn().mockRejectedValue(error);
    await expect(
      factory(request).place('workspace-a', 'chosen.bin', new Blob(['abc']), {
        idempotencyKey: key,
      }),
    ).rejects.toBe(error);
    expect(request).toHaveBeenCalledOnce();
  }
});

for (const retirement of ['abort', 'current'] as const) {
  describe(`${retirement} guards`, () => {
    it('rejects before any read or request', async () => {
      const input = source();
      const request = stagedRequest();
      const aborter = new AbortController();
      aborter.abort();
      await expect(
        factory(request).place(
          'workspace-a',
          'chosen.bin',
          input,
          retirement === 'abort' ? { signal: aborter.signal } : { current: () => false },
        ),
      ).rejects.toThrow();
      expect(input.sha256).not.toHaveBeenCalled();
      expect(input.readBase64).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

    it.each(['hash', 'begin', 'read', 'chunk', 'commit', 'lookup'])(
      'suppresses late results and further work after %s',
      async (phase) => {
        const aborter = new AbortController();
        let current = true;
        const retire = () => {
          if (retirement === 'abort') aborter.abort();
          else current = false;
        };
        const request = stagedRequest();
        const normal = request.getMockImplementation()!;
        request.mockImplementation(async (method) => {
          if (phase === 'lookup' && method === 'file.attachmentUpload.commit') throw lost();
          if (
            method ===
            (phase === 'lookup' ? 'file.getAttachmentInfo' : `file.attachmentUpload.${phase}`)
          )
            retire();
          return normal(method);
        });
        const input = source();
        if (phase === 'hash')
          input.sha256 = vi.fn(async () => {
            retire();
            return 'a'.repeat(64);
          });
        if (phase === 'read')
          input.readBase64 = vi.fn(async () => {
            retire();
            return 'AA==';
          });
        const progress = vi.fn();
        await expect(
          factory(request).place('workspace-a', 'large.bin', input, {
            signal: aborter.signal,
            current: () => current,
            idempotencyKey: KEY,
            onProgress: progress,
          }),
        ).rejects.toThrow();
        const methods = request.mock.calls.map(([method]) => method);
        if (phase === 'hash') expect(methods).toEqual([]);
        if (['begin', 'read', 'chunk'].includes(phase)) {
          expect(methods).not.toContain('file.attachmentUpload.commit');
          expect(progress).not.toHaveBeenCalled();
        }
        if (retirement === 'current' || phase === 'hash')
          expect(methods).not.toContain('file.attachmentUpload.abort');
        else expect(methods.at(-1)).toBe('file.attachmentUpload.abort');
        if (phase !== 'lookup') expect(methods).not.toContain('file.getAttachmentInfo');
        if (phase === 'begin') expect(input.readBase64).not.toHaveBeenCalled();
        if (phase === 'read') expect(methods).not.toContain('file.attachmentUpload.chunk');
        if (phase === 'chunk')
          expect(methods.filter((method) => method === 'file.attachmentUpload.chunk')).toHaveLength(
            1,
          );
      },
    );

    it.each(['read', 'place', 'lookup'])('suppresses late single-shot %s', async (phase) => {
      const aborter = new AbortController();
      let current = true;
      const retire = () => {
        if (retirement === 'abort') aborter.abort();
        else current = false;
      };
      const request = vi.fn(async (method: string) => {
        if (phase === 'lookup' && method === 'file.placeAttachment') throw lost();
        retire();
        return phase === 'lookup' ? info : placed;
      });
      const input = source(1);
      if (phase === 'read')
        input.readBase64 = vi.fn(async () => {
          retire();
          return 'AA==';
        });
      await expect(
        factory(request).place('workspace-a', 'chosen.bin', input, {
          signal: aborter.signal,
          current: () => current,
          idempotencyKey: KEY,
        }),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(phase === 'read' ? 0 : phase === 'place' ? 1 : 2);
    });
  });
}

it('converts inline images through the injected owner without source runtime defaults', async () => {
  const { toImageReferenceBlocks } = await import('./image-attachment-placement');
  const request = vi.fn().mockResolvedValue(placed);
  const api = { ...factory(request), mintIdempotencyKey: () => KEY };
  expect(
    await toImageReferenceBlocks(
      'workspace-a',
      [{ type: 'image', data: 'AP8BgA==', mimeType: 'image/png' }],
      api,
    ),
  ).toEqual([{ type: 'image', attachmentId: placed.attachmentId, mimeType: placed.mimeType }]);
  expect(request).toHaveBeenCalledWith('file.placeAttachment', {
    workspaceId: 'workspace-a',
    fileName: expect.stringMatching(/\.png$/),
    data: 'AP8BgA==',
    mimeType: 'image/png',
    idempotencyKey: KEY,
  });
});

it('does not publish an inline image reference after its original authority retires', async () => {
  const { toImageReferenceBlocks } = await import('./image-attachment-placement');
  let current = true;
  const request = vi.fn(async () => {
    current = false;
    return placed;
  });
  const api = { ...factory(request), mintIdempotencyKey: () => KEY };
  await expect(
    toImageReferenceBlocks(
      'workspace-a',
      [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      api,
      () => current,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).toHaveBeenCalledOnce();
});
