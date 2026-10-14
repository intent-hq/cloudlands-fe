import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatVideoBlock } from './chat-video-block';

const first = 'blob:https://app.test/first';
const second = 'blob:https://app.test/second';
let root: Root;
let container: HTMLDivElement;
let operations: { kind: string; node?: HTMLMediaElement; src: string | null }[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  operations = [];
  // jsdom has no native media engine. These unit observations check React DOM
  // teardown order only; genuine loading/cancellation is covered by the native journey.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    operations.push({ kind: 'pause', node: this, src: this.getAttribute('src') });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    operations.push({ kind: 'load', node: this, src: this.getAttribute('src') });
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Video({ url = first, allowed = true }: { url?: string; allowed?: boolean }) {
  return (
    <ChatVideoBlock
      source={{ kind: 'remote', url, mimeType: 'video/mp4' }}
      showActionsMenu={false}
      canLoadMedia={() => allowed}
      onOpenLink={() => false}
    />
  );
}

it('retires thumbnail and portaled player before the parent passive URL release', async () => {
  let videos: HTMLVideoElement[] = [];
  const release = vi.fn(() => {
    expect(videos.map((video) => video.getAttribute('src'))).toEqual([null, null]);
    expect(operations.filter((entry) => entry.kind === 'load').map((entry) => entry.node)).toEqual(
      expect.arrayContaining(videos),
    );
    operations.push({ kind: 'release', src: first });
  });
  function Owner() {
    useEffect(() => release, []);
    return <Video />;
  }
  await act(async () => root.render(<Owner />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-testid="chat-video-snapshot"]')!.click(),
  );
  videos = [...document.querySelectorAll('video')];
  expect(videos).toHaveLength(2);
  await act(async () => root.render(null));
  expect(release).toHaveBeenCalledOnce();
  expect(operations.at(-1)?.kind).toBe('release');
  for (const video of videos) {
    expect(
      operations.filter((entry) => entry.node === video).map((entry) => [entry.kind, entry.src]),
    ).toEqual([
      ['pause', first],
      ['load', null],
    ]);
  }
});

it('stops old source consumers before replacement and stops both on authority removal', async () => {
  await act(async () => root.render(<Video />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-testid="chat-video-snapshot"]')!.click(),
  );
  const videos = [...document.querySelectorAll('video')];
  expect(videos).toHaveLength(2);
  await act(async () => root.render(<Video url={second} />));
  expect(videos.map((video) => video.getAttribute('src'))).toEqual([second, second]);
  expect(operations.filter((entry) => entry.kind === 'load')).toHaveLength(2);
  expect(
    operations.filter((entry) => entry.kind === 'load').every((entry) => entry.src === null),
  ).toBe(true);
  await act(async () => root.render(<Video url={second} allowed={false} />));
  expect(document.querySelectorAll('video')).toHaveLength(0);
  expect(videos.map((video) => video.getAttribute('src'))).toEqual([null, null]);
  expect(operations.filter((entry) => entry.kind === 'load')).toHaveLength(4);
});

it('restores the source after StrictMode ref replay without retaining a final consumer', async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Video />
      </StrictMode>,
    ),
  );
  const video = container.querySelector('video')!;
  expect(video.getAttribute('src')).toBe(first);
  expect(operations.some((entry) => entry.kind === 'load')).toBe(true);
  const before = operations.length;
  await act(async () => root.render(null));
  expect(video.getAttribute('src')).toBeNull();
  expect(operations.slice(before).map((entry) => [entry.kind, entry.src])).toEqual([
    ['pause', first],
    ['load', null],
  ]);
});
