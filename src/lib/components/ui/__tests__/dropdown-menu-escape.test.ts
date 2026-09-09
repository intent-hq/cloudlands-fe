/**
 * dropdown-menu.svelte Escape handling via the escape-layer stack.
 *
 * While open, the dropdown occupies the top of the escape-layer stack and
 * DECLINES the event: lower layers (e.g. an expanded sidebar panel) are
 * shielded from the same keypress, while the unconsumed event still falls
 * through to bits-ui's own Escape handling, which closes the menu and
 * restores focus to the trigger.
 *
 * NOTE: The actual close-on-Escape (bits-ui) is verified in the Playwright
 * component test (files-open-in-dropdown.ct.spec.ts) running in a real
 * browser — bits-ui's Escape handling does not work reliably in jsdom.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import DropdownMenu from '../dropdown-menu.svelte';

function dispatchEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

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

    const event = dispatchEscape();

    // No layer on the stack — the event must not be consumed
    expect(event.defaultPrevented).toBe(false);
  });

  it('shields lower escape layers while open, without consuming the event', async () => {
    // Simulates an expanded sidebar panel registered below the dropdown.
    const panelDismiss = vi.fn();
    const releasePanel = pushEscapeLayer(panelDismiss);
    try {
      render(DropdownMenu, { props: { open: true } });
      await tick();
      expect(screen.getByRole('menu')).toBeTruthy();

      const event = dispatchEscape();

      // The dropdown's layer is topmost and declines: the panel layer must
      // not fire, and the event stays unconsumed for bits-ui to close the menu.
      expect(panelDismiss).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      releasePanel();
    }
  });

  it('yields Escape back to lower layers once closed', async () => {
    const panelDismiss = vi.fn();
    const releasePanel = pushEscapeLayer(panelDismiss);
    try {
      const { rerender } = render(DropdownMenu, { props: { open: true } });
      await tick();

      await rerender({ open: false });
      await tick();
      expect(screen.queryByRole('menu')).toBeFalsy();

      dispatchEscape();

      // Dropdown layer released — the panel layer handles the next Escape.
      expect(panelDismiss).toHaveBeenCalledTimes(1);
    } finally {
      releasePanel();
    }
  });
});
