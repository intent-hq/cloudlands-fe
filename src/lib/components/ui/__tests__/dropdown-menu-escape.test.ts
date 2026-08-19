/**
 * dropdown-menu.svelte Escape handling via the escape-layer stack.
 *
 * NOTE: Escape dismissal is verified in the Playwright component test
 * (files-open-in-dropdown.ct.spec.ts) running in a real browser, not here.
 * bits-ui's Escape handling does not work reliably in jsdom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
} from '@testing-library/svelte';
import DropdownMenu from '../dropdown-menu.svelte';

describe('DropdownMenu Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the menu when open', async () => {
    render(DropdownMenu, { props: { open: true } });
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('data-state')).toBe('open');
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
