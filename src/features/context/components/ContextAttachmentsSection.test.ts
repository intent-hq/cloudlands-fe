import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextAttachmentsSection from './ContextAttachmentsSection.svelte';
import type { ContextAttachment } from '$store/renderer/slices/context/context-types';
import { store as appStore } from '$store/renderer/store';
import { openWorkspaceAttachment } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const backendRequest = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/client/live/backend-transport')>()),
  backendRequest,
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
