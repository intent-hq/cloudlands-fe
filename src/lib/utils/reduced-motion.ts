/**
 * Single JS source of truth for "is motion reduced?". Mirrors the CSS
 * `--motion-reduced` token in `src/lib/styles/tokens.css`: motion is reduced
 * when the OS `prefers-reduced-motion: reduce` media query matches OR the
 * root element carries `data-reduce-motion` (set by the battery-saver
 * preference). Dependency-light on purpose — no stores, services, or side
 * effects — and SSR-safe. The reactive rune wrapper lives in
 * `./reduced-motion.svelte.ts`.
 */

export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';

function reducedMotionQuery(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
}

function rootElement(): HTMLElement | undefined {
  return typeof document === 'undefined' ? undefined : (document.documentElement ?? undefined);
}

function rootRequestsReducedMotion(): boolean {
  return rootElement()?.hasAttribute(REDUCE_MOTION_ATTRIBUTE) === true;
}

/** True when the OS preference or the root `data-reduce-motion` attribute asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches === true || rootRequestsReducedMotion();
}

/**
 * Subscribe to changes of the combined reduced-motion flag from either source
 * (media query `change` events and root-attribute mutations). `listener` is
 * called only when the combined value actually flips. Returns the unsubscribe.
 */
export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
  const query = reducedMotionQuery();
  const root = rootElement();
  let mediaMatches = query?.matches === true;
  let current = mediaMatches || rootRequestsReducedMotion();

  const publish = () => {
    const next = mediaMatches || rootRequestsReducedMotion();
    if (next === current) return;
    current = next;
    listener(next);
  };
  const onMediaChange = (event: MediaQueryListEvent) => {
    mediaMatches = event.matches;
    publish();
  };

  query?.addEventListener('change', onMediaChange);
  let observer: MutationObserver | undefined;
  if (root && typeof MutationObserver === 'function') {
    observer = new MutationObserver(publish);
    observer.observe(root, { attributes: true, attributeFilter: [REDUCE_MOTION_ATTRIBUTE] });
  }

  return () => {
    query?.removeEventListener('change', onMediaChange);
    observer?.disconnect();
  };
}
