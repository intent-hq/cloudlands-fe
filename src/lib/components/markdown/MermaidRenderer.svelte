<script lang="ts" module>
  import mermaid from 'mermaid';
  import elkLayouts from '@mermaid-js/layout-elk';

  // Register the ELK layout engine once per module load; per-diagram
  // frontmatter (`config: layout: ...`) still overrides the default.
  mermaid.registerLayoutLoaders(elkLayouts);
</script>

<script lang="ts">
  /* eslint-disable max-lines -- Mermaid post-processing and presentation stay coordinated */
  import { onMount, tick } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { faCode, faExpand } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import MediaLightbox from '$lib/components/ui/MediaLightbox.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';
  import { faUser, getPhosphorIconComponent } from '$lib/icons/phosphor-icons';
  import {
    createMermaidConfig,
    MERMAID_PRIMARY_FONT,
    runSerializedMermaidRender,
  } from './mermaid-theme';
  import { splitSemanticLabel } from '$lib/components/diagrams/diagram-label-wrap';
  import type { SvgBounds } from './mermaid-state-layout';
  import {
    alignFlowchartMarkerTips,
    attachStateTerminalArrowheads,
    measuredClusterHeaderHeight,
    placeStateLabelsOnFinalRoutes,
    positionCompactGroupedEdgeLabels,
    reflowCompactFlowchart,
    repairFlowchartNodeOutlines,
    reserveFlowchartClusterHeaderBands,
    routeFlowchartClientRequestLane,
    rewriteStateRoutes,
    roundOrthogonalBends,
    routeFlowchartAroundClusterHeaders,
    routeFlowchartCenteredFanouts,
    routeFlowchartDecisionBranches,
    routeFlowchartFeedbackLane,
    routeGroupedReturnEdges,
    snapFlowchartPorts,
    snapFlowchartFeedbackPorts,
  } from './mermaid-path-geometry';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('MermaidRenderer');
  const STATE_LABEL_TEXT = {
    streamFails: 'Stream fails', // i18n-ignore (agent-authored Mermaid content)
    agentAsksUser: 'Agent asks user', // i18n-ignore (agent-authored Mermaid content)
    toolCompletes: 'Tool completes', // i18n-ignore (agent-authored Mermaid content)
    agentResponds: 'Agent responds', // i18n-ignore (agent-authored Mermaid content)
    toolStarts: 'Tool starts', // i18n-ignore (agent-authored Mermaid content)
  } as const;

  interface Props {
    code: string;
    className?: string;
    showExpandButton?: boolean;
  }

  let { code, className = '', showExpandButton = true }: Props = $props();

  let renderedSvg = $state('');
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let isFullscreen = $state(false);
  let fullscreenSvg = $state('');
  let showSource = $state(false);
  let fullscreenOpenerElement: HTMLElement | null = $state(null);
  let zoomPanViewport: ZoomPanViewport | undefined = $state();
  let rendererElement: HTMLDivElement | undefined = $state();
  let actorIconTemplateElement: HTMLSpanElement | undefined = $state();
  let themeRevision = $state(0);
  let compactLayout = $state(false);
  let narrowLayout = $state(false);
  let renderGeneration = 0;
  let fitGeneration = 0;
  let settledGeneration = $state(0);
  let decodedSource = $derived(decodeHtmlEntities(decodeBase64(code)));
  const MermaidActorIcon = getPhosphorIconComponent(faUser);

  // Decode base64 encoded mermaid code
  function decodeBase64(str: string): string {
    try {
      // Check if it looks like base64 (no newlines, only base64 chars)
      if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
        return decodeURIComponent(escape(atob(str)));
      }
      // Fall back to treating as plain text (for backwards compatibility)
      return str;
    } catch {
      // If base64 decode fails, return as-is
      return str;
    }
  }

  function applyLayoutDefaults(source: string): string {
    if (
      !/^\s*stateDiagram(?:-v2)?\b/m.test(source) ||
      /^\s*direction\s+(?:LR|RL|TB|BT)\b/m.test(source)
    ) {
      return source;
    }
    return source.replace(/^(\s*stateDiagram(?:-v2)?\b[^\n]*)/m, '$1\n  direction TB');
  }

  function applyResponsiveLayout(source: string): string {
    if (!compactLayout) return source;
    const verticalSource = /\bsubgraph\b/.test(source)
      ? source
      : source.replace(/^(\s*(?:flowchart|graph)\s+)(?:LR|RL)\b/m, '$1TB');
    if (!narrowLayout || !/^\s*sequenceDiagram\b/m.test(verticalSource)) return verticalSource;
    return `---
config:
  sequence:
    actorMargin: 0
    diagramMarginX: 0
    messageMargin: 24
    noteMargin: 4
    width: 96
    wrap: true
---
${verticalSource}`;
  }

  // Decode HTML entities that may have been escaped (legacy support)
  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  type ClassNodeGeometry = {
    element: SVGGElement;
    name: string;
    x: number;
    y: number;
    box: DOMRect;
    originalBox: DOMRect;
    deltaX: number;
    deltaY: number;
  };

  type ClassTextGroupLayout = {
    element: SVGGElement;
    bounds: DOMRect;
  };

  const CLASS_HORIZONTAL_PADDING = 12;
  const CLASS_VERTICAL_PADDING = 10;
  const CLASS_ROW_GAP = 6;

  function readTranslate(element: SVGGraphicsElement): { x: number; y: number } | null {
    const transform = element.transform.baseVal.consolidate()?.matrix;
    return transform ? { x: transform.e, y: transform.f } : null;
  }

  function visibleTextBounds(element: Element): DOMRect | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rects.push(...Array.from(range.getClientRects()));
    }
    if (!rects.length) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  function addSemanticLabelBreaks(svg: SVGSVGElement) {
    if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
    for (const label of svg.querySelectorAll<HTMLElement>(
      'g.node .nodeLabel > p, g.cluster .nodeLabel > p',
    )) {
      if (label.dataset.semanticBreaks === 'true') continue;
      const source = label.cloneNode(true) as HTMLElement;
      source.querySelectorAll('br').forEach((breakElement) => breakElement.replaceWith('\n'));
      const text = source.textContent?.replace(/[^\S\n]+/g, ' ').trim();
      if (!text) continue;
      label.replaceChildren();
      for (const part of splitSemanticLabel(text)) {
        label.append(document.createTextNode(part.text));
        if (part.hardBreak) label.append(document.createElement('br'));
        else if (part.breakAfter) label.append(document.createElement('wbr'));
      }
      label.dataset.semanticBreaks = 'true';
    }
  }

  function hideEmptyEdgeLabels(svg: SVGSVGElement) {
    for (const label of svg.querySelectorAll<SVGGElement>('g.edgeLabel')) {
      if (!label.textContent?.trim()) label.style.display = 'none';
    }
  }

  function centerFlowchartLabels(svg: SVGSVGElement) {
    if (svg.getAttribute('aria-roledescription') !== 'flowchart-v2') return;
    for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
      const label = node.querySelector<SVGGElement>(':scope > .label');
      const foreignObject = label?.querySelector<SVGForeignObjectElement>('foreignObject');
      const content = foreignObject?.firstElementChild;
      const shape = node.querySelector<SVGGraphicsElement>(
        ':scope > .label-container, :scope > .outer-path, :scope > .basic.label-container',
      );
      if (!label || !foreignObject || !(content instanceof HTMLElement) || !shape) continue;

      const height = Number.parseFloat(foreignObject.getAttribute('height') ?? '0');
      const initialTextBounds = visibleTextBounds(label);
      const initialMatrix = label.getScreenCTM();
      const initialScaleY = initialMatrix ? Math.hypot(initialMatrix.c, initialMatrix.d) || 1 : 1;
      const contentHeight = Math.max(
        content.scrollHeight,
        initialTextBounds ? initialTextBounds.height / initialScaleY : 0,
      );
      if (contentHeight > height + 0.5) {
        const repairedHeight = Math.ceil(contentHeight + 1);
        foreignObject.setAttribute('height', String(repairedHeight));
        const transform = readTranslate(label);
        if (transform)
          label.setAttribute('transform', `translate(${transform.x}, ${-repairedHeight / 2})`);
        if (shape instanceof SVGRectElement) {
          const verticalPadding = Math.max(0, (Number(shape.getAttribute('height')) - height) / 2);
          shape.setAttribute('y', String(-repairedHeight / 2 - verticalPadding));
          shape.setAttribute('height', String(repairedHeight + verticalPadding * 2));
        }
      }

      const shapeBounds = shape.getBoundingClientRect();
      const textBounds = visibleTextBounds(label);
      const transform = readTranslate(label);
      const matrix = label.getScreenCTM();
      if (!textBounds || !transform || !matrix) continue;
      const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
      const scaleY = Math.hypot(matrix.c, matrix.d) || 1;
      const offsetX = textBounds.x + textBounds.width / 2 - (shapeBounds.x + shapeBounds.width / 2);
      const offsetY =
        textBounds.y + textBounds.height / 2 - (shapeBounds.y + shapeBounds.height / 2);
      label.setAttribute(
        'transform',
        `translate(${transform.x - offsetX / scaleX}, ${transform.y - offsetY / scaleY})`,
      );
    }
  }

  function padMermaidEdgeLabels(svg: SVGSVGElement) {
    for (const foreignObject of svg.querySelectorAll<SVGForeignObjectElement>(
      'foreignObject:has(span.edgeLabel)',
    )) {
      if (foreignObject.dataset.labelPadded === 'true') continue;
      const x = foreignObject.x.baseVal.value;
      const y = foreignObject.y.baseVal.value;
      const width = foreignObject.width.baseVal.value;
      const height = foreignObject.height.baseVal.value;
      const label = foreignObject.querySelector<HTMLElement>('span.edgeLabel');
      if (!label?.textContent?.trim()) continue;
      const wrapsStateFailure = label?.textContent?.trim() === STATE_LABEL_TEXT.streamFails;
      if (wrapsStateFailure && label) {
        label.style.display = 'inline-block';
        label.style.width = '40px';
        label.style.whiteSpace = 'normal';
      }
      const paddedWidth = wrapsStateFailure ? 52 : width + 12;
      foreignObject.setAttribute('x', String(x + width / 2 - paddedWidth / 2));
      foreignObject.setAttribute('y', String(y - 4));
      foreignObject.setAttribute('width', String(paddedWidth));
      foreignObject.setAttribute(
        'height',
        String(wrapsStateFailure ? Math.max(44, height + 8) : height + 8),
      );
      foreignObject.classList.add('edge-label-surface');
      foreignObject.dataset.labelPaddingX = '6';
      foreignObject.dataset.labelPaddingY = '4';
      foreignObject.dataset.labelPadded = 'true';
    }
    for (const background of svg.querySelectorAll<SVGRectElement>(
      '.edgeLabel rect.background:not([data-label-padded])',
    )) {
      const x = Number(background.getAttribute('x'));
      const y = Number(background.getAttribute('y'));
      const width = Number(background.getAttribute('width'));
      const height = Number(background.getAttribute('height'));
      if (![x, y, width, height].every(Number.isFinite)) continue;
      background.setAttribute('x', String(x - 6));
      background.setAttribute('y', String(y - 5));
      background.setAttribute('width', String(width + 12));
      background.setAttribute('height', String(height + 10));
      background.setAttribute('rx', '2');
      background.dataset.labelPaddingX = '6';
      background.dataset.labelPaddingY = '5';
      background.dataset.labelPadded = 'true';
    }
  }

  function insertLabelKnockout(
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

  function addMermaidLabelKnockouts(svg: SVGSVGElement) {
    for (const label of svg.querySelectorAll<SVGGElement>('g.edgeLabel')) {
      if (label.querySelector('.edge-label-knockout, rect.background, foreignObject')) continue;
      const content = label.querySelector<SVGGraphicsElement>('text');
      if (content) {
        insertLabelKnockout(label, label.firstElementChild!, content.getBBox());
      }
    }

    for (const text of svg.querySelectorAll<SVGGraphicsElement>(
      'text.messageText, text.loopText',
    )) {
      if (text.dataset.labelKnockout === 'true' || !text.textContent?.trim()) continue;
      const parent = text.parentElement;
      if (!parent) continue;
      insertLabelKnockout(parent, text, text.getBBox());
      text.dataset.labelKnockout = 'true';
    }
  }

  function balanceMermaidEdgeLabelGlyphs(svg: SVGSVGElement) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    for (const label of svg.querySelectorAll<HTMLElement>('span.edgeLabel')) {
      const textBlock = label.querySelector<HTMLElement>('p');
      if (!textBlock) continue;
      const style = getComputedStyle(textBlock);
      context.font = style.font;
      const lines = textBlock.innerText.split('\n').filter((line) => line.length > 0);
      if (lines.length === 0) continue;
      const first = context.measureText(lines[0]);
      const last = context.measureText(lines.at(-1)!);
      const fontTop = first.fontBoundingBoxAscent || first.actualBoundingBoxAscent;
      const fontBottom = last.fontBoundingBoxDescent || last.actualBoundingBoxDescent;
      const topInset = fontTop - first.actualBoundingBoxAscent;
      const bottomInset = fontBottom - last.actualBoundingBoxDescent;
      const offset = (bottomInset - topInset) / 2;
      textBlock.style.transform = `translateY(${offset}px)`;
      label.dataset.opticalTopGap = String(3 + topInset + offset);
      label.dataset.opticalBottomGap = String(3 + bottomInset - offset);
    }
  }

  function recenterStateLabels(svg: SVGSVGElement) {
    for (const label of svg.querySelectorAll<SVGGElement>('g.edgeLabel[data-route-path-id]')) {
      const center = label.dataset.finalPathCenter?.split(',').map(Number);
      const path = label.dataset.routePathId
        ? svg.querySelector<SVGPathElement>(`#${CSS.escape(label.dataset.routePathId)}`)
        : null;
      const pathMatrix = path?.getCTM();
      const parentMatrix = (label.parentElement as SVGGraphicsElement | null)?.getCTM();
      if (!center || center.length !== 2 || !pathMatrix || !parentMatrix) continue;
      const parentPoint = new DOMPoint(center[0], center[1])
        .matrixTransform(pathMatrix)
        .matrixTransform(parentMatrix.inverse());
      const bounds = label.getBBox();
      label.setAttribute(
        'transform',
        `translate(${parentPoint.x - (bounds.x + bounds.width / 2)}, ${parentPoint.y - (bounds.y + bounds.height / 2)})`,
      );
    }
  }

  function alignCompactClusterTitles(svg: SVGSVGElement) {
    for (const cluster of svg.querySelectorAll<SVGGElement>('g.cluster')) {
      const rect = cluster.querySelector<SVGRectElement>(':scope > rect');
      const label = cluster.querySelector<SVGGElement>(':scope > g.cluster-label');
      const viewport = label?.querySelector<SVGForeignObjectElement>('foreignObject');
      if (!rect || !label || !viewport) continue;
      const x = Number(rect.getAttribute('x'));
      const y = Number(rect.getAttribute('y'));
      const width = Number(rect.getAttribute('width'));
      const height = Number(rect.getAttribute('height'));
      if (![x, y, width, height].every(Number.isFinite)) continue;
      viewport.setAttribute('x', '0');
      viewport.setAttribute('y', '0');
      viewport.setAttribute('width', String(Math.max(24, width - 40)));
      const content = viewport.querySelector<HTMLElement>('div');
      const titleHeight = Math.ceil(
        Math.max(content?.getBoundingClientRect().height ?? 0, content?.scrollHeight ?? 0, 18),
      );
      const measuredHeader = measuredClusterHeaderHeight(titleHeight);
      const currentHeader = Number(cluster.dataset.headerHeight) || measuredHeader;
      const headerGrowth = Math.max(0, measuredHeader - currentHeader);
      const finalY = y - headerGrowth;
      viewport.setAttribute('height', String(titleHeight));
      rect.setAttribute('y', String(finalY));
      rect.setAttribute('height', String(height + headerGrowth));
      cluster.dataset.headerHeight = String(Math.max(currentHeader, measuredHeader));
      label.setAttribute('transform', `translate(${x + 20}, ${finalY + 20})`);
    }
  }

  function replaceSequenceActorFigures(svg: SVGSVGElement) {
    if (svg.getAttribute('aria-roledescription') !== 'sequence') return;
    const template = actorIconTemplateElement?.querySelector('svg');
    if (!template) return;
    for (const actor of svg.querySelectorAll<SVGGElement>('g.actor-man')) {
      const head = actor.querySelector<SVGCircleElement>(':scope > circle');
      const label = actor.querySelector<SVGTextElement>(':scope > text.actor-man');
      if (!head || !label) continue;
      const centerX = Number(head.getAttribute('cx'));
      const labelHeight = label.getBBox().height;
      actor
        .querySelectorAll(':scope > line, :scope > circle')
        .forEach((element) => element.remove());
      const icon = template.cloneNode(true) as SVGSVGElement;
      icon.classList.add('mermaid-actor-user-icon');
      icon.setAttribute('x', String(centerX - 15));
      icon.setAttribute('y', '1');
      icon.setAttribute('width', '30');
      icon.setAttribute('height', '30');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('focusable', 'false');
      icon.removeAttribute('role');
      label.setAttribute('y', String(37 + labelHeight / 2));
      actor.insertBefore(icon, label);
    }
  }

  function arrangeClassTextGroup(element: SVGGElement | null): ClassTextGroupLayout | null {
    if (!element) return null;
    const labels = Array.from(element.children).filter(
      (child): child is SVGGElement =>
        child instanceof SVGGElement &&
        child.classList.contains('label') &&
        Boolean(child.textContent?.trim()),
    );
    if (!labels.length) {
      element.style.display = 'none';
      return null;
    }

    element.style.removeProperty('display');
    let cursor = 0;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const [index, label] of labels.entries()) {
      const bounds = label.getBBox();
      label.setAttribute('transform', `translate(0, ${cursor - bounds.y})`);
      left = Math.min(left, bounds.x);
      right = Math.max(right, bounds.x + bounds.width);
      cursor += bounds.height;
      if (index < labels.length - 1) cursor += CLASS_ROW_GAP;
    }
    return { element, bounds: new DOMRect(left, 0, right - left, cursor) };
  }

  function repairClassDiagramGeometry(svg: SVGSVGElement): DOMRect | null {
    if (!svg.classList.contains('classDiagram')) return null;

    const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.node')).flatMap(
      (element): ClassNodeGeometry[] => {
        const outer = element.querySelector<SVGGElement>('.outer-path');
        const position = readTranslate(element);
        if (!outer || !position) return [];

        const outline = outer.getBBox();
        element.querySelectorAll(':scope > .divider').forEach((divider) => divider.remove());
        element.querySelector(':scope > .class-box-outline')?.remove();

        const annotation = arrangeClassTextGroup(
          element.querySelector<SVGGElement>(':scope > .annotation-group'),
        );
        const title = arrangeClassTextGroup(
          element.querySelector<SVGGElement>(':scope > .label-group'),
        );
        const members = arrangeClassTextGroup(
          element.querySelector<SVGGElement>(':scope > .members-group'),
        );
        const methods = arrangeClassTextGroup(
          element.querySelector<SVGGElement>(':scope > .methods-group'),
        );
        const headerGroups = [annotation, title].filter(
          (group): group is ClassTextGroupLayout => group !== null,
        );
        const sections = [
          { groups: headerGroups, centered: true },
          ...(members ? [{ groups: [members], centered: false }] : []),
          ...(methods ? [{ groups: [methods], centered: false }] : []),
        ];
        if (!headerGroups.length) return [];

        const sectionHeights = sections.map(({ groups }) =>
          groups.reduce(
            (height, group, index) => height + group.bounds.height + (index ? CLASS_ROW_GAP : 0),
            0,
          ),
        );
        const contentWidth = Math.max(
          ...sections.flatMap(({ groups }) => groups.map((group) => group.bounds.width)),
        );
        const width = Math.max(outline.width, contentWidth + CLASS_HORIZONTAL_PADDING * 2);
        const left = -width / 2;
        const top = -(sectionHeights[0] + CLASS_VERTICAL_PADDING * 2) / 2;
        let cursor = top + CLASS_VERTICAL_PADDING;

        const dividers: SVGLineElement[] = [];
        for (const [sectionIndex, section] of sections.entries()) {
          for (const [groupIndex, group] of section.groups.entries()) {
            if (groupIndex) cursor += CLASS_ROW_GAP;
            const x = section.centered
              ? -group.bounds.width / 2 - group.bounds.x
              : left + CLASS_HORIZONTAL_PADDING - group.bounds.x;
            group.element.setAttribute('transform', `translate(${x}, ${cursor - group.bounds.y})`);
            cursor += group.bounds.height;
          }
          cursor += CLASS_VERTICAL_PADDING;
          if (sectionIndex < sections.length - 1) {
            const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            divider.classList.add('class-box-divider');
            divider.setAttribute('x1', String(left));
            divider.setAttribute('x2', String(left + width));
            divider.setAttribute('y1', String(cursor));
            divider.setAttribute('y2', String(cursor));
            dividers.push(divider);
            cursor += CLASS_VERTICAL_PADDING;
          }
        }

        const repaired = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        repaired.classList.add('class-box-outline');
        repaired.setAttribute('x', String(left));
        repaired.setAttribute('y', String(top));
        repaired.setAttribute('width', String(width));
        repaired.setAttribute('height', String(cursor - top));
        element.insertBefore(repaired, outer);
        outer.style.display = 'none';
        const firstTextGroup = element.querySelector<SVGGElement>(
          ':scope > .annotation-group, :scope > .label-group, :scope > .members-group, :scope > .methods-group',
        );
        for (const divider of dividers) element.insertBefore(divider, firstTextGroup);

        return [
          {
            element,
            name: title!.element.textContent?.trim() ?? '',
            ...position,
            box: repaired.getBBox(),
            originalBox: outline,
            deltaX: 0,
            deltaY: 0,
          },
        ];
      },
    );
    const getBounds = () => {
      const left = Math.min(...nodes.map((node) => node.x + node.deltaX + node.box.x));
      const top = Math.min(...nodes.map((node) => node.y + node.deltaY + node.box.y));
      const right = Math.max(
        ...nodes.map((node) => node.x + node.deltaX + node.box.x + node.box.width),
      );
      const bottom = Math.max(
        ...nodes.map((node) => node.y + node.deltaY + node.box.y + node.box.height),
      );
      return new DOMRect(left, top, right - left, bottom - top);
    };
    if (nodes.length < 2) return nodes.length ? getBounds() : null;

    const xRange =
      Math.max(...nodes.map((node) => node.x)) - Math.min(...nodes.map((node) => node.x));
    const yRange =
      Math.max(...nodes.map((node) => node.y)) - Math.min(...nodes.map((node) => node.y));
    const vertical = yRange >= xRange;
    const mainPosition = (node: ClassNodeGeometry) => (vertical ? node.y : node.x);
    const ranks: ClassNodeGeometry[][] = [];
    for (const node of nodes.toSorted((a, b) => mainPosition(a) - mainPosition(b))) {
      const rank = ranks.at(-1);
      if (rank && Math.abs(mainPosition(rank[0]) - mainPosition(node)) < 1) rank.push(node);
      else ranks.push([node]);
    }

    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const rank of ranks) {
      const start = Math.min(
        ...rank.map((node) => mainPosition(node) + (vertical ? node.box.y : node.box.x)),
      );
      const end = Math.max(
        ...rank.map(
          (node) =>
            mainPosition(node) +
            (vertical ? node.box.y + node.box.height : node.box.x + node.box.width),
        ),
      );
      const shift = Number.isFinite(previousEnd) ? Math.max(0, previousEnd + 24 - start) : 0;
      for (const node of rank) {
        if (vertical) node.deltaY = shift;
        else node.deltaX = shift;
        node.element.setAttribute(
          'transform',
          `translate(${node.x + node.deltaX}, ${node.y + node.deltaY})`,
        );
      }
      previousEnd = end + shift;
    }

    for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path[data-edge="true"]')) {
      const length = path.getTotalLength();
      if (!length) continue;
      const startPoint = path.getPointAtLength(0);
      const endPoint = path.getPointAtLength(length);
      const nearest = (point: DOMPoint) =>
        nodes.toSorted((a, b) => {
          const distance = (node: ClassNodeGeometry) => {
            const { originalBox } = node;
            const dx = Math.max(
              node.x + originalBox.x - point.x,
              0,
              point.x - node.x - originalBox.x - originalBox.width,
            );
            const dy = Math.max(
              node.y + originalBox.y - point.y,
              0,
              point.y - node.y - originalBox.y - originalBox.height,
            );
            return Math.hypot(dx, dy);
          };
          return distance(a) - distance(b);
        })[0];
      const pathIdentity = path.dataset.id ?? '';
      const namedPair = nodes
        .flatMap((source) =>
          nodes.filter((target) => target !== source).map((target) => ({ source, target })),
        )
        .find(({ source, target }) => pathIdentity.startsWith(`id_${source.name}_${target.name}_`));
      const source = namedPair?.source ?? nearest(startPoint);
      const target = namedPair?.target ?? nearest(endPoint);
      if (!source || !target || source === target) continue;

      const sourceCenter = {
        x: source.x + source.deltaX + source.box.x + source.box.width / 2,
        y: source.y + source.deltaY + source.box.y + source.box.height / 2,
      };
      const targetCenter = {
        x: target.x + target.deltaX + target.box.x + target.box.width / 2,
        y: target.y + target.deltaY + target.box.y + target.box.height / 2,
      };
      const horizontal =
        Math.abs(targetCenter.x - sourceCenter.x) > Math.abs(targetCenter.y - sourceCenter.y);
      if (horizontal) {
        const direction = Math.sign(targetCenter.x - sourceCenter.x) || 1;
        const startX =
          source.x +
          source.deltaX +
          (direction > 0 ? source.box.x + source.box.width : source.box.x);
        const endX =
          target.x +
          target.deltaX +
          (direction > 0 ? target.box.x : target.box.x + target.box.width);
        const middle = (startX + endX) / 2;
        const points = [
          { x: startX, y: sourceCenter.y },
          { x: middle, y: sourceCenter.y },
          { x: middle, y: targetCenter.y },
          { x: endX, y: targetCenter.y },
        ];
        path.setAttribute(
          'd',
          points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
        );
        path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
      } else {
        const direction = Math.sign(targetCenter.y - sourceCenter.y) || 1;
        const startY =
          source.y +
          source.deltaY +
          (direction > 0 ? source.box.y + source.box.height : source.box.y);
        const endY =
          target.y +
          target.deltaY +
          (direction > 0 ? target.box.y : target.box.y + target.box.height);
        const middle = (startY + endY) / 2;
        const points = [
          { x: sourceCenter.x, y: startY },
          { x: sourceCenter.x, y: middle },
          { x: targetCenter.x, y: middle },
          { x: targetCenter.x, y: endY },
        ];
        path.setAttribute(
          'd',
          points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(''),
        );
        path.dataset.manhattanPoints = points.map((point) => `${point.x},${point.y}`).join(' ');
      }
    }
    return getBounds();
  }

  function setReadableMermaidWidth(svg: SVGSVGElement, width: number) {
    const captionSize = Number.parseFloat(getComputedStyle(svg).fontSize);
    const readableWidth = width * (12 / (Number.isFinite(captionSize) ? captionSize : 13));
    svg.style.setProperty('--mermaid-readable-width', `${readableWidth.toFixed(3)}px`);
  }

  function measureFinalFlowchartBounds(svg: SVGSVGElement): SvgBounds {
    const measured = svg.getBBox();
    const coordinateReference = svg.querySelector<SVGGraphicsElement>('.edgePaths path, g.node');
    const inverse = coordinateReference?.getScreenCTM()?.inverse();
    if (!inverse) return measured;
    const labelBounds = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].flatMap(
      (label) => {
        if (!label.textContent?.trim()) return [];
        const box = label.getBoundingClientRect();
        const corners = [
          new DOMPoint(box.left, box.top),
          new DOMPoint(box.right, box.top),
          new DOMPoint(box.right, box.bottom),
          new DOMPoint(box.left, box.bottom),
        ].map((point) => point.matrixTransform(inverse));
        const left = Math.min(...corners.map((point) => point.x));
        const top = Math.min(...corners.map((point) => point.y));
        const right = Math.max(...corners.map((point) => point.x));
        const bottom = Math.max(...corners.map((point) => point.y));
        return [{ x: left, y: top, width: right - left, height: bottom - top }];
      },
    );
    const allBounds = [measured, ...labelBounds];
    const left = Math.min(...allBounds.map((bounds) => bounds.x));
    const top = Math.min(...allBounds.map((bounds) => bounds.y));
    const right = Math.max(...allBounds.map((bounds) => bounds.x + bounds.width));
    const bottom = Math.max(...allBounds.map((bounds) => bounds.y + bounds.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  async function fitRenderedSvg(generation: number): Promise<boolean> {
    const fit = ++fitGeneration;
    await tick();
    await document.fonts?.ready;
    if (generation !== renderGeneration) return false;
    const svg = rendererElement?.querySelector<SVGSVGElement>('.mermaid-svg svg');
    if (!svg || typeof svg.getBBox !== 'function') return false;
    delete svg.dataset.layoutSettled;
    replaceSequenceActorFigures(svg);
    if (svg.getAttribute('aria-roledescription') === 'sequence') {
      addMermaidLabelKnockouts(svg);
      setReadableMermaidWidth(svg, svg.viewBox.baseVal.width);
      svg.dataset.layoutSettled = 'true';
      return true;
    }
    addSemanticLabelBreaks(svg);
    hideEmptyEdgeLabels(svg);
    centerFlowchartLabels(svg);
    balanceMermaidEdgeLabelGlyphs(svg);
    padMermaidEdgeLabels(svg);
    addMermaidLabelKnockouts(svg);
    reserveFlowchartClusterHeaderBands(svg);
    repairFlowchartNodeOutlines(svg);
    if (compactLayout) {
      reflowCompactFlowchart(svg, false);
      reflowCompactFlowchart(svg);
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (generation !== renderGeneration) return false;
    svg.getBoundingClientRect();
    routeFlowchartFeedbackLane(svg);
    routeFlowchartCenteredFanouts(svg);
    routeFlowchartDecisionBranches(svg);
    let compactFlowchartBounds: SvgBounds | null = null;
    if (compactLayout) {
      reflowCompactFlowchart(svg);
      routeFlowchartFeedbackLane(svg, true);
      routeFlowchartCenteredFanouts(svg);
      routeFlowchartDecisionBranches(svg);
      alignCompactClusterTitles(svg);
      routeFlowchartAroundClusterHeaders(svg);
      positionCompactGroupedEdgeLabels(svg);
      compactFlowchartBounds = svg.getBBox();
    } else {
      routeFlowchartAroundClusterHeaders(svg);
      if (svg.querySelector('g.cluster')) positionCompactGroupedEdgeLabels(svg);
    }
    const normalizedState = svg.classList.contains('statediagram');
    const stateRouteLayout = narrowLayout ? 'compact' : 'wide';
    const shouldRewriteStateRoutes =
      !normalizedState || svg.dataset.stateRouteLayout !== stateRouteLayout;
    if (shouldRewriteStateRoutes) rewriteStateRoutes(svg, narrowLayout);
    if (normalizedState && shouldRewriteStateRoutes) {
      svg.dataset.stateRouteLayout = stateRouteLayout;
    }
    const classBounds = repairClassDiagramGeometry(svg);
    roundOrthogonalBends(svg);
    alignFlowchartMarkerTips(svg);
    attachStateTerminalArrowheads(svg);
    placeStateLabelsOnFinalRoutes(svg, narrowLayout);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (generation !== renderGeneration) return false;
    recenterStateLabels(svg);
    routeFlowchartDecisionBranches(svg);
    roundOrthogonalBends(svg);
    alignFlowchartMarkerTips(svg);
    if (svg.querySelector('g.cluster')) positionCompactGroupedEdgeLabels(svg);
    const measuredBounds = svg.getBBox();
    const extraBounds = [classBounds, compactFlowchartBounds].filter(
      (bounds): bounds is SvgBounds => Boolean(bounds),
    );
    const baseBounds = measuredBounds;
    const bounds = extraBounds.length
      ? DOMRect.fromRect({
          x: Math.min(baseBounds.x, ...extraBounds.map((bounds) => bounds.x)),
          y: Math.min(baseBounds.y, ...extraBounds.map((bounds) => bounds.y)),
          width:
            Math.max(
              baseBounds.x + baseBounds.width,
              ...extraBounds.map((bounds) => bounds.x + bounds.width),
            ) - Math.min(baseBounds.x, ...extraBounds.map((bounds) => bounds.x)),
          height:
            Math.max(
              baseBounds.y + baseBounds.height,
              ...extraBounds.map((bounds) => bounds.y + bounds.height),
            ) - Math.min(baseBounds.y, ...extraBounds.map((bounds) => bounds.y)),
        })
      : baseBounds;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
    const flowchart = svg.getAttribute('aria-roledescription') === 'flowchart-v2';
    const groupedFlowchart = Boolean(svg.querySelector('g.cluster'));
    const padding = flowchart
      ? 28
      : groupedFlowchart
        ? 24
        : compactLayout
          ? normalizedState
            ? 10
            : 8
          : 10;
    let width = Math.ceil(bounds.width + padding * 2);
    let height = Math.ceil(bounds.height + padding * 2);
    svg.setAttribute('viewBox', `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`);
    svg.style.removeProperty('width');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    if (normalizedState) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (generation !== renderGeneration) return false;
      const settledBounds = svg.getBBox();
      width = Math.ceil(settledBounds.width + padding * 2);
      height = Math.ceil(settledBounds.height + padding * 2);
      svg.setAttribute(
        'viewBox',
        `${settledBounds.x - padding} ${settledBounds.y - padding} ${width} ${height}`,
      );
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
    }
    setReadableMermaidWidth(svg, width);
    await new Promise<void>((resolve) => setTimeout(resolve, 64));
    if (generation !== renderGeneration) return false;
    if (!compactLayout && svg.getAttribute('aria-roledescription') === 'flowchart-v2') {
      routeFlowchartFeedbackLane(svg, true);
      alignFlowchartMarkerTips(svg);
      const finalBounds = measureFinalFlowchartBounds(svg);
      width = Math.ceil(finalBounds.width + padding * 2);
      height = Math.ceil(finalBounds.height + padding * 2);
      svg.setAttribute(
        'viewBox',
        `${finalBounds.x - padding} ${finalBounds.y - padding} ${width} ${height}`,
      );
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      setReadableMermaidWidth(svg, width);
    }
    if (svg.getAttribute('aria-roledescription') === 'flowchart-v2') {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (generation !== renderGeneration) return false;
      snapFlowchartPorts(svg);
      snapFlowchartFeedbackPorts(svg);
      routeGroupedReturnEdges(svg);
      alignFlowchartMarkerTips(svg);
      if (compactLayout && svg.querySelector('g.cluster')) positionCompactGroupedEdgeLabels(svg);
    }
    if (compactLayout) {
      alignCompactClusterTitles(svg);
      routeFlowchartAroundClusterHeaders(svg);
      positionCompactGroupedEdgeLabels(svg);
    }
    if (svg.getAttribute('aria-roledescription') === 'flowchart-v2') {
      snapFlowchartPorts(svg);
      snapFlowchartFeedbackPorts(svg);
      routeFlowchartClientRequestLane(svg);
      roundOrthogonalBends(svg);
      alignFlowchartMarkerTips(svg);
      const finalBounds = measureFinalFlowchartBounds(svg);
      width = Math.ceil(finalBounds.width + padding * 2);
      height = Math.ceil(finalBounds.height + padding * 2);
      svg.setAttribute(
        'viewBox',
        `${finalBounds.x - padding} ${finalBounds.y - padding} ${width} ${height}`,
      );
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      setReadableMermaidWidth(svg, width);
    }
    if (normalizedState || groupedFlowchart || (compactLayout && flowchart)) {
      svg.style.setProperty('--mermaid-readable-width', '0px');
      svg.style.setProperty('max-width', '100%');
    }
    if (normalizedState) attachStateTerminalArrowheads(svg);
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    if (generation !== renderGeneration || fit !== fitGeneration) return false;
    if (svg.getAttribute('aria-roledescription') === 'flowchart-v2') {
      const settledBounds = measureFinalFlowchartBounds(svg);
      width = Math.ceil(settledBounds.width + padding * 2);
      height = Math.ceil(settledBounds.height + padding * 2);
      svg.setAttribute(
        'viewBox',
        `${settledBounds.x - padding} ${settledBounds.y - padding} ${width} ${height}`,
      );
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      setReadableMermaidWidth(svg, width);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (generation !== renderGeneration || fit !== fitGeneration) return false;
    }
    svg.dataset.layoutSettled = 'true';
    return true;
  }

  async function renderDiagram(rawCode: string) {
    const generation = ++renderGeneration;
    settledGeneration = 0;
    // First decode base64, then decode any HTML entities (for legacy support)
    const base64Decoded = decodeBase64(rawCode);
    const decodedCode = decodeHtmlEntities(base64Decoded);

    if (!decodedCode?.trim()) {
      renderedSvg = '';
      error = null;
      return;
    }

    try {
      const renderCode = applyResponsiveLayout(applyLayoutDefaults(decodedCode));
      const usesHtmlLabels = /(?:^|\n)\s*(?:flowchart|graph)\s/i.test(renderCode);
      const config = createMermaidConfig(
        getComputedStyle(document.documentElement),
        usesHtmlLabels,
      );
      const usesStateDiagram = /^\s*stateDiagram(?:-v2)?\b/m.test(renderCode);
      if (usesStateDiagram) {
        config.layout = 'elk';
      }
      if (compactLayout) {
        config.flowchart = {
          ...config.flowchart,
          nodeSpacing: 4,
          padding: 9,
          rankSpacing: 24,
          wrappingWidth: narrowLayout && /\bsubgraph\b/.test(renderCode) ? 80 : 120,
        };
        if (narrowLayout) {
          config.sequence = {
            ...config.sequence,
            actorMargin: 0,
            diagramMarginX: 0,
            messageMargin: 24,
            noteMargin: 4,
            width: 96,
            wrap: true,
          };
        }
      }
      await document.fonts?.load(`400 ${config.fontSize}px "${MERMAID_PRIMARY_FONT}"`);
      const { svg } = await runSerializedMermaidRender(async () => {
        mermaid.initialize(config);
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        return mermaid.render(id, renderCode);
      });
      if (generation !== renderGeneration) return;
      renderedSvg = svg;
      error = null;
      const fitCompleted = await fitRenderedSvg(generation);
      if (fitCompleted && generation === renderGeneration) settledGeneration = generation;
    } catch (err) {
      if (generation !== renderGeneration) return;
      logger.error('Failed to render mermaid diagram:', err);
      error = err instanceof Error ? err.message : m.markdown_mermaid_renderFailed_error();
      renderedSvg = '';
    }
  }

  function openFullscreen(e: MouseEvent) {
    // Prevent event propagation to avoid editor selection issues
    e.stopPropagation();
    e.preventDefault();
    fullscreenOpenerElement = e.currentTarget as HTMLElement;
    // Blur any focused element to avoid RangeError from ProseMirror
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    fullscreenSvg =
      rendererElement?.querySelector<SVGSVGElement>('.mermaid-svg svg')?.outerHTML ?? renderedSvg;
    isFullscreen = true;
  }

  function toggleSource(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    showSource = !showSource;
  }

  function closeFullscreen() {
    isFullscreen = false;
    fullscreenSvg = '';
  }

  function handleFullscreenKeydown(e: KeyboardEvent) {
    // Zoom keys (+/-/0): forward to the viewport unless it already handled
    // the event itself (keydown bubbling up from inside the viewport)
    if (!e.defaultPrevented) zoomPanViewport?.handleKeydown(e);
  }

  onMount(() => {
    mounted = true;
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(([entry]) => {
            compactLayout = entry.contentRect.width <= 620;
            narrowLayout = narrowLayout
              ? entry.contentRect.width < 440
              : entry.contentRect.width <= 420;
          });
    if (rendererElement && resizeObserver) {
      compactLayout = rendererElement.clientWidth <= 620;
      narrowLayout = rendererElement.clientWidth <= 420;
      resizeObserver.observe(rendererElement);
    }
    const observer = new MutationObserver(() => {
      themeRevision += 1;
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      renderGeneration += 1;
    };
  });

  // Re-render when code changes (after mount)
  $effect(() => {
    themeRevision;
    if (mounted && rendererElement) renderDiagram(code);
  });
</script>

<div
  class="mermaid-renderer {className}"
  class:has-diagram={Boolean(renderedSvg)}
  data-render-generation={settledGeneration}
  data-render-settled={settledGeneration > 0}
  style="--mermaid-font-family: var(--font-ui)"
  bind:this={rendererElement}
>
  <span class="mermaid-actor-icon-template" bind:this={actorIconTemplateElement} aria-hidden="true">
    <MermaidActorIcon size={30} weight="light" />
  </span>
  {#if error}
    <div class="mermaid-error">
      <div class="error-feedback" role="alert">
        <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
        <p>{m.markdown_mermaid_invalid_description()}</p>
      </div>
      <details class="error-details">
        <summary>{m.markdown_mermaid_errorDetails_label()}</summary>
        <pre class="error-message">{error}</pre>
        <strong>{m.markdown_mermaid_viewSource_label()}</strong>
        <pre class="error-source-code">{decodedSource}</pre>
      </details>
    </div>
  {:else if renderedSvg}
    <div class="mermaid-svg-container">
      <div class="mermaid-svg-viewport">
        <div class="mermaid-svg mermaid-presentation">
          {@html renderedSvg}
        </div>
      </div>
      <div
        class="mermaid-actions"
        role="toolbar"
        aria-label={m.markdown_mermaid_actions_ariaLabel()}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          iconOnly
          class="mermaid-action-button"
          onclick={toggleSource}
          aria-pressed={showSource}
          aria-label={m.markdown_mermaid_viewSource_label()}
          tooltip={m.markdown_mermaid_viewSource_label()}
        >
          <Fa icon={faCode} size="sm" />
        </Button>
        {#if showExpandButton}
          <Button
            variant="ghost"
            size="icon-xs"
            iconOnly
            class="mermaid-action-button expand-button"
            onclick={openFullscreen}
            aria-label={m.markdown_mermaid_expand_ariaLabel()}
            tooltip={m.markdown_mermaid_expand_tooltip()}
          >
            <Fa icon={faExpand} size="sm" />
          </Button>
        {/if}
      </div>
    </div>
    {#if showSource}
      <div class="mermaid-source" role="region" aria-label={m.markdown_mermaid_viewSource_label()}>
        <pre>{decodedSource}</pre>
      </div>
    {/if}
  {:else if !code?.trim()}
    <div class="mermaid-empty" role="status">
      <strong>{m.markdown_mermaid_noCode_label()}</strong>
      <span>{m.markdown_mermaid_noCode_description()}</span>
    </div>
  {:else}
    <div class="mermaid-loading" role="status">{m.ui_spinner_loading_ariaLabel()}</div>
  {/if}
</div>

<MediaLightbox
  bind:open={isFullscreen}
  ariaLabel={m.markdown_mermaid_fullscreenView_ariaLabel()}
  closeLabel={m.markdown_mermaid_closeFullscreen_ariaLabel()}
  onClose={closeFullscreen}
  openerElement={fullscreenOpenerElement}
  onKeydown={handleFullscreenKeydown}
>
  <div
    class="h-[90vh] w-[90vw] overflow-hidden rounded-lg bg-background shadow-2xl"
    data-media-lightbox-content
  >
    <ZoomPanViewport bind:this={zoomPanViewport}>
      <div
        class="fullscreen-diagram mermaid-presentation"
        style="--mermaid-font-family: var(--font-ui)"
      >
        {@html fullscreenSvg}
      </div>
    </ZoomPanViewport>
  </div>
</MediaLightbox>

<style>
  .mermaid-renderer {
    width: 100%;
    min-width: 0;
    color: hsl(var(--foreground));
    font-family: var(--font-ui);
  }

  .mermaid-renderer.has-diagram {
    width: 100%;
    max-width: 100%;
    margin-inline: auto;
  }

  .mermaid-svg-container {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    gap: var(--space-1);
    padding: var(--space-2);
  }

  .mermaid-svg-viewport {
    grid-column: 1;
    grid-row: 2;
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
  }

  .mermaid-svg-container:hover .mermaid-actions,
  .mermaid-svg-container:focus-within .mermaid-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .mermaid-svg {
    display: flex;
    width: 100%;
    min-width: 0;
    margin-inline: auto;
    justify-content: safe center;
    align-items: center;
  }

  .mermaid-svg :global(svg) {
    display: block;
    flex: none;
    width: auto;
    max-width: 100%;
    min-width: var(--mermaid-readable-width, 0);
    height: auto;
  }

  .mermaid-actions {
    grid-column: 1;
    grid-row: 1;
    justify-self: end;
    display: flex;
    gap: 2px;
    padding: 2px;
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    opacity: 0;
    pointer-events: none;
    box-shadow: var(--elevation-raised);
    transition: opacity var(--motion-standard) var(--ease-standard);
  }

  :global(.mermaid-action-button) {
    color: hsl(var(--muted-foreground));
  }

  :global(.mermaid-action-button:hover),
  :global(.mermaid-action-button:focus-visible) {
    color: hsl(var(--foreground));
  }

  .fullscreen-diagram {
    padding: var(--space-7);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .fullscreen-diagram :global(svg) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    min-width: 0;
    height: auto;
  }

  .mermaid-presentation :global(svg) {
    font-family: var(--mermaid-font-family) !important;
    font-size: var(--mermaid-root-font-size, var(--text-caption-size)) !important;
    background: transparent !important;
    overflow: visible;
  }

  .mermaid-presentation :global(.edge-pattern-solid),
  .mermaid-presentation :global(.flowchart-link),
  .mermaid-presentation :global(.relation),
  .mermaid-presentation :global(.transition),
  .mermaid-presentation :global(line),
  .mermaid-presentation :global(path.path),
  .mermaid-presentation :global(.messageLine0),
  .mermaid-presentation :global(.messageLine1),
  .mermaid-presentation :global(.loopLine),
  .mermaid-presentation :global(.edge-thickness-normal),
  .mermaid-presentation :global(.edge-thickness-thick),
  .mermaid-presentation :global(.edgePath path),
  .mermaid-presentation :global(.edgePaths path[data-edge='true']) {
    stroke: var(--diagram-connector) !important;
    stroke-width: var(--diagram-connector-width) !important;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mermaid-presentation :global(.node rect),
  .mermaid-presentation :global(.node circle),
  .mermaid-presentation :global(.node ellipse),
  .mermaid-presentation :global(.node polygon),
  .mermaid-presentation :global(.node path),
  .mermaid-presentation :global(rect.actor),
  .mermaid-presentation :global(rect.labelBox),
  .mermaid-presentation :global(rect.entityBox) {
    fill: var(--diagram-node-surface) !important;
    stroke: none !important;
  }

  .mermaid-presentation :global(.node rect),
  .mermaid-presentation :global(.node circle),
  .mermaid-presentation :global(.node ellipse),
  .mermaid-presentation :global(.node polygon),
  .mermaid-presentation :global(.node path),
  .mermaid-presentation :global(.actor),
  .mermaid-presentation :global(.labelBox),
  .mermaid-presentation :global(.note),
  .mermaid-presentation :global(.entityBox) {
    stroke-width: var(--line-hairline) !important;
  }

  .mermaid-presentation :global(.node > .flowchart-node-outline) {
    fill: none !important;
    stroke: none !important;
    stroke-width: 0 !important;
    pointer-events: none;
  }

  .mermaid-presentation :global(.classDiagram .class-box-outline) {
    fill: var(--diagram-node-surface) !important;
    stroke: none !important;
    stroke-width: 0 !important;
    rx: var(--diagram-node-radius);
    ry: var(--diagram-node-radius);
  }

  .mermaid-presentation :global(.classDiagram .class-box-divider) {
    stroke: hsl(var(--border)) !important;
    stroke-width: var(--line-hairline) !important;
    pointer-events: none;
  }

  .mermaid-presentation :global(.node rect),
  .mermaid-presentation :global(.actor),
  .mermaid-presentation :global(.labelBox),
  .mermaid-presentation :global(.note),
  .mermaid-presentation :global(.entityBox) {
    rx: var(--diagram-node-radius) !important;
    ry: var(--diagram-node-radius) !important;
  }

  .mermaid-presentation :global(marker path) {
    fill: var(--diagram-connector) !important;
    stroke: var(--diagram-connector) !important;
    stroke-width: 0.75px !important;
    stroke-linecap: round !important;
    stroke-linejoin: round !important;
  }

  .mermaid-presentation :global(.state-start),
  .mermaid-presentation :global(.state-end) {
    stroke-width: 1px !important;
  }

  .mermaid-presentation :global(.actor-line) {
    stroke-width: 1px !important;
    stroke-dasharray: 3 4;
    opacity: 0.62;
  }

  .mermaid-presentation :global(text),
  .mermaid-presentation :global(.label),
  .mermaid-presentation :global(.nodeLabel),
  .mermaid-presentation :global(.edgeLabel),
  .mermaid-presentation :global(.messageText),
  .mermaid-presentation :global(.actor) {
    font-family: var(--mermaid-font-family) !important;
    font-size: var(--text-caption-size) !important;
    line-height: 1.5 !important;
    letter-spacing: normal !important;
  }

  .mermaid-presentation :global(.node .nodeLabel),
  .mermaid-presentation :global(.node .label),
  .mermaid-presentation :global(.statediagram-state .nodeLabel),
  .mermaid-presentation :global(.statediagram-state text) {
    font-family: var(--mermaid-font-family) !important;
    font-size: var(--text-caption-size) !important;
    font-weight: 500 !important;
  }

  .mermaid-presentation :global(.edgeLabel),
  .mermaid-presentation :global(.cluster-label),
  .mermaid-presentation :global(.group-label) {
    font-family: var(--font-ui) !important;
    font-weight: 500 !important;
  }

  .mermaid-presentation :global(.node.active rect),
  .mermaid-presentation :global(.node.current rect),
  .mermaid-presentation :global(.node.selected rect) {
    fill: var(--diagram-accent) !important;
    stroke: color-mix(in srgb, var(--diagram-accent) 76%, var(--diagram-node-outline)) !important;
  }

  .mermaid-presentation :global(.node.active .nodeLabel),
  .mermaid-presentation :global(.node.current .nodeLabel),
  .mermaid-presentation :global(.node.selected .nodeLabel) {
    color: var(--diagram-accent-foreground) !important;
    fill: var(--diagram-accent-foreground) !important;
  }

  .mermaid-presentation :global(.nodeLabel),
  .mermaid-presentation :global(.actor),
  .mermaid-presentation :global(.cluster-label),
  .mermaid-presentation :global(.entityLabel) {
    font-weight: 400 !important;
  }

  .mermaid-presentation
    :global(svg[aria-roledescription='flowchart-v2'] g.node > .label foreignObject > div),
  .mermaid-presentation :global(g.cluster > .cluster-label foreignObject > div) {
    display: flex !important;
    width: 100% !important;
    height: 100% !important;
    align-items: center;
    justify-content: center;
    white-space: normal !important;
    text-align: center !important;
  }

  .mermaid-presentation
    :global(svg[aria-roledescription='flowchart-v2'] g.node > .label .nodeLabel),
  .mermaid-presentation :global(g.cluster > .cluster-label .nodeLabel),
  .mermaid-presentation
    :global(svg[aria-roledescription='flowchart-v2'] g.node > .label .nodeLabel > p),
  .mermaid-presentation :global(g.cluster > .cluster-label .nodeLabel > p) {
    display: block;
    width: 100%;
    margin: 0;
    white-space: normal !important;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: none;
    text-align: center;
  }

  .mermaid-presentation :global(.mermaid-actor-user-icon) {
    color: hsl(var(--foreground));
  }

  .mermaid-actor-icon-template {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .mermaid-presentation :global(.labelBkg) {
    background: var(--diagram-canvas) !important;
  }

  .mermaid-presentation :global(.edgeLabel rect.background) {
    fill: var(--diagram-label-surface) !important;
    fill-opacity: 1 !important;
    opacity: 1 !important;
    stroke: none !important;
    filter: none !important;
  }

  .mermaid-presentation :global(.edge-label-knockout) {
    fill: var(--diagram-label-surface) !important;
    fill-opacity: 1 !important;
    opacity: 1 !important;
    stroke: none !important;
    filter: none !important;
    pointer-events: none;
  }

  .mermaid-presentation :global(.node > .label),
  .mermaid-presentation :global(.node > .label foreignObject),
  .mermaid-presentation :global(.node > .label .nodeLabel),
  .mermaid-presentation :global(.node > .label .nodeLabel > p) {
    background: transparent !important;
  }

  .mermaid-presentation :global(foreignObject.edge-label-surface),
  .mermaid-presentation :global(foreignObject.edge-label-surface > .labelBkg),
  .mermaid-presentation :global(span.edgeLabel) {
    display: inline-block;
    border: 0;
    border-radius: 2px;
    background: var(--diagram-label-surface) !important;
    color: hsl(var(--muted-foreground)) !important;
    box-sizing: border-box;
    box-shadow: none !important;
  }

  .mermaid-presentation :global(foreignObject.edge-label-surface > .labelBkg) {
    display: flex !important;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
  }

  .mermaid-presentation :global(span.edgeLabel) {
    padding: 0;
  }

  .mermaid-presentation :global(span.edgeLabel > p) {
    margin: 0;
    background: transparent !important;
    color: inherit !important;
  }

  .mermaid-presentation :global(.cluster rect) {
    fill: var(--diagram-canvas) !important;
    stroke: var(--diagram-group-outline) !important;
    stroke-width: 1px !important;
    stroke-dasharray: none;
    rx: var(--diagram-group-radius) !important;
    ry: var(--diagram-group-radius) !important;
  }

  .mermaid-error {
    min-height: 4.5rem;
    border-left: 2px solid hsl(var(--error-foreground));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.25);
    padding: var(--space-3);
    color: hsl(var(--error-foreground));
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }

  .error-feedback {
    display: grid;
    gap: var(--space-1);
  }

  .error-feedback strong {
    color: hsl(var(--foreground));
    font-weight: var(--text-caption-weight);
  }

  .error-feedback p {
    margin: 0;
    color: hsl(var(--muted-foreground));
  }

  .error-message {
    font-family: var(--font-code);
    white-space: pre-wrap;
    word-break: break-word;
    margin: var(--space-2) 0;
  }

  .error-details {
    margin-top: var(--space-2);
  }

  .error-details summary {
    cursor: pointer;
    opacity: 0.7;
  }

  .error-details summary:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .error-details pre {
    margin-top: var(--space-1);
    border-radius: var(--radius-small);
    padding: var(--space-2);
    background: hsl(var(--background));
    overflow-x: auto;
    font-family: var(--font-code);
    font-size: var(--text-code-size);
  }

  .mermaid-source {
    min-width: 0;
    max-width: 100%;
    margin-top: var(--space-2);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.25);
    overflow: hidden;
  }

  .mermaid-source pre {
    margin: 0;
    padding: var(--space-3);
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    color: hsl(var(--foreground));
    font-family: var(--font-code);
    font-size: var(--text-code-size);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .mermaid-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }

  .mermaid-empty {
    display: grid;
    min-height: 5rem;
    place-content: center;
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: center;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
  }

  .mermaid-empty strong {
    color: hsl(var(--foreground));
    font-weight: var(--text-caption-weight);
  }

  .mermaid-empty span {
    font-size: var(--text-caption-size);
  }

  :global(.catalog-reduced-motion) .mermaid-actions {
    transition: none;
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .mermaid-actions {
      transition: none;
      animation: none;
    }
  }
</style>
