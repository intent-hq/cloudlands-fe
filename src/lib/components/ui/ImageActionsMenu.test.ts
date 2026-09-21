/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageActionsMenu from './ImageActionsMenu.svelte';

async function openMenu() {
  const trigger = screen.getByRole('button', { name: /image options/i });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImageActionsMenu source actions', () => {
  it('offers copy image for a workspace asset without path or link actions', async () => {
    render(ImageActionsMenu, { props: { imageUrl: 'workspace-asset://asset-123' } });
    await openMenu();

    expect(screen.getByRole('menuitem', { name: /download/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /copy image/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /copy path/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /copy link/i })).toBeNull();
  });

  it('copies the link for an HTTPS image', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const imageUrl = 'https://example.com/image.png';
    render(ImageActionsMenu, { props: { imageUrl } });
    await openMenu();

    expect(screen.getByRole('menuitem', { name: /copy image/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /copy path/i })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: /copy link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(imageUrl));
  });

  it('keeps copy image alongside copy path for workspace files', async () => {
    render(ImageActionsMenu, {
      props: { imageUrl: 'workspace-file://ws-1/docs/image.png' },
    });
    await openMenu();

    expect(screen.getByRole('menuitem', { name: /copy image/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /copy path/i })).toBeTruthy();
  });
});
