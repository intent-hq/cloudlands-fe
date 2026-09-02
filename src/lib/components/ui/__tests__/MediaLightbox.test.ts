import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transitionMocks = vi.hoisted(() => ({
  fade: vi.fn(() => ({ duration: 0, css: () => '' })),
}));

vi.mock('svelte/transition', () => ({ fade: transitionMocks.fade }));

import MediaLightboxHarness from './MediaLightbox.test-harness.svelte';

describe('MediaLightbox', () => {
  beforeEach(() => {
    transitionMocks.fade.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('mounts the dialog in a body portal', async () => {
    const { container } = render(MediaLightboxHarness, { props: { initialOpen: true } });
    const dialog = await screen.findByRole('dialog', { name: 'Media preview' });

    expect(document.body.contains(dialog)).toBe(true);
    expect(container.contains(dialog)).toBe(false);
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(MediaLightboxHarness);
    const trigger = screen.getByRole('button', { name: 'Open media' });
    const focusSpy = vi.spyOn(trigger, 'focus');
    trigger.focus();
    focusSpy.mockClear();
    await fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Media preview' });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Media preview' })).toBeNull());
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(trigger);
  });

  it('uses no fade duration when reduced motion is preferred', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    render(MediaLightboxHarness, { props: { initialOpen: true } });
    await screen.findByRole('dialog', { name: 'Media preview' });

    expect(transitionMocks.fade).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ duration: 0 }),
      expect.anything(),
    );
  });
});
