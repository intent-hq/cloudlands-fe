/** Independent screen-space oracle for visible paint, including stroke and arrowheads. */
export function readDiagramPaint(element: Element) {
  const viewport = element.querySelector('.diagram-scroll-container')!.getBoundingClientRect();
  const drawing = element.querySelector('.diagram-content')!.getBoundingClientRect();
  const svg = element.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
  const svgBox = svg.getBoundingClientRect();
  const matrix = svg.getScreenCTM()!;
  const scale = Math.hypot(matrix.a, matrix.b);
  const boxes = [
    ...element.querySelectorAll<SVGGraphicsElement>(
      '[data-node-id], .group-bg, .group-label, .edge-path, .edge-label-container',
    ),
  ]
    .filter((node) => {
      let opacity = 1;
      for (
        let parent: Element | null = node;
        parent && parent !== element;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        opacity *= Number(style.opacity);
      }
      return opacity > 0.01;
    })
    .map((node) => {
      const box = node.getBoundingClientRect();
      const margin = node.matches('.edge-path') ? 3.5 * scale + 0.5 : 0.5;
      return {
        left: box.left - margin,
        right: box.right + margin,
        top: box.top - margin,
        bottom: box.bottom + margin,
      };
    });
  return {
    finite: boxes.length > 0 && boxes.every((box) => Object.values(box).every(Number.isFinite)),
    overflow: Math.max(
      0,
      ...boxes.flatMap((box) => [
        Math.max(drawing.left, svgBox.left) - box.left,
        box.right - Math.min(drawing.right, svgBox.right),
        Math.max(drawing.top, svgBox.top) - box.top,
        box.bottom - Math.min(drawing.bottom, svgBox.bottom),
      ]),
    ),
    topGap: Math.min(...boxes.map((box) => box.top)) - viewport.top,
    bottomGap: viewport.bottom - Math.max(...boxes.map((box) => box.bottom)),
  };
}
