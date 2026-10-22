/** Measure real message rows after hydration/layout, never virtual extents. */
interface ViewportFillOptions {
  enabled: boolean;
  /** Changes when a page, snapshot, or fetch state settles. */
  revision: string;
  hydrate: (messageId: string) => void;
  requestOlder: () => void;
}

export function fillChatViewport(viewport: HTMLElement, initial: ViewportFillOptions) {
  let options = initial;
  let frame: number | undefined;
  let disposed = false;
  const observed = new Set<Element>();

  function measure() {
    frame = undefined;
    if (disposed || !options.enabled || document.visibilityState === 'hidden') return;
    if (viewport.clientHeight === 0 || !viewport.checkVisibility({ visibilityProperty: true }))
      return;
    const rows = [...viewport.querySelectorAll<HTMLElement>('[data-lazy-turn-key]')];
    const selector = '[data-lazy-turn-key], [data-message-id]';
    const messages = [...viewport.querySelectorAll<HTMLElement>(selector)].filter((row) => {
      const ancestor = row.parentElement?.closest(selector);
      return !ancestor || !viewport.contains(ancestor);
    });
    let renderedHeight = 0;
    for (const message of messages) {
      const placeholderSelector = '[data-lazy-visible="false"]';
      const placeholders = message.matches(placeholderSelector)
        ? [message]
        : [...message.querySelectorAll<HTMLElement>(placeholderSelector)];
      const estimatedHeight = placeholders.reduce(
        (sum, row) => sum + row.getBoundingClientRect().height,
        0,
      );
      const height = Math.max(0, message.getBoundingClientRect().height - estimatedHeight);
      const style = getComputedStyle(message);
      // Margins belong to real rendered rows, not empty placeholder shells.
      if (height > 0)
        renderedHeight += height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }
    if (renderedHeight >= viewport.getBoundingClientRect().height) return;
    // An estimated placeholder can push an unread, short resident row outside
    // the observer band. Materialize that row before fetching more history.
    const placeholder = rows.findLast((row) => row.dataset.lazyVisible !== 'true');
    if (placeholder?.dataset.lazyTurnKey) {
      options.hydrate(placeholder.dataset.lazyTurnKey);
      return;
    }
    options.requestOlder();
  }

  function schedule() {
    if (disposed || !options.enabled || frame !== undefined) return;
    // Two frames put measurement behind the Svelte flush, intersection
    // hydration delivery and the prepend anchor restoration.
    frame = requestAnimationFrame(() => {
      startObserving();
      frame = requestAnimationFrame(measure);
    });
  }

  let resize: ResizeObserver | undefined;
  let mutation: MutationObserver | undefined;
  function observeRows() {
    const current = new Set<Element>([
      viewport,
      ...viewport.querySelectorAll('[data-lazy-turn-key], [data-message-id]'),
    ]);
    for (const row of observed) {
      if (!current.has(row)) {
        resize?.unobserve(row);
        observed.delete(row);
      }
    }
    for (const row of current) {
      if (!observed.has(row)) {
        observed.add(row);
        resize?.observe(row);
      }
    }
  }
  function startObserving() {
    if (resize || !options.enabled || disposed) return;
    resize = new ResizeObserver(schedule);
    mutation = new MutationObserver(() => {
      observeRows();
      schedule();
    });
    mutation.observe(viewport, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-lazy-visible'],
    });
    document.addEventListener('visibilitychange', schedule);
    observeRows();
  }
  function stopObserving() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    mutation?.disconnect();
    resize?.disconnect();
    mutation = undefined;
    resize = undefined;
    observed.clear();
    document.removeEventListener('visibilitychange', schedule);
  }
  schedule();
  return {
    update(next: ViewportFillOptions) {
      options = next;
      if (!options.enabled) stopObserving();
      schedule();
    },
    destroy() {
      disposed = true;
      stopObserving();
    },
  };
}
