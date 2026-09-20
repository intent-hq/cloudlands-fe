import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentInfo } from './input/context-api';
import { observeAttachmentImageUrl } from './attachment-image-url';

const { backendRequest, reconnectHandlers } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  reconnectHandlers: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest,
  onBackendReconnected: (handler: () => void) => {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  },
}));

beforeEach(() => backendRequest.mockReset());
afterEach(() => expect(reconnectHandlers.size).toBe(0));

describe('attachment image observation', () => {
  it('coalesces reconnects during a failed lookup into one trailing lookup', async () => {
    const attachmentId = '80a39dfa-66c4-43a2-814f-43c28549d7dd';
    let rejectLookup!: (error: Error) => void;
    const pending = new Promise<AttachmentInfo>((_, reject) => {
      rejectLookup = reject;
    });
    backendRequest.mockReturnValueOnce(pending).mockResolvedValueOnce({
      attachmentId,
      fileName: 'retry.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedAt: '2026-09-17T00:00:00Z',
      path: '.intent/attachments/retry.png',
      exists: true,
    });
    const onUrl = vi.fn();
    const observer = observeAttachmentImageUrl('workspace-one', attachmentId, onUrl);
    try {
      for (let index = 0; index < 5; index += 1) {
        for (const handler of reconnectHandlers) handler();
      }
      expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.getAttachmentInfo', {
        attachmentId,
      });
      rejectLookup(new Error('connection lost'));
      await vi.waitFor(() =>
        expect(onUrl).toHaveBeenLastCalledWith(
          'workspace-file://workspace-one/.intent/attachments/retry.png',
        ),
      );
      expect(backendRequest).toHaveBeenCalledTimes(2);
      expect(backendRequest).toHaveBeenLastCalledWith('file.getAttachmentInfo', { attachmentId });
      expect(onUrl.mock.calls).toEqual([
        [null],
        ['workspace-file://workspace-one/.intent/attachments/retry.png'],
      ]);
    } finally {
      observer.dispose();
    }
  });

  it('disposes a pending lookup without emitting or starting its queued retry', async () => {
    const attachmentId = '091026f5-9a12-40ce-905b-a7ac3ac1db7c';
    let resolveLookup!: (info: AttachmentInfo) => void;
    const pending = new Promise<AttachmentInfo>((resolve) => {
      resolveLookup = resolve;
    });
    backendRequest.mockReturnValueOnce(pending);
    const onUrl = vi.fn();
    const observer = observeAttachmentImageUrl('workspace-two', attachmentId, onUrl);
    for (const handler of reconnectHandlers) handler();
    observer.dispose();
    resolveLookup({
      attachmentId,
      fileName: 'late.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedAt: '2026-09-17T00:00:00Z',
      path: '.intent/attachments/late.png',
      exists: true,
    });
    // Drain the registry lookup, URL resolution, and observer continuations.
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUrl).not.toHaveBeenCalled();
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.getAttachmentInfo', {
      attachmentId,
    });
  });
});
