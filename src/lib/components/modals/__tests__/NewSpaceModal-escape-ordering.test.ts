/**
 * Regression test: Escape ordering for stacked overlays.
 *
 * Bug: with an ImageLightbox open on top of NewSpaceModal, both components
 * attached their own capture-phase window keydown listeners, so a single
 * Escape press closed BOTH overlays instead of only the topmost one.
 *
 * With the escape-layer stack, the first Escape closes only the lightbox
 * (topmost layer) and a second Escape closes the modal.
 */
import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/svelte';
import NewSpaceModal from '../NewSpaceModal.svelte';
import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';

// Stub the heavy initializer (Redux store, navigation, etc.) — irrelevant here
vi.mock('$lib/components/workspace/CompactWorkspaceInitializer.svelte', async () => ({
  default: (await import('./mocks/MockCompactWorkspaceInitializer.svelte')).default,
}));

describe('NewSpaceModal + ImageLightbox Escape ordering', () => {
  it('first Escape closes only the lightbox, second Escape closes the modal', async () => {
    const modalOnClose = vi.fn();
    const lightboxOnClose = vi.fn();

    // Modal opens first (registers its escape layer first)
    render(NewSpaceModal, { props: { open: true, onClose: modalOnClose } });
    await waitFor(() => {
      expect(screen.getByText('New Workspace')).toBeTruthy();
    });

    // Lightbox opens on top (registers its escape layer second)
    render(ImageLightbox, {
      props: {
        open: true,
        imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        imageName: 'test.png',
        onClose: lightboxOnClose,
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // First Escape: closes only the lightbox
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
    });
    expect(lightboxOnClose).toHaveBeenCalledTimes(1);
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();

    // Second Escape: closes the modal
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('New Workspace')).toBeFalsy();
    });
    expect(modalOnClose).toHaveBeenCalledTimes(1);
    expect(lightboxOnClose).toHaveBeenCalledTimes(1);
  });

  it('Escape still closes the modal when it is the only overlay', async () => {
    const modalOnClose = vi.fn();
    render(NewSpaceModal, { props: { open: true, onClose: modalOnClose } });
    await waitFor(() => {
      expect(screen.getByText('New Workspace')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('New Workspace')).toBeFalsy();
    });
    expect(modalOnClose).toHaveBeenCalledTimes(1);
  });
});
