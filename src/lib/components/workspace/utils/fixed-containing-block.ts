function createsFixedContainingBlock(style: CSSStyleDeclaration): boolean {
  const willChange = style.willChange.split(',').map((property) => property.trim());

  return (
    style.transform !== 'none' ||
    style.translate !== 'none' ||
    style.rotate !== 'none' ||
    style.scale !== 'none' ||
    style.perspective !== 'none' ||
    style.filter !== 'none' ||
    style.backdropFilter !== 'none' ||
    /\b(?:layout|paint|strict|content)\b/.test(style.contain) ||
    style.contentVisibility === 'auto' ||
    willChange.some((property) =>
      [
        'transform',
        'translate',
        'rotate',
        'scale',
        'perspective',
        'filter',
        'backdrop-filter',
        'contain',
      ].includes(property),
    )
  );
}

export function getFixedContainingBlockOffset(node: HTMLElement): { x: number; y: number } {
  let ancestor = node.parentElement;
  while (ancestor) {
    if (createsFixedContainingBlock(window.getComputedStyle(ancestor))) {
      const rect = ancestor.getBoundingClientRect();
      return {
        x: rect.left + ancestor.clientLeft,
        y: rect.top + ancestor.clientTop,
      };
    }
    ancestor = ancestor.parentElement;
  }

  return { x: 0, y: 0 };
}
