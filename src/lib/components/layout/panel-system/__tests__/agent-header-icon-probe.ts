/** Measure rendered ink, excluding the icon library's transparent viewBox rect. */
export function probeHeaderIcons(root: Element) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].map((button) => {
    const svg = button.querySelector<SVGSVGElement>('svg')!;
    const target = button.getBoundingClientRect();
    const box = svg.getBoundingClientRect();
    const shapes = [
      ...svg.querySelectorAll<SVGGeometryElement>('path,circle,line,polyline,polygon,rect'),
    ].filter((shape) => {
      const style = getComputedStyle(shape);
      return style.fill !== 'none' || style.stroke !== 'none';
    });
    const points = shapes.flatMap((shape) => {
      const b = shape.getBBox();
      const m = shape.getScreenCTM()!;
      return [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    });
    const left = Math.min(...points.map((p) => p.x));
    const right = Math.max(...points.map((p) => p.x));
    const top = Math.min(...points.map((p) => p.y));
    const bottom = Math.max(...points.map((p) => p.y));
    const id = button.dataset.testid ?? 'add-panel-column';
    // Cross-sections through straight segments (normal to the diagonal for X).
    const crossSections: Record<string, [number, number, number, number]> = {
      'panel-actions-trigger': [8, 8, 1, 0],
      'add-panel-column': [128, 64, 1, 0],
      'panel-close-button': [80, 80, Math.SQRT1_2, -Math.SQRT1_2],
    };
    const [x, y, dx, dy] = crossSections[id];
    let ink = 0;
    for (let offset = -20; offset < 20; offset += 0.125) {
      const p = new DOMPoint(x + (offset + 0.0625) * dx, y + (offset + 0.0625) * dy);
      if (shapes.some((shape) => shape.isPointInFill(p))) ink += 0.125;
    }
    return {
      id,
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
      svg: { width: box.width, height: box.height, transform: getComputedStyle(svg).transform },
      painted: {
        width: right - left,
        height: bottom - top,
        dx: (left + right - target.left - target.right) / 2,
        dy: (top + bottom - target.top - target.bottom) / 2,
      },
      strokeWidth: (ink * box.width) / svg.viewBox.baseVal.width,
      color: getComputedStyle(svg).color,
      opacity: Number(getComputedStyle(button).opacity),
      disabled: button.disabled,
    };
  });
}
