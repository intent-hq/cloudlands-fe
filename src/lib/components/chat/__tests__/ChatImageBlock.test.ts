/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatImageBlock from '../ChatImageBlock.svelte';
import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  it('copies only the hydrated original through keyboard and native Copy events', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const view = render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', dataTruncated: true, dataIsThumbnail: true },
    });
    const opener = screen.getByRole('button');
    opener.focus();
    expect(await fireEvent.keyDown(opener, { key: 'c', metaKey: true })).toBe(true);
    expect(await fireEvent.copy(opener)).toBe(true);
    await fireEvent.click(opener);
    const thumbnailPreview = await screen.findByRole('dialog');
    expect(await fireEvent.keyDown(thumbnailPreview, { key: 'c', metaKey: true })).toBe(true);
    expect(await fireEvent.copy(thumbnailPreview)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await view.rerender({
      data: btoa('original pixels'),
      dataTruncated: false,
      dataIsThumbnail: false,
    });
    expect(await fireEvent.keyDown(opener, { key: 'c', metaKey: true })).toBe(false);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0][0].items['image/png'].size).toBe(15);
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(opener);
    const originalPreview = await screen.findByRole('dialog');
    expect(await fireEvent.copy(originalPreview)).toBe(false);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][0][0].items['image/png'].size).toBe(15);
    expect(screen.getByRole('dialog')).toBe(originalPreview);
  });

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

    // The block only carries the low-res thumbnail bytes: the menu's
    // download/copy/info actions would act on the wrong image.
    expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
    expect(await fireEvent.contextMenu(screen.getByRole('img'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onHydrate).not.toHaveBeenCalled();
  });

  it('does not export a thumbnail through the lightbox when hydration is unavailable', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', dataTruncated: true, dataIsThumbnail: true },
    });
    await fireEvent.click(screen.getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name: /image preview/i });
    expect(await fireEvent.contextMenu(dialog.querySelector('img')!)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
  });

  it('opens original image actions on right-click without opening the lightbox', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'original' },
    });
    expect(await fireEvent.contextMenu(screen.getByRole('img'))).toBe(false);
    await screen.findByRole('menuitem', { name: /copy image/i });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href).toBe(`data:image/png;base64,${pngData}`);
    expect(anchor.download).toBe('original.png');
  });

  it('closes a right-click lightbox menu before the preview and resets on reopen', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'screenshot.png' },
    });
    const opener = screen.getByRole('button', { name: /view.*full size/i });
    await fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: /image preview/i });
    expect(await fireEvent.contextMenu(dialog.querySelector('img')!)).toBe(false);
    await screen.findByRole('menu');
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('dialog')).toBe(dialog);
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await fireEvent.click(opener);
    const reopened = await screen.findByRole('dialog');
    expect(screen.queryByRole('menu')).toBeNull();
    await fireEvent.contextMenu(reopened.querySelector('img')!);
    expect(await screen.findByRole('menuitem', { name: /copy image/i })).toBeTruthy();
  });

  it('downloads only the original payload after the thumbnail has hydrated', async () => {
    const onHydrate = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = render(ChatImageBlock, {
      props: {
        data: pngData,
        mimeType: 'image/png',
        alt: 'original',
        dataTruncated: true,
        dataIsThumbnail: true,
        onHydrate,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: /load full-size/i }));
    expect(onHydrate).toHaveBeenCalledOnce();
    expect(anchorClick).not.toHaveBeenCalled();
    const original = btoa('original image bytes, not the thumbnail');
    await view.rerender({ data: original, dataTruncated: false, dataIsThumbnail: false });
    await openImageActionsMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.href).toBe(`data:image/png;base64,${original}`);
    expect(anchor.download).toBe('original.png');
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

  // §7.1 image dimension sidecar: `width`/`height` reserve the final box
  // (natural aspect, capped at the container) with a placeholder until decode.
  it('reserves the intrinsic aspect box and shows a placeholder until the sized image decodes', async () => {
    const { container } = render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'shot.png', width: 1440, height: 900 },
    });

    const frame = container.querySelector<HTMLElement>('[data-image-sized]')!;
    expect(frame).not.toBeNull();
    expect(frame.style.aspectRatio).toBe('1440 / 900');
    expect(frame.style.width).toBe('min(1440px, 100%)');
    expect(frame.dataset.loaded).toBe('false');

    const placeholder = screen.getByTestId('media-loading-placeholder');
    expect(placeholder.textContent).toContain('shot.png');

    const image = screen
      .getByRole('button', { name: /view shot\.png full size/i })
      .querySelector('img')!;
    await fireEvent.load(image);

    expect(screen.queryByTestId('media-loading-placeholder')).toBeNull();
    expect(frame.dataset.loaded).toBe('true');
    // The reserved box is unchanged by the decode — no relayout.
    expect(frame.style.aspectRatio).toBe('1440 / 900');
    expect(frame.style.width).toBe('min(1440px, 100%)');
  });

  it('keeps the revealed frame across a hydration swap once any bytes decoded', async () => {
    const { container, rerender } = render(ChatImageBlock, {
      props: {
        data: pngData,
        mimeType: 'image/png',
        alt: 'shot.png',
        width: 1440,
        height: 900,
        dataTruncated: true,
        dataIsThumbnail: true,
        onHydrate: vi.fn(),
      },
    });
    const thumbnail = screen
      .getByRole('button', { name: /load full-size shot\.png/i })
      .querySelector('img')!;
    await fireEvent.load(thumbnail);
    expect(screen.queryByTestId('media-loading-placeholder')).toBeNull();

    // The original replaces the thumbnail bytes: the placeholder must not
    // flash over the image already on screen.
    await rerender({
      data: `${pngData}AA==`,
      mimeType: 'image/png',
      alt: 'shot.png',
      width: 1440,
      height: 900,
    });
    expect(screen.queryByTestId('media-loading-placeholder')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-image-sized]')!.dataset.loaded).toBe('true');
  });

  it('renders the legacy layout with no reserved box or placeholder when dimensions are absent', () => {
    const { container } = render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'legacy.png' },
    });

    expect(container.querySelector('[data-image-sized]')).toBeNull();
    expect(screen.queryByTestId('media-loading-placeholder')).toBeNull();
    const trigger = screen.getByRole('button', { name: /view legacy\.png full size/i });
    expect(trigger.parentElement!.style.aspectRatio).toBe('');
    expect(trigger.parentElement!.style.width).toBe('');
  });

  it.each([
    ['only one dimension', { width: 1440 }],
    ['a zero dimension', { width: 0, height: 900 }],
    ['a fractional dimension', { width: 0.5, height: 900 }],
    ['a non-finite dimension', { width: Number.POSITIVE_INFINITY, height: 900 }],
    ['a NaN dimension', { width: 640, height: Number.NaN }],
  ])('falls back to the legacy layout with %s', (_label, dims) => {
    const { container } = render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'invalid.png', ...dims },
    });

    expect(container.querySelector('[data-image-sized]')).toBeNull();
    expect(screen.queryByTestId('media-loading-placeholder')).toBeNull();
    const trigger = screen.getByRole('button', { name: /view invalid\.png full size/i });
    expect(trigger.parentElement!.style.aspectRatio).toBe('');
    expect(trigger.parentElement!.style.width).toBe('');
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
