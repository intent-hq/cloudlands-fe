/**
 * Single JS source of truth for "is motion reduced?". Mirrors the CSS
 * `--motion-reduced` token in `src/lib/styles/tokens.css`: motion is reduced
 * when the OS `prefers-reduced-motion: reduce` media query matches OR the
 * root element carries `data-reduce-motion` (set by the battery-saver
 * preference). Explicit catalog previews override both sources (reduced first).
 * Dependency-light on purpose — no stores, services, or side
 * effects — and SSR-safe. The reactive rune wrapper lives in
 * `./reduced-motion.svelte.ts`.
 */

export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCE_MOTION_ATTRIBUTE = 'data-reduce-motion';

function targetDocument(documentRef?: Document): Document | undefined {
  return documentRef ?? (typeof document === 'undefined' ? undefined : document);
}

function reducedMotionQuery(documentRef?: Document): MediaQueryList | undefined {
  const view = documentRef?.defaultView;
  return typeof view?.matchMedia === 'function'
    ? view.matchMedia(REDUCED_MOTION_MEDIA_QUERY)
    : undefined;
}

function resolveReducedMotion(root: HTMLElement | undefined, mediaMatches: boolean): boolean {
  if (root?.classList.contains('catalog-reduced-motion')) return true;
  if (root?.classList.contains('catalog-full-motion')) return false;
  return mediaMatches || root?.hasAttribute(REDUCE_MOTION_ATTRIBUTE) === true;
}

/** OS-or-battery policy, with authoritative catalog previews in the owning document. */
export function prefersReducedMotion(documentRef?: Document): boolean {
  const target = targetDocument(documentRef);
  return resolveReducedMotion(
    target?.documentElement,
    reducedMotionQuery(target)?.matches === true,
  );
}

/**
 * Subscribe to changes of the combined reduced-motion flag from either source
 * (media query `change` events and root-attribute mutations). `listener` is
 * called only when the combined value actually flips. Returns the unsubscribe.
 */
export function onReducedMotionChange(
  listener: (reduced: boolean) => void,
  documentRef?: Document,
): () => void {
  const target = targetDocument(documentRef);
  const query = reducedMotionQuery(target);
  const root = target?.documentElement;
  let mediaMatches = query?.matches === true;
  let current = resolveReducedMotion(root, mediaMatches);

  const publish = () => {
    const next = resolveReducedMotion(root, mediaMatches);
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
  const Observer = target?.defaultView?.MutationObserver;
  if (root && Observer) {
    observer = new Observer(publish);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [REDUCE_MOTION_ATTRIBUTE, 'class'],
    });
  }

  return () => {
    query?.removeEventListener('change', onMediaChange);
    observer?.disconnect();
  };
}
