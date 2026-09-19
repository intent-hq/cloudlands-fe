import { writeTextToClipboard } from '$lib/utils/clipboard';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const EXPORT_STYLE_PROPERTIES = [
  'align-items',
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
  'fill-opacity',
  'flex',
  'flex-direction',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-style',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'gap',
  'height',
  'justify-content',
  'letter-spacing',
  'line-height',
  'margin',
  'opacity',
  'overflow',
  'overflow-wrap',
  'padding',
  'rx',
  'ry',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-align',
  'text-anchor',
  'text-transform',
  'transform',
  'transform-origin',
  'vector-effect',
  'white-space',
  '-webkit-box-orient',
  '-webkit-line-clamp',
  'width',
  'word-break',
] as const;

function inlineComputedStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  for (const property of EXPORT_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value && (target instanceof SVGElement || target instanceof HTMLElement)) {
      // Freeze resolved theme values, including overrides from outside the SVG.
      target.style.setProperty(property, value, 'important');
    }
  }
}

function materializeDiagramPseudoElement(source: Element, target: Element) {
  if (
    !(source instanceof HTMLElement) ||
    (source.dataset.storeNode !== 'true' &&
      !source.matches('foreignObject.edge-label-surface > .labelBkg, .edge-label-html'))
  )
    return;
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
    'mask-image',
    'mask-composite',
    'mask-size',
    'mask-repeat',
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
  // Custom graphs use intrinsic coordinates and an outer camera transform that
  // export removes. Its screen rect is scaled, not the graph's viewport. Mermaid
  // already maps its viewBox into the rendered viewport, which we must preserve.
  const intrinsic = svg.classList.contains('diagram-svg-layer');
  const width =
    (intrinsic ? attributeWidth : 0) || rect.width || attributeWidth || viewBoxWidth || 1;
  const height =
    (intrinsic ? attributeHeight : 0) || rect.height || attributeHeight || viewBoxHeight || 1;
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
  // Only renderer-owned graph roots are eligible, never toolbar/template/nested
  // icon SVGs. An ambiguous scope must fail rather than export a neighboring graph.
  const graphs = container.querySelectorAll<SVGSVGElement>(
    '.mermaid-svg > svg, svg.diagram-svg-layer',
  );
  const svg = graphs.length === 1 ? graphs[0] : undefined;
  const renderer = svg?.closest('.mermaid-renderer, .diagram-renderer');
  if (
    !svg ||
    renderer?.getAttribute('data-render-settled') === 'false' ||
    renderer?.getAttribute('data-diagram-settled') === 'false'
  ) {
    throw new Error('Diagram SVG is unavailable');
  }
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
    if (source instanceof HTMLElement && target instanceof HTMLElement) {
      for (const property of ['position', 'isolation', 'z-index']) {
        target.style.setProperty(property, getComputedStyle(source).getPropertyValue(property));
      }
    }
    materializeDiagramPseudoElement(source, target);
  });

  const { width, height } = readDimensions(svg);
  if (!clone.hasAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.setProperty('width', `${width}px`, 'important');
  clone.style.setProperty('height', `${height}px`, 'important');
  // The note viewport clips oversized Mermaid lifelines. Keep that viewport
  // boundary when the snapshot is rendered without its surrounding container.
  clone.style.setProperty('overflow', 'hidden', 'important');
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

/** Standalone images cannot use the app document's loaded web fonts. */
async function embedDiagramFonts(clone: SVGSVGElement): Promise<void> {
  const normalizeFamily = (family: string) =>
    family
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
  const families = new Set(
    [clone, ...clone.querySelectorAll<SVGElement | HTMLElement>('[style]')].flatMap((element) =>
      element.style.fontFamily.split(',').map(normalizeFamily),
    ),
  );
  const faces: CSSFontFaceRule[] = [];
  const collect = (sheet: CSSStyleSheet | CSSGroupingRule) => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      // Cross-origin sheets may apply styles while denying CSSOM rule access.
      if (error instanceof DOMException && error.name === 'SecurityError') return;
      throw error;
    }
    for (const rule of Array.from(rules)) {
      if (
        rule instanceof CSSFontFaceRule &&
        families.has(normalizeFamily(rule.style.getPropertyValue('font-family')))
      ) {
        faces.push(rule);
      } else if (rule instanceof CSSImportRule && rule.styleSheet) {
        collect(rule.styleSheet);
      } else if ('cssRules' in rule) {
        collect(rule as CSSGroupingRule);
      }
    }
  };
  for (const sheet of Array.from(clone.ownerDocument.styleSheets)) collect(sheet);
  if (!faces.length) return;
  const css = await Promise.all(
    faces.map(async (face) => {
      const urls = [...face.cssText.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)];
      let embedded = face.cssText;
      for (const [expression, , url] of urls) {
        if (url.startsWith('data:')) continue;
        const response = await fetch(
          new URL(url, face.parentStyleSheet?.href ?? clone.ownerDocument.baseURI),
        );
        if (!response.ok) throw new Error('Diagram font is unavailable');
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error('Diagram font encoding failed'));
          reader.readAsDataURL(blob);
        });
        embedded = embedded.replace(expression, `url("${dataUrl}")`);
      }
      return embedded;
    }),
  );
  const style = document.createElementNS(SVG_NAMESPACE, 'style');
  style.textContent = css.join('\n');
  clone.prepend(style);
}

export async function copyDiagramSvg(container: HTMLElement): Promise<void> {
  const clone = prepareDiagramSvgForExport(findSvg(container));
  await embedDiagramFonts(clone);
  await writeTextToClipboard(new XMLSerializer().serializeToString(clone));
}

export async function copyDiagramImage(container: HTMLElement): Promise<void> {
  const source = findSvg(container);
  const clone = prepareDiagramSvgForExport(source);
  const { width, height } = readDimensions(source);
  await embedDiagramFonts(clone);
  const scale = 2;
  // Chromium cannot decode SVG Blobs through createImageBitmap. A data URL
  // decoded by Image also keeps foreignObject labels origin-clean for toBlob.
  const image = new Image();
  try {
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    await image.decode();
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
    image.src = '';
  }
}

export async function downloadDiagramSvg(container: HTMLElement, name = 'diagram'): Promise<void> {
  const clone = prepareDiagramSvgForExport(findSvg(container));
  await embedDiagramFonts(clone);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'diagram'}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
