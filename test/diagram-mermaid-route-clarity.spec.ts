import { expect, test, type Page } from '@playwright/test';

type Appearance = { name: string; theme: 'light' | 'dark'; colorTheme?: 'nord' };
const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const appearances: Appearance[] = [
  { name: 'light', theme: 'light' },
  { name: 'dark', theme: 'dark' },
  { name: 'nord', theme: 'light', colorTheme: 'nord' },
];
const widths = [1400, 960, 420, 320] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openDiagram(page: Page, state: string, width: number, appearance: Appearance) {
  const params = new URLSearchParams({
    state,
    theme: appearance.theme,
    width: String(width),
    motion: 'reduced',
  });
  if (appearance.colorTheme) params.set('colorTheme', appearance.colorTheme);
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?${params}`);
  await page.locator('[data-preview-ready="true"]').waitFor();
  await page
    .locator('[data-diagram-workbench-ready="true"]')
    .waitFor({ state: 'attached', timeout: 90_000 });
  const diagram = page.locator(`#${state} svg[aria-roledescription]`);
  await expect(diagram).toBeVisible();
  await diagram.locator('g.node').first().waitFor();
}

for (const appearance of appearances) {
  for (const width of widths) {
    test(`Mermaid route clarity · ${appearance.name} · ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await openDiagram(page, 'mermaid-long-labels', width, appearance);
      await Promise.all(
        [
          'mermaid-flow',
          'mermaid-state',
          'mermaid-groups',
          'mermaid-nested-groups',
          'mermaid-nested-routing',
          'mermaid-topology-stress',
        ].map((fixture) =>
          page.locator(`#${fixture} svg[data-layout-settled="true"]`).waitFor({ timeout: 90_000 }),
        ),
      );
      await expect(
        page.locator(
          '#mermaid-long-labels .mermaid-svg > svg:not([data-layout-settled="true"]), #mermaid-cycle-fanout .mermaid-svg > svg:not([data-layout-settled="true"]), #mermaid-state .mermaid-svg > svg:not([data-layout-settled="true"])',
        ),
      ).toHaveCount(0);
      const outlines = await page.locator('#mermaid-long-labels g.node').evaluateAll((nodes) =>
        nodes.map((node) => {
          const shape = node.querySelector<SVGGraphicsElement>(
            ':scope > .label-container:not(.flowchart-node-outline)',
          );
          const outline = node.querySelector<SVGGraphicsElement>(
            ':scope > .flowchart-node-outline',
          );
          const label = node.querySelector<SVGGraphicsElement>(':scope > .label');
          const box = (item: Element | null) => item?.getBoundingClientRect();
          const s = box(shape);
          const o = box(outline);
          const l = box(label);
          const matrix = shape?.getScreenCTM();
          const scale = matrix ? Math.hypot(matrix.a, matrix.b) || 1 : 1;
          const opaque = [
            ...node.querySelectorAll('.label, foreignObject, .nodeLabel, .nodeLabel > p'),
          ].some(
            (item) =>
              !['transparent', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(item).backgroundColor),
          );
          return {
            fitted:
              !!s &&
              !!o &&
              Math.max(
                Math.abs(s.left - o.left),
                Math.abs(s.top - o.top),
                Math.abs(s.right - o.right),
                Math.abs(s.bottom - o.bottom),
              ) <= 0.5,
            onTop:
              !!outline &&
              !!label &&
              [...node.children].indexOf(outline) > [...node.children].indexOf(label),
            padding:
              !!s &&
              !!l &&
              Math.min(l.left - s.left, s.right - l.right, l.top - s.top, s.bottom - l.bottom) /
                scale,
            opaque,
          };
        }),
      );
      expect(outlines).toHaveLength(3);
      expect(
        outlines.every((item) => item.fitted && item.onTop && item.padding >= 8 && !item.opaque),
      ).toBe(true);

      const decision = await page
        .locator('#mermaid-flow svg[aria-roledescription="flowchart-v2"]')
        .evaluate((svg) => {
          const paths = [
            ...svg.querySelectorAll<SVGPathElement>(
              'path[data-decision-branch], path[data-decision-return]',
            ),
          ];
          const parse = (path: SVGPathElement) =>
            path.dataset.manhattanPoints!.split(' ').map((value) => {
              const [x, y] = value.split(',').map(Number);
              return { x, y };
            });
          const segments = paths.flatMap((path, pathIndex) => {
            const points = parse(path);
            return points.slice(1).map((end, index) => ({
              start: points[index],
              end,
              pathIndex,
            }));
          });
          const conflicts: string[] = [];
          for (let i = 0; i < segments.length; i += 1)
            for (let j = i + 1; j < segments.length; j += 1) {
              const a = segments[i];
              const b = segments[j];
              if (a.pathIndex === b.pathIndex) continue;
              const horizontalA = a.start.y === a.end.y;
              const horizontalB = b.start.y === b.end.y;
              const overlap = (a1: number, a2: number, b1: number, b2: number) =>
                Math.min(Math.max(a1, a2), Math.max(b1, b2)) -
                Math.max(Math.min(a1, a2), Math.min(b1, b2));
              if (
                horizontalA &&
                horizontalB &&
                a.start.y === b.start.y &&
                overlap(a.start.x, a.end.x, b.start.x, b.end.x) > 0.5
              )
                conflicts.push('shared-horizontal');
              if (
                !horizontalA &&
                !horizontalB &&
                a.start.x === b.start.x &&
                overlap(a.start.y, a.end.y, b.start.y, b.end.y) > 0.5
              )
                conflicts.push('shared-vertical');
              if (horizontalA !== horizontalB) {
                const horizontal = horizontalA ? a : b;
                const vertical = horizontalA ? b : a;
                if (
                  overlap(
                    horizontal.start.x,
                    horizontal.end.x,
                    vertical.start.x,
                    vertical.start.x,
                  ) >= 0 &&
                  overlap(
                    vertical.start.y,
                    vertical.end.y,
                    horizontal.start.y,
                    horizontal.start.y,
                  ) >= 0
                )
                  conflicts.push('false-junction');
              }
            }
          const nodeShapes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
            id: node.id,
            bounds: node.getBoundingClientRect(),
          }));
          const frame = svg.getBoundingClientRect();
          const routeResults = paths.map((path) => {
            const points = parse(path);
            const matrix = path.getScreenCTM()!;
            const screen = points.map(({ x, y }) => new DOMPoint(x, y).matrixTransform(matrix));
            const end = screen.at(-1)!;
            const before = screen.at(-2)!;
            const target = nodeShapes.find(({ id }) =>
              id.includes(`-flowchart-${path.dataset.decisionTarget}-`),
            )!;
            const center = {
              x: target.bounds.left + target.bounds.width / 2,
              y: target.bounds.top + target.bounds.height / 2,
            };
            const label = svg.querySelector<SVGGElement>(
              `.edgeLabel[data-route-path-id="${path.id}"]`,
            );
            const samples = Array.from({ length: 121 }, (_, index) => {
              const point = path.getPointAtLength((path.getTotalLength() * index) / 120);
              return new DOMPoint(point.x, point.y).matrixTransform(matrix);
            });
            const crossesUnrelatedNode = samples
              .slice(2, -2)
              .some((point) =>
                nodeShapes.some(
                  ({ id, bounds }) =>
                    !id.includes(`-flowchart-${path.dataset.decisionSource}-`) &&
                    !id.includes(`-flowchart-${path.dataset.decisionTarget}-`) &&
                    point.x > bounds.left + 1 &&
                    point.x < bounds.right - 1 &&
                    point.y > bounds.top + 1 &&
                    point.y < bounds.bottom - 1,
                ),
              );
            return {
              source: path.dataset.decisionSource,
              target: path.dataset.decisionTarget,
              branch: path.dataset.decisionBranch ?? path.dataset.decisionReturn,
              port: path.dataset.decisionPort,
              lane: path.dataset.decisionLane,
              towardTarget:
                Math.hypot(end.x - center.x, end.y - center.y) <
                Math.hypot(before.x - center.x, before.y - center.y),
              contactsTarget:
                Math.min(
                  Math.abs(end.x - target.bounds.left),
                  Math.abs(end.x - target.bounds.right),
                  Math.abs(end.y - target.bounds.top),
                  Math.abs(end.y - target.bounds.bottom),
                ) <= 1,
              marker: path.getAttribute('marker-end'),
              contained: samples.every(
                ({ x, y }) =>
                  x >= frame.left - 1 &&
                  x <= frame.right + 1 &&
                  y >= frame.top - 1 &&
                  y <= frame.bottom + 1,
              ),
              crossesUnrelatedNode,
              animated: getComputedStyle(path).animationName !== 'none',
              ownsLabel:
                !path.dataset.decisionBranch ||
                label?.textContent?.trim() ===
                  (path.dataset.decisionBranch === 'upper' ? 'Yes' : 'No'),
              labelClear:
                !label ||
                nodeShapes.every(({ bounds }) => {
                  const box = label.getBoundingClientRect();
                  return (
                    box.right <= bounds.left ||
                    box.left >= bounds.right ||
                    box.bottom <= bounds.top ||
                    box.top >= bounds.bottom
                  );
                }),
            };
          });
          return { conflicts, routeResults };
        });
      expect(decision.conflicts).toEqual([]);
      expect(
        decision.routeResults.map(({ source, target, branch }) => ({ source, target, branch })),
      ).toEqual([
        { source: 'Check', target: 'Work', branch: 'upper' },
        { source: 'Check', target: 'Fix', branch: 'lower' },
        { source: 'Fix', target: 'Check', branch: 'outer' },
      ]);
      expect(new Set(decision.routeResults.slice(0, 2).map(({ port }) => port)).size).toBe(2);
      expect(new Set(decision.routeResults.map(({ lane }) => lane)).size).toBe(3);
      expect(
        decision.routeResults.every(
          (route) =>
            route.towardTarget &&
            route.contactsTarget &&
            route.marker?.includes('pointEnd') &&
            route.contained &&
            !route.crossesUnrelatedNode &&
            !route.animated &&
            route.ownsLabel &&
            route.labelClear,
        ),
      ).toBe(true);

      const nestedDecision = await page
        .locator('#mermaid-nested-routing svg[aria-roledescription="flowchart-v2"]')
        .evaluate((svg) => {
          const labelFor = (path: SVGPathElement) => {
            const edgeId = path.id.match(/-(L_.+)$/)?.[1];
            return edgeId
              ? [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].find(
                  (label) =>
                    label.querySelector(':scope > .label')?.getAttribute('data-id') === edgeId,
                )
              : undefined;
          };
          const routes = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map(
            (path) => {
              const points = path.dataset.manhattanPoints!.split(' ').map((value) => {
                const [x, y] = value.split(',').map(Number);
                return { x, y };
              });
              return {
                path,
                label: labelFor(path)?.textContent?.trim().toLowerCase() ?? '',
                points,
              };
            },
          );
          const selected = routes.filter(
            ({ path, label }) =>
              ['done', 'no', 'retry', 'save'].includes(label) || path.dataset.selfLoop === 'right',
          );
          const segments = selected.flatMap(({ label, points }, pathIndex) =>
            points.slice(1).map((end, index) => ({
              label: label || 'self',
              pathIndex,
              start: points[index],
              end,
            })),
          );
          const overlap = (a1: number, a2: number, b1: number, b2: number) =>
            Math.min(Math.max(a1, a2), Math.max(b1, b2)) -
            Math.max(Math.min(a1, a2), Math.min(b1, b2));
          const sharedShafts: string[] = [];
          for (let left = 0; left < segments.length; left += 1)
            for (let right = left + 1; right < segments.length; right += 1) {
              const a = segments[left];
              const b = segments[right];
              if (a.pathIndex === b.pathIndex) continue;
              const ah = Math.abs(a.start.y - a.end.y) < 0.001;
              const bh = Math.abs(b.start.y - b.end.y) < 0.001;
              if (
                ah &&
                bh &&
                Math.abs(a.start.y - b.start.y) < 0.001 &&
                overlap(a.start.x, a.end.x, b.start.x, b.end.x) > 0.5
              )
                sharedShafts.push(`${a.label}/${b.label}`);
              if (
                !ah &&
                !bh &&
                Math.abs(a.start.x - b.start.x) < 0.001 &&
                overlap(a.start.y, a.end.y, b.start.y, b.end.y) > 0.5
              )
                sharedShafts.push(`${a.label}/${b.label}`);
            }
          const decisionPorts = selected.flatMap(({ path, label, points }) => {
            if (label === 'done' || label === 'no')
              return [`${points.at(-1)!.x},${points.at(-1)!.y}`];
            if (label === 'save') return [`${points[0].x},${points[0].y}`];
            if (path.dataset.selfLoop === 'right') {
              return [`${points[0].x},${points[0].y}`, `${points.at(-1)!.x},${points.at(-1)!.y}`];
            }
            return [];
          });
          const horizontalLanes = selected.flatMap(({ label, points }) => {
            if (!['done', 'no', 'retry', 'save'].includes(label)) return [];
            const longest = points.slice(1).reduce(
              (best, end, index) => {
                const start = points[index];
                const length = Math.abs(start.y - end.y) < 0.001 ? Math.abs(start.x - end.x) : 0;
                return length > best.length ? { length, y: start.y } : best;
              },
              { length: 0, y: Number.NaN },
            );
            return [longest.y];
          });
          const frame = svg.getBoundingClientRect();
          const contained = selected.every(({ path }) => {
            const matrix = path.getScreenCTM()!;
            return Array.from({ length: 101 }, (_, index) => {
              const point = path.getPointAtLength((path.getTotalLength() * index) / 100);
              return new DOMPoint(point.x, point.y).matrixTransform(matrix);
            }).every(
              ({ x, y }) =>
                x >= frame.left - 1 &&
                x <= frame.right + 1 &&
                y >= frame.top - 1 &&
                y <= frame.bottom + 1,
            );
          });
          const ready = [...svg.querySelectorAll<SVGGElement>('g.node')].find(
            (node) => node.textContent?.trim() === 'Ready?',
          )!;
          const readyId = ready.id.match(/-flowchart-(.+)-[0-9]+$/)![1];
          const readyBounds = ready.getBoundingClientRect();
          const readyCenter = {
            x: (readyBounds.left + readyBounds.right) / 2,
            y: (readyBounds.top + readyBounds.bottom) / 2,
          };
          const denseRoutes = routes.filter(({ path }) => path.id.includes(`_${readyId}_`));
          const densePorts = denseRoutes.map(({ path, points }) => {
            const outbound = path.id.includes(`-L_${readyId}_`);
            const matrix = path.getScreenCTM()!;
            const port = new DOMPoint(
              ...Object.values(outbound ? points[0] : points.at(-1)!),
            ).matrixTransform(matrix);
            const adjacent = new DOMPoint(
              ...Object.values(outbound ? points[1] : points.at(-2)!),
            ).matrixTransform(matrix);
            const side = outbound ? path.dataset.diamondSourceSide : path.dataset.diamondTargetSide;
            const vertical = side === 'top' || side === 'bottom';
            return {
              port: `${port.x.toFixed(2)},${port.y.toFixed(2)}`,
              boundaryError: Math.abs(
                Math.abs(port.x - readyCenter.x) / (readyBounds.width / 2) +
                  Math.abs(port.y - readyCenter.y) / (readyBounds.height / 2) -
                  1,
              ),
              tangentAligned: vertical
                ? Math.abs(port.x - adjacent.x) < 0.01
                : Math.abs(port.y - adjacent.y) < 0.01,
              rounded:
                points.length < 3 ||
                (path.dataset.cornerRadius === '6' && path.getAttribute('d')!.includes(' Q ')),
            };
          });
          return {
            allAxisAligned: selected.every(({ points }) =>
              points.slice(1).every((point, index) => {
                const previous = points[index];
                return (
                  Math.abs(point.x - previous.x) < 0.001 || Math.abs(point.y - previous.y) < 0.001
                );
              }),
            ),
            rounded: selected.every(
              ({ path, points }) =>
                points.length < 3 ||
                (path.dataset.cornerRadius === '6' && path.getAttribute('d')!.includes(' Q ')),
            ),
            straightTerminals: selected.every(({ points }) => {
              const end = points.at(-1)!;
              const previous = points.at(-2)!;
              return Math.abs(end.x - previous.x) < 0.001 || Math.abs(end.y - previous.y) < 0.001;
            }),
            decisionPorts,
            horizontalLanes,
            sharedShafts,
            selfLoop: selected.some(({ path }) => path.dataset.selfLoop === 'right'),
            contained,
            densePorts,
          };
        });
      expect(nestedDecision.allAxisAligned).toBe(true);
      expect(nestedDecision.rounded).toBe(true);
      expect(nestedDecision.straightTerminals).toBe(true);
      expect(new Set(nestedDecision.decisionPorts).size).toBe(5);
      expect(new Set(nestedDecision.horizontalLanes).size).toBe(4);
      expect(nestedDecision.sharedShafts).toEqual([]);
      expect(nestedDecision.selfLoop).toBe(true);
      expect(nestedDecision.contained).toBe(true);
      expect(nestedDecision.densePorts).toHaveLength(6);
      expect(new Set(nestedDecision.densePorts.map(({ port }) => port)).size).toBe(6);
      expect(
        nestedDecision.densePorts.every(
          ({ boundaryError, tangentAligned, rounded }) =>
            boundaryError < 0.03 && tangentAligned && rounded,
        ),
      ).toBe(true);

      const labelSurfaces = await page
        .locator('#mermaid-flow, #mermaid-state')
        .evaluateAll((roots) => {
          const rgb = (value: string) =>
            value
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number) ?? [0, 0, 0];
          const luminance = (value: string) => {
            const channels = rgb(value).map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.03928
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          };
          const contrast = (foreground: string, background: string) => {
            const light = Math.max(luminance(foreground), luminance(background));
            const dark = Math.min(luminance(foreground), luminance(background));
            return (light + 0.05) / (dark + 0.05);
          };
          return roots.flatMap((root) =>
            [...root.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
              .filter((label) => label.textContent?.trim())
              .map((label) => {
                const surface = label.querySelector<SVGGraphicsElement>(
                  'rect.edge-label-knockout, foreignObject.edge-label-surface, rect.background[data-label-padded]',
                )!;
                const text = label.querySelector<SVGGraphicsElement>('text');
                const htmlText = label.querySelector<HTMLElement>('span.edgeLabel');
                const surfaceBounds = surface.getBoundingClientRect();
                let textBounds = text?.getBoundingClientRect();
                if (htmlText) {
                  const range = document.createRange();
                  range.selectNodeContents(htmlText);
                  textBounds = range.getBoundingClientRect();
                }
                const style = getComputedStyle(surface);
                const htmlSurface = surface.querySelector<HTMLElement>(':scope > .labelBkg');
                const featherStyle = htmlSurface
                  ? getComputedStyle(htmlSurface, '::before')
                  : style;
                const textStyle = getComputedStyle((text ?? htmlText)!);
                const background =
                  surface instanceof SVGRectElement ? style.fill : featherStyle.backgroundColor;
                const color = textStyle.fill === 'none' ? textStyle.color : textStyle.fill;
                const alpha = Number(background.match(/[\d.]+/g)?.[3] ?? 1);
                const svg = label.closest('svg');
                const edgePaths = svg?.querySelector('.edgePaths, .edges.edgePath');
                const edgeLabels = label.closest('.edgeLabels');
                const edgeLayerKind = edgePaths?.classList.contains('edgePaths')
                  ? 'flowchart'
                  : edgePaths?.matches('.edges.edgePath')
                    ? 'state'
                    : 'missing';
                return {
                  text: label.textContent!.trim(),
                  edgeLayerKind,
                  layersPresent: Boolean(edgePaths && edgeLabels),
                  horizontal:
                    Math.min(
                      textBounds!.left - surfaceBounds.left,
                      surfaceBounds.right - textBounds!.right,
                    ) + 0.1,
                  vertical:
                    Math.min(
                      textBounds!.top - surfaceBounds.top,
                      surfaceBounds.bottom - textBounds!.bottom,
                    ) + 0.1,
                  alpha,
                  radius:
                    surface instanceof SVGRectElement
                      ? Number(surface.getAttribute('rx'))
                      : Number.parseFloat(style.borderRadius),
                  border: style.stroke === 'none' || style.borderStyle === 'none',
                  shadow: style.filter === 'none' && style.boxShadow === 'none',
                  contrast: contrast(color, background),
                  feathered:
                    surface instanceof SVGRectElement
                      ? surface.dataset.labelFeathered === 'true' &&
                        Boolean(surface.getAttribute('mask'))
                      : Boolean(htmlSurface) &&
                        (featherStyle.webkitMaskImage || featherStyle.maskImage) !== 'none' &&
                        style.backgroundColor === 'rgba(0, 0, 0, 0)',
                  paintOrder:
                    Boolean(
                      edgePaths &&
                      edgeLabels &&
                      edgePaths.compareDocumentPosition(edgeLabels) &
                        Node.DOCUMENT_POSITION_FOLLOWING,
                    ) &&
                    !!(
                      surface.compareDocumentPosition((text ?? htmlText)!) &
                      Node.DOCUMENT_POSITION_FOLLOWING
                    ),
                };
              }),
          );
        });
      expect(labelSurfaces.length).toBeGreaterThanOrEqual(12);
      expect(new Set(labelSurfaces.map(({ edgeLayerKind }) => edgeLayerKind))).toEqual(
        new Set(['flowchart', 'state']),
      );
      expect(
        labelSurfaces.filter(
          (surface) =>
            !surface.layersPresent ||
            surface.horizontal < 6 ||
            surface.vertical < 4 ||
            surface.alpha !== 1 ||
            surface.radius > 3 ||
            !surface.border ||
            !surface.shadow ||
            !surface.feathered ||
            !surface.paintOrder ||
            surface.contrast < 4.5,
        ),
      ).toEqual([]);

      const sharedStyles = await page.locator('#mermaid-flow').evaluate((root) => {
        const canvas = getComputedStyle(
          root.querySelector<HTMLElement>('.mermaid-presentation')!,
        ).backgroundColor;
        const node = root.querySelector<SVGGraphicsElement>('g.node > .label-container')!;
        const nodeStyle = getComputedStyle(node);
        const edge = root.querySelector<SVGPathElement>('.edgePaths path')!;
        const edgeStyle = getComputedStyle(edge);
        const label = root.querySelector<SVGGraphicsElement>('.edgeLabel text, .edgeLabel span')!;
        const labelStyle = getComputedStyle(label);
        const markerId = edge.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
        const marker = markerId
          ? root.querySelector<SVGPathElement>(`marker[id="${markerId}"] path`)
          : null;
        return {
          canvas,
          nodeFill: nodeStyle.fill,
          nodeStroke: nodeStyle.stroke,
          edgeStroke: edgeStyle.stroke,
          labelColor: labelStyle.fill === 'none' ? labelStyle.color : labelStyle.fill,
          markerFill: marker ? getComputedStyle(marker).fill : null,
          markerStroke: marker ? getComputedStyle(marker).stroke : null,
        };
      });
      expect(sharedStyles.nodeStroke).toBe('none');
      expect(sharedStyles.nodeFill).not.toBe(sharedStyles.canvas);
      expect(sharedStyles.edgeStroke).not.toBe(sharedStyles.labelColor);
      expect([sharedStyles.markerFill, sharedStyles.markerStroke]).toContain(
        sharedStyles.edgeStroke,
      );

      const groupGeometry = await page
        .locator('#mermaid-groups, #mermaid-nested-groups')
        .evaluateAll((roots) =>
          roots.flatMap((root) => {
            const svg = root.querySelector<SVGSVGElement>(
              '.mermaid-svg > svg[data-layout-settled="true"]',
            )!;
            const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
            const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')];
            const clusters = [...svg.querySelectorAll<SVGGElement>('g.cluster')];
            return clusters.map((cluster) => {
              const rect = cluster.querySelector<SVGRectElement>(':scope > rect')!;
              const title = cluster.querySelector<SVGGElement>(':scope > .cluster-label')!;
              const frame = rect.getBoundingClientRect();
              const titleBounds = title.getBoundingClientRect();
              const containedNodes = nodes
                .map((node) => node.getBoundingClientRect())
                .filter(
                  (bounds) =>
                    bounds.left >= frame.left &&
                    bounds.right <= frame.right &&
                    bounds.top >= frame.top &&
                    bounds.bottom <= frame.bottom,
                );
              const containedGroups = clusters
                .filter((candidate) => candidate !== cluster)
                .map((candidate) =>
                  candidate.querySelector<SVGRectElement>(':scope > rect')!.getBoundingClientRect(),
                )
                .filter(
                  (bounds) =>
                    bounds.left >= frame.left &&
                    bounds.right <= frame.right &&
                    bounds.top >= frame.top &&
                    bounds.bottom <= frame.bottom,
                );
              const content = [...containedNodes, ...containedGroups];
              const scale = frame.height / rect.getBBox().height;
              const protectedBottom =
                frame.top + (Number(cluster.dataset.headerHeight) + 8) * scale;
              const routeInHeader = paths.some((path) => {
                const matrix = path.getScreenCTM()!;
                return Array.from({ length: 151 }, (_, index) => {
                  const point = path.getPointAtLength((path.getTotalLength() * index) / 150);
                  return new DOMPoint(point.x, point.y).matrixTransform(matrix);
                }).some(
                  ({ x, y }) =>
                    x > frame.left && x < frame.right && y > frame.top && y < protectedBottom,
                );
              });
              const titleOpaque = [title, ...title.querySelectorAll('*')].some((element) => {
                const background = getComputedStyle(element).backgroundColor;
                return background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent';
              });
              return {
                name: title.textContent?.trim(),
                topGap: (titleBounds.top - frame.top) / scale,
                childGap:
                  (Math.min(...content.map((bounds) => bounds.top)) - titleBounds.bottom) / scale,
                sideInset:
                  Math.min(
                    ...content.flatMap((bounds) => [
                      bounds.left - frame.left,
                      frame.right - bounds.right,
                    ]),
                  ) / scale,
                bottomInset:
                  Math.min(...content.map((bounds) => frame.bottom - bounds.bottom)) / scale,
                nestedInset: containedGroups.length
                  ? Math.min(
                      ...containedGroups.flatMap((bounds) => [
                        bounds.left - frame.left,
                        frame.right - bounds.right,
                        bounds.top - frame.top,
                        frame.bottom - bounds.bottom,
                      ]),
                    ) / scale
                  : 999,
                headerHeight: Number(cluster.dataset.headerHeight),
                titleHeight: title.getBBox().height,
                centerError:
                  Math.abs(
                    (titleBounds.left + titleBounds.right) / 2 - (frame.left + frame.right) / 2,
                  ) / scale,
                routeInHeader,
                titleOpaque,
              };
            });
          }),
        );
      expect(groupGeometry.length).toBeGreaterThanOrEqual(4);
      expect(
        groupGeometry.filter(
          (group) =>
            group.topGap < 19.5 ||
            group.childGap < 27.5 ||
            group.sideInset < 19.5 ||
            group.bottomInset < 19.5 ||
            group.nestedInset < 19.5 ||
            group.headerHeight < group.titleHeight + 48 ||
            group.centerError > 1 ||
            group.routeInHeader ||
            group.titleOpaque,
        ),
      ).toEqual([]);
      const nestedViewportInsets = await page
        .locator('#mermaid-nested-groups svg[data-layout-settled="true"]')
        .evaluate((svg) => {
          const frame = svg.getBoundingClientRect();
          const scale = frame.width / svg.viewBox.baseVal.width;
          const labelRight = Math.min(
            ...[...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
              .filter((label) => label.textContent?.trim())
              .map((label) => (frame.right - label.getBoundingClientRect().right) / scale),
          );
          const routeRight = Math.min(
            ...[...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
              const matrix = path.getScreenCTM()!;
              const right = Math.max(
                ...Array.from({ length: 201 }, (_, index) => {
                  const point = path.getPointAtLength((path.getTotalLength() * index) / 200);
                  return new DOMPoint(point.x, point.y).matrixTransform(matrix).x;
                }),
              );
              return (frame.right - right) / scale;
            }),
          );
          return { labelRight, routeRight };
        });
      if (width === 320) {
        expect(nestedViewportInsets.labelRight).toBeGreaterThanOrEqual(23);
        expect(nestedViewportInsets.routeRight).toBeGreaterThanOrEqual(23);
      }

      const topology = await page
        .locator('#mermaid-topology-stress svg[aria-roledescription="flowchart-v2"]')
        .evaluate(async (svg) => {
          const viewport = svg.closest<HTMLElement>('.mermaid-svg-viewport')!;
          viewport.scrollLeft = 0;
          await new Promise(requestAnimationFrame);
          const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
          const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
            id: node.id.match(/flowchart-(.+?)-\d+$/)?.[1],
            bounds: node.getBoundingClientRect(),
          }));
          const violations: string[] = [];
          for (const path of paths) {
            const identity = path.id.match(/-L_([^_]+)_([^_]+)_\d+$/);
            const points = path.dataset.manhattanPoints!.split(' ').map((value) => {
              const [x, y] = value.split(',').map(Number);
              return { x, y };
            });
            points.slice(1).forEach((point, index) => {
              const previous = points[index];
              if (Math.abs(point.x - previous.x) >= 0.01 && Math.abs(point.y - previous.y) >= 0.01)
                violations.push(`${path.id} diagonal`);
            });
            const matrix = path.getScreenCTM()!;
            const samples = Array.from({ length: 121 }, (_, index) => {
              const point = path.getPointAtLength((path.getTotalLength() * index) / 120);
              return new DOMPoint(point.x, point.y).matrixTransform(matrix);
            });
            if (
              samples
                .slice(2, -2)
                .some((point) =>
                  nodes.some(
                    (node) =>
                      node.id !== identity?.[1] &&
                      node.id !== identity?.[2] &&
                      point.x > node.bounds.left + 1 &&
                      point.x < node.bounds.right - 1 &&
                      point.y > node.bounds.top + 1 &&
                      point.y < node.bounds.bottom - 1,
                  ),
                )
            )
              violations.push(`${path.id} crosses node`);
          }
          const labels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].filter((label) =>
            label.textContent?.trim(),
          );
          // The readable SVG can exceed its native scroll viewport. Its canvas,
          // not the viewport-width presentation wrapper, owns the 16px inset.
          const frame = svg.getBoundingClientRect();
          const canvasMargin = 16;
          const paintBounds = [...nodes.map(({ bounds }) => bounds)];
          if (
            nodes.some(
              ({ bounds }) =>
                bounds.left < frame.left + canvasMargin ||
                bounds.right > frame.right - canvasMargin ||
                bounds.top < frame.top + canvasMargin ||
                bounds.bottom > frame.bottom - canvasMargin,
            )
          )
            violations.push('node leaves painted canvas');
          for (let left = 0; left < labels.length; left += 1) {
            const a = labels[left].getBoundingClientRect();
            paintBounds.push(a);
            if (
              a.left < frame.left + canvasMargin ||
              a.right > frame.right - canvasMargin ||
              a.top < frame.top + canvasMargin ||
              a.bottom > frame.bottom - canvasMargin
            )
              violations.push(`${labels[left].textContent?.trim()} leaves frame`);
            for (let right = left + 1; right < labels.length; right += 1) {
              const b = labels[right].getBoundingClientRect();
              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (overlapX > 0.5 && overlapY > 0.5) violations.push('overlapping labels');
            }
          }
          const feedback = svg.querySelector<SVGPathElement>('path[data-feedback-lane="outer"]');
          const parallel = paths
            .filter((path) => /-L_(?:A_B|B_A)_/.test(path.id))
            .map((path) => path.dataset.parallelLane)
            .filter(Boolean);
          for (const path of paths) {
            const matrix = path.getScreenCTM()!;
            const scale = Math.hypot(matrix.a, matrix.b);
            const style = getComputedStyle(path);
            const strokeScale = style.vectorEffect === 'non-scaling-stroke' ? 1 : scale;
            const bleed = (Number.parseFloat(style.strokeWidth) * strokeScale) / 2;
            const bounds = path.getBoundingClientRect();
            paintBounds.push(
              new DOMRect(
                bounds.x - bleed,
                bounds.y - bleed,
                bounds.width + bleed * 2,
                bounds.height + bleed * 2,
              ),
            );
            const markerId = path.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
            if (!markerId) continue;
            const marker = svg.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`);
            const shape = marker?.querySelector<SVGPathElement>('path');
            if (!marker || !shape) {
              violations.push(`${path.id} missing marker geometry`);
              continue;
            }
            const box = shape.getBBox();
            const view = marker.viewBox.baseVal;
            const units =
              marker.markerUnits.baseVal === SVGMarkerElement.SVG_MARKERUNITS_STROKEWIDTH
                ? Number.parseFloat(style.strokeWidth)
                : 1;
            const zoom = view.width
              ? Math.max(
                  marker.markerWidth.baseVal.value / view.width,
                  marker.markerHeight.baseVal.value / view.height,
                )
              : 1;
            const markerScale = units * zoom * scale;
            const markerStyle = getComputedStyle(shape);
            const markerStrokeScale =
              markerStyle.vectorEffect === 'non-scaling-stroke' ? 1 : markerScale;
            // A conservative orientation-independent disk encloses the actual
            // marker, only at the terminal — never along the entire shaft.
            const radius =
              Math.max(
                ...[box.x, box.x + box.width].flatMap((x) =>
                  [box.y, box.y + box.height].map((y) =>
                    Math.hypot(x - marker.refX.baseVal.value, y - marker.refY.baseVal.value),
                  ),
                ),
              ) *
                markerScale +
              (Number.parseFloat(markerStyle.strokeWidth) * markerStrokeScale) / 2;
            const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
            paintBounds.push(new DOMRect(end.x - radius, end.y - radius, radius * 2, radius * 2));
          }
          if (
            paintBounds.some(
              (bounds) =>
                bounds.left < frame.left + canvasMargin ||
                bounds.right > frame.right - canvasMargin ||
                bounds.top < frame.top + canvasMargin ||
                bounds.bottom > frame.bottom - canvasMargin,
            )
          )
            violations.push('paint leaves inset canvas');
          const scrollExtremes = [];
          for (const requested of [0, viewport.scrollWidth]) {
            viewport.scrollLeft = requested;
            await new Promise(requestAnimationFrame);
            const clip = viewport.getBoundingClientRect();
            const displacement = svg.getBoundingClientRect().left - frame.left;
            scrollExtremes.push({
              scrollLeft: viewport.scrollLeft,
              leftInset: Math.min(
                ...paintBounds.map((bounds) => bounds.left + displacement - clip.left),
              ),
              rightInset: Math.min(
                ...paintBounds.map((bounds) => clip.right - bounds.right - displacement),
              ),
            });
          }
          viewport.scrollLeft = 0;
          const fonts = [
            ...svg.querySelectorAll<SVGElement>('.nodeLabel, .edgeLabel text, span.edgeLabel'),
          ]
            .filter((element) => element.textContent?.trim())
            .map(
              (element) =>
                Number.parseFloat(getComputedStyle(element).fontSize) *
                Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b),
            );
          return {
            violations,
            scrollExtremes,
            scrollExtent: viewport.scrollWidth - viewport.clientWidth,
            minimumFont: Math.min(...fonts),
            pageOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            feedback: [feedback?.dataset.feedbackSource, feedback?.dataset.feedbackTarget],
            parallel,
            selfLoop: svg.querySelector('path[data-self-loop="right"]') !== null,
          };
        });
      await testInfo.attach('topology-canvas-geometry', {
        body: JSON.stringify(topology, null, 2),
        contentType: 'application/json',
      });
      expect(topology.violations).toEqual([]);
      expect(topology.scrollExtremes[0].scrollLeft).toBe(0);
      expect(topology.scrollExtremes[1].scrollLeft).toBe(topology.scrollExtent);
      expect(topology.scrollExtremes[0].leftInset).toBeGreaterThanOrEqual(16);
      expect(topology.scrollExtremes[1].rightInset).toBeGreaterThanOrEqual(16);
      // CSS layout quantizes the SVG width; allow only one 1/64px layout unit.
      expect(topology.minimumFont).toBeGreaterThanOrEqual(12 - 1 / 64);
      expect(topology.pageOverflow).toBe(0);
      expect(topology.feedback).toEqual(['E', 'B']);
      if (width === 960) {
        expect(topology.parallel).toEqual(['before', 'center', 'after']);
        expect(topology.selfLoop).toBe(true);
      }

      await page
        .locator(
          '#mermaid-cycle-fanout svg[aria-roledescription="flowchart-v2"] path[data-feedback-lane="outer"]',
        )
        .waitFor();
      const feedback = await page
        .locator('#mermaid-cycle-fanout svg[aria-roledescription="flowchart-v2"]')
        .evaluate(
          (svg, runNegativeControls) => {
            const outer = svg.querySelector<SVGPathElement>('path[data-feedback-lane="outer"]')!;
            const inner = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find(
              (path) => path.id.includes('-L_ER_Review_'),
            )!;
            const target = [...svg.querySelectorAll<SVGGElement>('g.node')].find((node) =>
              node.id.includes('-flowchart-Hub-'),
            )!;
            const shape = target.querySelector<SVGGeometryElement>(':scope > .label-container')!;
            const end = outer.getPointAtLength(outer.getTotalLength());
            const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(outer.getScreenCTM()!);
            const targetBox = shape.getBoundingClientRect();
            const shapeMatrix = shape.getScreenCTM()!;
            const inverseShapeMatrix = shapeMatrix.inverse();
            type Point = { x: number; y: number };
            const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
            const inside = (point: Point) =>
              shape.isPointInFill(
                new DOMPoint(point.x, point.y).matrixTransform(inverseShapeMatrix),
              );
            const perimeterCount = Math.ceil(
              shape.getTotalLength() * Math.hypot(shapeMatrix.a, shapeMatrix.b) * 10,
            );
            const perimeter = Array.from({ length: perimeterCount }, (_, index) =>
              shape
                .getPointAtLength((shape.getTotalLength() * index) / perimeterCount)
                .matrixTransform(shapeMatrix),
            );
            const nearest = (point: Point) =>
              perimeter.reduce((best, p) =>
                distance(point, p) < distance(point, best) ? p : best,
              );
            const terminal = (path: SVGPathElement, atEnd: boolean) => {
              const matrix = path.getScreenCTM()!;
              const scale = Math.hypot(matrix.a, matrix.b);
              const length = path.getTotalLength();
              const point = path.getPointAtLength(atEnd ? length : 0).matrixTransform(matrix);
              const adjacent = path
                .getPointAtLength(atEnd ? length - 0.25 / scale : 0.25 / scale)
                .matrixTransform(matrix);
              const magnitude = distance(point, adjacent);
              const sign = atEnd ? 1 : -1;
              const direction = {
                x: (sign * (point.x - adjacent.x)) / magnitude,
                y: (sign * (point.y - adjacent.y)) / magnitude,
              };
              const stroke = getComputedStyle(path);
              const visiblePaint =
                stroke.stroke !== 'none' &&
                parseFloat(stroke.strokeWidth) > 0 &&
                parseFloat(stroke.strokeOpacity) > 0 &&
                parseFloat(stroke.opacity) > 0;
              const shaftRadius =
                (parseFloat(stroke.strokeWidth) / 2) *
                (stroke.vectorEffect === 'non-scaling-stroke' ? 1 : scale);
              const markerId = path
                .getAttribute(atEnd ? 'marker-end' : 'marker-start')
                ?.match(/#([^)]*)/)?.[1];
              let forward = shaftRadius,
                lateral = shaftRadius,
                markerValid = !atEnd;
              if (markerId) {
                const marker = svg.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`);
                const markerShape = marker?.querySelector<SVGGeometryElement>('path');
                if (marker && markerShape) {
                  const box = markerShape.getBBox(),
                    view = marker.viewBox.baseVal;
                  const sx = marker.markerWidth.baseVal.value / view.width;
                  const sy = marker.markerHeight.baseVal.value / view.height;
                  const units =
                    marker.markerUnits.baseVal === 2 ? parseFloat(stroke.strokeWidth) : 1;
                  const markerStyle = getComputedStyle(markerShape);
                  const bleed =
                    (parseFloat(markerStyle.strokeWidth) / 2) *
                    (markerStyle.vectorEffect === 'non-scaling-stroke' ? 1 : scale * units * sx);
                  markerValid =
                    marker.getAttribute('orient') === 'auto' && Math.abs(sx - sy) < 0.001;
                  forward =
                    (box.x + box.width - marker.refX.baseVal.value) * sx * units * scale + bleed;
                  lateral =
                    Math.max(
                      Math.abs(box.y - marker.refY.baseVal.value),
                      Math.abs(box.y + box.height - marker.refY.baseVal.value),
                    ) *
                      sy *
                      units *
                      scale +
                    bleed;
                }
              }
              return {
                id: path.id,
                atEnd,
                point,
                direction,
                boundary: nearest(point),
                forward,
                lateral,
                markerValid,
                visiblePaint,
              };
            };
            const original = terminal(outer, true);
            const inwardAt = (point: Point, direction: Point) =>
              inside({ x: point.x + direction.x * 0.75, y: point.y + direction.y * 0.75 }) &&
              !inside({ x: point.x - direction.x * 0.75, y: point.y - direction.y * 0.75 });
            // Discover adjacent incoming AND outgoing paint from endpoints, not port datasets.
            const findNeighbors = () =>
              [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')]
                .filter((path) => path !== outer)
                .flatMap((path) => [terminal(path, false), terminal(path, true)])
                .filter(
                  (item) =>
                    distance(item.point, item.boundary) <= 8 &&
                    inwardAt(item.boundary, original.direction) &&
                    Math.abs(
                      (item.boundary.x - original.boundary.x) * original.direction.x +
                        (item.boundary.y - original.boundary.y) * original.direction.y,
                    ) < 0.2,
                );
            const inspectAttachment = () => {
              const item = terminal(outer, true);
              const neighbors = findNeighbors();
              const { point, direction, boundary } = item;
              const tangent = { x: -direction.y, y: direction.x };
              const rawGap =
                (boundary.x - point.x) * direction.x + (boundary.y - point.y) * direction.y;
              const perpendicularError = Math.abs(
                (boundary.x - point.x) * tangent.x + (boundary.y - point.y) * tangent.y,
              );
              const cardinal = Math.min(Math.abs(direction.x), Math.abs(direction.y)) < 0.001;
              const straightBoundary = [-1, 0, 1].every((sign) =>
                inwardAt(
                  {
                    x: boundary.x + tangent.x * sign * (item.lateral + 1),
                    y: boundary.y + tangent.y * sign * (item.lateral + 1),
                  },
                  direction,
                ),
              );
              const clearance = neighbors.map((neighbor) => ({
                id: neighbor.id,
                atEnd: neighbor.atEnd,
                separation:
                  Math.abs(
                    (neighbor.boundary.x - boundary.x) * tangent.x +
                      (neighbor.boundary.y - boundary.y) * tangent.y,
                  ) -
                  neighbor.lateral -
                  item.lateral,
                markerValid: neighbor.markerValid,
                visiblePaint: neighbor.visiblePaint,
                forward: neighbor.forward,
                lateral: neighbor.lateral,
              }));
              return {
                cardinal,
                inward: inwardAt(boundary, direction),
                straightBoundary,
                perpendicularError,
                markerValid: item.markerValid,
                paintedGap: rawGap - item.forward,
                nonconflicting: clearance.every((neighbor) => neighbor.separation > 1),
                clearance,
                endpoint: { x: point.x, y: point.y },
                boundary: { x: boundary.x, y: boundary.y },
              };
            };
            const neighbors = findNeighbors();
            const attachment = inspectAttachment();
            const negativeControls: Record<string, ReturnType<typeof inspectAttachment>> = {};
            let restoredAttachment: ReturnType<typeof inspectAttachment> | undefined;
            if (runNegativeControls) {
              // Mutate only this browser's rendered path, then restore it. The same
              // observer must reject real detached, tangential and colliding paint.
              const originalD = outer.getAttribute('d')!;
              const originalStyle = outer.getAttribute('style');
              // Do not measure the first frame of a CSS d transition as the mutation.
              outer.style.setProperty('transition', 'none', 'important');
              getComputedStyle(outer).transition;
              let collisionPath: SVGPathElement | undefined;
              const move = (dx: number, dy: number) => {
                const m = outer.getScreenCTM()!;
                const a = new DOMPoint(0, 0).matrixTransform(m.inverse());
                const b = new DOMPoint(dx, dy).matrixTransform(m.inverse());
                outer.setAttribute(
                  'd',
                  originalD.replace(/[MLQ][^MLQ]*/g, (command) => {
                    const coordinates = command.slice(1).trim().split(/[ ,]+/).map(Number);
                    return (
                      command[0] +
                      coordinates
                        .map((value, index) => value + (index % 2 ? b.y - a.y : b.x - a.x))
                        .join(' ') +
                      ' '
                    );
                  }),
                );
              };
              const restore = () => {
                outer.setAttribute('d', originalD);
              };
              try {
                move(-original.direction.x * 20, -original.direction.y * 20);
                negativeControls.detached = inspectAttachment();
                restore();
                outer.setAttribute('d', `${originalD} L ${end.x + 2} ${end.y}`);
                negativeControls.tangential = inspectAttachment();
                restore();
                outer.setAttribute('d', `${originalD} L ${end.x} ${end.y + 2}`);
                negativeControls.outward = inspectAttachment();
                restore();
                move(targetBox.left - original.point.x, 0);
                negativeControls.corner = inspectAttachment();
                restore();
                // Duplicate the rendered shaft and marker as real coincident SVG paint.
                collisionPath = outer.cloneNode(true) as SVGPathElement;
                collisionPath.id = 'collision-negative-control';
                outer.parentElement!.append(collisionPath);
                negativeControls.colliding = inspectAttachment();
              } finally {
                collisionPath?.remove();
                restore();
                getComputedStyle(outer).d;
                if (originalStyle === null) outer.removeAttribute('style');
                else outer.setAttribute('style', originalStyle);
                restoredAttachment = inspectAttachment();
              }
            }
            const sample = (path: SVGPathElement) => {
              const count = Math.ceil(path.getTotalLength() / 2) + 1;
              return Array.from({ length: count }, (_, index) =>
                path.getPointAtLength((path.getTotalLength() * index) / (count - 1)),
              );
            };
            const left = sample(outer).slice(1, -1);
            const right = sample(inner).slice(1, -1);
            const minimumDistance = Math.min(
              ...left.flatMap((a) => right.map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
            );
            const outerBox = outer.getBBox();
            const innerBox = inner.getBBox();
            return {
              source: outer.dataset.feedbackSource,
              target: outer.dataset.feedbackTarget,
              segments: Number(outer.dataset.manhattanSegments),
              outside:
                outerBox.x + outerBox.width > innerBox.x + innerBox.width + 20 &&
                outerBox.y + outerBox.height > innerBox.y + innerBox.height + 20,
              minimumDistance,
              marker: outer.getAttribute('marker-end'),
              attachment,
              neighbors: neighbors.map(({ id, atEnd, point, boundary }) => ({
                id,
                atEnd,
                point: { x: point.x, y: point.y },
                boundary: { x: boundary.x, y: boundary.y },
              })),
              negativeControls,
              restoredAttachment,
              targetCenterError: Math.abs(screenEnd.x - (targetBox.left + targetBox.right) / 2),
              targetGap:
                outer.dataset.feedbackTargetSide === 'top'
                  ? targetBox.top - screenEnd.y
                  : screenEnd.y - targetBox.bottom,
            };
          },
          width === 420 && appearance.name === 'light',
        );
      await testInfo.attach('feedback-attachment-geometry', {
        body: JSON.stringify(feedback, null, 2),
        contentType: 'application/json',
      });
      expect(feedback).toMatchObject({
        source: 'Review',
        target: 'Hub',
        outside: true,
      });
      expect(feedback.segments).toBeLessThanOrEqual(6);
      expect(feedback.minimumDistance).toBeGreaterThan(6);
      expect(feedback.marker).toContain('pointEnd');
      expect(feedback.attachment).toMatchObject({
        cardinal: true,
        inward: true,
        straightBoundary: true,
        markerValid: true,
        nonconflicting: true,
      });
      expect(feedback.attachment.perpendicularError).toBeLessThanOrEqual(0.2);
      expect(feedback.attachment.paintedGap).toBeGreaterThanOrEqual(4.65);
      expect(feedback.attachment.paintedGap).toBeLessThanOrEqual(5.35);
      if (feedback.neighbors.length === 0)
        expect(feedback.targetCenterError).toBeLessThanOrEqual(1);
      if (width === 420 && appearance.name === 'light') {
        expect(feedback.negativeControls.detached.paintedGap).toBeGreaterThan(5.35);
        expect(feedback.negativeControls.tangential.inward).toBe(false);
        expect(feedback.negativeControls.outward.inward).toBe(false);
        expect(feedback.negativeControls.corner.straightBoundary).toBe(false);
        expect(feedback.negativeControls.colliding.nonconflicting).toBe(false);
        const collision = feedback.negativeControls.colliding.clearance.find(
          ({ id }) => id === 'collision-negative-control',
        );
        expect(collision).toBeDefined();
        expect(collision!.separation).toBeLessThanOrEqual(0);
        expect(collision).toMatchObject({ markerValid: true, visiblePaint: true });
        expect(collision!.forward).toBeGreaterThan(0);
        expect(collision!.lateral).toBeGreaterThan(0);
        expect(feedback.restoredAttachment).toBeDefined();
        expect(feedback.restoredAttachment).toMatchObject({
          boundary: feedback.attachment.boundary,
          paintedGap: feedback.attachment.paintedGap,
          nonconflicting: true,
        });
        expect(
          feedback.restoredAttachment!.clearance.some(
            ({ id }) => id === 'collision-negative-control',
          ),
        ).toBe(false);
      }
      expect(feedback.targetGap).toBeGreaterThanOrEqual(0);
      expect(feedback.targetGap).toBeLessThanOrEqual(6);

      await page
        .locator('#mermaid-state svg.statediagram path[data-route-label]')
        .first()
        .waitFor({ state: 'attached' });
      const state = await page.locator('#mermaid-state svg.statediagram').evaluate((svg) => {
        const paths = [...svg.querySelectorAll<SVGPathElement>('path[data-route-label]')];
        const nodeBounds = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) =>
          node.getBoundingClientRect(),
        );
        const pathMatrix = paths[0]?.getScreenCTM() ?? new DOMMatrix();
        const nearNode = (x: number, y: number) => {
          const point = new DOMPoint(x, y).matrixTransform(pathMatrix);
          return nodeBounds.some(
            (bounds) =>
              point.x >= bounds.left - 16 &&
              point.x <= bounds.right + 16 &&
              point.y >= bounds.top - 16 &&
              point.y <= bounds.bottom + 16,
          );
        };
        const segments = paths.flatMap((path, pathIndex) => {
          const points = path.dataset.manhattanPoints!.split(' ').map((value) => {
            const [x, y] = value.split(',').map(Number);
            return { x, y };
          });
          return points.slice(1).map((end, index) => ({
            start: points[index],
            end,
            pathIndex,
            label: path.dataset.routeLabel,
          }));
        });
        const violations: string[] = [];
        for (let i = 0; i < segments.length; i += 1)
          for (let j = i + 1; j < segments.length; j += 1) {
            const a = segments[i];
            const b = segments[j];
            if (a.pathIndex === b.pathIndex) continue;
            const ah = a.start.y === a.end.y;
            const bh = b.start.y === b.end.y;
            const between = (value: number, one: number, two: number) =>
              value > Math.min(one, two) + 0.01 && value < Math.max(one, two) - 0.01;
            const horizontalOverlap =
              Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x)) -
              Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x));
            if (ah && bh && a.start.y === b.start.y && horizontalOverlap > 12)
              violations.push(`${a.label}/${b.label} shared-horizontal`);
            const verticalOverlap =
              Math.min(Math.max(a.start.y, a.end.y), Math.max(b.start.y, b.end.y)) -
              Math.max(Math.min(a.start.y, a.end.y), Math.min(b.start.y, b.end.y));
            if (!ah && !bh && a.start.x === b.start.x && verticalOverlap > 12)
              violations.push(`${a.label}/${b.label} shared-vertical`);
            if (ah !== bh) {
              const h = ah ? a : b;
              const v = ah ? b : a;
              if (
                between(v.start.x, h.start.x, h.end.x) &&
                between(h.start.y, v.start.y, v.end.y) &&
                !nearNode(v.start.x, h.start.y)
              )
                violations.push(`${a.label}/${b.label} crossing`);
            }
          }
        const placements = paths.map((path) => {
          const points = path.dataset.manhattanPoints!.split(' ').map((value) => {
            const [x, y] = value.split(',').map(Number);
            return { x, y };
          });
          const directions = points.slice(1).map((point, index) => {
            const dx = point.x - points[index].x;
            const dy = point.y - points[index].y;
            return Math.abs(dx) < 0.01 && Math.abs(dy) >= 0.01
              ? { x: 0, y: Math.sign(dy) }
              : Math.abs(dy) < 0.01 && Math.abs(dx) >= 0.01
                ? { x: Math.sign(dx), y: 0 }
                : null;
          });
          const cleanLegs = directions.every(
            (direction, index) =>
              direction &&
              (!index ||
                (directions[index - 1] &&
                  direction.x * directions[index - 1]!.x +
                    direction.y * directions[index - 1]!.y ===
                    0)),
          );
          let necessaryFive = false;
          let fiveLegEvidence;
          if (directions.length === 5 && cleanLegs) {
            // Read the rendered path independently of its Manhattan metadata.
            // Q controls recover rounded corners; consecutive collinear Ls
            // (including terminal trimming) are one geometric leg, not a turn.
            const actualPoints: { x: number; y: number }[] = [];
            const commands = path.getAttribute('d')!.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
            const supportedCommands = commands.every((command) => {
              const values = command.slice(1).trim().split(/[ ,]+/).map(Number);
              if (
                !['M', 'L', 'Q'].includes(command[0]) ||
                values.some((value) => !Number.isFinite(value))
              )
                return false;
              for (let index = 0; index < values.length; index += 2) {
                const point = { x: values[index], y: values[index + 1] };
                const a = actualPoints.at(-2),
                  b = actualPoints.at(-1);
                if (
                  a &&
                  b &&
                  ((Math.abs(a.x - b.x) < 0.01 &&
                    Math.abs(b.x - point.x) < 0.01 &&
                    (b.y - a.y) * (point.y - b.y) > 0) ||
                    (Math.abs(a.y - b.y) < 0.01 &&
                      Math.abs(b.y - point.y) < 0.01 &&
                      (b.x - a.x) * (point.x - b.x) > 0))
                )
                  actualPoints.pop();
                actualPoints.push(point);
              }
              return true;
            });
            const actualLegsMatch =
              supportedCommands &&
              actualPoints.length === 6 &&
              actualPoints.slice(1).every((point, index) => {
                const dx = point.x - actualPoints[index].x,
                  dy = point.y - actualPoints[index].y;
                const direction = directions[index]!;
                return direction.x
                  ? Math.abs(dy) < 0.01 && Math.sign(dx) === direction.x
                  : Math.abs(dx) < 0.01 && Math.sign(dy) === direction.y;
              });
            const matrix = path.getScreenCTM()!;
            const length = path.getTotalLength();
            const scale = Math.hypot(matrix.a, matrix.b);
            const count = Math.ceil(length * scale * 4);
            const samples = Array.from({ length: count + 1 }, (_, index) =>
              path.getPointAtLength((length * index) / count).matrixTransform(matrix),
            );
            const start = samples[0],
              end = samples.at(-1)!;
            const first = { x: samples[1].x - start.x, y: samples[1].y - start.y };
            const last = { x: end.x - samples.at(-2)!.x, y: end.y - samples.at(-2)!.y };
            const firstLength = Math.hypot(first.x, first.y),
              lastLength = Math.hypot(last.x, last.y);
            const sameDirection =
              Math.abs(first.x / firstLength - last.x / lastLength) < 0.01 &&
              Math.abs(first.y / firstLength - last.y / lastLength) < 0.01;
            // Same-direction terminal legs with opposite net displacement cannot
            // use 1 or 3 legs; 2/4 legs have perpendicular terminals. Five is the
            // geometric minimum, independent of route IDs or router metadata.
            const oppositeDisplacement =
              (end.x - start.x) * first.x + (end.y - start.y) * first.y < 0;
            const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
              id: node.id,
              shape: node.querySelector<SVGGeometryElement>(
                ':scope > .label-container, :scope > rect, :scope > circle',
              )!,
            }));
            const perimeterDistance = (shape: SVGGeometryElement, point: DOMPoint) => {
              const transform = shape.getScreenCTM()!;
              const perimeter = shape.getTotalLength();
              const steps = Math.ceil(perimeter * Math.hypot(transform.a, transform.b) * 8);
              let closest = Infinity;
              for (let index = 0; index <= steps; index++) {
                const edge = shape
                  .getPointAtLength((perimeter * index) / steps)
                  .matrixTransform(transform);
                closest = Math.min(closest, Math.hypot(edge.x - point.x, edge.y - point.y));
              }
              return closest;
            };
            const source = nodes.toSorted(
              (a, b) => perimeterDistance(a.shape, start) - perimeterDistance(b.shape, start),
            )[0];
            const target = nodes.find((node) => node.id === path.dataset.terminalTarget);
            const markerId = path.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
            const marker = markerId
              ? svg.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`)
              : null;
            const markerShape = marker?.querySelector<SVGPathElement>('path');
            // Measure the chevron's forward-most painted point from its actual
            // shape/reference point, not the router's stored terminal gap.
            let markerTip = NaN;
            if (
              marker &&
              markerShape &&
              marker.orientType.baseVal === SVGMarkerElement.SVG_MARKER_ORIENT_AUTO
            ) {
              const units =
                marker.markerUnits.baseVal === SVGMarkerElement.SVG_MARKERUNITS_STROKEWIDTH
                  ? Number.parseFloat(getComputedStyle(path).strokeWidth)
                  : 1;
              const zoom = marker.viewBox.baseVal.width
                ? marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width
                : 1;
              const box = markerShape.getBBox();
              const stroke = getComputedStyle(markerShape);
              const strokeScale =
                stroke.vectorEffect === 'non-scaling-stroke' ? 1 : scale * units * zoom;
              markerTip =
                (box.x + box.width - marker.refX.baseVal.value) * units * zoom * scale +
                (Number.parseFloat(stroke.strokeWidth) * strokeScale) / 2;
            }
            const targetGap = target ? perimeterDistance(target.shape, end) - markerTip : NaN;
            const inside = (node: typeof source, point: DOMPoint) =>
              node.shape.isPointInFill(point.matrixTransform(node.shape.getScreenCTM()!.inverse()));
            const entersTarget =
              target &&
              inside(
                target,
                new DOMPoint(end.x + (last.x / lastLength) * 8, end.y + (last.y / lastLength) * 8),
              );
            const clearsNodes = samples
              .slice(1, -1)
              .every((point) => nodes.every((node) => !inside(node, point)));
            const otherLabels = [
              ...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel'),
            ].filter((label) => label.textContent?.trim() && label.dataset.routePathId !== path.id);
            const clearsLabels = otherLabels.every((label) => {
              const b = label.getBoundingClientRect();
              return samples.every(
                (p) => p.x <= b.left || p.x >= b.right || p.y <= b.top || p.y >= b.bottom,
              );
            });
            const ownLabel = svg
              .querySelector<SVGGElement>(`.edgeLabel[data-route-path-id="${path.id}"]`)!
              .getBoundingClientRect();
            const labelClearsNodes = nodes.every(({ shape }) => {
              const b = shape.getBoundingClientRect();
              return (
                ownLabel.right <= b.left ||
                ownLabel.left >= b.right ||
                ownLabel.bottom <= b.top ||
                ownLabel.top >= b.bottom
              );
            });
            fiveLegEvidence = {
              actualLegsMatch,
              terminalDirections: [first, last],
              displacement: { x: end.x - start.x, y: end.y - start.y },
              sourceGap: perimeterDistance(source.shape, start),
              targetGap,
              clearsNodes,
              clearsLabels,
              labelClearsNodes,
            };
            necessaryFive =
              actualLegsMatch &&
              sameDirection &&
              oppositeDisplacement &&
              perimeterDistance(source.shape, start) <= 0.5 &&
              Boolean(entersTarget) &&
              Number.isFinite(targetGap) &&
              Math.abs(targetGap - 5) <= 0.35 &&
              clearsNodes &&
              clearsLabels &&
              labelClearsNodes;
          }
          const label = svg.querySelector<SVGGElement>(
            `.edgeLabel[data-route-path-id="${path.id}"]`,
          )!;
          const [x, y] = label.dataset.finalPathCenter!.split(',').map(Number);
          const [a, b] = path.dataset
            .labelSegment!.split(' ')
            .map((value) => value.split(',').map(Number));
          const horizontal = a[1] === b[1];
          const box = label.getBBox();
          const center = new DOMPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ).matrixTransform(label.getCTM()!);
          const expected = new DOMPoint(x, y).matrixTransform(path.getCTM()!);
          return {
            label: path.dataset.routeLabel,
            distance: Math.hypot(center.x - expected.x, center.y - expected.y),
            capacity: Number(path.dataset.labelCapacity),
            required: horizontal ? box.width : box.height,
            segments: directions.length,
            cleanLegs,
            necessaryFive,
            fiveLegEvidence,
            terminal: path.dataset.terminalTarget,
            marker: path.getAttribute('marker-end'),
          };
        });
        return { count: paths.length, violations, placements };
      });
      await testInfo.attach('state-route-geometry', {
        body: JSON.stringify(state, null, 2),
        contentType: 'application/json',
      });
      expect(state.count).toBe(10);
      expect(state.violations).toEqual([]);
      expect(
        state.placements.filter(
          (item) =>
            item.distance > 1 ||
            item.capacity < item.required ||
            !item.cleanLegs ||
            (item.segments > 4 && !item.necessaryFive) ||
            !item.terminal ||
            !item.marker?.includes('barbEnd'),
        ),
      ).toEqual([]);
      await page.locator('.catalog-topbar').evaluate((toolbar) => {
        toolbar.style.visibility = 'hidden';
      });
      for (const fixture of [
        'mermaid-flow',
        'mermaid-state',
        'mermaid-groups',
        'mermaid-nested-groups',
        'mermaid-nested-routing',
      ]) {
        const capture =
          fixture === 'mermaid-state'
            ? page.locator(`#${fixture} .mermaid-presentation`)
            : page.locator(`#${fixture}`);
        await capture.screenshot({
          path: testInfo.outputPath(`${fixture}-${appearance.name}-${width}.png`),
        });
      }
    });
  }
}

test('custom multiline edge labels keep their three-line clamp and full tooltip', async ({
  page,
}) => {
  const params = new URLSearchParams({
    state: 'custom-disconnected-extremes',
    theme: 'light',
    width: '320',
    motion: 'reduced',
  });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?${params}`);
  await page.locator('[data-preview-ready="true"]').waitFor();
  const root = page.locator('#custom-disconnected-extremes .diagram-renderer');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await page.evaluate(() => document.fonts.ready);

  const truncated = root.locator('.edge-label-container[data-truncated="true"]').first();
  await expect(truncated).toBeVisible();
  const metrics = await truncated.evaluate((foreignObject) => {
    const label = foreignObject.querySelector<HTMLElement>('.edge-label-html')!;
    const text = label.querySelector<HTMLElement>('.edge-label-text')!;
    const style = getComputedStyle(label);
    const oracle = document.createElement('div');
    Object.assign(oracle.style, {
      position: 'absolute',
      visibility: 'hidden',
      width: `${(foreignObject as SVGForeignObjectElement).width.baseVal.value}px`,
      boxSizing: 'border-box',
      padding: style.padding,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      whiteSpace: 'pre-line',
      overflowWrap: 'normal',
      wordBreak: 'normal',
    });
    oracle.textContent = text.textContent;
    document.body.append(oracle);
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const naturalLines = Math.round((oracle.getBoundingClientRect().height - padding) / lineHeight);
    oracle.remove();
    return {
      fullText: text.textContent!,
      accessibleText: label.getAttribute('aria-label'),
      naturalLines,
      renderedHeight: (foreignObject as SVGForeignObjectElement).height.baseVal.value,
      expectedHeight: 3 * lineHeight + padding,
    };
  });
  expect(metrics.naturalLines).toBeGreaterThan(3);
  expect(metrics.renderedHeight).toBeCloseTo(metrics.expectedHeight, 1);
  expect(metrics.accessibleText).toBe(metrics.fullText);

  await truncated.locator('.edge-label-html').hover();
  await expect(page.getByRole('tooltip')).toContainText(metrics.fullText);
});

test('keeps topology routes cardinal across live theme changes', async ({ page }) => {
  test.setTimeout(120_000);
  await openDiagram(page, 'mermaid-topology-stress', 960, appearances[0]);

  const assertSettledCardinalRoutes = async (previousId?: string) => {
    const svg = page.locator('#mermaid-topology-stress svg[data-layout-settled="true"]');
    if (previousId) await expect(svg).not.toHaveAttribute('id', previousId, { timeout: 90_000 });
    await expect
      .poll(
        () =>
          svg.evaluate((root) =>
            [...root.querySelectorAll<SVGPathElement>('.edgePaths path')].flatMap((path) => {
              const commands =
                path
                  .getAttribute('d')!
                  .match(/[MLQ][^MLQ]*/g)
                  ?.map((command) => ({
                    type: command[0],
                    values: command.slice(1).trim().split(/[ ,]+/).map(Number),
                  })) ?? [];
              let current = { x: 0, y: 0 };
              return commands.flatMap(({ type, values }) => {
                if (type === 'M') {
                  current = { x: values[0], y: values[1] };
                  return [];
                }
                const control = { x: values[0], y: values[1] };
                const end =
                  type === 'Q' ? { x: values[2], y: values[3] } : { x: values[0], y: values[1] };
                const cardinal =
                  (Math.abs(current.x - control.x) < 0.01 ||
                    Math.abs(current.y - control.y) < 0.01) &&
                  (type !== 'Q' ||
                    Math.abs(control.x - end.x) < 0.01 ||
                    Math.abs(control.y - end.y) < 0.01);
                current = end;
                return cardinal ? [] : [path.id];
              });
            }),
          ),
        { timeout: 90_000 },
      )
      .toEqual([]);
    return (await svg.getAttribute('id'))!;
  };

  let svgId = await assertSettledCardinalRoutes();
  await page.getByTestId('catalog-theme-control').getByText('Dark', { exact: true }).click();
  svgId = await assertSettledCardinalRoutes(svgId);
  await page.getByTestId('catalog-theme-control').getByText('Light', { exact: true }).click();
  svgId = await assertSettledCardinalRoutes(svgId);
  await page.getByTestId('catalog-color-theme-control').click();
  await page.getByRole('option', { name: 'Nord', exact: true }).click();
  await assertSettledCardinalRoutes(svgId);
});

for (const appearance of appearances) {
  for (const width of [960, 320] as const) {
    test(`custom walkthrough highlight · ${appearance.name} · ${width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
      const diagramUrl = (state: string) => {
        const params = new URLSearchParams({
          state,
          theme: appearance.theme,
          width: String(width),
          motion: 'reduced',
        });
        if (appearance.colorTheme) params.set('colorTheme', appearance.colorTheme);
        return `${baseUrl}/sandbox/diagram-workbench?${params}`;
      };
      await page.goto(diagramUrl('custom-walkthrough'));
      await expect(page.getByTestId('catalog-scene')).toHaveAttribute(
        'data-preview-ready',
        'true',
        {
          timeout: 30_000,
        },
      );
      const root = page.locator('#custom-walkthrough');
      await root.getByRole('button', { name: 'State 2: 2. Follow execution' }).click();
      await expect(root.locator('.diagram-renderer')).toHaveAttribute(
        'data-diagram-settled',
        'true',
      );
      const daemon = root.locator('[data-node-id="daemon"] .diagram-node-html');
      await expect(daemon).toHaveClass(/node-state-highlighted/);
      const highlight = await daemon.evaluate((node) => {
        const style = getComputedStyle(node);
        const frame = node.parentElement!.getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return {
          borderWidth: Number.parseFloat(style.borderWidth),
          borderStyle: style.borderStyle,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
          background: style.backgroundColor,
          contained:
            bounds.left >= frame.left &&
            bounds.right <= frame.right &&
            bounds.top >= frame.top &&
            bounds.bottom <= frame.bottom,
        };
      });
      expect(highlight).toMatchObject({
        borderStyle: 'none',
        outlineStyle: 'none',
        boxShadow: 'none',
        background: expect.not.stringMatching(/rgba\(0, 0, 0, 0\)|transparent/),
        contained: true,
      });
      expect(highlight.borderWidth).toBe(0);
      await page.evaluate(() => document.fonts.ready);
      const defaults = await root.locator('.diagram-renderer').evaluate(
        (renderer, runNegatives) => {
          const node = renderer.querySelector<HTMLElement>(
            '.diagram-node-html:not(.node-state-highlighted)',
          )!;
          const label = renderer.querySelector<HTMLElement>('.edge-label-html')!;
          const text = label.querySelector<HTMLElement>('.edge-label-text')!;
          const labelRange = document.createRange();
          labelRange.selectNodeContents(text);
          const labelBounds = label.getBoundingClientRect();
          const textBounds = labelRange.getBoundingClientRect();
          const edge = renderer.querySelector<SVGPathElement>('.edge-path')!;
          const markerId = edge.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
          const marker = markerId
            ? renderer.querySelector<SVGPathElement>(`marker[id="${markerId}"] path`)
            : null;
          const nodeStyle = getComputedStyle(node);
          const labelStyle = getComputedStyle(label);
          const labelFeatherStyle = getComputedStyle(label, '::before');
          const svg = renderer.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
          const matrix = svg.getScreenCTM()!;
          const scale = Math.hypot(matrix.a, matrix.b);
          const foreignObject = label.closest('foreignObject')!;
          const measurePadding = () => {
            const bounds = label.getBoundingClientRect();
            const lineBox = text.getBoundingClientRect();
            const frame = foreignObject.getBoundingClientRect();
            const style = getComputedStyle(label);
            const characters: DOMRect[] = [];
            const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
                if (!node.textContent![index].trim()) continue;
                const range = document.createRange();
                range.setStart(node, index);
                range.setEnd(node, index + 1);
                characters.push(...range.getClientRects());
              }
            }
            const contains = (outer: DOMRect, inner: DOMRect) =>
              inner.left >= outer.left &&
              inner.right <= outer.right &&
              inner.top >= outer.top &&
              inner.bottom <= outer.bottom;
            const lines = [...new Set(characters.map((rect) => rect.top))].map((top) => {
              const rects = characters.filter((rect) => rect.top === top);
              return {
                top,
                bottom: Math.max(...rects.map((r) => r.bottom)),
                left: Math.min(...rects.map((r) => r.left)),
                right: Math.max(...rects.map((r) => r.right)),
              };
            });
            return {
              top: (lineBox.top - bounds.top) / scale,
              bottom: (bounds.bottom - lineBox.bottom) / scale,
              cssTop: parseFloat(style.paddingTop),
              cssBottom: parseFloat(style.paddingBottom),
              textContained:
                characters.length > 0 &&
                characters.every((rect) => contains(bounds, rect) && contains(frame, rect)),
              textFits:
                text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight,
              unmasked: [label, text, foreignObject].every((element) => {
                const s = getComputedStyle(element);
                return s.clipPath === 'none' && s.maskImage === 'none';
              }),
              lines,
            };
          };
          const padding = measurePadding();
          const negativePadding: Record<string, ReturnType<typeof measurePadding>> = {};
          if (runNegatives) {
            const labelStyle = label.getAttribute('style'),
              textStyle = text.getAttribute('style');
            const restore = () => {
              for (const [element, style] of [
                [label, labelStyle],
                [text, textStyle],
              ] as const) {
                if (style === null) element.removeAttribute('style');
                else element.setAttribute('style', style);
              }
            };
            try {
              label.style.paddingTop = '2px';
              label.style.paddingBottom = '2px';
              label.style.height = `${labelBounds.height / scale - 4}px`;
              negativePadding.insufficient = measurePadding();
              restore();
              text.style.height = '2px';
              negativePadding.clipped = measurePadding();
              restore();
              text.style.transform = 'translateY(20px)';
              negativePadding.displaced = measurePadding();
            } finally {
              restore();
            }
          }
          return {
            nodeBorder: Number.parseFloat(nodeStyle.borderWidth),
            nodeBackground: nodeStyle.backgroundColor,
            nodeColor: nodeStyle.color,
            labelBackground: labelStyle.backgroundColor,
            labelFeatherBackground: labelFeatherStyle.backgroundColor,
            labelMask: labelFeatherStyle.webkitMaskImage || labelFeatherStyle.maskImage,
            horizontal:
              Math.min(textBounds.left - labelBounds.left, labelBounds.right - textBounds.right) /
              scale,
            padding,
            negativePadding,
            paintOrder: !!(
              edge.compareDocumentPosition(label.closest('foreignObject')!) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
            edgeStroke: getComputedStyle(edge).stroke,
            markerFill: marker?.getAttribute('fill'),
            markerStroke: marker?.getAttribute('stroke'),
          };
        },
        width === 320 && appearance.name === 'light',
      );
      expect(defaults).toMatchObject({
        nodeBorder: 0,
        paintOrder: true,
        markerFill: 'none',
        markerStroke: 'context-stroke',
      });
      expect(defaults.nodeBackground).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(defaults.edgeStroke).not.toBe(defaults.nodeColor);
      expect(defaults.labelBackground).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(defaults.labelFeatherBackground).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(defaults.labelMask).not.toBe('none');
      expect(defaults.horizontal).toBeGreaterThanOrEqual(5.9);
      const assertPadding = (padding: typeof defaults.padding) => {
        // CSS padding belongs to the line box, not font ascent/descent rectangles.
        expect(padding.top).toBeGreaterThanOrEqual(3.9);
        expect(padding.bottom).toBeGreaterThanOrEqual(3.9);
        expect(padding.cssTop).toBe(4);
        expect(padding.cssBottom).toBe(4);
        expect(padding.textContained).toBe(true);
        expect(padding.textFits).toBe(true);
        expect(padding.unmasked).toBe(true);
        expect(padding.lines.length).toBeGreaterThan(0);
      };
      await testInfo.attach('custom-padding-geometry', {
        body: JSON.stringify(
          { padding: defaults.padding, negative: defaults.negativePadding },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      assertPadding(defaults.padding);
      for (const [name, corrupted] of Object.entries(defaults.negativePadding)) {
        expect(() => assertPadding(corrupted), `Reject ${name} text geometry`).toThrow();
      }
      // Range rectangles contain font leading, not just ink. Compare actual pixels
      // with text overflow unclipped as an independent check that no glyphs are lost.
      const label = root.locator('.edge-label-html').first();
      const text = label.locator('.edge-label-text');
      const geometry = () =>
        text.evaluate((element) => {
          const label = element.closest<HTMLElement>('.edge-label-html')!;
          const foreignObject = label.closest('foreignObject')!;
          const rect = (item: Element) => {
            const bounds = item.getBoundingClientRect();
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
          };
          const range = document.createRange();
          range.selectNodeContents(element);
          const rangeBounds = range.getBoundingClientRect();
          return {
            label: rect(label),
            foreignObject: rect(foreignObject),
            range: {
              x: rangeBounds.x,
              y: rangeBounds.y,
              width: rangeBounds.width,
              height: rangeBounds.height,
            },
          };
        });
      const allowedGeometry = await geometry();
      const clipped = await label.screenshot();
      const originalStyle = await text.evaluate((element) => {
        const style = element.getAttribute('style');
        element.style.overflow = 'visible';
        return style;
      });
      try {
        const unclipped = await label.screenshot();
        await testInfo.attach('custom-label-clipped', { body: clipped, contentType: 'image/png' });
        await testInfo.attach('custom-label-unclipped', {
          body: unclipped,
          contentType: 'image/png',
        });
        expect(clipped.equals(unclipped), 'Text overflow must not hide visible glyph pixels').toBe(
          true,
        );
      } finally {
        await text.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }, originalStyle);
      }
      if (width === 960 && appearance.name === 'light') {
        const originalAllowanceStyle = await text.evaluate((element) => {
          const style = element.getAttribute('style');
          element.style.marginInline = '0px';
          element.style.paddingInline = '0px';
          return style;
        });
        try {
          const removedGeometry = await geometry();
          const removedHidden = await label.screenshot();
          await text.evaluate((element) => {
            element.style.overflow = 'visible';
          });
          const removedVisible = await label.screenshot();
          await testInfo.attach('custom-label-allowance-geometry', {
            body: JSON.stringify({ allowed: allowedGeometry, removed: removedGeometry }, null, 2),
            contentType: 'application/json',
          });
          await testInfo.attach('custom-label-allowance-removed-hidden', {
            body: removedHidden,
            contentType: 'image/png',
          });
          await testInfo.attach('custom-label-allowance-removed-visible', {
            body: removedVisible,
            contentType: 'image/png',
          });
          expect(
            removedHidden.equals(removedVisible),
            'Removing allowance must restore clipping',
          ).toBe(false);
          expect(removedGeometry.label).toEqual(allowedGeometry.label);
          expect(removedGeometry.foreignObject).toEqual(allowedGeometry.foreignObject);
          expect(removedGeometry.range).toEqual(allowedGeometry.range);
        } finally {
          await text.evaluate((element, style) => {
            if (style === null) element.removeAttribute('style');
            else element.setAttribute('style', style);
          }, originalAllowanceStyle);
        }
        expect(await geometry()).toEqual(allowedGeometry);
        expect(
          (await label.screenshot()).equals(clipped),
          'Allowance restoration must be exact',
        ).toBe(true);
      }
      await page.locator('.catalog-topbar').evaluate((toolbar) => {
        toolbar.style.visibility = 'hidden';
      });
      await root.locator('.diagram-renderer').screenshot({
        path: testInfo.outputPath(`custom-walkthrough-${appearance.name}-${width}.png`),
      });

      const architecture = page.locator('#custom-architecture');
      await architecture.getByRole('button', { name: 'State 2: 2. Follow the data' }).click();
      const notes = architecture.locator(
        '[data-node-id="notes"] .node-success.node-clickable.node-state-highlighted',
      );
      await page.keyboard.press('Tab');
      await notes.focus();
      await expect(notes).toBeFocused();
      const focus = await notes.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          focusVisible: node.matches(':focus-visible'),
          outlineWidth: Number.parseFloat(style.outlineWidth),
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
        };
      });
      expect(focus).toMatchObject({
        focusVisible: true,
        outlineStyle: 'solid',
        boxShadow: 'none',
      });
      expect(focus.outlineWidth).toBeGreaterThanOrEqual(1);
      expect(focus.outlineWidth).toBeLessThanOrEqual(2.3);
    });
  }
}
