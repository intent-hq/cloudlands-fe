/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ChatVideoBlock from '../ChatVideoBlock.svelte';

afterEach(cleanup);

const remoteSource = {
  kind: 'remote' as const,
  url: 'https://media.example/demo.mp4',
  mimeType: 'video/mp4',
};

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
    expect(trigger.className).toContain('aspect-video');
    expect(snapshot.className).toContain('motion-reduce:transition-none');

    await fireEvent.loadedData(snapshot);
    expect(snapshot.className).toContain('opacity-100');
  });

  it('opens controlled playback, exposes fallback access, and restores focus after Escape', async () => {
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
    expect(screen.getByRole('link', { name: 'Open or download video' }).getAttribute('href')).toBe(
      remoteSource.url,
    );
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
    const snapshot = screen.getByRole('button').querySelector('video')!;
    expect(snapshot.getAttribute('poster')).toBeNull();
    await fireEvent.error(snapshot);
    expect(snapshot.className).toContain('opacity-0');
    expect(screen.getByRole('button').querySelector('svg')).toBeTruthy();
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
