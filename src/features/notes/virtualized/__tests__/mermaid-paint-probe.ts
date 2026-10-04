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
  nativeLabelVisible: boolean;
  geometry: Record<string, unknown>;
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
  const scroller = construction.querySelector<HTMLElement>('.mermaid-svg-viewport');
  if (!scroller) throw new Error('Native Mermaid viewport is missing');
  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  await document.fonts.ready;
  const svg = construction.querySelector<SVGSVGElement>('.mermaid-svg > svg');
  if (!svg) throw new Error('Native Mermaid SVG is missing');
  const labels = svg.querySelectorAll('.node .nodeLabel, .messageText');
  const label = labels[target === 'first' ? 0 : labels.length - 1];
  if (!label) throw new Error('Native Mermaid label is missing');
  const sourceRect = svg.getBoundingClientRect(),
    labelRect = label.getBoundingClientRect();
  const hostRect = construction.getBoundingClientRect();
  // The camera margin is measured in output pixels, including at higher zoom.
  const x = Math.max(0, labelRect.left - sourceRect.left - 50 / scale);
  const y = Math.max(0, labelRect.top - sourceRect.top - 50 / scale);
  // Pan through the renderer's own scroll viewport before moving the camera.
  // Translating only the outer host leaves a far node clipped by inner overflow.
  scroller.scrollLeft = x;
  scroller.scrollTop = y;
  const pannedRect = svg.getBoundingClientRect();
  // A nested SVG camera does not reproduce the native root SVG CSS background.
  // Include that exact painted box, along with the surrounding native surfaces.
  const backdrops: Array<{ color: string; rect: DOMRect }> = [];
  for (
    let ancestor: Element | null = svg;
    ancestor && ancestor !== viewport;
    ancestor = ancestor.parentElement
  ) {
    const color = getComputedStyle(ancestor).backgroundColor;
    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)')
      backdrops.unshift({ color, rect: ancestor.getBoundingClientRect() });
  }
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
    for (const backdrop of backdrops) {
      context.fillStyle = backdrop.color;
      context.fillRect(
        (backdrop.rect.left - pannedRect.left - x) * scale,
        (backdrop.rect.top - pannedRect.top - y) * scale,
        backdrop.rect.width * scale,
        backdrop.rect.height * scale,
      );
    }
    context.drawImage(image, 0, 0);
    const png = canvas.toDataURL('image/png');
    // Capture the synchronous camera transition as well as the final native clip.
    const beforeCamera = {
      label: label.getBoundingClientRect().toJSON(),
      connected: label.isConnected && svg.isConnected && scroller.isConnected,
      transform: getComputedStyle(construction).transform,
      transitionProperty: getComputedStyle(construction).transitionProperty,
      transitionDuration: getComputedStyle(construction).transitionDuration,
    };
    construction.style.transformOrigin = '0 0';
    construction.style.transform = `translate(${-(pannedRect.left - hostRect.left + x) * scale}px, ${-(pannedRect.top - hostRect.top + y) * scale}px) scale(${scale})`;
    const shown = label.getBoundingClientRect(),
      cameraRect = viewport.getBoundingClientRect();
    const nativeClip = scroller.getBoundingClientRect();
    const nativeLabelVisible =
      shown.left >= Math.max(cameraRect.left, nativeClip.left) &&
      shown.right <= Math.min(cameraRect.right, nativeClip.right) &&
      shown.top >= Math.max(cameraRect.top, nativeClip.top) &&
      shown.bottom <= Math.min(cameraRect.bottom, nativeClip.bottom);
    return {
      png,
      nativeLabelVisible,
      geometry: {
        beforeCamera,
        backdrops: backdrops.map((layer) => ({ color: layer.color, rect: layer.rect.toJSON() })),
        label: shown.toJSON(),
        camera: cameraRect.toJSON(),
        clip: nativeClip.toJSON(),
        connected: label.isConnected && svg.isConnected && scroller.isConnected,
        currentSvg: svg === construction.querySelector('.mermaid-svg > svg'),
        currentLabel: svg.contains(label),
        requestedTransform: construction.style.transform,
        computedTransform: getComputedStyle(construction).transform,
        source: sourceRect.toJSON(),
        panned: pannedRect.toJSON(),
        host: hostRect.toJSON(),
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      },
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
