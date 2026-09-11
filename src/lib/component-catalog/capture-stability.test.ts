// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureStabilityTimeoutError, waitForCaptureStability } from './capture-stability';

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

function createImage({
  complete,
  loading,
  top,
  naturalWidth = 100,
}: {
  complete: () => boolean;
  loading?: 'lazy' | 'eager';
  top: number;
  naturalWidth?: number;
}) {
  const image = document.createElement('img');
  if (loading) image.setAttribute('loading', loading);
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
