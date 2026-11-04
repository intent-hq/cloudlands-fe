/**
 * Bounded object reads (PROTOCOL §5.9): every read sends
 * `maxBytes`, a fitting or legacy reply is used as is, and a truncated reply
 * is replaced by the whole object read with the chunk methods.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));

import {
  InvalidUtf8Error,
  OBJECT_CHUNK_BYTES,
  OBJECT_READ_MAX_BYTES,
  OBJECT_WHOLE_MAX_BYTES,
  readAllChunks,
  readFileText,
  showFileText,
} from './bounded-object-read';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** A fake request serving `whole` through the bounded and chunk methods. */
function fakeDaemon(whole: Uint8Array, opts: { legacy?: boolean; sizeDrift?: boolean } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    const text = Buffer.from(whole).toString('utf8');
    if (method === 'file.read' || method === 'git.showFile') {
      if (opts.legacy) return method === 'file.read' ? text : { content: text };
      const truncated = whole.length > 10;
      return { content: truncated ? text.slice(0, 10) : text, truncated, totalBytes: whole.length };
    }
    const offset = params.offset as number;
    const length = params.length as number;
    const slice = whole.subarray(offset, offset + length);
    const size = opts.sizeDrift && offset > 0 ? whole.length + 1 : whole.length;
    return { content: b64(slice), bytesRead: slice.length, size };
  });
  return { request: request as never, calls };
}

describe('readFileText', () => {
  it('sends maxBytes and returns a fitting reply without chunk reads', async () => {
    const { request, calls } = fakeDaemon(Buffer.from('short'));
    await expect(readFileText({ workspaceId: 'w', path: 'a.txt' }, request)).resolves.toBe('short');
    expect(calls).toEqual([
      {
        method: 'file.read',
        params: { workspaceId: 'w', path: 'a.txt', maxBytes: OBJECT_READ_MAX_BYTES },
      },
    ]);
  });

  it('accepts the legacy bare-string reply of a daemon without maxBytes support', async () => {
    const { request, calls } = fakeDaemon(Buffer.from('legacy whole file text'), { legacy: true });
    await expect(readFileText({ workspaceId: 'w', path: 'a.txt' }, request)).resolves.toBe(
      'legacy whole file text',
    );
    expect(calls).toHaveLength(1);
  });

  it('reads a truncated file whole with file.readChunk, keeping the scope', async () => {
    const text = 'héllo wörld, a file past the cap ✓';
    const { request, calls } = fakeDaemon(Buffer.from(text));
    await expect(
      readFileText({ workspaceId: 'w', path: 'a.txt', gitRootId: 'r' }, request),
    ).resolves.toBe(text);
    expect(calls[1]).toEqual({
      method: 'file.readChunk',
      params: {
        workspaceId: 'w',
        path: 'a.txt',
        gitRootId: 'r',
        offset: 0,
        length: OBJECT_CHUNK_BYTES,
      },
    });
  });

  it('keeps a byte-order mark like read_to_string', async () => {
    const { request } = fakeDaemon(Buffer.from('﻿bom file past the cap'));
    await expect(readFileText({ workspaceId: 'w', path: 'a.txt' }, request)).resolves.toBe(
      '﻿bom file past the cap',
    );
  });

  it('throws InvalidUtf8Error for a chunked file that is not UTF-8', async () => {
    const { request } = fakeDaemon(
      new Uint8Array([0x61, 0xff, 0xfe, ...Buffer.from('more bytes here')]),
    );
    await expect(readFileText({ workspaceId: 'w', path: 'b.bin' }, request)).rejects.toBeInstanceOf(
      InvalidUtf8Error,
    );
  });

  it('returns null for a reply that holds no text', async () => {
    const request = vi.fn(async () => ({ unexpected: true }));
    await expect(
      readFileText({ workspaceId: 'w', path: 'a' }, request as never),
    ).resolves.toBeNull();
  });
});

describe('showFileText', () => {
  it('reads a truncated blob whole with git.showFileChunk and replacement decoding', async () => {
    const bytes = new Uint8Array([...Buffer.from('blob at a ref '), 0xff, ...Buffer.from(' end')]);
    const { request, calls } = fakeDaemon(bytes);
    await expect(
      showFileText({ workspaceId: 'w', filePath: 'a.rs', ref: ':0', gitRootId: 'r' }, request),
    ).resolves.toBe('blob at a ref � end');
    expect(calls[0].params).toEqual({
      workspaceId: 'w',
      filePath: 'a.rs',
      ref: ':0',
      gitRootId: 'r',
      maxBytes: OBJECT_READ_MAX_BYTES,
    });
    expect(calls[1].method).toBe('git.showFileChunk');
  });

  it('accepts the legacy { content } reply and folds a reply without content to empty', async () => {
    const { request } = fakeDaemon(Buffer.from('legacy content past ten'), { legacy: true });
    await expect(
      showFileText({ workspaceId: 'w', filePath: 'a', ref: 'HEAD' }, request),
    ).resolves.toBe('legacy content past ten');
    const empty = vi.fn(async () => ({}));
    await expect(
      showFileText({ workspaceId: 'w', filePath: 'a', ref: 'HEAD' }, empty as never),
    ).resolves.toBe('');
  });
});

describe('readAllChunks', () => {
  it('assembles windows until a short window', async () => {
    const whole = new Uint8Array(21).map((_, i) => i * 7);
    const { request, calls } = fakeDaemon(whole);
    const read = await readAllChunks('file.readChunk', { workspaceId: 'w', path: 'a' }, request, 8);
    expect(read).toEqual(whole);
    expect(calls.map((c) => [c.params.offset, c.params.length])).toEqual([
      [0, 8],
      [8, 8],
      [16, 8],
    ]);
  });

  it('stops at the size when the last window is full', async () => {
    const whole = new Uint8Array(16).fill(1);
    const { request, calls } = fakeDaemon(whole);
    await readAllChunks('file.readChunk', {}, request, 8);
    expect(calls).toHaveLength(2);
  });

  it('fails when the object changes between windows', async () => {
    const whole = new Uint8Array(21);
    const { request } = fakeDaemon(whole, { sizeDrift: true });
    await expect(
      readAllChunks('file.readChunk', { workspaceId: 'w', path: 'a' }, request, 8),
    ).rejects.toThrow(/changed while it was read/);
  });

  it('refuses objects over the whole-object limit before buffering them', async () => {
    const request = vi.fn(async () => ({
      content: '',
      bytesRead: 0,
      size: OBJECT_WHOLE_MAX_BYTES + 1,
    }));
    await expect(readAllChunks('file.readChunk', {}, request as never)).rejects.toThrow(/over the/);
  });
});
