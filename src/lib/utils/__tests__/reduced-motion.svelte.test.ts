/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  onReducedMotionChange,
  prefersReducedMotion,
  REDUCE_MOTION_ATTRIBUTE,
  REDUCED_MOTION_MEDIA_QUERY,
} from '../reduced-motion';
import { watchReducedMotion } from '../reduced-motion.svelte';

type MediaListener = (event: { matches: boolean }) => void;

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<MediaListener>();
  const matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn((_: string, cb: MediaListener) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: MediaListener) => listeners.delete(cb)),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    emit(next: boolean) {
      for (const cb of listeners) cb({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
}

const root = () => document.documentElement;
const settleObservers = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  root().removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  root().classList.remove('catalog-full-motion', 'catalog-reduced-motion');
});

describe('prefersReducedMotion', () => {
  it('is false when neither the OS preference nor the root attribute asks for it', () => {
    const media = stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(media.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_MEDIA_QUERY);
  });

  it('is true when the OS media query matches', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is true when the root carries data-reduce-motion even without the OS preference', () => {
    stubMatchMedia(false);
    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false without matchMedia support (SSR-like) and no root attribute', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('onReducedMotionChange', () => {
  it('notifies when the media query flips and stops after unsubscribe', () => {
    const media = stubMatchMedia(false);
    const listener = vi.fn();
    const stop = onReducedMotionChange(listener);

    media.emit(true);
    expect(listener).toHaveBeenLastCalledWith(true);
    media.emit(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    expect(media.listenerCount()).toBe(0);
    media.emit(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies when the root attribute is toggled', async () => {
    stubMatchMedia(false);
    const listener = vi.fn();
    const stop = onReducedMotionChange(listener);

    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    await settleObservers();
    expect(listener).toHaveBeenLastCalledWith(true);

    root().removeAttribute(REDUCE_MOTION_ATTRIBUTE);
    await settleObservers();
    expect(listener).toHaveBeenLastCalledWith(false);

    stop();
    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    await settleObservers();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stays reduced while either source still asks for it', async () => {
    const media = stubMatchMedia(true);
    const listener = vi.fn();
    const stop = onReducedMotionChange(listener);

    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    await settleObservers();
    media.emit(false);
    expect(listener).not.toHaveBeenCalled();

    root().removeAttribute(REDUCE_MOTION_ATTRIBUTE);
    await settleObservers();
    expect(listener).toHaveBeenCalledExactlyOnceWith(false);
    stop();
  });

  it('tracks authoritative preview overrides without losing changes to underlying sources', async () => {
    const media = stubMatchMedia(true);
    const listener = vi.fn();
    const stop = onReducedMotionChange(listener);
    try {
      root().classList.add('catalog-full-motion');
      await settleObservers();
      expect(prefersReducedMotion()).toBe(false);
      expect(listener).toHaveBeenLastCalledWith(false);

      root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
      media.emit(false);
      await settleObservers();
      expect(listener).toHaveBeenCalledTimes(1);

      root().classList.remove('catalog-full-motion');
      await settleObservers();
      expect(prefersReducedMotion()).toBe(true);
      expect(listener).toHaveBeenLastCalledWith(true);

      root().classList.add('catalog-full-motion', 'catalog-reduced-motion');
      root().removeAttribute(REDUCE_MOTION_ATTRIBUTE);
      await settleObservers();
      expect(prefersReducedMotion()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(2);

      root().classList.remove('catalog-reduced-motion');
      await settleObservers();
      expect(prefersReducedMotion()).toBe(false);
      expect(listener).toHaveBeenLastCalledWith(false);
    } finally {
      stop();
    }
    root().classList.add('catalog-reduced-motion');
    await settleObservers();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(media.listenerCount()).toBe(0);
  });

  it('reads and watches only the owning document and releases its listeners', async () => {
    stubMatchMedia(true);
    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const owner = iframe.contentDocument!;
    const view = iframe.contentWindow!;
    const listeners = new Set<MediaListener>();
    let matches = false;
    Object.defineProperty(view, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (_: string, cb: MediaListener) => listeners.add(cb),
        removeEventListener: (_: string, cb: MediaListener) => listeners.delete(cb),
      }),
    });
    const listener = vi.fn();
    const stop = onReducedMotionChange(listener, owner);
    try {
      expect(prefersReducedMotion(owner)).toBe(false);
      root().classList.add('catalog-reduced-motion');
      await settleObservers();
      expect(listener).not.toHaveBeenCalled();
      owner.documentElement.setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
      await settleObservers();
      expect(listener).toHaveBeenLastCalledWith(true);
      owner.documentElement.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
      await settleObservers();
      expect(listener).toHaveBeenLastCalledWith(false);
      matches = true;
      for (const cb of listeners) cb({ matches });
      expect(prefersReducedMotion(owner)).toBe(true);
      expect(listener).toHaveBeenLastCalledWith(true);
      stop();
      owner.documentElement.classList.add('catalog-full-motion');
      await settleObservers();
      expect(listener).toHaveBeenCalledTimes(3);
      expect(listeners.size).toBe(0);
    } finally {
      stop();
      iframe.remove();
    }
  });
});

describe('watchReducedMotion', () => {
  it('seeds from the combined flag and tracks both sources until cleanup', async () => {
    const media = stubMatchMedia(false);
    const watch = watchReducedMotion();
    expect(watch.current).toBe(false);

    media.emit(true);
    expect(watch.current).toBe(true);
    media.emit(false);
    expect(watch.current).toBe(false);

    root().setAttribute(REDUCE_MOTION_ATTRIBUTE, '');
    await settleObservers();
    expect(watch.current).toBe(true);

    watch.cleanup();
    root().removeAttribute(REDUCE_MOTION_ATTRIBUTE);
    await settleObservers();
    media.emit(true);
    expect(watch.current).toBe(true);
    expect(media.listenerCount()).toBe(0);
  });
});
