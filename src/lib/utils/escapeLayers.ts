/**
 * Escape-layer stack — coordinates Escape handling across stacked overlays.
 *
 * Overlays (modals, lightboxes, etc.) register a layer while they are open via
 * `pushEscapeLayer(onEscape)`. A single lazily-attached capture-phase `window`
 * keydown listener handles Escape and dispatches it to the **topmost** layer
 * only, so stacked overlays dismiss one at a time in LIFO order instead of all
 * reacting to the same keypress.
 *
 * Dependency-light by design: no stores, services, or side effects beyond the
 * shared window listener, which is detached whenever the stack empties.
 */

/**
 * Layer callback. Receives the Escape keydown event and may return `false` to
 * decline handling: the utility then neither calls preventDefault /
 * stopImmediatePropagation nor consults lower layers — the Escape falls
 * through to non-stack handlers (e.g. a focused input's own keydown).
 */
type EscapeCallback = (event: KeyboardEvent) => boolean | void;

interface EscapeLayer {
  onEscape: EscapeCallback;
}

const stack: EscapeLayer[] = [];
let listenerAttached = false;

function handleWindowKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.onEscape(e) === false) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function attachListenerIfNeeded(): void {
  if (listenerAttached) return;
  window.addEventListener('keydown', handleWindowKeydown, { capture: true });
  listenerAttached = true;
}

function detachListenerIfEmpty(): void {
  if (!listenerAttached || stack.length > 0) return;
  window.removeEventListener('keydown', handleWindowKeydown, { capture: true });
  listenerAttached = false;
}

/**
 * Register an escape layer on top of the stack.
 *
 * @param onEscape Called when Escape is pressed while this layer is topmost.
 *   Return `false` to decline handling (see {@link EscapeCallback}).
 * @returns A release function that unregisters the layer (from anywhere in the
 *   stack, not just the top). Safe to call more than once.
 */
export function pushEscapeLayer(onEscape: EscapeCallback): () => void {
  const layer: EscapeLayer = { onEscape };
  stack.push(layer);
  attachListenerIfNeeded();

  return function release(): void {
    const index = stack.indexOf(layer);
    if (index !== -1) {
      stack.splice(index, 1);
    }
    detachListenerIfEmpty();
  };
}
