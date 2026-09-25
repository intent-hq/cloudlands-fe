/**
 * Item handlers for a required single-select `ToggleGroup`.
 *
 * bits-ui deselects the active item when it is clicked or toggled with
 * Enter/Space and reports `''`. Spread onto each `ToggleGroup.Item`, these
 * handlers run ahead of bits-ui's own (it composes caller handlers first and
 * skips its toggle once the event is `defaultPrevented`), so cancelling the
 * event on the active item keeps it selected and no empty value is reported.
 */
function cancelWhenActive(event: Event) {
  const item = event.currentTarget as Element | null;
  if (item?.getAttribute('aria-checked') === 'true') event.preventDefault();
}

export const keepToggleSelected = {
  onclick: cancelWhenActive,
  onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') cancelWhenActive(event);
  },
};
