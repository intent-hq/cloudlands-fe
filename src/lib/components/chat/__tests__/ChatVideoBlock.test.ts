/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatVideoBlock from '../ChatVideoBlock.svelte';
import VideoActionsMenu from '$lib/components/ui/VideoActionsMenu.svelte';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock('svelte-sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  toastSuccess.mockClear();
});

const remoteSource = {
  kind: 'remote' as const,
  url: 'https://media.example/demo.mp4',
  mimeType: 'video/mp4',
};

async function openVideoActionsMenu(index = 0) {
  const trigger = screen.getAllByRole('button', { name: 'Video options' })[index];
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  return trigger;
}

describe('ChatVideoBlock', () => {
  it('renders one contained, labelled snapshot without transcript controls or autoplay', async () => {
    render(ChatVideoBlock, {
      props: {
        source: remoteSource,
        name: 'demo.mp4',
        poster: 'https://media.example/demo.webp',
      },
    });

    const trigger = screen.getByRole('button', { name: 'Play demo.mp4' });
    const snapshot = trigger.querySelector('video')!;
    expect(snapshot.controls).toBe(false);
    expect(snapshot.autoplay).toBe(false);
    expect(snapshot.preload).toBe('metadata');
    expect(snapshot.poster).toBe('https://media.example/demo.webp');
    expect(snapshot.className).toContain('motion-reduce:transition-none');

    await fireEvent.loadedData(snapshot);
    expect(snapshot.className).toContain('opacity-100');
  });

  it('opens controlled playback and restores focus after Escape', async () => {
    const { container } = render(ChatVideoBlock, {
      props: { source: remoteSource, name: 'demo.mp4' },
    });
    const transcript = container.firstElementChild as HTMLElement;
    transcript.scrollTop = 23;
    const trigger = screen.getByRole('button', { name: 'Play demo.mp4' });
    trigger.focus();
    await fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Video preview: demo.mp4' });
    const player = screen.getByTestId('chat-video-player') as HTMLVideoElement;
    expect(dialog.contains(player)).toBe(true);
    expect(player.controls).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(dialog.contains(screen.getAllByRole('button', { name: 'Video options' })[1])).toBe(true);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await fireEvent.error(player);
    expect(screen.getByRole('status').textContent).toContain('preview is unavailable');
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(transcript.scrollTop).toBe(23);
  });

  it('keeps a stable placeholder when a frame is unavailable and rejects unsafe posters', async () => {
    render(ChatVideoBlock, {
      props: { source: remoteSource, poster: 'javascript:alert(1)' },
    });
    const playButton = screen.getByRole('button', { name: /play/i });
    const snapshot = playButton.querySelector('video')!;
    expect(snapshot.getAttribute('poster')).toBeNull();
    await fireEvent.error(snapshot);
    expect(snapshot.className).toContain('opacity-0');
    expect(playButton.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('preview unavailable');
  });

  it('accepts a workspace-file poster', () => {
    render(ChatVideoBlock, {
      props: {
        source: remoteSource,
        poster: 'workspace-file://ws-1/.demo-artifacts/run/poster.webp',
      },
    });

    expect(screen.getByRole('button', { name: /play/i }).querySelector('video')?.poster).toBe(
      'workspace-file://ws-1/.demo-artifacts/run/poster.webp',
    );
  });

  it('keeps the viewer open when Escape first closes its actions menu', async () => {
    render(ChatVideoBlock, { props: { source: remoteSource, name: 'demo.mp4' } });
    const thumbnail = screen.getByRole('button', { name: 'Play demo.mp4' });
    await fireEvent.click(thumbnail);
    const dialog = await screen.findByRole('dialog', { name: 'Video preview: demo.mp4' });

    await openVideoActionsMenu(1);
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(dialog.isConnected).toBe(true);

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(thumbnail);
  });

  it('renders a normalized workspace video source without changing remote video behavior', () => {
    const url = 'workspace-file://ws-1/.demo-artifacts/run/preview.webm';
    render(ChatVideoBlock, {
      props: {
        source: { kind: 'workspace', url, mimeType: 'video/webm' },
        name: 'preview.webm',
      },
    });

    expect(
      screen.getByRole('button', { name: 'Play preview.webm' }).querySelector('video')?.src,
    ).toBe(url);
  });
});

describe('VideoActionsMenu', () => {
  it('copies a remote link and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('metadata unavailable')));
    render(VideoActionsMenu, {
      props: { videoUrl: remoteSource.url, sourceKind: 'remote', videoName: 'demo.mp4' },
    });

    await openVideoActionsMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(remoteSource.url));
    expect(toastSuccess).toHaveBeenCalledWith('Link copied to clipboard');
  });

  it('copies a decoded workspace-relative path and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('metadata unavailable')));
    render(VideoActionsMenu, {
      props: {
        videoUrl: 'workspace-file://ws-1/.demo-artifacts/some%20run/demo.webm',
        sourceKind: 'workspace',
      },
    });

    await openVideoActionsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('.demo-artifacts/some run/demo.webm'),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Path copied to clipboard');
  });

  it('downloads remote video bytes under the display name', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:video-download');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['video']) }),
    );
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    render(VideoActionsMenu, {
      props: { videoUrl: remoteSource.url, sourceKind: 'remote', videoName: 'demo.mp4' },
    });

    await openVideoActionsMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('blob:video-download');
    expect(anchor.getAttribute('download')).toBe('demo.mp4');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-download');
  });
});
