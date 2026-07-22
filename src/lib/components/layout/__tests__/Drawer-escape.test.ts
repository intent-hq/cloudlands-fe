/**
 * Drawer.svelte Escape handling via the escape-layer stack.
 *
 * Migrated from a `svelte:window` Escape listener. Also hosts the
 * stacked-ordering regression: a Drawer opened on top of a Modal closes
 * first (LIFO), the Modal only on the next Escape.
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
import Drawer from '../Drawer.svelte';
import Modal from '$lib/components/modals/Modal.svelte';

describe('Drawer Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes the open drawer', async () => {
    const onclose = vi.fn();
    render(Drawer, { props: { isOpen: true, title: 'Test Drawer', onclose } });
    await waitFor(() => {
      expect(screen.getByText('Test Drawer')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Test Drawer')).toBeFalsy();
    });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('Escape is not consumed while the drawer is closed (no layer registered)', async () => {
    const onclose = vi.fn();
    render(Drawer, { props: { isOpen: false, title: 'Test Drawer', onclose } });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('drawer stacked on a Modal: Escape closes the drawer first, then the modal (LIFO)', async () => {
    const onModalClose = vi.fn();
    const onDrawerClose = vi.fn();
    render(Modal, {
      props: { open: true, title: 'Lower Modal', onClose: onModalClose },
    });
    render(Drawer, {
      props: { isOpen: true, title: 'Top Drawer', onclose: onDrawerClose },
    });
    await waitFor(() => {
      expect(screen.getByText('Lower Modal')).toBeTruthy();
      expect(screen.getByText('Top Drawer')).toBeTruthy();
    });

    // First Escape: only the drawer (topmost layer) closes
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Top Drawer')).toBeFalsy();
    });
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
    expect(onModalClose).not.toHaveBeenCalled();
    expect(screen.getByText('Lower Modal')).toBeTruthy();

    // Second Escape: the modal closes
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Lower Modal')).toBeFalsy();
    });
    expect(onModalClose).toHaveBeenCalledTimes(1);
  });
});
