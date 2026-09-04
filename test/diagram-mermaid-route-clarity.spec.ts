import { expect, test, type Page } from '@playwright/test';

type Appearance = { name: string; theme: 'light' | 'dark'; colorTheme?: 'nord' };
const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const appearances: Appearance[] = [
  { name: 'light', theme: 'light' },
  { name: 'dark', theme: 'dark' },
  { name: 'nord', theme: 'light', colorTheme: 'nord' },
];
const widths = [960, 640, 420, 320] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');
test.describe.configure({ mode: 'serial' });

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
        ['mermaid-flow', 'mermaid-state', 'mermaid-groups', 'mermaid-nested-groups'].map(
          (fixture) =>
            page
              .locator(`#${fixture} svg[data-layout-settled="true"]`)
              .waitFor({ timeout: 90_000 }),
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
                  'foreignObject.edge-label-surface, rect.background[data-label-padded]',
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
                const textStyle = getComputedStyle((text ?? htmlText)!);
                const background =
                  surface instanceof SVGRectElement ? style.fill : style.backgroundColor;
                const color = textStyle.fill === 'none' ? textStyle.color : textStyle.fill;
                const alpha = Number(background.match(/[\d.]+/g)?.[3] ?? 1);
                return {
                  text: label.textContent!.trim(),
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
                };
              }),
          );
        });
      expect(labelSurfaces.length).toBeGreaterThanOrEqual(12);
      expect(
        labelSurfaces.filter(
          (surface) =>
            surface.horizontal < 6 ||
            surface.vertical < 4 ||
            surface.alpha !== 1 ||
            surface.radius > 3 ||
            !surface.border ||
            !surface.shadow ||
            surface.contrast < 4.5,
        ),
      ).toEqual([]);

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

      await page
        .locator(
          '#mermaid-cycle-fanout svg[aria-roledescription="flowchart-v2"] path[data-feedback-lane="outer"]',
        )
        .waitFor();
      const feedback = await page
        .locator('#mermaid-cycle-fanout svg[aria-roledescription="flowchart-v2"]')
        .evaluate((svg) => {
          const outer = svg.querySelector<SVGPathElement>('path[data-feedback-lane="outer"]')!;
          const inner = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].find((path) =>
            path.id.includes('-L_ER_Review_'),
          )!;
          const target = [...svg.querySelectorAll<SVGGElement>('g.node')].find((node) =>
            node.id.includes('-flowchart-Hub-'),
          )!;
          const shape = target.querySelector<SVGGraphicsElement>(':scope > .label-container')!;
          const end = outer.getPointAtLength(outer.getTotalLength());
          const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(outer.getScreenCTM()!);
          const targetBox = shape.getBoundingClientRect();
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
            targetCenterError: Math.abs(screenEnd.x - (targetBox.left + targetBox.right) / 2),
            targetGap: screenEnd.y - targetBox.bottom,
          };
        });
      expect(feedback).toMatchObject({
        source: 'Review',
        target: 'Hub',
        segments: 4,
        outside: true,
      });
      expect(feedback.minimumDistance).toBeGreaterThan(6);
      expect(feedback.marker).toContain('pointEnd');
      expect(feedback.targetCenterError).toBeLessThanOrEqual(1);
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
            segments: Number(path.dataset.manhattanSegments),
            terminal: path.dataset.terminalTarget,
            marker: path.getAttribute('marker-end'),
          };
        });
        return { count: paths.length, violations, placements };
      });
      expect(state.count).toBe(10);
      expect(state.violations).toEqual([]);
      expect(
        state.placements.filter(
          (item) =>
            item.distance > 1 ||
            item.capacity < item.required ||
            item.segments > 4 ||
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
      ]) {
        await page.locator(`#${fixture}`).screenshot({
          path: testInfo.outputPath(`${fixture}-${appearance.name}-${width}.png`),
        });
      }
    });
  }
}

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
        borderStyle: 'solid',
        outlineStyle: 'none',
        boxShadow: 'none',
        background: expect.not.stringMatching(/rgba\(0, 0, 0, 0\)|transparent/),
        contained: true,
      });
      expect(highlight.borderWidth).toBeGreaterThanOrEqual(0.9);
      expect(highlight.borderWidth).toBeLessThanOrEqual(1.2);
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
