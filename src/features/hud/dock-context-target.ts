/** Header chrome opens the dock menu; conversation text keeps its normal edit menu. */
export function wantsDockContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]'))
    return false;
  if (target.closest('[data-dock-chrome]')) return true;
  return !target.closest('[data-testid="dock-conversation-surface"]');
}
