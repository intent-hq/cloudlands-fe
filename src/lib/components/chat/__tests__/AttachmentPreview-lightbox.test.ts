import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import AttachmentPreview from '../AttachmentPreview.svelte';

describe('AttachmentPreview thumbnail lightbox', () => {
  const mockImageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const mockImageMimeType = 'image/png';

  it('opens lightbox when thumbnail is clicked', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Find the thumbnail button
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    expect(thumbnailButton).toBeTruthy();

    // Click the thumbnail
    await fireEvent.click(thumbnailButton);

    // Check if lightbox dialog appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('opens lightbox with Enter key', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });

    // Press Enter key
    await fireEvent.keyDown(thumbnailButton, { key: 'Enter' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('opens lightbox with Space key', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });

    // Press Space key
    await fireEvent.keyDown(thumbnailButton, { key: ' ' });

    // Check if lightbox appears
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeTruthy();
    });
  });

  it('removes attachment without opening lightbox when X is clicked', async () => {
    const onRemove = vi.fn();
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
        onRemove,
      },
    });

    // Find the remove button (X)
    const removeButton = screen.getByRole('button', { name: /remove test\.png/i });
    expect(removeButton).toBeTruthy();

    // Click the remove button
    await fireEvent.click(removeButton);

    // Check that onRemove was called
    expect(onRemove).toHaveBeenCalledWith('test-img');

    // Check that lightbox did NOT appear
    const dialog = screen.queryByRole('dialog', { name: /image preview/i });
    expect(dialog).toBeFalsy();
  });

  it('closes lightbox when Escape is pressed', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Press Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when close button is clicked', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click close button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Lightbox should close
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });
  });

  it('closes lightbox when backdrop is clicked', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Click the backdrop (dialog element itself)
    const dialog = screen.getByRole('dialog', { name: /image preview/i });
    await fireEvent.click(dialog);

    // Lightbox should close and focus should return to thumbnail
    await waitFor(() => {
      const dialogAfter = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialogAfter).toBeFalsy();
      expect(document.activeElement).toBe(thumbnailButton);
    });
  });

  it('moves focus into dialog when opened', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox and check focus moved into it
    await waitFor(() => {
      const closeButton = screen.getByRole('button', { name: /close preview/i });
      expect(closeButton).toBeTruthy();
      expect(document.activeElement).toBe(closeButton);
    });
  });

  it('returns focus to thumbnail button when closed via Escape', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Get the thumbnail button
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });

    // Open the lightbox
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via Escape
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(thumbnailButton);
    });
  });

  it('returns focus to thumbnail button when closed via X button', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Get the thumbnail button
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });

    // Open the lightbox
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Close via X button
    const closeButton = screen.getByRole('button', { name: /close preview/i });
    await fireEvent.click(closeButton);

    // Wait for lightbox to close and check focus returned
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /image preview/i })).toBeFalsy();
      expect(document.activeElement).toBe(thumbnailButton);
    });
  });

  it('does not crash when thumbnail is removed before lightbox closes', async () => {
    const { unmount } = render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });

    // Unmount the component (removes the thumbnail button)
    unmount();

    // Close the lightbox via Escape - should not crash
    await fireEvent.keyDown(window, { key: 'Escape' });

    // Wait for lightbox to close - should succeed without errors
    await waitFor(() => {
      const dialog = screen.queryByRole('dialog', { name: /image preview/i });
      expect(dialog).toBeFalsy();
    });

    // No assertion on focus since the thumbnail is unmounted
    // The test passing without throwing proves the isConnected check works
  });

  it('traps focus with Tab key wrapping between first and last focusable elements', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Wait for lightbox to appear and close button to be focused
    await waitFor(() => {
      const closeButton = screen.getByRole('button', { name: /close preview/i });
      expect(closeButton).toBeTruthy();
      expect(document.activeElement).toBe(closeButton);
    });

    const closeButton = screen.getByRole('button', { name: /close preview/i });
    const resetZoomButton = screen.getByRole('button', { name: /reset zoom/i });

    // Shift+Tab from close button (first focusable) should wrap to the last
    // focusable element (the reset zoom button in the zoom controls)
    await fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(resetZoomButton);

    // Tab from the last focusable element should wrap back to the close button
    await fireEvent.keyDown(resetZoomButton, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);
  });

  it('renders zoom controls in the lightbox', async () => {
    render(AttachmentPreview, {
      props: {
        id: 'test-img',
        name: 'test.png',
        type: 'image/png',
        imageData: mockImageData,
        imageMimeType: mockImageMimeType,
        variant: 'thumbnail',
      },
    });

    // Open the lightbox
    const thumbnailButton = screen.getByRole('button', { name: /view test\.png full size/i });
    await fireEvent.click(thumbnailButton);

    // Zoom controls should render inside the lightbox
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: /zoom controls/i })).toBeTruthy();
    });
    expect(screen.getByRole('slider', { name: /zoom level/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reset zoom/i })).toBeTruthy();
  });
});
