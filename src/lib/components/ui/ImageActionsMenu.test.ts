/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageActionsMenu from './ImageActionsMenu.svelte';

const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('image unavailable')));
});

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
  vi.clearAllMocks();
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

  it.each(['http://example.com/image.png', 'file:///tmp/image.png', 'data:text/plain;base64,YQ=='])(
    'does not expose actions for unsupported %s',
    (imageUrl) => {
      render(ImageActionsMenu, { props: { imageUrl } });
      expect(screen.queryByRole('button', { name: /image options/i })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/svg+xml', 'svg'],
  ])(
    'downloads original HTTPS bytes using the fetched %s MIME type',
    async (mimeType, extension) => {
      const original = new Blob(['original bytes'], { type: mimeType });
      const fetchImage = vi.fn().mockResolvedValue({ ok: true, blob: async () => original });
      vi.stubGlobal('fetch', fetchImage);
      const createObjectURL = vi.fn(() => 'blob:original');
      const revokeObjectURL = vi.fn();
      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL = createObjectURL;
          static revokeObjectURL = revokeObjectURL;
        },
      );
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      const imageUrl = 'https://example.com/images/original';
      render(ImageActionsMenu, { props: { imageUrl, imageName: 'diagram' } });
      await openMenu();
      await fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
      await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
      expect(fetchImage).toHaveBeenLastCalledWith(imageUrl);
      expect(createObjectURL).toHaveBeenCalledWith(original);
      const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe(`diagram.${extension}`);
      expect(anchor.href).toBe('blob:original');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:original');
      expect(anchor.isConnected).toBe(false);
      expect(notify.error).not.toHaveBeenCalled();
    },
  );

  it('surfaces a failed image download without starting a file download', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(ImageActionsMenu, { props: { imageUrl: 'https://example.com/private.png' } });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(anchorClick).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('copies the original HTTPS PNG bytes and reports clipboard rejection', async () => {
    const original = new Blob(['original pixels'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => original }));
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    render(ImageActionsMenu, { props: { imageUrl: 'https://example.com/original.png' } });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /copy image/i }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(write.mock.calls[0][0][0].items['image/png']).toBe(original);
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('reports a decode failure instead of claiming pixels were copied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['bad jpeg'], { type: 'image/jpeg' }),
      }),
    );
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const write = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    render(ImageActionsMenu, { props: { imageUrl: 'https://example.com/bad.jpg' } });
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: /copy image/i }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(write).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });
});
