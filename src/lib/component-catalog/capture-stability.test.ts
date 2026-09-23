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
  let notifyFrame: (() => void) | undefined;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      notifyFrame?.();
      notifyFrame = undefined;
      return frames.length;
    }),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
  const next = async () => {
    if (frames.length === 0) {
      await new Promise<void>((resolve) => {
        notifyFrame = resolve;
      });
    }
    const frame = frames.shift();
    frame!(performance.now());
    await Promise.resolve();
  };
  return { next };
}

function createImage({
  complete,
  loading,
  top,
  naturalWidth = 100,
  rendered,
}: {
  complete: () => boolean;
  loading?: 'lazy' | 'eager';
  top: number;
  naturalWidth?: number;
  rendered?: boolean;
}) {
  const image = document.createElement('img');
  if (loading) image.setAttribute('loading', loading);
  if (rendered !== undefined) image.checkVisibility = vi.fn(() => rendered);
  Object.defineProperty(image, 'complete', { configurable: true, get: complete });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, get: () => naturalWidth });
  image.getBoundingClientRect = () =>
    ({ top, bottom: top + 40, left: 0, right: 40, width: 40, height: 40 }) as DOMRect;
  image.decode = vi.fn().mockResolvedValue(undefined);
  return image;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('catalog-reduced-motion', 'catalog-full-motion');
  document.documentElement.removeAttribute('data-reduce-motion');
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
  it('reports the final battery policy after pending frames and honors preview overrides', async () => {
    setFonts(Promise.resolve());
    const frames = useManualFrames();
    const root = document.createElement('div');
    const pending = waitForCaptureStability(root);
    await frames.next();
    document.documentElement.setAttribute('data-reduce-motion', '');
    await frames.next();
    await expect(pending).resolves.toMatchObject({ reducedMotion: true });

    document.documentElement.classList.add('catalog-full-motion');
    const full = waitForCaptureStability(root);
    await frames.next();
    await frames.next();
    await expect(full).resolves.toMatchObject({ reducedMotion: false });
  });

  it('uses the capture root owning document rather than the host motion policy', async () => {
    document.documentElement.setAttribute('data-reduce-motion', '');
    const owner = document.implementation.createHTMLDocument();
    const root = owner.createElement('div');
    owner.body.append(root);
    await expect(waitForCaptureStability(root)).resolves.toMatchObject({ reducedMotion: false });
    owner.documentElement.classList.add('catalog-reduced-motion');
    await expect(waitForCaptureStability(root)).resolves.toMatchObject({ reducedMotion: true });
  });

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
    await expect(stability).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 0,
      reducedMotion: false,
    });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('defaults missing readiness to the stability timeout and cleans up', async () => {
    vi.useFakeTimers();
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const root = document.createElement('div');
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      timeoutMs: 25,
    });
    const rejection = expect(stability).rejects.toBeInstanceOf(CaptureStabilityTimeoutError);

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the full stability budget after delayed readiness', async () => {
    vi.useFakeTimers();
    const fonts = deferred<void>();
    setFonts(fonts.promise);
    const frames = useManualFrames();
    const root = document.createElement('div');
    const marker = document.createElement('div');
    marker.dataset.ready = 'true';
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      readinessTimeoutMs: 20,
      timeoutMs: 100,
    });
    const resolution = expect(stability).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 0,
      reducedMotion: false,
    });

    await vi.advanceTimersByTimeAsync(15);
    root.append(marker);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(90);
    fonts.resolve();
    await frames.next();
    await frames.next();

    await resolution;
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts readiness after the shorter post-readiness budget has elapsed', async () => {
    vi.useFakeTimers();
    setFonts(Promise.resolve());
    const frames = useManualFrames();
    const root = document.createElement('div');
    const marker = document.createElement('div');
    marker.dataset.ready = 'true';
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      readinessTimeoutMs: 20,
      timeoutMs: 5,
    });

    await vi.advanceTimersByTimeAsync(10);
    root.append(marker);
    await Promise.resolve();
    await frames.next();
    await frames.next();

    await expect(stability).resolves.toMatchObject({ imageCount: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an explicit initial readiness override', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      readinessTimeoutMs: 25,
      timeoutMs: 100,
    });
    const rejection = expect(stability).rejects.toThrow(
      'Preview did not become stable within 25ms.',
    );

    await vi.advanceTimersByTimeAsync(24);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the post-readiness timeout independent from a longer readiness override', async () => {
    vi.useFakeTimers();
    setFonts(Promise.resolve());
    const root = document.createElement('div');
    const marker = document.createElement('div');
    marker.dataset.ready = 'true';
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    root.append(marker, image);
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      readinessTimeoutMs: 100,
      timeoutMs: 25,
    });
    const rejection = expect(stability).rejects.toThrow(
      'Preview did not become stable within 25ms.',
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
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
    await expect(stability).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 0,
      reducedMotion: false,
    });
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

    await expect(stability).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 0,
      reducedMotion: false,
    });
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
    vi.useFakeTimers();
    setFonts(Promise.resolve());
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const root = document.createElement('div');
    const controller = new AbortController();
    const stability = waitForCaptureStability(root, {
      readiness: { selector: '[data-ready="true"]' },
      readinessTimeoutMs: 25,
      signal: controller.signal,
    });

    controller.abort();
    await expect(stability).rejects.toMatchObject({ name: 'AbortError' });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
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

    await expect(stability).resolves.toEqual({
      imageCount: 1,
      deferredImageCount: 0,
      reducedMotion: true,
    });
    expect(image.decode).toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('does not wait for offscreen lazy images that have not started loading', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    const offscreenLazy = createImage({
      complete: () => false,
      loading: 'lazy',
      top: window.innerHeight + 2_000,
    });
    const addListener = vi.spyOn(offscreenLazy, 'addEventListener');
    root.append(offscreenLazy);

    await expect(waitForCaptureStability(root, { timeoutMs: 1_000 })).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 1,
      reducedMotion: false,
    });
    expect(addListener).not.toHaveBeenCalled();
    expect(offscreenLazy.decode).not.toHaveBeenCalled();
  });

  it('does not wait for unrendered lazy images even though their rect sits at the origin', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    const hiddenLazy = createImage({
      complete: () => false,
      loading: 'lazy',
      top: 0,
      rendered: false,
    });
    hiddenLazy.getBoundingClientRect = () =>
      ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    const addListener = vi.spyOn(hiddenLazy, 'addEventListener');
    root.append(hiddenLazy);

    await expect(waitForCaptureStability(root, { timeoutMs: 1_000 })).resolves.toEqual({
      imageCount: 0,
      deferredImageCount: 1,
      reducedMotion: false,
    });
    expect(hiddenLazy.checkVisibility).toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  it('still waits for lazy images inside the viewport until they load', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    let complete = false;
    const visibleLazy = createImage({ complete: () => complete, loading: 'lazy', top: 10 });
    root.append(visibleLazy);

    let settled = false;
    const stability = waitForCaptureStability(root, { timeoutMs: 1_000 }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    complete = true;
    visibleLazy.dispatchEvent(new Event('load'));
    await expect(stability).resolves.toEqual({
      imageCount: 1,
      deferredImageCount: 0,
      reducedMotion: false,
    });
    expect(visibleLazy.decode).toHaveBeenCalled();
  });

  it('keeps waiting for offscreen eager images and counts them once loaded', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    let complete = false;
    const offscreenEager = createImage({
      complete: () => complete,
      top: window.innerHeight + 2_000,
    });
    root.append(offscreenEager);

    let settled = false;
    const stability = waitForCaptureStability(root, { timeoutMs: 1_000 }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    complete = true;
    offscreenEager.dispatchEvent(new Event('load'));
    await expect(stability).resolves.toMatchObject({ imageCount: 1, deferredImageCount: 0 });
  });

  it('treats broken images as ready without decoding them', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    let complete = false;
    const broken = createImage({ complete: () => complete, top: 10, naturalWidth: 0 });
    root.append(broken);

    const stability = waitForCaptureStability(root, { timeoutMs: 1_000 });
    await Promise.resolve();
    complete = true;
    broken.dispatchEvent(new Event('error'));

    await expect(stability).resolves.toMatchObject({ imageCount: 1, deferredImageCount: 0 });
    expect(broken.decode).not.toHaveBeenCalled();
  });

  it('derives image counts from one snapshot when an image is removed while decoding', async () => {
    setFonts(Promise.resolve());
    useTimerFrames();
    const root = document.createElement('div');
    const removedWhileDecoding = createImage({ complete: () => true, top: 10 });
    const offscreenLazy = createImage({
      complete: () => false,
      loading: 'lazy',
      top: window.innerHeight + 2_000,
    });
    root.append(removedWhileDecoding, offscreenLazy);
    let decodes = 0;
    removedWhileDecoding.decode = vi.fn(async () => {
      decodes += 1;
      if (decodes === 2) removedWhileDecoding.remove();
    });

    await expect(waitForCaptureStability(root, { timeoutMs: 1_000 })).resolves.toEqual({
      imageCount: 1,
      deferredImageCount: 1,
      reducedMotion: false,
    });
    expect(decodes).toBe(2);
    expect(root.contains(removedWhileDecoding)).toBe(false);
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
