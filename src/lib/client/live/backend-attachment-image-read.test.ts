import { describe, expect, it, vi } from 'vitest';
import { createAttachmentImageRead } from './backend-attachment-image-read';
import type { BackendTransport } from './backend-transport-types';

const attachment = {
  attachmentId: 'image-1',
  fileName: 'screen.png',
  path: '.intent/attachments/screen.png',
  exists: true,
  mimeType: 'image/png',
  size: 3,
};
const chunk = { content: '/wAB', bytesRead: 3, size: 3 };
const signal = () => new AbortController().signal;
const reader = (request: ReturnType<typeof vi.fn>) =>
  createAttachmentImageRead(request as BackendTransport['request']);

describe('admitted attachment PNG reads', () => {
  it('uses the scoped registry path and preserves exact binary bytes', async () => {
    const request = vi.fn().mockResolvedValueOnce(attachment).mockResolvedValueOnce(chunk);
    expect(await reader(request)('ws', 'image-1', signal())).toEqual({
      attachment,
      data: new Uint8Array([255, 0, 1]),
    });
    expect(request.mock.calls).toEqual([
      ['file.getAttachmentInfo', { workspaceId: 'ws', attachmentId: 'image-1' }],
      ['file.readChunk', { workspaceId: 'ws', path: attachment.path, offset: 0, length: 1048576 }],
    ]);
  });
  it.each([
    { attachmentId: 'other' },
    { exists: false },
    { mimeType: 'image/svg+xml' },
    { path: '.intent/attachments/image.svg' },
    { path: '../secret.png' },
    { path: '.intent/attachments/../secret.png' },
    { path: '/tmp/secret.png' },
    { path: '.intent/attachments/a\\secret.png' },
    { path: '.intent/attachments/a\0.png' },
  ])('rejects invalid registry provenance before requesting bytes: %j', async (override) => {
    const request = vi.fn().mockResolvedValue({ ...attachment, ...override });
    await expect(reader(request)('ws', 'image-1', signal())).rejects.toThrow('Unsupported');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not issue bytes after its owner retires during registry lookup', async () => {
    const controller = new AbortController();
    let settle!: (value: typeof attachment) => void;
    const request = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const pending = reader(request)('ws', 'image-1', controller.signal);
    controller.abort();
    settle(attachment);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects changed size instead of publishing mismatched attachment bytes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...attachment, size: 4 })
      .mockResolvedValueOnce(chunk);
    await expect(reader(request)('ws', 'image-1', signal())).rejects.toThrow('size changed');
  });
});
