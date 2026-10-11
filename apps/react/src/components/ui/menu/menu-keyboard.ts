// Source: Bits internal/tabbable and MenuContentState.handleTabKeyDown.
import { focusable, isFocusable, isTabbable, tabbable } from 'tabbable';

export function getAdjacentTabStop(current: HTMLElement, backwards: boolean) {
  const options = { getShadowRoot: true };
  const doc = current.ownerDocument;
  const isCurrentTabbable = isTabbable(current, options);
  if (!isCurrentTabbable && !isFocusable(current, options)) return doc.body;
  const candidates = isCurrentTabbable ? tabbable(doc.body, options) : focusable(doc.body, options);
  if (backwards) candidates.reverse();
  const index = candidates.indexOf(current);
  if (index === -1) return doc.body;
  const remaining = candidates.slice(index + 1);
  return isCurrentTabbable
    ? remaining[0]
    : (remaining.find((node) => isTabbable(node, options)) ?? doc.body);
}

/** Radix blocks native Tab; reproduce the source's native path and scope edge loop. */
export function getInlineTabStop(content: HTMLElement, backwards: boolean, loop: boolean) {
  const active = content.ownerDocument.activeElement;
  const candidates = tabbable(content, { includeContainer: false, getShadowRoot: true });
  if (loop && candidates.length) {
    if (backwards && active === candidates[0]) return candidates.at(-1);
    if (!backwards && active === candidates.at(-1)) return candidates[0];
  }
  return getAdjacentTabStop(active instanceof HTMLElement ? active : content, backwards);
}
