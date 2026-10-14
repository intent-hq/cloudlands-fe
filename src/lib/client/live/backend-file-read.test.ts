import { describe, expect, it, vi } from 'vitest';
import { createFileRead, FILE_TEXT_PREVIEW_BYTES } from './backend-file-read';
import type { BackendTransport } from './backend-transport-types';
import { fileSnapshot } from '$features/file/utils/file-content';

const chunk = (bytes: Uint8Array, size = bytes.length) => ({
  content: Buffer.from(bytes).toString('base64'),
  bytesRead: bytes.length,
  size,
});
const utf8 = (text: string) => new TextEncoder().encode(text);
const options = { readOnlyPreview: true };

describe('explicit bounded read-only file preview', () => {
  it.each(['', 'small complete text', '\ufefftext\r\n'])(
    'retains exact small contents without granting edit/snapshot capability: %j',
    async (text) => {
      const request = vi.fn<BackendTransport['request']>().mockResolvedValue(chunk(utf8(text)));
      const entry = await createFileRead(request)('ws', 'a.json', options);
      expect(entry).toMatchObject({
        kind: 'read-only-text',
        originalContent: text,
        localContent: null,
        truncated: false,
        bytesRead: utf8(text).length,
        totalBytes: utf8(text).length,
      });
      expect(fileSnapshot(entry ?? undefined)).toBeUndefined();
      expect(request.mock.calls).toEqual([
        [
          'file.readChunk',
          { workspaceId: 'ws', path: 'a.json', offset: 0, length: FILE_TEXT_PREVIEW_BYTES },
        ],
      ]);
    },
  );
  it.each([1, 2, 3])(
    'defers a split UTF8 codepoint with %i bytes at the real cap',
    async (kept) => {
      const prefix = 'a'.repeat(FILE_TEXT_PREVIEW_BYTES - kept);
      const bytes = utf8(prefix + '😀');
      const request = vi
        .fn<BackendTransport['request']>()
        .mockResolvedValue(chunk(bytes.slice(0, FILE_TEXT_PREVIEW_BYTES), 129063439));
      const entry = await createFileRead(request)('ws', 'a.json', {
        ...options,
        gitRootId: 'root',
      });
      expect(entry).toMatchObject({
        kind: 'read-only-text',
        originalContent: prefix,
        truncated: true,
        totalBytes: 129063439,
        bytesRead: FILE_TEXT_PREVIEW_BYTES,
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[1]).toMatchObject({
        gitRootId: 'root',
        offset: 0,
        length: FILE_TEXT_PREVIEW_BYTES,
      });
    },
  );
  it.each([
    new Uint8Array([0xff]),
    new Uint8Array([0xf0, 0x9f]),
    new Uint8Array([0xc0, 0xaf]),
    new Uint8Array([0]),
  ])('keeps malformed EOF or binary controls out of text previews', async (bytes) => {
    const request = vi.fn<BackendTransport['request']>().mockResolvedValue(chunk(bytes));
    expect(await createFileRead(request)('ws', 'a', options)).toMatchObject({
      kind: 'preview-only',
      isBinary: true,
      originalContent: null,
    });
  });
  it('rejects invalid UTF8 in the middle of a truncated prefix', async () => {
    const bytes = new Uint8Array(FILE_TEXT_PREVIEW_BYTES).fill(97);
    bytes[7] = 255;
    const request = vi.fn<BackendTransport['request']>().mockResolvedValue(chunk(bytes, 100000));
    expect(await createFileRead(request)('ws', 'a', options)).toMatchObject({
      kind: 'preview-only',
      isBinary: true,
    });
  });
  it.each([
    { content: '', bytesRead: 0, size: 100 },
    { content: 'YQ==', bytesRead: 1, size: 100 },
    { content: 'YQ==', bytesRead: 1, size: 0 },
    { content: 'YQ==', bytesRead: 1, size: -1 },
    { content: 'YQ==', bytesRead: 1, size: 1.5 },
    { content: '!!!!', bytesRead: 1, size: 1 },
    { content: 'YR==', bytesRead: 1, size: 1 },
    { content: 'YQ==', bytesRead: 2, size: 2 },
    {
      content: 'A'.repeat(4 * Math.ceil(FILE_TEXT_PREVIEW_BYTES / 3) + 4),
      bytesRead: FILE_TEXT_PREVIEW_BYTES,
      size: 99999,
    },
  ])('rejects malformed, non-progressing or oversized chunk metadata', async (value) => {
    const request = vi.fn<BackendTransport['request']>().mockResolvedValue(value);
    await expect(createFileRead(request)('ws', 'a', options)).rejects.toThrow(
      'Failed to read file',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not silently change ordinary full-read capability', async () => {
    const request = vi.fn<BackendTransport['request']>().mockResolvedValue('complete');
    expect(await createFileRead(request)('ws', 'a')).toMatchObject({
      kind: 'editable-text',
      originalContent: 'complete',
      truncated: false,
    });
    expect(request.mock.calls).toEqual([['file.read', { workspaceId: 'ws', path: 'a' }]]);
  });
});
