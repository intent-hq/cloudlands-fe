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

/** Measure a text-children trigger against its label so a fixed icon box cannot hide overflow. */
export function measureTextTrigger(trigger: Element) {
  const bounds = trigger.getBoundingClientRect();
  const label = trigger.querySelector<HTMLElement>('[data-setup-card-path]')!;
  const labelBounds = label.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(label);
  const text = range.getBoundingClientRect();
  return {
    width: bounds.width,
    height: bounds.height,
    labelWidth: labelBounds.width,
    textWidth: text.width,
    labelOverflow: Math.max(0, text.right - bounds.right, bounds.left - text.left),
    scrollOverflow: trigger.scrollWidth - trigger.clientWidth,
  };
}
