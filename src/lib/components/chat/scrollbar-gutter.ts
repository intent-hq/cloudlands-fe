/**
 * Width the scroll container reserves for its vertical scrollbar gutter
 * (`scrollbar-gutter: stable` / classic scrollbars). The pinned-prompt
 * overlay compensates by this amount so its lane occupies the same
 * horizontal box as the conversation column inside the scroll container.
 * Horizontal border widths are subtracted from `offsetWidth - clientWidth`
 * so the measurement stays exact if the container ever gains a border.
 */
export function measureScrollbarGutterWidth(container: HTMLElement): number {
  const style = getComputedStyle(container);
  const horizontalBorders =
    (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  return Math.max(0, container.offsetWidth - container.clientWidth - horizontalBorders);
}
