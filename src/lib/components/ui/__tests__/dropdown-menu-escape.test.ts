/**
 * dropdown-menu.svelte Escape handling via the escape-layer stack.
 * Migrated from a document keydown listener; Escape must still dismiss
 * the open menu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';
import DropdownMenu from '../dropdown-menu.svelte';

describe('DropdownMenu Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape dismisses the open menu', async () => {
    render(DropdownMenu, { props: { open: true } });
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeFalsy();
    });
  });

  it('Escape does nothing while the menu is closed (no layer registered)', async () => {
    render(DropdownMenu, { props: { open: false } });
    expect(screen.queryByRole('menu')).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // No layer on the stack — the event must not be consumed
    expect(event.defaultPrevented).toBe(false);
  });
});
