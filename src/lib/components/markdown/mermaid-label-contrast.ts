import { color, rgb, type RGBColor } from 'd3';
import { checkColorContrast } from '$lib/utils/accessibility';
import { flowchartClusterId, type FlowchartClusterMembership } from './mermaid-cluster-membership';

const shapeSelector = 'rect, circle, ellipse, polygon, path';
const corrections = new WeakMap<SVGSVGElement, (() => void)[]>();

/** Resolve solid CSS paints without treating unknown paints (e.g. gradients) as black. */
function colorReader() {
  const cache = new Map<string, RGBColor | null>();
  let context: CanvasRenderingContext2D | null | undefined;
  return (value: string): RGBColor | null => {
    if (cache.has(value)) return cache.get(value)!;
    let parsed = value === 'none' ? rgb(0, 0, 0, 0) : (color(value)?.rgb() ?? null);
    // Computed color-mix/OKLCH paints are not CSS Color 3 strings understood by d3.
    if (!parsed && typeof CSS !== 'undefined' && CSS.supports('color', value)) {
      if (context === undefined) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        context = canvas.getContext('2d');
      }
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        parsed = rgb(r, g, b, a / 255);
      }
    }
    parsed = parsed?.clamp() ?? null;
    cache.set(value, parsed);
    return parsed;
  };
}

function over(front: RGBColor, back: RGBColor): RGBColor {
  const alpha = front.opacity + back.opacity * (1 - front.opacity);
  if (!alpha) return rgb(0, 0, 0, 0);
  const channel = (a: number, b: number) =>
    (a * front.opacity + b * back.opacity * (1 - front.opacity)) / alpha;
  return rgb(channel(front.r, back.r), channel(front.g, back.g), channel(front.b, back.b), alpha);
}

function opacity(value: string): number {
  if (!value) return 1;
  return value.endsWith('%') ? Number.parseFloat(value) / 100 : Number(value);
}

/** Color-only flowchart repair; never infer missing labels or change authored surfaces. */
export function ensureMermaidLabelContrast(
  svg: SVGSVGElement,
  membership?: FlowchartClusterMembership,
): void {
  if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
  // Fits may repeat on the same SVG. Reconsider original paints, not our last correction.
  for (const restore of corrections.get(svg) ?? []) restore();
  const restores: (() => void)[] = [];
  corrections.set(svg, restores);
  const read = colorReader();
  let canvas = rgb(0, 0, 0, 0);
  for (let element: Element | null = svg; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.backgroundImage && style.backgroundImage !== 'none') return;
    const background = read(style.backgroundColor);
    if (!background) return;
    canvas = over(canvas, background);
    if (canvas.opacity === 1) break;
  }
  if (canvas.opacity !== 1) return;

  const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')];
  const clusterIds = new Map(
    clusters.map((cluster) => [
      cluster,
      membership ? flowchartClusterId(cluster, membership) : cluster.id,
    ]),
  );
  const parentCluster = (owner: SVGGElement): SVGGElement | undefined => {
    const id = clusterIds.get(owner) ?? owner.id.match(/flowchart-(.+?)-\d+$/)?.[1] ?? owner.id;
    const semanticParents = clusters.filter((cluster) => {
      const clusterId = clusterIds.get(cluster);
      return cluster !== owner && clusterId && membership?.get(clusterId)?.has(id);
    });
    if (semanticParents.length) {
      return semanticParents.sort(
        (a, b) =>
          membership!.get(clusterIds.get(a)!)!.size - membership!.get(clusterIds.get(b)!)!.size,
      )[0];
    }
    return owner.parentElement?.closest<SVGGElement>('g.cluster') ?? undefined;
  };
  const surfaces = new Map<SVGGElement, RGBColor | null>();
  const surface = (owner: SVGGElement, visiting = new Set<SVGGElement>()): RGBColor | null => {
    if (surfaces.has(owner)) return surfaces.get(owner)!;
    if (visiting.has(owner)) return null;
    visiting.add(owner);
    const parent = parentCluster(owner);
    const backdrop = parent ? surface(parent, visiting) : canvas;
    if (!backdrop) return null;
    const container = owner.querySelector<SVGElement>(':scope > .label-container');
    const shape = container?.matches(shapeSelector)
      ? container
      : (container?.querySelector<SVGElement>(shapeSelector) ??
        owner.querySelector<SVGElement>(
          ':scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > path',
        ));
    if (!shape) return null;
    const style = getComputedStyle(shape);
    const fill = read(style.fill);
    const result = fill
      ? over(
          rgb(
            fill.r,
            fill.g,
            fill.b,
            fill.opacity * opacity(style.fillOpacity) * opacity(style.opacity),
          ),
          backdrop,
        )
      : null;
    surfaces.set(owner, result);
    return result;
  };

  const writes: { element: SVGElement | HTMLElement; property: string; value: string }[] = [];
  for (const owner of svg.querySelectorAll<SVGGElement>('g.node, g.cluster')) {
    const background = surface(owner);
    if (!background) continue;
    const label = owner.querySelector<SVGElement>(':scope > .label, :scope > .cluster-label');
    if (!label) continue;
    for (const element of label.querySelectorAll<SVGElement | HTMLElement>(
      'text, tspan, foreignObject *',
    )) {
      if (element.closest('svg') !== svg) continue;
      if (
        ![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())
      ) {
        continue;
      }
      let hidden = false;
      let localBackground = background;
      const ancestors: Element[] = [];
      for (
        let ancestor: Element | null = element;
        ancestor && ancestor !== svg;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        // Hidden/partially faded groups are not missing-text contrast failures.
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          opacity(style.opacity) !== 1
        ) {
          hidden = true;
        }
        if (ancestor.namespaceURI === 'http://www.w3.org/1999/xhtml') ancestors.unshift(ancestor);
      }
      if (hidden) continue;
      for (const ancestor of ancestors) {
        const style = getComputedStyle(ancestor);
        const paint = read(style.backgroundColor);
        if (!paint || (style.backgroundImage && style.backgroundImage !== 'none')) {
          hidden = true;
          break;
        }
        localBackground = over(paint, localBackground);
      }
      if (hidden) continue;
      const style = getComputedStyle(element);
      const property = element.namespaceURI === 'http://www.w3.org/1999/xhtml' ? 'color' : 'fill';
      const foreground = read(style.getPropertyValue(property));
      const fillOpacity = property === 'fill' ? opacity(style.fillOpacity) : 1;
      if (!foreground || !foreground.opacity || !fillOpacity) continue;
      const ratio = (paint: RGBColor) =>
        checkColorContrast(
          over(
            rgb(paint.r, paint.g, paint.b, paint.opacity * fillOpacity),
            localBackground,
          ).formatHex(),
          localBackground.formatHex(),
        ).ratio;
      if (ratio(foreground) >= 4.5) continue;
      const candidates = [read(getComputedStyle(svg).color), rgb(0, 0, 0), rgb(255, 255, 255)]
        .filter((paint): paint is RGBColor => paint !== null)
        .filter((paint) => ratio(paint) >= 4.55);
      const replacement = candidates[0];
      if (replacement) writes.push({ element, property, value: replacement.formatRgb() });
    }
  }
  // Read all original leaf paints before writing, so a parent correction cannot hide
  // an already-readable authored color on a nested tspan/HTML emphasis element.
  for (const { element, property, value } of writes) {
    const original = element.style.getPropertyValue(property);
    const priority = element.style.getPropertyPriority(property);
    restores.push(() => {
      if (original) element.style.setProperty(property, original, priority);
      else element.style.removeProperty(property);
    });
    element.style.setProperty(property, value, 'important');
  }
}
