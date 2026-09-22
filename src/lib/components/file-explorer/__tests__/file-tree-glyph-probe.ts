/** Sample real SVG ink in screen coordinates so mirroring/rotation cannot fool the probe. */
export function probeFileTreeGlyph(svg: SVGSVGElement) {
  const box = svg.getBoundingClientRect();
  const shapes = [...svg.querySelectorAll<SVGGeometryElement>('path,circle,polyline')];
  const inkPoints = shapes.flatMap((shape) => {
    const bounds = shape.getBBox();
    const matrix = shape.getScreenCTM()!;
    return [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
  });
  const inkWidth = Math.max(...inkPoints.map((p) => p.x)) - Math.min(...inkPoints.map((p) => p.x));
  const inkHeight = Math.max(...inkPoints.map((p) => p.y)) - Math.min(...inkPoints.map((p) => p.y));
  const paintedAt = (x: number, y: number) =>
    shapes.some((shape) => {
      const point = new DOMPoint(box.x + x * box.width, box.y + y * box.height).matrixTransform(
        shape.getScreenCTM()!.inverse(),
      );
      const style = getComputedStyle(shape);
      return (
        (style.fill !== 'none' && shape.isPointInFill(point)) ||
        (style.stroke !== 'none' && shape.isPointInStroke(point))
      );
    });
  let searchInk = 0;
  // A horizontal cross-section through the magnifier's left ring, measured in CSS pixels.
  for (let x = 0; x < 64; x += 0.125) {
    if (paintedAt((x + 0.0625) / 256, 112 / 256)) searchInk += (box.width * 0.125) / 256;
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
    color: getComputedStyle(svg).color,
    inkWidth,
    inkHeight,
    right: paintedAt(176 / 256, 0.5),
    left: paintedAt(80 / 256, 0.5),
    down: paintedAt(0.5, 176 / 256),
    up: paintedAt(0.5, 80 / 256),
    searchInk,
  };
}
