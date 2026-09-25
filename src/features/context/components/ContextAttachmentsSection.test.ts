import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextAttachmentsSection from './ContextAttachmentsSection.svelte';
import type { ContextAttachment } from '$store/renderer/slices/context/context-types';
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const { backendRequest, reconnectHandlers } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  reconnectHandlers: new Set<() => void>(),
}));
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest,
  onBackendReconnected: (handler: () => void) => {
    reconnectHandlers.add(handler);
    return () => reconnectHandlers.delete(handler);
  },
}));

beforeEach(() => backendRequest.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const image: ContextAttachment = {
  id: 'one',
  name: 'landscape.png',
  block: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
};

describe('context image grid interactions', () => {
  it.each(['loaded', 'error'] as const)(
    'waits for the retried hydration result even when loading is coalesced away (%s)',
    async (outcome) => {
      const dispatch = vi.fn();
      vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatch);
      const slim = {
        ...image,
        agentId: 'agent-1',
        messageId: 'message-1',
        block: {
          ...image.block,
          id: 'image-1',
          dataTruncated: true,
          dataIsThumbnail: true,
          dataBytes: 1024,
        },
        hydration: { status: 'error' as const, seq: 1, error: 'offline' },
      };
      const view = render(ContextAttachmentsSection, { workspaceId: 'one', attachments: [slim] });
      const button = screen.getByRole('button', { name: /view landscape.png full size/i });
      await fireEvent.click(button);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chatState/messageBlockHydrationRequested',
          payload: ['agent-1', 'message-1', 'image-1'],
        }),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      // A fast retry may settle before the next readable emission; no loading prop is observed.
      const full = {
        id: 'image-1',
        type: 'image' as const,
        mimeType: 'image/png',
        data: 'b3JpZ2luYWw=',
      };
      await view.rerender({
        workspaceId: 'one',
        attachments: [
          {
            ...slim,
            block: outcome === 'loaded' ? full : slim.block,
            hydration:
              outcome === 'loaded'
                ? { status: 'loaded', seq: 3, block: full }
                : { status: 'error', seq: 3, error: 'still offline' },
          },
        ],
      });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('img').getAttribute('src')).toBe(
        `data:image/png;base64,${outcome === 'loaded' ? full.data : image.block.data}`,
      );
    },
  );

  it('recovers the same attachment URL after reconnect and disposes its listener', async () => {
    const attachmentId = 'image-reconnect';
    backendRequest.mockResolvedValue({
      attachmentId,
      fileName: 'reconnect.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedAt: '2026-09-16T00:00:00Z',
      path: '.intent/attachments/reconnect.png',
      exists: true,
    });
    const view = render(ContextAttachmentsSection, {
      workspaceId: 'one',
      attachments: [
        {
          id: 'reconnect',
          name: 'reconnect.png',
          block: { type: 'image', attachmentId },
        },
      ],
    });
    const thumbnail = await screen.findByAltText('reconnect.png');
    const url = thumbnail.getAttribute('src');
    await fireEvent.error(thumbnail);
    expect(screen.queryByAltText('reconnect.png')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /view reconnect.png full size/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(backendRequest).toHaveBeenCalledTimes(1);
    for (const handler of reconnectHandlers) handler();
    await waitFor(() => expect(screen.getByAltText('reconnect.png').getAttribute('src')).toBe(url));
    expect(backendRequest).toHaveBeenCalledTimes(2);
    expect(backendRequest).toHaveBeenLastCalledWith('file.getAttachmentInfo', { attachmentId });
    await fireEvent.click(screen.getByRole('button', { name: /view reconnect.png full size/i }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    view.unmount();
    expect(reconnectHandlers.size).toBe(0);
  });

  it.each([
    ['brief.pdf', 'application/pdf'],
    ['walkthrough.mp4', 'video/mp4'],
    ['archive.zip', 'application/zip'],
  ])('opens %s through the existing workspace attachment action', async (name, mimeType) => {
    const dispatch = vi.fn();
    vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatch);
    render(ContextAttachmentsSection, {
      workspaceId: 'one',
      attachments: [
        {
          id: 'file',
          name,
          block: { type: 'file', attachmentId: 'att-file', fileName: name, mimeType },
        },
      ],
    });
    await fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      openWorkspaceAttachment('one', 'att-file', name),
    );
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it.each(['placing', 'failed'] as const)(
    'keeps a %s file visible but unavailable until placed',
    async (placementStatus) => {
      const dispatch = vi.fn();
      vi.spyOn(appStore, 'dispatch', 'get').mockReturnValue(dispatch);
      const file = {
        id: 'file',
        name: 'report.pdf',
        block: { type: 'file' as const, fileName: 'report.pdf', mimeType: 'application/pdf' },
      };
      const view = render(ContextAttachmentsSection, {
        workspaceId: 'one',
        attachments: [{ ...file, placementStatus }],
      });
      const button = screen.getByRole('button', { name: /report.pdf/ }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe(String(placementStatus === 'placing'));
      await view.rerender({
        workspaceId: 'one',
        attachments: [
          {
            ...file,
            placementStatus: 'placed',
            block: { ...file.block, attachmentId: 'att-file' },
          },
        ],
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }));
      expect(dispatch).toHaveBeenCalledExactlyOnceWith(
        openWorkspaceAttachment('one', 'att-file', 'report.pdf'),
      );
      await view.rerender({ workspaceId: 'one', attachments: [] });
      expect(screen.queryByRole('region')).toBeNull();
    },
  );

  it('collapses and expands the image section', async () => {
    render(ContextAttachmentsSection, { attachments: [image], workspaceId: 'one' });
    const toggle = screen.getByRole('button', { expanded: true });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByAltText('landscape.png')).toBeNull();
    await fireEvent.click(toggle);
    expect(screen.getByAltText('landscape.png')).toBeTruthy();
  });

  it('opens the shared lightbox from a thumbnail', async () => {
    render(ContextAttachmentsSection, { attachments: [image], workspaceId: 'one' });
    await fireEvent.click(screen.getByRole('button', { name: /view landscape.png full size/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('hides the section after its last image is removed', async () => {
    const view = render(ContextAttachmentsSection, { attachments: [image], workspaceId: 'one' });
    await view.rerender({ attachments: [], workspaceId: 'one' });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('resolves an attachment through the exact daemon request and renders its returned path', async () => {
    const attachmentId = '04591a54-6b26-4b9d-8f62-7df30e3fa378';
    // PROTOCOL §5.9 file.getAttachmentInfo response, matching AttachmentInfo.
    backendRequest.mockResolvedValue({
      attachmentId,
      fileName: 'drawing #1.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedAt: '2026-09-16T00:00:00Z',
      path: '.intent/attachments/drawing #1.png',
      exists: true,
    });
    render(ContextAttachmentsSection, {
      workspaceId: 'one',
      attachments: [
        {
          id: 'placed',
          name: 'drawing #1.png',
          block: { type: 'image', attachmentId },
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByAltText('drawing #1.png').getAttribute('src')).toBe(
        'workspace-file://one/.intent/attachments/drawing%20%231.png',
      ),
    );
    expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.getAttachmentInfo', {
      attachmentId,
    });
    await fireEvent.click(screen.getByRole('button', { name: /view drawing #1.png full size/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });

  it('keeps a missing attachment unavailable without issuing repeated lookups', async () => {
    const attachmentId = '8413140d-8d2a-4621-85d8-63963cddfa3f';
    backendRequest.mockResolvedValue({
      attachmentId,
      fileName: 'missing.png',
      mimeType: 'image/png',
      size: 1024,
      uploadedAt: '2026-09-16T00:00:00Z',
      path: '.intent/attachments/missing.png',
      exists: false,
    });
    render(ContextAttachmentsSection, {
      workspaceId: 'one',
      attachments: [
        {
          id: 'missing',
          name: 'missing.png',
          block: { type: 'image', attachmentId },
        },
      ],
    });
    await waitFor(() =>
      expect(backendRequest).toHaveBeenCalledExactlyOnceWith('file.getAttachmentInfo', {
        attachmentId,
      }),
    );
    expect(screen.queryByAltText('missing.png')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /view missing.png full size/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
