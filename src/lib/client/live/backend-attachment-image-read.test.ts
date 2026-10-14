import { describe, expect, it, vi } from 'vitest';
import { createAttachmentMediaRead } from './backend-attachment-image-read';
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
  createAttachmentMediaRead(request as BackendTransport['request'], 'image/png');

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

describe('admitted attachment JPEG reads', () => {
  const jpeg = {
    ...attachment,
    fileName: 'screen.jpg',
    path: '.intent/attachments/screen.jpg',
    mimeType: 'image/jpeg',
  };
  const read = (request: ReturnType<typeof vi.fn>) =>
    createAttachmentMediaRead(request as BackendTransport['request'], 'image/jpeg');

  it.each(['jpg', 'jpeg', 'JPG', 'JPEG'])(
    'preserves exact bytes for the canonical .%s image extension',
    async (extension) => {
      const registered = { ...jpeg, path: `.intent/attachments/screen.${extension}` };
      const request = vi.fn().mockResolvedValueOnce(registered).mockResolvedValueOnce(chunk);
      expect(await read(request)('ws', 'image-1', signal())).toEqual({
        attachment: registered,
        data: new Uint8Array([255, 0, 1]),
      });
      expect(request.mock.calls[1]).toEqual([
        'file.readChunk',
        { workspaceId: 'ws', path: registered.path, offset: 0, length: 1048576 },
      ]);
    },
  );

  it.each([
    { attachmentId: 'other' },
    { exists: false },
    { mimeType: 'image/png' },
    { mimeType: 'image/jpg' },
    { path: '.intent/attachments/screen.png' },
    { path: '.intent/attachments/screen.svg' },
    { path: '.intent/attachments/screen.jpg.exe' },
    { path: '.intent/attachments/../screen.jpeg' },
    { path: '.intent/attachments/a\\screen.jpg' },
    { path: '.intent/attachments/a\0.jpg' },
    { path: '/tmp/screen.jpg' },
  ])('rejects JPEG identity/MIME/path drift before bytes: %j', async (override) => {
    const request = vi.fn().mockResolvedValue({ ...jpeg, ...override });
    await expect(read(request)('ws', 'image-1', signal())).rejects.toThrow('Unsupported');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects changed JPEG size', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...jpeg, size: 4 })
      .mockResolvedValueOnce(chunk);
    await expect(read(request)('ws', 'image-1', signal())).rejects.toThrow('size changed');
  });

  it('retires a JPEG read during its final chunk', async () => {
    const controller = new AbortController();
    let finish!: (value: typeof chunk) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(jpeg)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const pending = read(request)('ws', 'image-1', controller.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort();
    finish(chunk);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('admitted attachment MP4 reads', () => {
  const video = {
    ...attachment,
    fileName: 'recording.mp4',
    path: '.intent/attachments/recording.mp4',
    mimeType: 'video/mp4',
  };
  const read = (request: ReturnType<typeof vi.fn>) =>
    createAttachmentMediaRead(request as BackendTransport['request'], 'video/mp4');

  it('uses the canonical video path policy and the same bounded binary reader', async () => {
    const request = vi.fn().mockResolvedValueOnce(video).mockResolvedValueOnce(chunk);
    expect(await read(request)('ws', 'image-1', signal())).toEqual({
      attachment: video,
      data: new Uint8Array([255, 0, 1]),
    });
    expect(request.mock.calls[1]).toEqual([
      'file.readChunk',
      { workspaceId: 'ws', path: video.path, offset: 0, length: 1048576 },
    ]);
  });

  it.each([
    { attachmentId: 'other' },
    { exists: false },
    { mimeType: 'image/png' },
    { path: '.intent/attachments/recording.webm' },
    { path: '.intent/attachments/../outside.mp4' },
    { path: '/tmp/recording.mp4' },
    { path: '.intent/attachments/a\\recording.mp4' },
    { path: '.intent/attachments/a\0.mp4' },
  ])('rejects video identity/MIME/path drift without reading bytes: %j', async (override) => {
    const request = vi.fn().mockResolvedValue({ ...video, ...override });
    await expect(read(request)('ws', 'image-1', signal())).rejects.toThrow('Unsupported');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not publish a final video chunk after owner cancellation', async () => {
    const controller = new AbortController();
    let finish!: (value: typeof chunk) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(video)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const pending = read(request)('ws', 'image-1', controller.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    controller.abort();
    finish(chunk);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
