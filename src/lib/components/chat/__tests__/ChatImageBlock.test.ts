/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatImageBlock from '../ChatImageBlock.svelte';
import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 1x1 transparent PNG
const pngData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function openImageActionsMenu() {
  const trigger = screen.getByRole('button', { name: /image options/i });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  return trigger;
}

describe('ChatImageBlock', () => {
  it('opens the lightbox when the thumbnail is clicked', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'screenshot.png' },
    });

    const trigger = screen.getByRole('button', { name: /view screenshot\.png full size/i });
    expect(trigger.querySelector('img')?.src).toBe(`data:image/png;base64,${pngData}`);

    await fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });
  });

  it('requests hydration instead of opening the lightbox for a truncated thumbnail block', async () => {
    const onHydrate = vi.fn();
    render(ChatImageBlock, {
      props: {
        data: pngData,
        mimeType: 'image/png',
        alt: 'screenshot.png',
        dataTruncated: true,
        dataIsThumbnail: true,
        onHydrate,
      },
    });

    const trigger = screen.getByRole('button', { name: /load full-size screenshot\.png/i });
    await fireEvent.click(trigger);

    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a placeholder chip with on-demand fetch when a truncated block has no data', async () => {
    const onHydrate = vi.fn();
    render(ChatImageBlock, {
      props: {
        mimeType: 'image/png',
        alt: 'screenshot.png',
        dataTruncated: true,
        onHydrate,
      },
    });

    const placeholder = screen.getByTestId('chat-image-placeholder');
    await fireEvent.click(placeholder);

    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an image actions menu whose trigger does not open the lightbox', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'screenshot.png' },
    });

    const trigger = await openImageActionsMenu();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Data-URL image: Download + Copy image (no workspace path to copy).
    expect(screen.getByRole('menuitem', { name: /download/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /copy image/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /copy path/i })).toBeNull();

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes the actions menu inside the opened lightbox', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'screenshot.png' },
    });

    await fireEvent.click(screen.getByRole('button', { name: /view screenshot\.png full size/i }));
    const dialog = await screen.findByRole('dialog', { name: /image preview/i });

    const triggers = screen.getAllByRole('button', { name: /image options/i });
    expect(triggers.some((button) => dialog.contains(button))).toBe(true);
  });
});

describe('ImageActionsMenu actions', () => {
  it('downloads a data-URL image under the display name with an extension', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(ImageActionsMenu, {
      props: { imageUrl: `data:image/png;base64,${pngData}`, imageName: 'screenshot' },
    });
    await openImageActionsMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(`data:image/png;base64,${pngData}`);
    expect(anchor.getAttribute('download')).toBe('screenshot.png');
  });

  it('copies the decoded workspace-relative path for workspace-file images', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(ImageActionsMenu, {
      props: { imageUrl: 'workspace-file://ws-1/docs/some%20dir/pic.png' },
    });
    await openImageActionsMenu();

    expect(screen.queryByRole('menuitem', { name: /copy image/i })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: /copy path/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('docs/some dir/pic.png'));
  });

  it('copies a PNG data-URL image to the clipboard as an image', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { write },
      configurable: true,
    });
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);

    render(ImageActionsMenu, {
      props: { imageUrl: `data:image/png;base64,${pngData}` },
    });
    await openImageActionsMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /copy image/i }));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const item = write.mock.calls[0][0][0] as InstanceType<typeof FakeClipboardItem>;
    expect(item.items['image/png']).toBeInstanceOf(Blob);
    expect(item.items['image/png'].type).toBe('image/png');
    vi.unstubAllGlobals();
  });
});
