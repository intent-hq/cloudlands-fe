export function insertLabelKnockout(
  parent: Element,
  before: Element,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const knockout = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  knockout.classList.add('edge-label-knockout');
  knockout.setAttribute('x', String(bounds.x - 6));
  knockout.setAttribute('y', String(bounds.y - 4));
  knockout.setAttribute('width', String(bounds.width + 12));
  knockout.setAttribute('height', String(bounds.height + 8));
  knockout.setAttribute('rx', '2');
  knockout.dataset.labelPaddingX = '6';
  knockout.dataset.labelPaddingY = '4';
  parent.insertBefore(knockout, before);
}

export function addMermaidLabelKnockouts(svg: SVGSVGElement) {
  const measured: {
    parent: Element;
    before: Element;
    bounds: DOMRect;
    text?: SVGGraphicsElement;
  }[] = [];

  // These text bounds are independent of the new background rectangles.
  // Read both label families before invalidating SVG layout with insertions.
  for (const label of svg.querySelectorAll<SVGGElement>('g.edgeLabel')) {
    if (label.querySelector('.edge-label-knockout, rect.background, foreignObject')) continue;
    const content = label.querySelector<SVGGraphicsElement>('text');
    if (content) {
      measured.push({ parent: label, before: label.firstElementChild!, bounds: content.getBBox() });
    }
  }

  for (const text of svg.querySelectorAll<SVGGraphicsElement>('text.messageText, text.loopText')) {
    if (text.dataset.labelKnockout === 'true' || !text.textContent?.trim()) continue;
    const parent = text.parentElement;
    if (!parent) continue;
    measured.push({ parent, before: text, bounds: text.getBBox(), text });
  }

  for (const { parent, before, bounds, text } of measured) {
    insertLabelKnockout(parent, before, bounds);
    if (text) text.dataset.labelKnockout = 'true';
  }
}
