/** Browser measurement of production inline text; no fixture styling is substituted. */
export function measureInlinePath(paragraph: Element) {
  const trigger = paragraph.querySelector<HTMLElement>('[role="button"]')!;
  const parentStyle = getComputedStyle(paragraph);
  const triggerStyle = getComputedStyle(trigger);
  const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim()) textNodes.push(node as Text);
  }
  const lastText = textNodes.at(-1)!;
  const length = lastText.length;
  const glyph = (offset: number) => {
    const range = document.createRange();
    range.setStart(lastText, offset);
    range.setEnd(lastText, offset + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, height: rect.height };
  };
  const range = document.createRange();
  range.selectNodeContents(lastText);
  const lines = [...range.getClientRects()].map((rect) => ({
    x: rect.x,
    y: rect.y,
    right: rect.right,
  }));
  const bounds = paragraph.getBoundingClientRect();
  return {
    fontSize: parseFloat(parentStyle.fontSize),
    lineHeight: parseFloat(parentStyle.lineHeight),
    triggerFont: parseFloat(triggerStyle.fontSize),
    triggerLine: parseFloat(triggerStyle.lineHeight),
    family: parentStyle.fontFamily,
    triggerFamily: triggerStyle.fontFamily,
    overflow: paragraph.scrollWidth - paragraph.clientWidth,
    paragraphRight: bounds.right,
    lines,
    beforePeriod: glyph(length - 2),
    period: glyph(length - 1),
  };
}

/** Inspect every trigger layer so a second nested hover surface cannot hide. */
export function measureCollapsedFilesTrigger(element: Element) {
  const bounds = element.getBoundingClientRect();
  const row = element.closest('[data-sidebar-label-row]')!.getBoundingClientRect();
  const icon = element.querySelector('svg')!.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    width: bounds.width,
    height: bounds.height,
    iconWidth: icon.width,
    iconHeight: icon.height,
    rightInset: row.right - bounds.right,
    centerX: icon.x + icon.width / 2 - bounds.x - bounds.width / 2,
    centerY: icon.y + icon.height / 2 - bounds.y - bounds.height / 2,
    padding: [style.paddingLeft, style.paddingRight],
    backgrounds: [element, ...element.querySelectorAll('span')].map(
      (layer) => getComputedStyle(layer).backgroundColor,
    ),
    focusVisible: element.matches(':focus-visible'),
    outline: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth),
  };
}
