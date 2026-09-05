import { writeTextToClipboard } from '$lib/utils/clipboard';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const EXPORT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'box-sizing',
  'color',
  'display',
  'fill',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'letter-spacing',
  'line-height',
  'margin',
  'opacity',
  'overflow',
  'padding',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'text-align',
  'text-anchor',
  'text-transform',
  'transform',
  'transform-origin',
  'vector-effect',
  'white-space',
  'width',
] as const;

function inlineComputedStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  for (const property of EXPORT_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value)
      target.setAttribute('style', `${target.getAttribute('style') ?? ''}${property}:${value};`);
  }
}

function materializeDatabaseRim(source: Element, target: Element) {
  if (!(source instanceof HTMLElement) || source.dataset.storeNode !== 'true') return;
  const computed = getComputedStyle(source, '::before');
  const rim = document.createElementNS(XHTML_NAMESPACE, 'span');
  rim.setAttribute('aria-hidden', 'true');
  rim.setAttribute('data-diagram-export-pseudo', 'before');
  for (const property of EXPORT_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) rim.style.setProperty(property, value);
  }
  for (const property of [
    'position',
    'z-index',
    'top',
    'right',
    'bottom',
    'left',
    'pointer-events',
  ]) {
    const value = computed.getPropertyValue(property);
    if (value) rim.style.setProperty(property, value);
  }
  target.prepend(rim);
}

function readDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
  const rect = svg.getBoundingClientRect();
  const viewBoxWidth = viewBox?.length === 4 ? viewBox[2] : 0;
  const viewBoxHeight = viewBox?.length === 4 ? viewBox[3] : 0;
  const widthAttribute = svg.getAttribute('width') ?? '';
  const heightAttribute = svg.getAttribute('height') ?? '';
  const attributeWidth = /^\d+(?:\.\d+)?(?:px)?$/.test(widthAttribute)
    ? Number.parseFloat(widthAttribute)
    : 0;
  const attributeHeight = /^\d+(?:\.\d+)?(?:px)?$/.test(heightAttribute)
    ? Number.parseFloat(heightAttribute)
    : 0;
  const width = rect.width || attributeWidth || viewBoxWidth || 1;
  const height = rect.height || attributeHeight || viewBoxHeight || 1;
  return { width, height };
}

function findCanvasColor(svg: SVGSVGElement): string {
  let element: Element | null = svg;
  while (element) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
    element = element.parentElement;
  }
  return 'transparent';
}

function findSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) throw new Error('Diagram SVG is unavailable');
  return svg;
}

export function prepareDiagramSvgForExport(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NAMESPACE);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const sources = [svg, ...svg.querySelectorAll('*')];
  const targets = [clone, ...clone.querySelectorAll('*')];
  sources.forEach((source, index) => {
    const target = targets[index];
    if (!target) return;
    inlineComputedStyles(source, target);
    if (source.parentElement?.localName === 'foreignObject' && source instanceof HTMLElement) {
      target.setAttribute('xmlns', XHTML_NAMESPACE);
    }
    materializeDatabaseRim(source, target);
  });

  const { width, height } = readDimensions(svg);
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.removeProperty('position');
  clone.style.removeProperty('left');
  clone.style.removeProperty('top');
  clone.style.removeProperty('max-width');
  clone.style.removeProperty('min-width');
  clone.style.removeProperty('transform');
  return clone;
}

export function serializeDiagramSvg(container: HTMLElement): string {
  return new XMLSerializer().serializeToString(prepareDiagramSvgForExport(findSvg(container)));
}

export async function copyDiagramSvg(container: HTMLElement): Promise<void> {
  await writeTextToClipboard(serializeDiagramSvg(container));
}

export async function copyDiagramImage(container: HTMLElement): Promise<void> {
  const source = findSvg(container);
  const clone = prepareDiagramSvgForExport(source);
  const { width, height } = readDimensions(source);
  const scale = 2;
  clone.setAttribute('width', String(Math.round(width * scale)));
  clone.setAttribute('height', String(Math.round(height * scale)));
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context is unavailable');
    context.fillStyle = findCanvasColor(source);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
        'image/png',
      );
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } finally {
    image.close();
  }
}

export function downloadDiagramSvg(container: HTMLElement, name = 'diagram'): void {
  const blob = new Blob([serializeDiagramSvg(container)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'diagram'}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
