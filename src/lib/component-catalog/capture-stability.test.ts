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
