const REVEAL_ATTRIBUTE = 'data-mermaid-reveal';
const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, line, use, image';
const LABELS = 'text, foreignObject';
const NODES = 'g.node, g.cluster, g.classGroup';
const NON_CONTENT = 'defs, marker, clipPath, mask, pattern, symbol';
const GRAPH_FAMILIES = new Set(['flowchart-v2', 'stateDiagram', 'class', 'er']);

type Part = { element: Element; key: string; phase: 'shape' | 'label' };

function textKey(element: Element): string {
  return element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function stableId(id: string, svg: Element): string {
  return svg.id && id.startsWith(`${svg.id}-`) ? id.slice(svg.id.length + 1) : id;
}

function nodeKey(node: Element, svg: Element): string {
  const authoredId = node.getAttribute('data-id');
  if (authoredId) return authoredId;
  // These suffixes are render counters, not the author's node identity.
  return stableId(node.id, svg).replace(/^(flowchart|classId|state|entity)-(.+)-\d+$/, '$1-$2');
}

function graphParts(svg: Element): Part[] {
  const parts: Part[] = [];
  for (const node of svg.querySelectorAll(NODES)) {
    const key = nodeKey(node, svg);
    if (!key) continue;
    for (const element of node.querySelectorAll(`${SHAPES}, ${LABELS}`)) {
      if (element.closest(NODES) !== node || element.closest(NON_CONTENT)) continue;
      // A foreignObject owns its HTML and any nested icons as a single label.
      if (element.parentElement?.closest('foreignObject, text')) continue;
      const phase = element.matches(LABELS) ? 'label' : 'shape';
      parts.push({
        element,
        key: `node:${key}:${phase}:${phase === 'label' ? textKey(element) : ''}`,
        phase,
      });
    }
  }
  for (const edge of svg.querySelectorAll('.edgePaths path')) {
    if (edge.closest(NON_CONTENT)) continue;
    const key = stableId(edge.getAttribute('data-id') || edge.id, svg);
    if (key) parts.push({ element: edge, key: `edge:${key}`, phase: 'shape' });
  }
  const labelOccurrences = new Map<string, number>();
  for (const label of svg.querySelectorAll('.edgeLabels > .edgeLabel')) {
    const text = textKey(label);
    if (!text) continue;
    const occurrence = labelOccurrences.get(text) ?? 0;
    labelOccurrences.set(text, occurrence + 1);
    // Mermaid's sanitizer may remove data-id; repeated labels remain distinct.
    const id = label.querySelector('[data-id]')?.getAttribute('data-id');
    const key = id ? stableId(id, svg) : `${text}:${occurrence}`;
    parts.push({ element: label, key: `edge:${key}:label:${text}`, phase: 'label' });
  }
  return parts;
}

function sequenceParts(svg: Element): Part[] {
  const parts: Part[] = [];
  const actors = new Set(svg.querySelectorAll('g[data-id], g.actor-man'));
  for (const label of svg.querySelectorAll('text.actor')) {
    if (label.parentElement) actors.add(label.parentElement);
  }
  for (const actor of actors) {
    const key =
      actor.getAttribute('data-id') ||
      actor.querySelector('[name]')?.getAttribute('name') ||
      textKey(actor);
    if (!key) continue;
    for (const element of actor.querySelectorAll(`${SHAPES}, ${LABELS}`)) {
      if (element.closest(NON_CONTENT)) continue;
      const phase = element.matches(LABELS) ? 'label' : 'shape';
      parts.push({ element, key: `actor:${key}:${phase}`, phase });
    }
  }
  // Sequence messages are emitted in source order. Coordinates and text wrapping
  // change as participants arrive, but the ordinal of an existing message does not.
  svg.querySelectorAll('.messageLine0, .messageLine1').forEach((line, index) => {
    parts.push({ element: line, key: `message:${index}`, phase: 'shape' });
    let label = line.previousElementSibling;
    while (label?.matches('text.messageText')) {
      parts.push({ element: label, key: `message:${index}:label`, phase: 'label' });
      label = label.previousElementSibling;
    }
  });
  return parts;
}

/** Settle only our transient reveal, preserving authored SVG opacity and styles. */
export function finishMermaidReveal(root: ParentNode): void {
  root.querySelectorAll(`[${REVEAL_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(REVEAL_ATTRIBUTE);
  });
}

/** Sample the export's final opacity synchronously, restoring the live animation
 * before the browser can paint. Other animations and authored opacity survive. */
export function readSettledMermaidOpacity(element: Element): string | undefined {
  if (!element.hasAttribute(REVEAL_ATTRIBUTE)) return undefined;
  const animations = (element.getAnimations?.() ?? []).filter((animation) =>
    (animation as CSSAnimation).animationName?.endsWith('mermaid-reveal'),
  );
  if (!animations.length) return undefined;
  const times = animations.map((animation) => animation.currentTime);
  try {
    for (const animation of animations) {
      const endTime = animation.effect?.getComputedTiming().endTime;
      if (endTime !== undefined) animation.currentTime = endTime;
    }
    return getComputedStyle(element).opacity;
  } finally {
    animations.forEach((animation, index) => {
      animation.currentTime = times[index];
    });
  }
}

/** Renderer-local history. Only installed, successful SVG snapshots enter it. */
export function createMermaidRevealTracker() {
  let lastSource: string | undefined;
  let seen = new Set<string>();

  return {
    prepare(svgMarkup: string, source: string, animate: boolean): string {
      if (lastSource !== undefined && !source.startsWith(lastSource)) seen = new Set();
      const sourceChanged = source !== lastSource;
      lastSource = source;
      const template = document.createElement('template');
      template.innerHTML = svgMarkup;
      const svg = template.content.querySelector('svg');
      if (!svg) return svgMarkup;
      const family = svg.getAttribute('aria-roledescription') ?? '';
      const parts = GRAPH_FAMILIES.has(family)
        ? graphParts(svg)
        : family === 'sequence'
          ? sequenceParts(svg)
          : [];
      const next = new Set<string>();
      for (const { element, key, phase } of parts) {
        const identity = `${family}:${key}`;
        if (animate && sourceChanged && !seen.has(identity)) {
          element.setAttribute(REVEAL_ATTRIBUTE, phase);
        }
        next.add(identity);
      }
      for (const key of next) seen.add(key);
      // New parts wait for layout without hiding existing or unfamiliar content.
      if (svg.querySelector(`[${REVEAL_ATTRIBUTE}]`)) {
        svg.setAttribute('data-mermaid-reveal-ready', 'false');
      }
      return template.innerHTML;
    },
  };
}
