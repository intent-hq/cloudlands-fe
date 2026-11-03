/** Text fields and the open conversation keep their own (edit) context menu. */
export function wantsDockContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest(
    'input, textarea, [contenteditable=""], [contenteditable="true"], [data-testid="dock-conversation-surface"]',
  );
}
