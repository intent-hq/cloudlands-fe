type Side = 'top' | 'right' | 'bottom' | 'left';

export function resolveSubmenuSide(
  preferred: Side,
  trigger: { left: number; right: number },
  contentWidth: number,
  viewportWidth: number,
  sideOffset: number,
  padding: { left: number; right: number },
): Side {
  if (preferred === 'top' || preferred === 'bottom' || contentWidth <= 0 || viewportWidth <= 0) {
    return preferred;
  }
  const leftSpace = trigger.left - padding.left - sideOffset;
  const rightSpace = viewportWidth - trigger.right - padding.right - sideOffset;
  // Bits can flip horizontally, but cannot shift a side flyout over its trigger.
  // A vertical fallback lets its existing collision engine keep the child in view.
  return Math.max(leftSpace, rightSpace) >= contentWidth ? preferred : 'bottom';
}
