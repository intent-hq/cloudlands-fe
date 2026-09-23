/** True when the menu rect is unchanged from the current read to the next animation-frame callback. */
export function isPanelMenuSettled(root: Element) {
  const before = JSON.stringify(root.getBoundingClientRect());
  return new Promise<boolean>((resolve) => {
    requestAnimationFrame(() => resolve(JSON.stringify(root.getBoundingClientRect()) === before));
  });
}

/** Native painted-ink measurements; transparent SVG viewBox rectangles are excluded. */
export function probePanelMenuIcons(root: Element) {
  const bounds = root.getBoundingClientRect();
  const crossSections: Record<string, [number, number, number, number]> = {
    font: [80, 152, 0, 1],
    expand: [48, 72, 1, 0],
    compress: [88, 64, 1, 0],
    'arrow-left': [128, 128, 0, 1],
    'arrow-right': [128, 128, 0, 1],
    copy: [40, 144, 1, 0],
    trash: [104, 128, 1, 0],
    'circle-info': [32, 128, 1, 0],
    'table-columns': [56, 128, 1, 0],
    'arrow-up-right-from-square': [40, 144, 1, 0],
    'up-right-from-square': [40, 144, 1, 0],
  };
  const commandIcons = [...root.querySelectorAll<SVGSVGElement>('svg[data-icon]')].filter(
    (svg) => !svg.closest('[data-slot="menu-sub-chevron"], [data-slot="menu-item-indicator"]'),
  );
  const icons = commandIcons.map((svg) => {
    const id = svg.dataset.icon!;
    const box = svg.getBoundingClientRect();
    const row = svg.closest('[data-menu-item], [data-slot="menu-label"]')!;
    const target = row.getBoundingClientRect();
    const shapes = [...svg.querySelectorAll<SVGGeometryElement>('path,circle,rect')].filter(
      (shape) => getComputedStyle(shape).fill !== 'none',
    );
    const points = shapes.flatMap((shape) => {
      const b = shape.getBBox();
      const m = shape.getScreenCTM()!;
      return [
        [b.x, b.y],
        [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    });
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    let ink = 0;
    const section = crossSections[id];
    if (section) {
      const [x, y, dx, dy] = section;
      for (let offset = -20; offset < 20; offset += 0.125) {
        const point = new DOMPoint(x + (offset + 0.0625) * dx, y + (offset + 0.0625) * dy);
        if (shapes.some((shape) => shape.isPointInFill(point))) ink += 0.125;
      }
    }
    return {
      id,
      label: row.textContent?.trim(),
      weight: svg.dataset.weight,
      svg: { width: box.width, height: box.height, transform: getComputedStyle(svg).transform },
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
      painted: {
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      strokeWidth: section ? (ink * box.width) / svg.viewBox.baseVal.width : null,
      opacity: getComputedStyle(svg).opacity,
      disabled: row.getAttribute('aria-disabled') === 'true',
      menuTransform: getComputedStyle(root).transform,
    };
  });
  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    icons,
  };
}
