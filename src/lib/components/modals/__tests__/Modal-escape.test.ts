/**
 * Modal.svelte Escape handling via the escape-layer stack.
 *
 * Migrated from a legacy capture-phase window keydown listener. Semantics
 * preserved: Escape closes the modal, EXCEPT while an input/textarea is
 * focused — then the modal declines so the input's own handler keeps the key.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';
import Modal from '../Modal.svelte';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';

describe('Modal Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes the modal when it is the only overlay', async () => {
    const onClose = vi.fn();
    render(Modal, { props: { open: true, title: 'Test Modal', onClose } });
    await waitFor(() => {
      expect(screen.getByText('Test Modal')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Test Modal')).toBeFalsy();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('declines Escape while an input is focused (modal stays open, event not consumed)', async () => {
    const onClose = vi.fn();
    render(Modal, { props: { open: true, title: 'Test Modal', onClose } });
    await waitFor(() => {
      expect(screen.getByText('Test Modal')).toBeTruthy();
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const notCancelled = await fireEvent.keyDown(input, { key: 'Escape' });

    // fireEvent returns false if preventDefault was called — the modal must decline
    expect(notCancelled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Test Modal')).toBeTruthy();
    input.remove();

    // Escape from a non-input target still closes
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Test Modal')).toBeFalsy();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opened on top of another escape layer: Escape closes the modal first (LIFO)', async () => {
    const lowerLayer = vi.fn();
    const releaseLower = pushEscapeLayer(lowerLayer);
    try {
      const onClose = vi.fn();
      render(Modal, { props: { open: true, title: 'Test Modal', onClose } });
      await waitFor(() => {
        expect(screen.getByText('Test Modal')).toBeTruthy();
      });

      // First Escape: the modal (topmost layer) closes; lower layer untouched
      await fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByText('Test Modal')).toBeFalsy();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(lowerLayer).not.toHaveBeenCalled();

      // Second Escape: falls through to the lower layer
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(lowerLayer).toHaveBeenCalledTimes(1);
    } finally {
      releaseLower();
    }
  });
});
