import { copyDiagramSvg } from '$lib/components/diagrams/diagram-export';

export interface MermaidPaintProbe {
  png: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  label: string;
  nativeNodes: number;
  serializedSvgUnits: number;
  imageUrlUnits: number;
  decodedPixels: number;
}
/** Browser-only feasibility probe, NOT a production producer/consumer or sink.
 * Whole clone/font embedding/XML/data URL belong to admitted construction work.
 * Reuses the unchanged native export path with a test-local clipboard capture. */
export async function probeNativeMermaidPaint(
  viewport: HTMLElement,
  construction: HTMLElement,
  target: 'first' | 'far',
  scale: number,
): Promise<MermaidPaintProbe> {
  if ((window as Window & { electronAPI?: unknown }).electronAPI)
    throw new Error('Paint probe requires an isolated browser test context');
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 8) throw new Error('Invalid probe zoom');
  construction.style.transform = '';
  await document.fonts.ready;
  const svg = construction.querySelector<SVGSVGElement>('.mermaid-svg > svg');
  if (!svg) throw new Error('Native Mermaid SVG is missing');
  const labels = svg.querySelectorAll('.node .nodeLabel, .messageText');
  const label = labels[target === 'first' ? 0 : labels.length - 1];
  if (!label) throw new Error('Native Mermaid label is missing');
  const sourceRect = svg.getBoundingClientRect(),
    labelRect = label.getBoundingClientRect();
  const hostRect = construction.getBoundingClientRect();
  const x = Math.max(0, labelRect.left - sourceRect.left - 50);
  const y = Math.max(0, labelRect.top - sourceRect.top - 50);
  let xml = '';
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        xml = value;
      },
      write: () => {
        throw new Error('Unexpected clipboard write');
      },
      read: () => {
        throw new Error('Clipboard reads prohibited');
      },
      readText: () => {
        throw new Error('Clipboard reads prohibited');
      },
    },
  });
  try {
    await copyDiagramSvg(svg.parentElement!);
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
  if (!xml) throw new Error('Native SVG export did not finish');
  const width = 256,
    height = 256;
  // Keep the complete original inner SVG layout; only the outer camera changes.
  const camera = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width / scale} ${height / scale}">${xml}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(camera)}`;
  const image = new Image();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== width || image.naturalHeight !== height)
      throw new Error('Tile decode exceeded requested pixel dimensions');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');
    context.fillStyle = getComputedStyle(viewport).backgroundColor;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const png = canvas.toDataURL('image/png');
    construction.style.transformOrigin = '0 0';
    construction.style.transform = `translate(${-(sourceRect.left - hostRect.left + x) * scale}px, ${-(sourceRect.top - hostRect.top + y) * scale}px) scale(${scale})`;
    return {
      png,
      width,
      height,
      x,
      y,
      scale,
      label: label.textContent ?? '',
      nativeNodes: svg.querySelectorAll('*').length,
      serializedSvgUnits: xml.length,
      imageUrlUnits: url.length,
      decodedPixels: image.naturalWidth * image.naturalHeight,
    };
  } finally {
    image.src = '';
    canvas.width = 0;
    canvas.height = 0;
  }
}
