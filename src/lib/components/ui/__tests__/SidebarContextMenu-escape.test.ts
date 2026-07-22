/**
 * SidebarContextMenu.svelte Escape handling via the escape-layer stack.
 * Migrated from a document keydown listener; Escape must still dismiss
 * the menu (via onClickOutside — the parent removes the component).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';
import SidebarContextMenu from '../sidebar-context-menu/SidebarContextMenu.svelte';

describe('SidebarContextMenu Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape dismisses the menu (calls onClickOutside)', async () => {
    const onClickOutside = vi.fn();
    render(SidebarContextMenu, {
      props: {
        x: 10,
        y: 10,
        items: [{ label: 'Rename', onClick: () => {} }],
        onClickOutside,
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClickOutside).toHaveBeenCalledTimes(1);
  });

  it('releases its escape layer on unmount', async () => {
    const onClickOutside = vi.fn();
    const { unmount } = render(SidebarContextMenu, {
      props: {
        x: 10,
        y: 10,
        items: [{ label: 'Rename', onClick: () => {} }],
        onClickOutside,
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    unmount();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onClickOutside).not.toHaveBeenCalled();
    // No layer left on the stack — the event must not be consumed
    expect(event.defaultPrevented).toBe(false);
  });
});
