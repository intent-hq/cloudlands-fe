import type { Action } from 'svelte/action';
import {
  scheduleLayoutRead,
  scheduleLayoutWrite,
  type CancelLayoutTask,
} from '$lib/utils/layout-phases';

export interface ScrollFadeOptions {
  /** Fade size in px at each overflowing edge. Defaults to 24. */
  fadeSize?: number;
  /** Scroll axis to fade along. Defaults to 'y'. */
  axis?: 'x' | 'y';
  /** Detach observers and listeners while the owning surface is inactive. */
  enabled?: boolean;
}

/**
 * Fades out overflowing content at the edges of a scroll container,
 * only on the side(s) that actually have more content to scroll toward.
 * Applies a `mask-image` gradient directly on the element.
 */
export const scrollFade: Action<HTMLElement, ScrollFadeOptions | undefined> = (
  el,
  options = {},
) => {
  let fadeSize = options?.fadeSize ?? 24;
  let axis = options?.axis ?? 'y';
  let enabled = options?.enabled ?? true;
  let listening = false;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let readPending = false;
  let cancelRead: CancelLayoutTask | undefined;
  let cancelWrite: CancelLayoutTask | undefined;
  let appliedMask: string | undefined;

  function update() {
    const scrollStart = axis === 'y' ? el.scrollTop : el.scrollLeft;
    const clientSize = axis === 'y' ? el.clientHeight : el.clientWidth;
    const scrollSize = axis === 'y' ? el.scrollHeight : el.scrollWidth;
    const canScrollBack = scrollStart > 2;
    const canScrollForward = scrollStart + clientSize < scrollSize - 2;
    const start = canScrollBack ? fadeSize : 0;
    const end = canScrollForward ? fadeSize : 0;
    const direction = axis === 'y' ? 'to bottom' : 'to right';
    const mask =
      start === 0 && end === 0
        ? ''
        : `linear-gradient(${direction}, transparent, black ${start}px, black calc(100% - ${end}px), transparent)`;
    // Skipping the no-change write avoids invalidating layout for other
    // readers batched into the same frame.
    if (mask === appliedMask) return;
    appliedMask = mask;
    // The style mutation is deferred to the write phase so it cannot dirty
    // layout ahead of other read tasks batched into the same frame. Repeat
    // reads in one frame supersede the pending write with the latest mask.
    cancelWrite?.();
    cancelWrite = scheduleLayoutWrite(() => {
      cancelWrite = undefined;
      el.style.maskImage = mask;
    });
  }

  // Coalesce scroll/resize/mutation bursts into the shared read phase so the
  // scrollTop/scrollHeight reads run against one clean layout per frame
  // instead of forcing a reflow per trigger. The pending flag (not the cancel
  // handle) gates re-scheduling: a synchronously-invoking rAF stub runs the
  // task before the handle assignment lands.
  function scheduleUpdate() {
    if (readPending) return;
    readPending = true;
    cancelRead = scheduleLayoutRead(() => {
      readPending = false;
      if (enabled) update();
    });
  }

  function stop() {
    if (listening) el.removeEventListener('scroll', scheduleUpdate);
    listening = false;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    cancelRead?.();
    cancelRead = undefined;
    cancelWrite?.();
    cancelWrite = undefined;
    readPending = false;
    appliedMask = undefined;
    el.style.maskImage = '';
  }

  function start() {
    stop();
    if (!enabled) return;
    scheduleUpdate();
    el.addEventListener('scroll', scheduleUpdate, { passive: true });
    listening = true;
    resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(el);
    mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(el, { childList: true, subtree: true });
  }

  start();

  return {
    update(newOptions: ScrollFadeOptions | undefined) {
      fadeSize = newOptions?.fadeSize ?? 24;
      axis = newOptions?.axis ?? 'y';
      enabled = newOptions?.enabled ?? true;
      start();
    },
    destroy: stop,
  };
};
