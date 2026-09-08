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

  it('replaces image bytes that cannot load with a clear placeholder', async () => {
    render(ChatImageBlock, {
      props: { data: 'not-an-image', mimeType: 'image/png', alt: 'broken.png' },
    });

    const image = screen
      .getByRole('button', { name: /view broken\.png full size/i })
      .querySelector('img')!;
    await fireEvent.error(image);

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('broken.png');
    expect(status.textContent).toContain('could not load');
    expect(screen.queryByRole('button', { name: /view broken\.png full size/i })).toBeNull();
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

  it('suppresses the actions menu on truncated thumbnail blocks until hydration', async () => {
    render(ChatImageBlock, {
      props: {
        data: pngData,
        mimeType: 'image/png',
        alt: 'screenshot.png',
        dataTruncated: true,
        dataIsThumbnail: true,
        onHydrate: vi.fn(),
      },
    });

    // The block only carries the low-res thumbnail bytes: the menu's
    // download/copy/info actions would act on the wrong image.
    expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
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

    expect(screen.getByRole('menuitem', { name: /copy image/i })).toBeTruthy();
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

  it('discards a stale dimensions probe that resolves after the URL changed', async () => {
    const probes: Array<{
      naturalWidth: number;
      naturalHeight: number;
      onload: (() => void) | null;
      src: string;
    }> = [];
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      src = '';
      constructor() {
        probes.push(this);
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const { rerender } = render(ImageActionsMenu, {
      props: { imageUrl: `data:image/png;base64,${pngData}` },
    });
    await openImageActionsMenu();
    await waitFor(() => expect(probes).toHaveLength(1));

    // Hydration swaps the URL while the first probe is still in flight.
    await rerender({ imageUrl: `data:image/jpeg;base64,${pngData}` });
    await waitFor(() => expect(probes).toHaveLength(2));

    // The stale probe resolves late: its dimensions must be discarded.
    probes[0].naturalWidth = 11;
    probes[0].naturalHeight = 22;
    probes[0].onload?.();
    expect(screen.queryByTestId('image-info-dimensions')).toBeNull();

    probes[1].naturalWidth = 800;
    probes[1].naturalHeight = 600;
    probes[1].onload?.();
    await waitFor(() =>
      expect(screen.getByTestId('image-info-dimensions').textContent).toContain('800'),
    );
    vi.unstubAllGlobals();
  });

  it('discards a stale byte-size fetch that resolves after the URL changed', async () => {
    const pending: Array<(response: unknown) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => pending.push(resolve))),
    );

    const { rerender } = render(ImageActionsMenu, {
      props: { imageUrl: 'workspace-file://ws-1/old.png' },
    });
    await openImageActionsMenu();
    await waitFor(() => expect(pending).toHaveLength(1));

    await rerender({ imageUrl: 'workspace-file://ws-1/new.png' });
    await waitFor(() => expect(pending).toHaveLength(2));

    // The stale fetch resolves late: its byte size must be discarded.
    pending[0]({ ok: true, blob: async () => ({ size: 111 }) });
    pending[1]({ ok: true, blob: async () => ({ size: 2048 }) });

    await waitFor(() => expect(screen.getByTestId('image-info-size').textContent).toContain('2'));
    expect(screen.getByTestId('image-info-size').textContent).not.toContain('111');
    vi.unstubAllGlobals();
  });
});
