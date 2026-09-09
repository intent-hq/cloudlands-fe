// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CaptureStabilityTimeoutError,
  waitForCaptureStability,
  watchCaptureStability,
} from './capture-stability';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => (resolve = next));
  return { promise, resolve };
}

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const originalRequestFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
const originalCancelFrame = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame');

function setFonts(ready: Promise<void>) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
}

function useTimerFrames() {
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    ),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn((id: number) => window.clearTimeout(id)),
  });
}

function useManualFrames() {
  const frames: FrameRequestCallback[] = [];
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
  const next = async () => {
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const frame = frames.shift();
    frame!(performance.now());
    await Promise.resolve();
  };
  return { next };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('catalog-reduced-motion');
  document.body.replaceChildren();
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else delete (document as Document & { fonts?: FontFaceSet }).fonts;
  if (originalRequestFrame)
    Object.defineProperty(window, 'requestAnimationFrame', originalRequestFrame);
  else
    delete (window as Window & { requestAnimationFrame?: typeof requestAnimationFrame })
      .requestAnimationFrame;
  if (originalCancelFrame)
    Object.defineProperty(window, 'cancelAnimationFrame', originalCancelFrame);
  else
    delete (window as Window & { cancelAnimationFrame?: typeof cancelAnimationFrame })
      .cancelAnimationFrame;
});

describe('waitForCaptureStability', () => {
  it('starts the stability budget after declared preview content is ready', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    const content = document.createElement('div');
    content.dataset.captureReady = 'false';
    root.append(content);

    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-capture-ready="true"]' },
      timeoutMs: 1_000,
    });
    await Promise.resolve();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    content.dataset.captureReady = 'true';
    await expect(stability).resolves.toEqual({ imageCount: 0, reducedMotion: false });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('waits for the exact declared marker count and a generation on every marker', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.dataset.ready = 'true';
    first.dataset.generation = '1';
    second.dataset.ready = 'true';
    root.append(first);

    const stability = waitForCaptureStability(root, {
      readiness: {
        selector: '[data-ready="true"]',
        count: 2,
        generationAttribute: 'data-generation',
      },
      timeoutMs: 1_000,
    });
    await Promise.resolve();
    root.append(second);
    await Promise.resolve();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    second.dataset.generation = '1';
    await expect(stability).resolves.toEqual({ imageCount: 0, reducedMotion: false });
  });

  it('restarts stability when a marker is replaced by a new generation', async () => {
    setFonts(Promise.resolve());
    const frames = useManualFrames();
    const root = document.createElement('div');
    const first = document.createElement('div');
    first.dataset.ready = 'true';
    first.dataset.generation = '1';
    root.append(first);

    const stability = waitForCaptureStability(root, {
      readiness: {
        selector: '[data-ready="true"]',
        count: 1,
        generationAttribute: 'data-generation',
      },
      timeoutMs: 1_000,
    });
    await frames.next();
    const replacement = document.createElement('div');
    replacement.dataset.ready = 'true';
    replacement.dataset.generation = '2';
    first.replaceWith(replacement);
    await frames.next();
    await frames.next();
    await frames.next();

    await expect(stability).resolves.toEqual({ imageCount: 0, reducedMotion: false });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(4);
  });

  it('orders waiting and stable generations, rejects stale settlement, and cleans up', async () => {
    setFonts(Promise.resolve());
    const frames = useManualFrames();
    const root = document.createElement('div');
    const marker = document.createElement('div');
    marker.dataset.ready = 'true';
    marker.dataset.generation = '1';
    root.append(marker);
    const controller = new AbortController();
    const events: string[] = [];
    const watching = watchCaptureStability(
      root,
      {
        readiness: {
          selector: '[data-ready="true"]',
          count: 1,
          generationAttribute: 'data-generation',
        },
        signal: controller.signal,
        timeoutMs: 1_000,
      },
      {
        onWaiting: (generation) => events.push(`waiting:${generation}`),
        onStable: (_result, generation) => events.push(`stable:${generation}`),
      },
    );
    await frames.next();
    await frames.next();
    expect(events).toEqual(['waiting:1', 'stable:1']);

    marker.dataset.ready = 'false';
    await vi.waitFor(() => expect(events).toEqual(['waiting:1', 'stable:1', 'waiting:2']));
    marker.dataset.generation = '2';
    marker.dataset.ready = 'true';
    await frames.next();
    marker.dataset.generation = '3';
    await frames.next();
    expect(events).toEqual(['waiting:1', 'stable:1', 'waiting:2']);
    await frames.next();
    await frames.next();
    expect(events).toEqual(['waiting:1', 'stable:1', 'waiting:2', 'stable:2']);

    controller.abort();
    await expect(watching).rejects.toMatchObject({ name: 'AbortError' });
    marker.dataset.ready = 'false';
    await Promise.resolve();
    expect(events).toEqual(['waiting:1', 'stable:1', 'waiting:2', 'stable:2']);
  });

  it('disconnects the readiness observer when a delayed marker wait is cancelled', async () => {
    setFonts(Promise.resolve());
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const root = document.createElement('div');
    const controller = new AbortController();
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      signal: controller.signal,
    });

    controller.abort();
    await expect(stability).rejects.toMatchObject({ name: 'AbortError' });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('waits for fonts, images, reduced-motion styles, and two settled frames', async () => {
    const fonts = deferred<void>();
    setFonts(fonts.promise);
    useTimerFrames();
    document.documentElement.classList.add('catalog-reduced-motion');
    const root = document.createElement('div');
    const image = document.createElement('img');
    let complete = false;
    Object.defineProperty(image, 'complete', { configurable: true, get: () => complete });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, get: () => 100 });
    image.decode = vi.fn().mockResolvedValue(undefined);
    root.append(image);

    let settled = false;
    const stability = waitForCaptureStability(root, { timeoutMs: 1_000 }).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    complete = true;
    image.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(settled).toBe(false);
    fonts.resolve();

    await expect(stability).resolves.toEqual({ imageCount: 1, reducedMotion: true });
    expect(image.decode).toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('cancels the wait and removes pending image listeners', async () => {
    setFonts(Promise.resolve());
    const root = document.createElement('div');
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    const removeListener = vi.spyOn(image, 'removeEventListener');
    root.append(image);
    const controller = new AbortController();

    const stability = waitForCaptureStability(root, {
      signal: controller.signal,
      timeoutMs: 1_000,
    });
    controller.abort();

    await expect(stability).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeListener).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('times out instead of hanging and cleans pending image listeners', async () => {
    vi.useFakeTimers();
    setFonts(Promise.resolve());
    const root = document.createElement('div');
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    const removeListener = vi.spyOn(image, 'removeEventListener');
    root.append(image);

    const stability = waitForCaptureStability(root, { timeoutMs: 25 });
    const rejection = expect(stability).rejects.toBeInstanceOf(CaptureStabilityTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(removeListener).toHaveBeenCalledWith('load', expect.any(Function));
  });
});
