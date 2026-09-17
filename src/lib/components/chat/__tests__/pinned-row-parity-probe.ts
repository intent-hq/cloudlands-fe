/** Native source-row oracle: compare rendered ink, typography and relative geometry. */
export function readPinnedRowPresentation(surface: HTMLElement) {
  const row =
    surface.querySelector<HTMLElement>(
      '[data-testid="agent-message-disclosure-header"], [data-testid="event-wakeup-header"], [data-testid="automated-wake-header"]',
    ) ?? surface;
  const bounds = row.getBoundingClientRect();
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const text = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const value = node.textContent?.trim();
    const element = node.parentElement;
    if (!value || !element || element.closest('.sr-only, [role="tooltip"]')) continue;
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    text.push({
      value,
      family: style.fontFamily,
      size: style.fontSize,
      lineHeight: style.lineHeight,
      weight: style.fontWeight,
      color: style.color,
      x: rect.x - bounds.x,
      y: rect.y - bounds.y,
      width: rect.width,
      height: rect.height,
    });
  }
  const glyphs = Array.from(row.querySelectorAll('svg')).map((svg) => {
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.x - bounds.x,
      y: rect.y - bounds.y,
      width: rect.width,
      height: rect.height,
      color: getComputedStyle(svg).color,
      ink: Array.from(svg.querySelectorAll('path, circle, rect, line, polygon, polyline')).map(
        (shape) => ({
          tag: shape.tagName,
          geometry: ['d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'points', 'transform'].map(
            (name) => shape.getAttribute(name),
          ),
          fill: getComputedStyle(shape).fill,
          stroke: getComputedStyle(shape).stroke,
        }),
      ),
    };
  });
  const surfaceStyle = getComputedStyle(surface);
  return {
    width: bounds.width,
    height: bounds.height,
    background: surfaceStyle.backgroundColor,
    radius: surfaceStyle.borderRadius,
    text,
    glyphs,
  };
}
