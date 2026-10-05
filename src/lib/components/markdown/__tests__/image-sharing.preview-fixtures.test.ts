/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
import {
  IMAGE_SHARING_HTTPS_URL,
  IMAGE_SHARING_SVG,
  installImageSharingClipboardFailure,
  installImageSharingDownloadFailure,
} from '../image-sharing.preview-fixtures';

const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify }));
const dispose: Array<() => void> = [];
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

afterEach(() => {
  cleanup();
  while (dispose.length) dispose.pop()?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function selectAction(name: RegExp) {
  const trigger = screen.getByRole('button', { name: /image options/i });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  await fireEvent.click(screen.getByRole('menuitem', { name }));
}

describe('image-sharing preview failure isolation', () => {
  it('drives real download error feedback without creating a download', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    dispose.push(installImageSharingDownloadFailure());
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(ImageActionsMenu, { props: { imageUrl: IMAGE_SHARING_HTTPS_URL } });

    await selectAction(/download/i);

    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(notify.success).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('passes unrelated fetches through and restores the previous transport', async () => {
    const network = vi.fn().mockResolvedValue(new Response(IMAGE_SHARING_SVG));
    vi.stubGlobal('fetch', network);
    const restore = installImageSharingDownloadFailure();
    dispose.push(restore);

    expect((await fetch(new Request(IMAGE_SHARING_HTTPS_URL))).status).toBe(403);
    await fetch('/local-preview', { method: 'HEAD' });
    expect(network).toHaveBeenCalledExactlyOnceWith('/local-preview', { method: 'HEAD' });
    restore();
    expect(globalThis.fetch).toBe(network);
  });

  it('drives the real PNG copy error and restores the prior clipboard', async () => {
    const prior = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    dispose.push(() => {
      if (prior) Object.defineProperty(navigator, 'clipboard', prior);
      else Reflect.deleteProperty(navigator, 'clipboard');
    });
    const realWrite = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: realWrite },
    });
    const previous = navigator.clipboard;
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, Blob>) {}
      },
    );
    const restore = installImageSharingClipboardFailure();
    dispose.push(restore);
    const deniedWrite = vi.spyOn(navigator.clipboard, 'write');
    render(ImageActionsMenu, { props: { imageUrl: png } });

    await selectAction(/copy image/i);

    await waitFor(() => expect(notify.error).toHaveBeenCalledOnce());
    expect(deniedWrite).toHaveBeenCalledOnce();
    expect(realWrite).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
    restore();
    expect(navigator.clipboard).toBe(previous);
  });
});
