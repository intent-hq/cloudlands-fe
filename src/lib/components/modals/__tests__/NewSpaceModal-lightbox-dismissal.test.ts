/**
 * Regression test: pointer dismissal for a lightbox stacked above a modal dialog.
 *
 * Bug: with an ImageLightbox open on top of NewSpaceModal (a bits-ui modal
 * dialog), the dialog's interaction lock sets pointer-events: none on body, so
 * the lightbox backdrop never received clicks, and the dialog treated a click
 * on the lightbox as an outside interaction and closed itself.
 *
 * Fix: the lightbox root forces pointer-events: auto and carries a
 * data-image-lightbox-root marker; the shared dialog-content ignores
 * interact-outside events originating inside the lightbox.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import NewSpaceModal from '../NewSpaceModal.svelte';
import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';

// Stub the heavy initializer (Redux store, navigation, etc.) — irrelevant here
vi.mock('$lib/components/workspace/CompactWorkspaceInitializer.svelte', async () => ({
  default: (await import('./mocks/MockCompactWorkspaceInitializer.svelte')).default,
}));

/** The dismissible layer debounces interact-outside by 10ms; let it settle. */
const flushInteractOutside = () => new Promise((resolve) => setTimeout(resolve, 30));

async function renderStackedOverlays() {
  const modalOnClose = vi.fn();
  const lightboxOnClose = vi.fn();

  render(NewSpaceModal, { props: { open: true, onClose: modalOnClose } });
  await waitFor(() => {
    expect(screen.getByText('New Workspace')).toBeTruthy();
  });

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

  // Let the layer's debounced reset from mount-time events settle
  await flushInteractOutside();

  const backdrop = screen.getByRole('dialog', { name: /image preview/i });
  return { modalOnClose, lightboxOnClose, backdrop };
}

describe('NewSpaceModal + ImageLightbox pointer dismissal', () => {
  it('keeps the lightbox backdrop clickable while the modal interaction lock is active', async () => {
    const { backdrop } = await renderStackedOverlays();

    // bits-ui's modal scroll lock disables pointer events at the body level
    expect(document.body.style.pointerEvents).toBe('none');

    // The lightbox root must opt back in so it can receive the click
    expect(backdrop.getAttribute('data-image-lightbox-root')).not.toBeNull();
    expect(getComputedStyle(backdrop).pointerEvents).not.toBe('none');
  });

  it('backdrop click closes only the lightbox; the modal stays open', async () => {
    const { modalOnClose, lightboxOnClose, backdrop } = await renderStackedOverlays();

    await fireEvent.pointerDown(backdrop, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });
    // Wait out the dialog's debounced interact-outside handling: the pointerdown
    // inside the lightbox must NOT count as an outside interaction for the modal
    await flushInteractOutside();
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();

    await fireEvent.click(backdrop, { button: 0, clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
    });
    expect(lightboxOnClose).toHaveBeenCalledTimes(1);
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();
  });

  it('the lightbox X button closes only the lightbox; the modal stays open', async () => {
    const { modalOnClose, lightboxOnClose } = await renderStackedOverlays();

    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.pointerDown(closeButton, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });
    await flushInteractOutside();
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();

    await fireEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
    });
    expect(lightboxOnClose).toHaveBeenCalledTimes(1);
    expect(modalOnClose).not.toHaveBeenCalled();
    expect(screen.getByText('New Workspace')).toBeTruthy();
  });

  it('outside interaction still closes the modal when no lightbox is open', async () => {
    const modalOnClose = vi.fn();
    render(NewSpaceModal, { props: { open: true, onClose: modalOnClose } });
    await waitFor(() => {
      expect(screen.getByText('New Workspace')).toBeTruthy();
    });
    await flushInteractOutside();

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    await fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });

    await waitFor(() => {
      expect(screen.queryByText('New Workspace')).toBeFalsy();
    });
    expect(modalOnClose).toHaveBeenCalledTimes(1);
  });
});
