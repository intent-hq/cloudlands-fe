import type { Action } from 'svelte/action';

export interface ScrollFadeOptions {
  /** Fade size in px at each overflowing edge. Defaults to 24. */
  fadeSize?: number;
  /** Scroll axis to fade along. Defaults to 'y'. */
  axis?: 'x' | 'y';
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

  function update() {
    const scrollStart = axis === 'y' ? el.scrollTop : el.scrollLeft;
    const clientSize = axis === 'y' ? el.clientHeight : el.clientWidth;
    const scrollSize = axis === 'y' ? el.scrollHeight : el.scrollWidth;
    const canScrollBack = scrollStart > 2;
    const canScrollForward = scrollStart + clientSize < scrollSize - 2;
    const start = canScrollBack ? fadeSize : 0;
    const end = canScrollForward ? fadeSize : 0;
    if (start === 0 && end === 0) {
      el.style.maskImage = '';
      return;
    }
    const direction = axis === 'y' ? 'to bottom' : 'to right';
    el.style.maskImage = `linear-gradient(${direction}, transparent, black ${start}px, black calc(100% - ${end}px), transparent)`;
  }

  update();
  el.addEventListener('scroll', update, { passive: true });
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
  resizeObserver?.observe(el);
  const mutationObserver = new MutationObserver(update);
  mutationObserver.observe(el, { childList: true, subtree: true });

  return {
    update(newOptions: ScrollFadeOptions | undefined) {
      fadeSize = newOptions?.fadeSize ?? 24;
      axis = newOptions?.axis ?? 'y';
      update();
    },
    destroy() {
      el.removeEventListener('scroll', update);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      el.style.maskImage = '';
    },
  };
};
