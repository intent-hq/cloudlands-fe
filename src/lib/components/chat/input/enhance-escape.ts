import { pushEscapeLayer } from '$lib/utils/escapeLayers';

/**
 * Escape-to-cancel for composers with an in-flight Enhance prompt request
 * (intent-hq/intent#5758).
 *
 * The enhancing composer locks its editor, so ProseMirror skips keydown and the
 * browser usually moves focus to the body; the editor's own Escape handler
 * never runs. Every enhancing composer shares ONE escape layer that routes the
 * key to the composer it was pressed in. A per-composer layer would not work:
 * a declining (`return false`) layer does not consult lower layers, so an
 * Escape in an earlier composer would stop at a later composer's layer.
 *
 * Routing: a target inside a registered container cancels that composer; an
 * unfocused document (target is the body) cancels the composer that last held
 * focus, else the most recently registered one; anything else declines so the
 * Escape reaches its own handlers.
 */
interface EnhancingComposer {
  container: () => HTMLElement | null | undefined;
  cancel: () => void;
}

const composers: EnhancingComposer[] = [];
let lastFocused: EnhancingComposer | null = null;
let releaseLayer: (() => void) | null = null;

function handleEscape(event: KeyboardEvent): boolean | void {
  const target = event.target;
  const owner =
    target instanceof Node
      ? composers.find((composer) => composer.container()?.contains(target))
      : undefined;
  if (owner) {
    owner.cancel();
    return;
  }
  const unfocused =
    !(target instanceof Node) || target === document.body || target === document.documentElement;
  if (!unfocused || composers.length === 0) return false;
  const fallback =
    lastFocused && composers.includes(lastFocused) ? lastFocused : composers[composers.length - 1];
  fallback.cancel();
}

/**
 * Register a composer while its enhancement is in flight. Returns the release
 * function (call when the request settles or is cancelled).
 */
export function registerEnhancingComposer(
  container: () => HTMLElement | null | undefined,
  cancel: () => void,
): () => void {
  const entry: EnhancingComposer = { container, cancel };
  composers.push(entry);
  const active = typeof document === 'undefined' ? null : document.activeElement;
  if (active && container()?.contains(active)) lastFocused = entry;
  releaseLayer ??= pushEscapeLayer(handleEscape);

  return function release(): void {
    const index = composers.indexOf(entry);
    if (index === -1) return;
    composers.splice(index, 1);
    if (lastFocused === entry) lastFocused = null;
    if (composers.length === 0) {
      releaseLayer?.();
      releaseLayer = null;
    }
  };
}
