import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MERMAID_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
type State = keyof typeof MERMAID_WORKBENCH_CASES;

async function localRouteGeometry(root: Locator) {
  return root.locator('.mermaid-svg > svg').evaluate((svg: SVGSVGElement) => {
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
      const shape = node.querySelector<SVGGeometryElement>(
        ':scope > .label-container, :scope > rect, :scope > circle, :scope > .outer-path > path',
      )!;
      return {
        id: node.id,
        name: node.textContent?.trim(),
        bounds: shape.getBoundingClientRect().toJSON(),
        radius: { x: getComputedStyle(shape).rx, y: getComputedStyle(shape).ry },
        shape,
      };
    });
    const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
      .filter((label) => label.textContent?.trim())
      .map((label) => ({
        id: label.dataset.routePathId ?? label.querySelector('[data-id]')?.getAttribute('data-id'),
        text: label.textContent?.trim(),
        bounds: label.getBoundingClientRect().toJSON(),
      }));
    const routes = [
      ...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.transition[data-edge="true"]'),
    ].map((path) => {
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM()!;
      const count = Math.ceil(length * 2);
      const samples = Array.from({ length: count + 1 }, (_, index) =>
        path.getPointAtLength((length * index) / count).matrixTransform(matrix),
      );
      const end = samples.at(-1)!;
      const source = nodes.toSorted((a, b) => {
        const distance = (node: typeof a) =>
          Math.hypot(
            Math.max(node.bounds.left - samples[0].x, 0, samples[0].x - node.bounds.right),
            Math.max(node.bounds.top - samples[0].y, 0, samples[0].y - node.bounds.bottom),
          );
        return distance(a) - distance(b);
      })[0];
      const target =
        nodes.find((node) => node.id === path.dataset.terminalTarget) ??
        nodes.toSorted((a, b) => {
          const distance = (n: typeof a) =>
            Math.hypot(
              Math.max(n.bounds.left - end.x, 0, end.x - n.bounds.right),
              Math.max(n.bounds.top - end.y, 0, end.y - n.bounds.bottom),
            );
          return distance(a) - distance(b);
        })[0];
      const before = samples.at(-2)!;
      const norm = Math.hypot(end.x - before.x, end.y - before.y);
      let low = 0,
        high = 30;
      const enters = (distance: number) =>
        target.shape.isPointInFill(
          new DOMPoint(
            end.x + ((end.x - before.x) * distance) / norm,
            end.y + ((end.y - before.y) * distance) / norm,
          ).matrixTransform(target.shape.getScreenCTM()!.inverse()),
        );
      const rayEnters = Array.from({ length: 60 }, (_, i) => (i + 1) / 2).find(enters);
      if (rayEnters !== undefined) high = rayEnters;
      if (rayEnters !== undefined)
        for (let i = 0; i < 16; i++) {
          const mid = (low + high) / 2;
          if (enters(mid)) high = mid;
          else low = mid;
        }
      const points: { x: number; y: number }[] = path.dataset.manhattanPoints
        ? path.dataset.manhattanPoints.split(' ').map((text) => {
            const [x, y] = text.split(',').map(Number);
            return { x, y };
          })
        : path.dataset.points
          ? JSON.parse(atob(path.dataset.points))
          : [];
      const inside = (p: DOMPoint, b: DOMRect) =>
        p.x > b.left + 0.5 && p.x < b.right - 0.5 && p.y > b.top + 0.5 && p.y < b.bottom - 0.5;
      const perimeter = target.shape.getTotalLength();
      const gap =
        Math.min(
          ...Array.from({ length: 1024 }, (_, index) => {
            const p = target.shape
              .getPointAtLength((perimeter * index) / 1024)
              .matrixTransform(target.shape.getScreenCTM()!);
            return Math.hypot(p.x - end.x, p.y - end.y);
          }),
        ) - 0.5;
      const sourcePerimeter = source.shape.getTotalLength();
      const sourceGap = Math.min(
        ...Array.from({ length: 2048 }, (_, index) => {
          const point = source.shape
            .getPointAtLength((sourcePerimeter * index) / 2048)
            .matrixTransform(source.shape.getScreenCTM()!);
          return Math.hypot(point.x - samples[0].x, point.y - samples[0].y);
        }),
      );
      return {
        id: path.id,
        data: { ...path.dataset },
        points,
        d: path.getAttribute('d'),
        length,
        bends: (path.getAttribute('d')?.match(/Q/g) ?? []).length,
        target: target.name,
        source: source.name,
        gap,
        sourceGap,
        entersTarget: rayEnters !== undefined,
        marker: path.getAttribute('marker-end'),
        rayGap: high - 0.5,
        nodeHits: nodes
          .filter(
            (node) =>
              node !== source &&
              node !== target &&
              samples.some((p) =>
                node.shape.isPointInFill(p.matrixTransform(node.shape.getScreenCTM()!.inverse())),
              ),
          )
          .map((node) => node.name),
        labelHits: labels
          .filter(
            (label) =>
              label.id !== path.id &&
              !path.id.endsWith(`-${label.id}`) &&
              samples.some((p) => inside(p, label.bounds)),
          )
          .map((label) => label.text),
        samples: samples.map(({ x, y }) => ({ x, y })),
      };
    });
    return { nodes: nodes.map(({ shape: _shape, ...node }) => node), labels, routes };
  });
}

type PaintedPoint = { x: number; y: number };
function paintedCrossings(a: PaintedPoint[], b: PaintedPoint[]) {
  const lines = (points: PaintedPoint[]) => {
    const result: { start: PaintedPoint; end: PaintedPoint }[] = [];
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1],
        end = points[i],
        last = result.at(-1);
      if (
        last &&
        Math.abs(
          (last.end.x - last.start.x) * (end.y - start.y) -
            (last.end.y - last.start.y) * (end.x - start.x),
        ) < 1e-6
      )
        last.end = end;
      else result.push({ start, end });
    }
    return result;
  };
  const other = lines(b);
  return lines(a).some(({ start: p, end: q }) =>
    other.some(({ start: r, end: s }) => {
      const dx = q.x - p.x,
        dy = q.y - p.y,
        ex = s.x - r.x,
        ey = s.y - r.y;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-8) return false;
      const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / denominator;
      const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / denominator;
      return t > 0 && t < 1 && u > 0 && u < 1;
    }),
  );
}

for (const crossing of ['none', 'trunk', 'shelf'] as const) {
  test(`optional local shortening requires a feedback ${crossing} crossing`, async ({ page }) => {
    await open(page, 'mermaid-topology-stress', 960, false);
    const result = await page.evaluate(async (crossing) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const helpers = await import(/* @vite-ignore */ modulePath);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '500');
      svg.setAttribute('height', '500');
      svg.setAttribute('aria-roledescription', 'flowchart-v2');
      const route =
        crossing === 'shelf'
          ? '150,140 150,220 70,220 70,150 240,150 240,270 150,270 150,300'
          : `150,140 150,190 ${crossing === 'trunk' ? 30 : 240},190 ${crossing === 'trunk' ? 30 : 240},260 150,260 150,300`;
      svg.innerHTML = `<g class="nodes"><g class="node" id="flowchart-A-1"><rect class="label-container" x="100" y="100" width="100" height="40"/></g><g class="node" id="flowchart-B-2"><rect class="label-container" x="100" y="300" width="100" height="40"/></g><g class="node" id="flowchart-C-3"><rect class="label-container" x="300" y="400" width="40" height="40"/></g></g>
        <g class="edgePaths"><path id="test-L_A_B_0" data-manhattan-points="${route}"/>
        <path id="test-L_C_A_0" data-feedback-lane="outer" data-manhattan-points="300,420 50,420 50,170 126,170 126,140"/></g><g class="edgeLabels"/>`;
      for (const path of svg.querySelectorAll<SVGPathElement>('path'))
        path.setAttribute(
          'd',
          path.dataset
            .manhattanPoints!.split(' ')
            .map((p, i) => `${i ? 'L' : 'M'}${p}`)
            .join(''),
        );
      document.body.append(svg);
      try {
        const path = svg.querySelector<SVGPathElement>('#test-L_A_B_0')!;
        const feedback = svg.querySelector<SVGPathElement>('#test-L_C_A_0')!;
        const sample = (path: SVGPathElement) => {
          const length = path.getTotalLength();
          return {
            d: path.getAttribute('d'),
            length,
            samples: Array.from({ length: 1001 }, (_, i) => {
              const p = path.getPointAtLength((length * i) / 1000);
              return { x: p.x, y: p.y };
            }),
          };
        };
        const before = sample(path),
          fixed = sample(feedback);
        helpers.repairFlowchartRouteClearance(svg);
        return { before, after: sample(path), fixed, feedbackAfter: sample(feedback) };
      } finally {
        svg.remove();
      }
    }, crossing);
    expect(paintedCrossings(result.before.samples, result.fixed.samples)).toBe(crossing !== 'none');
    expect(paintedCrossings(result.after.samples, result.fixed.samples)).toBe(false);
    expect(result.feedbackAfter).toEqual(result.fixed);
    if (crossing === 'none') expect(result.after).toEqual(result.before);
    else expect(result.after.length).toBeLessThan(result.before.length - 1);
  });
}

for (const state of ['mermaid-topology-stress', 'mermaid-state'] as const) {
  for (const width of [420, 960]) {
    test(`short local routes in ${state} at ${width}px`, async ({ page }, info) => {
      const { root, hashes } = await open(page, state, width, false);
      const result = await localRouteGeometry(root);
      await writeFile(
        info.outputPath('local-routes.json'),
        JSON.stringify(
          { hashes, source: MERMAID_WORKBENCH_CASES[state].source, ...result },
          null,
          2,
        ),
      );
      await writeFile(
        info.outputPath('snapshot.svg'),
        await root.locator('.mermaid-svg > svg').evaluate((svg) => svg.outerHTML),
      );
      await root
        .locator('.mermaid-presentation')
        .screenshot({ path: info.outputPath('routes.png') });
      if (state === 'mermaid-topology-stress') {
        const success = result.routes.find((route) => /-L_B_C_0$/.test(route.id))!;
        const feedback = result.routes.find((route) => /-L_E_B_0$/.test(route.id))!;
        const trunk = feedback.points
          .slice(1)
          .map((end, index) => ({ start: feedback.points[index], end }))
          .filter(({ start, end }) => Math.abs(start.x - end.x) < 0.01)
          .toSorted((a, b) => Math.abs(b.end.y - b.start.y) - Math.abs(a.end.y - a.start.y))[0];
        const crossesTrunk = success.points.slice(1).some((end, index) => {
          const start = success.points[index];
          return (
            Math.abs(start.y - end.y) < 0.01 &&
            Math.min(start.x, end.x) < trunk.start.x &&
            Math.max(start.x, end.x) > trunk.start.x &&
            start.y > Math.min(trunk.start.y, trunk.end.y) &&
            start.y < Math.max(trunk.start.y, trunk.end.y)
          );
        });
        expect(crossesTrunk).toBe(false);
        expect(paintedCrossings(success.samples, feedback.samples)).toBe(false);
        expect(success.source).toBe('Router');
        expect(success.target).toBe('Accepted');
        expect(feedback.target).toBe('Router');
        expect(success.nodeHits).toEqual([]);
        expect(feedback.nodeHits).toEqual([]);
        expect(success.labelHits).toEqual([]);
        expect(feedback.labelHits).toEqual([]);
        if (width === 960) {
          expect(success.length).toBeLessThan(200);
          expect(success.bends).toBeGreaterThan(0);
          expect(feedback.data.feedbackTargetSide).toBe('bottom');
        }
        expect(success.gap).toBeGreaterThanOrEqual(4.65);
        expect(success.gap).toBeLessThanOrEqual(5.35);
      } else {
        const failure = result.routes.find((route) => route.data.routeLabel === 'Stream fails')!;
        const idle = result.nodes.find((node) => node.name === 'Idle')!;
        expect(Math.min(...failure.samples.map((point) => point.y))).toBeGreaterThan(
          idle.bounds.bottom,
        );
        expect(failure.labelHits).toEqual([]);
        expect(failure.nodeHits).toEqual([]);
        expect(failure.source).toBe('Streaming');
        expect(failure.target).toBe('Failed');
        for (const other of result.routes.filter((route) => route !== failure))
          expect(paintedCrossings(failure.samples, other.samples), other.data.routeLabel).toBe(
            false,
          );
        if (width === 960) expect(failure.length).toBeLessThan(900);
        expect(failure.gap).toBeGreaterThanOrEqual(4.65);
        expect(failure.gap).toBeLessThanOrEqual(5.35);
      }
    });
  }
}

for (const contract of [
  {
    name: 'rounded corner',
    rx: 16,
    ry: 16,
    width: 60,
    y: 109,
    transform: 'scale(1)',
    state: true,
    rounded: true,
  },
  {
    name: 'straight side',
    rx: 16,
    ry: 16,
    width: 60,
    y: 118,
    transform: 'scale(1)',
    state: true,
    rounded: true,
  },
  {
    name: 'scaled corner',
    rx: 16,
    ry: 16,
    width: 60,
    y: 109,
    transform: 'scale(1.7)',
    state: true,
    rounded: true,
  },
  {
    name: 'clamped radius',
    rx: 100,
    ry: 100,
    width: 36,
    y: 109,
    transform: 'scale(1)',
    state: true,
    rounded: true,
  },
  {
    name: 'equal screen radii',
    rx: 16,
    ry: 8,
    width: 60,
    y: 104.5,
    transform: 'scale(1,2)',
    state: true,
    rounded: true,
  },
  {
    name: 'elliptical guard',
    rx: 16,
    ry: 8,
    width: 60,
    y: 109,
    transform: 'scale(1)',
    state: true,
    rounded: false,
  },
  {
    name: 'skew guard',
    rx: 16,
    ry: 16,
    width: 60,
    y: 109,
    transform: 'skewX(12)',
    state: true,
    rounded: false,
  },
  {
    name: 'non-state guard',
    rx: 16,
    ry: 16,
    width: 60,
    y: 109,
    transform: 'scale(1)',
    state: false,
    rounded: false,
  },
]) {
  test(`state terminal distance preserves ${contract.name}`, async ({ page }) => {
    await open(page, 'mermaid-state', 420, false);
    const result = await page.evaluate(async (contract) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const helpers = await import(/* @vite-ignore */ modulePath);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '600');
      svg.setAttribute('height', '600');
      if (contract.state) svg.classList.add('statediagram');
      svg.innerHTML = `<defs><marker id="gap-control" data-diagram-chevron="true"><path d="M-3,-3L0,0L-3,3" stroke="black" stroke-width="1" fill="none"/></marker></defs>
        <g transform="translate(20,20) ${contract.transform}"><g class="node" id="gap-target"><rect class="label-container" x="100" y="100" width="${contract.width}" height="36" rx="${contract.rx}" ry="${contract.ry}"/></g>
        <g class="edgePaths"><path d="M50,${contract.y}L100,${contract.y}" marker-end="url(#gap-control)" data-terminal-target="gap-target" data-manhattan-points="50,${contract.y} 100,${contract.y}"/></g></g>`;
      document.body.append(svg);
      try {
        const path = svg.querySelector<SVGPathElement>('.edgePaths path')!;
        const rect = svg.querySelector('rect')!;
        const results = [];
        for (let i = 0; i < 3; i++) {
          helpers.applyMermaidTerminalGaps(svg);
          const p = path
            .getPointAtLength(path.getTotalLength())
            .matrixTransform(path.getScreenCTM()!);
          const perimeter = rect.getTotalLength(),
            matrix = rect.getScreenCTM()!;
          const actualGap =
            Math.min(
              ...Array.from({ length: 4096 }, (_, index) => {
                const q = rect.getPointAtLength((perimeter * index) / 4096).matrixTransform(matrix);
                return Math.hypot(p.x - q.x, p.y - q.y);
              }),
            ) - 0.5;
          const b = rect.getBoundingClientRect();
          const legacyGap =
            Math.hypot(
              Math.max(b.left - p.x, 0, p.x - b.right),
              Math.max(b.top - p.y, 0, p.y - b.bottom),
            ) - 0.5;
          results.push({ actualGap, legacyGap, d: path.getAttribute('d') });
        }
        return results;
      } finally {
        svg.remove();
      }
    }, contract);
    for (const sample of result)
      expect(
        Math.abs((contract.rounded ? sample.actualGap : sample.legacyGap) - 5),
      ).toBeLessThanOrEqual(0.35);
    expect(result[2].d).toBe(result[0].d);
  });
}

for (const blocker of ['none', 'node', 'label', 'route', 'port'] as const) {
  test(`feedback inside slot respects ${blocker} occupancy`, async ({ page }) => {
    await open(page, 'mermaid-topology-stress', 960, false);
    const result = await page.evaluate(async (blocker) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const helpers = await import(/* @vite-ignore */ modulePath);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '500');
      svg.setAttribute('height', '500');
      svg.innerHTML = `<g class="nodes"><g class="node" id="flowchart-Target-1"><rect class="label-container" x="100" y="100" width="100" height="40" rx="16" ry="16"/></g><g class="node" id="flowchart-Source-2"><rect class="label-container" x="240" y="300" width="40" height="40"/></g></g>
        <g class="edgePaths"><path id="test-L_Source_Target_0" data-feedback-lane="outer" data-feedback-source="Source" data-feedback-target="Target" data-manhattan-points="280,320 320,320 320,400 50,400 50,170 150,170 150,140"/>
        <path id="test-L_Target_A_0" data-manhattan-points="142,140 142,200 200,200"/><path id="test-L_Target_B_0" data-manhattan-points="158,140 158,200 230,200"/></g><g class="edgeLabels"/>`;
      const add = (selector: string, html: string) =>
        svg.querySelector(selector)!.insertAdjacentHTML('beforeend', html);
      if (blocker === 'node')
        add(
          '.nodes',
          '<g class="node"><rect class="label-container" x="121" y="146" width="10" height="10"/></g>',
        );
      if (blocker === 'label')
        add(
          '.edgeLabels',
          '<g class="edgeLabel"><text x="120" y="160" font-size="10">x</text></g>',
        );
      if (blocker === 'route')
        add('.edgePaths', '<path id="test-L_X_Y_0" data-manhattan-points="122,150 130,150"/>');
      if (blocker === 'port')
        add(
          '.edgePaths',
          '<path id="test-L_Target_C_0" data-manhattan-points="110,140 110,150"/><path id="test-L_Target_D_0" data-manhattan-points="150,140 150,150"/>',
        );
      document.body.append(svg);
      try {
        const path = svg.querySelector<SVGPathElement>('path[data-feedback-lane]')!;
        const result = [];
        for (let i = 0; i < 3; i++) {
          helpers.snapFlowchartFeedbackPorts(svg);
          helpers.roundOrthogonalBends(svg);
          const points = path.dataset
            .manhattanPoints!.split(' ')
            .map((p) => p.split(',').map(Number));
          result.push({
            points,
            length: path.getTotalLength(),
            side: path.dataset.feedbackTargetSide,
          });
        }
        return result;
      } finally {
        svg.remove();
      }
    }, blocker);
    expect(result[2].points).toEqual(result[0].points);
    expect(result[0].side).toBe(blocker === 'port' ? 'top' : 'bottom');
    const port = result[0].points.at(-1)!;
    if (blocker === 'none') {
      expect(port[0]).toBeGreaterThanOrEqual(116);
      expect(142 - port[0]).toBeGreaterThanOrEqual(16);
    } else expect(port[0]).toBe(150);
    expect(result[0].points.slice(0, 4)).toEqual([
      [280, 320],
      [320, 320],
      [320, 400],
      [50, 400],
    ]);
  });
}

for (const state of ['mermaid-topology-stress', 'mermaid-state'] as const) {
  test(`shortened ${state} routes survive postprocessing and narrow-wide-narrow resize`, async ({
    page,
  }, info) => {
    const check = expect.configure({ soft: true });
    const results = [];
    const { root } = await open(page, state, 420, true);
    let priorWidth = 420;
    for (const width of [420, 960, 420]) {
      const priorSvgId = await root.locator('.mermaid-svg > svg').getAttribute('id');
      await page.locator('#routing-note-host').evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, width);
      await expect
        .poll(() => root.locator('.mermaid-renderer').evaluate((e) => e.clientWidth <= 620))
        .toBe(width === 420);
      if (width !== priorWidth) {
        await expect(root.locator('.mermaid-svg > svg')).not.toHaveAttribute('id', priorSvgId!);
      }
      priorWidth = width;
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      await settled(page, root);
      // Preserved pre-change narrow SVG: source starts at the left edge, one
      // quarter down its bounds. #4771 records the existing rounded-corner gap.
      // Compare against that attachment, not a newly invented absolute gap limit.
      const baselineSource =
        state === 'mermaid-state' && width === 420
          ? await root.locator('.mermaid-svg > svg').evaluate((svg: SVGSVGElement) => {
              const node = [...svg.querySelectorAll<SVGGElement>('g.node')].find(
                (node) => node.textContent?.trim() === 'Streaming',
              )!;
              const shape = node.querySelector<SVGGeometryElement>('.label-container')!;
              const bounds = shape.getBoundingClientRect();
              const start = { x: bounds.left, y: bounds.top + bounds.height / 4 };
              const perimeter = shape.getTotalLength();
              const gap = Math.min(
                ...Array.from({ length: 2048 }, (_, i) => {
                  const point = shape
                    .getPointAtLength((perimeter * i) / 2048)
                    .matrixTransform(shape.getScreenCTM()!);
                  return Math.hypot(point.x - start.x, point.y - start.y);
                }),
              );
              return { start, gap };
            })
          : undefined;
      for (let repeat = 0; repeat < 3; repeat++) {
        if (repeat)
          await root.locator('.mermaid-svg > svg').evaluate(async (svg: SVGSVGElement) => {
            const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
            const helpers = await import(/* @vite-ignore */ modulePath);
            if (svg.classList.contains('statediagram'))
              helpers.placeStateLabelsOnFinalRoutes(svg, svg.getBoundingClientRect().width <= 620);
            else {
              helpers.snapFlowchartPorts(svg);
              helpers.snapFlowchartFanoutPorts(svg);
              helpers.snapFlowchartFeedbackPorts(svg);
              helpers.routeFlowchartClientRequestLane(svg);
              helpers.snapFlowchartDiamondPorts(svg);
              const labels = helpers.repairFlowchartRouteClearance(svg);
              helpers.roundOrthogonalBends(svg);
              helpers.repairFlowchartLabelClearance(svg, labels);
              helpers.alignMermaidOpenArrowheads(svg);
            }
            helpers.applyMermaidTerminalGaps(svg);
          });
        const geometry = await localRouteGeometry(root);
        const route = geometry.routes.find((r) =>
          state === 'mermaid-state' ? r.data.routeLabel === 'Stream fails' : /-L_B_C_0$/.test(r.id),
        )!;
        const feedback = geometry.routes.find((r) => /-L_E_B_0$/.test(r.id));
        results.push({ state, width, repeat, route, feedback, baselineSource });
        await writeFile(info.outputPath('repeated-routes.json'), JSON.stringify(results, null, 2));
        check(route.nodeHits).toEqual([]);
        check(route.labelHits).toEqual([]);
        check(Math.abs(route.gap - 5)).toBeLessThanOrEqual(0.35);
        if (baselineSource) {
          check(
            Math.hypot(
              route.samples[0].x - baselineSource.start.x,
              route.samples[0].y - baselineSource.start.y,
            ),
          ).toBeLessThan(0.01);
          check(Math.abs(route.sourceGap - baselineSource.gap)).toBeLessThan(0.01);
        } else check(route.sourceGap).toBeLessThan(0.5);
        check(route.entersTarget).toBe(true);
        check(route.source).toBe(state === 'mermaid-state' ? 'Streaming' : 'Router');
        check(route.target).toBe(state === 'mermaid-state' ? 'Failed' : 'Accepted');
        if (state === 'mermaid-topology-stress') expect(feedback).toBeTruthy();
        if (feedback) {
          check(paintedCrossings(route.samples, feedback.samples)).toBe(false);
          check(feedback.nodeHits).toEqual([]);
          check(feedback.labelHits).toEqual([]);
          check(Math.abs(feedback.gap - 5)).toBeLessThanOrEqual(0.35);
          check(feedback.sourceGap).toBeLessThan(0.5);
          check(feedback.entersTarget).toBe(true);
          check(feedback.source).toBe('Audit');
          check(feedback.target).toBe('Router');
        }
        const prior = results.slice(0, -1).find((result) => result.width === width);
        if (prior) {
          // The external invariant is final paint, not intermediate Manhattan
          // metadata before cached terminal-gap restoration.
          for (const [current, previous] of [
            [route, prior.route],
            [feedback, prior.feedback],
          ]) {
            if (!current || !previous) continue;
            check(Math.abs(current.sourceGap - previous.sourceGap)).toBeLessThan(0.01);
            check(current.samples.length).toBe(previous.samples.length);
            if (current.samples.length === previous.samples.length) {
              check(
                Math.max(
                  ...current.samples.map((point, index) =>
                    Math.hypot(
                      point.x - previous.samples[index].x,
                      point.y - previous.samples[index].y,
                    ),
                  ),
                ),
              ).toBeLessThan(0.01);
            }
          }
        }
      }
    }
  });
}

test('state detour retains its safe exterior when the local departure is obstructed', async ({
  page,
}, info) => {
  const { root } = await open(page, 'mermaid-state', 960, false);
  const result = await root
    .locator('.mermaid-svg > svg')
    .evaluate(async (original: SVGSVGElement) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const helpers = await import(/* @vite-ignore */ modulePath);
      const svg = original.cloneNode(true) as SVGSVGElement;
      original.parentElement!.append(svg);
      try {
        helpers.rewriteStateRoutes(svg, false);
        const path = svg.querySelector<SVGPathElement>('path[data-route-label="Stream fails"]')!;
        const before = { points: path.dataset.manhattanPoints, length: path.getTotalLength() };
        const source = [...svg.querySelectorAll<SVGGElement>('g.node')].find(
          (n) => n.textContent?.trim() === 'Streaming',
        )!;
        const shape = source.querySelector<SVGGraphicsElement>('.label-container')!;
        const matrix = path.getScreenCTM()!.inverse().multiply(shape.getScreenCTM()!);
        const b = shape.getBBox();
        const p = new DOMPoint(b.x, b.y).matrixTransform(matrix);
        const walls = [
          { x: p.x - 24, y: p.y - 80, width: 16, height: b.height + 112 },
          { x: p.x + b.width + 8, y: p.y - 80, width: 16, height: b.height + 112 },
          { x: p.x - 24, y: p.y + b.height + 8, width: b.width + 48, height: 16 },
        ].map((b) => {
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          group.setAttribute('class', 'node');
          const rect = document.createElementNS(group.namespaceURI, 'rect') as SVGRectElement;
          rect.setAttribute('class', 'label-container');
          for (const [key, value] of Object.entries(b)) rect.setAttribute(key, String(value));
          group.append(rect);
          path.parentElement!.append(group);
          return rect;
        });
        helpers.placeStateLabelsOnFinalRoutes(svg, false);
        const hits = walls.map((rect) =>
          Array.from({ length: 2048 }, (_, i) => {
            const p = path
              .getPointAtLength((path.getTotalLength() * i) / 2047)
              .matrixTransform(path.getScreenCTM()!)
              .matrixTransform(rect.getScreenCTM()!.inverse());
            return rect.isPointInFill(p);
          }).some(Boolean),
        );
        return {
          before,
          after: { points: path.dataset.manhattanPoints, length: path.getTotalLength() },
          hits,
        };
      } finally {
        svg.remove();
      }
    });
  await writeFile(info.outputPath('blocked-state.json'), JSON.stringify(result, null, 2));
  expect(result.after).toEqual(result.before);
  expect(result.hits).toEqual([false, false, false]);
});

async function open(
  page: Page,
  state: State,
  width: number,
  note: boolean,
  theme = 'light',
  motion: 'reduced' | 'full' = 'reduced',
) {
  const names = ['MermaidRenderer.svelte', 'mermaid-path-geometry.ts'];
  const responses = names.map((name) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith(`/markdown/${name}`) && !url.searchParams.has('type');
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=${theme}&width=${width}&motion=${motion}`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const hashes: Record<string, string> = {};
  for (const [index, pending] of responses.entries()) {
    const body = await (await pending).text();
    const encoded = body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const map = JSON.parse(Buffer.from(encoded!, 'base64').toString());
    const source =
      map.sourcesContent[map.sources.findIndex((s: string) => s.endsWith(names[index]))];
    expect(source).toBe(await readFile(`src/lib/components/markdown/${names[index]}`, 'utf8'));
    hashes[names[index]] = createHash('sha256').update(source).digest('hex');
  }
  const ready = await page.evaluate(() => window.__INTENT_PREVIEW__.current());
  expect(ready).toMatchObject({ state, status: 'ready' });
  if (note) {
    await page.evaluate(
      async ({ source, width }) => {
        const [{ mount }, { default: NoteWithComments }] = await Promise.all([
          import('/@id/svelte'),
          import('/src/lib/components/workspace/NoteWithComments.svelte'),
        ]);
        const host = document.createElement('div');
        host.id = 'routing-note-host';
        host.style.cssText = `width:${width}px;height:1000px;margin-left:80px`;
        document.body.replaceChildren(host);
        mount(NoteWithComments, {
          target: host,
          props: {
            workspace: {
              id: 'routing-test',
              title: 'Routing',
              branch: 'test',
              changesets: [],
              timeline: [],
              conversationInfo: [],
              status: 'Active',
              createdAt: '2026-09-11T00:00:00Z',
              updatedAt: '2026-09-11T00:00:00Z',
            },
            content: `## Routes\n\nAdjacent prose.\n\n~~~mermaid\n${source}\n~~~\n\nFollowing prose.`,
            editable: true,
            showSuggestions: false,
            showComments: true,
          },
        });
      },
      { source: MERMAID_WORKBENCH_CASES[state].source, width },
    );
  }
  const root = page.locator(note ? '.node-mermaidBlock' : `#${state}`);
  await settled(page, root);
  return { root, hashes, ready };
}

async function settled(page: Page, root: Locator) {
  await page.evaluate(() => document.fonts.ready);
  await expect(root.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  await expect(root.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
}

for (const width of [420, 960]) {
  test(`state recovery approaches stay separate at ${width}px through repeat fits`, async ({
    page,
  }, info) => {
    const { root, hashes } = await open(page, 'mermaid-state-recovery', width, false, 'dark');
    const results = [];
    for (const currentWidth of [width, width === 420 ? 960 : 420, width]) {
      if (results.length) {
        const renderer = root.locator('.mermaid-renderer');
        const generation = await renderer.getAttribute('data-render-generation');
        await page.getByTestId('catalog-scene-focus').evaluate((host, value) => {
          host.style.width = `${value}px`;
        }, currentWidth);
        await expect(renderer).not.toHaveAttribute('data-render-generation', generation);
        await settled(page, root);
      }
      const geometry = await localRouteGeometry(root);
      const approaches = geometry.routes.filter(
        (route) =>
          route.target === 'Running' || (route.source === 'Running' && route.target === 'Failed'),
      );
      const separations = approaches.flatMap((route, index) =>
        approaches.slice(index + 1).map((other) => ({
          pair: [route.id, other.id],
          crossing: paintedCrossings(route.samples, other.samples),
          distance: Math.sqrt(
            route.samples.reduce(
              (nearest, a) =>
                other.samples.reduce(
                  (nearest, b) => Math.min(nearest, (a.x - b.x) ** 2 + (a.y - b.y) ** 2),
                  nearest,
                ),
              Infinity,
            ),
          ),
        })),
      );
      const frame = await root.locator('.mermaid-svg > svg').boundingBox();
      results.push({ width: currentWidth, separations, frame, ...geometry });
      await writeFile(
        info.outputPath('recovery.json'),
        JSON.stringify({ hashes, results }, null, 2),
      );
      await root
        .locator('.mermaid-presentation')
        .screenshot({ path: info.outputPath(`recovery-${currentWidth}-${results.length}.png`) });
    }
    const check = expect.configure({ soft: true });
    for (const result of results) {
      check(result.separations).toHaveLength(3);
      for (const pair of result.separations) {
        check(pair.crossing, pair.pair.join(' / ')).toBe(false);
        check(pair.distance, pair.pair.join(' / ')).toBeGreaterThanOrEqual(6);
      }
      for (const route of result.routes) {
        check(route.nodeHits).toEqual([]);
        check(route.labelHits).toEqual([]);
        check(route.sourceGap).toBeLessThanOrEqual(1);
        check(Math.abs(route.gap - 5)).toBeLessThanOrEqual(0.35);
        check(route.entersTarget).toBe(true);
        check(route.marker).toContain('barbEnd');
      }
      for (const bounds of [
        ...result.nodes.map((n) => n.bounds),
        ...result.labels.map((l) => l.bounds),
      ]) {
        check(bounds.left).toBeGreaterThanOrEqual(result.frame!.x - 0.5);
        check(bounds.right).toBeLessThanOrEqual(result.frame!.x + result.frame!.width + 0.5);
        check(bounds.top).toBeGreaterThanOrEqual(result.frame!.y - 0.5);
        check(bounds.bottom).toBeLessThanOrEqual(result.frame!.y + result.frame!.height + 0.5);
      }
    }
    const relativeNodes = (result: (typeof results)[number]) =>
      result.nodes.map((node) => ({
        name: node.name,
        x: node.bounds.x - result.frame!.x,
        y: node.bounds.y - result.frame!.y,
        width: node.bounds.width,
        height: node.bounds.height,
      }));
    check(relativeNodes(results[2])).toEqual(relativeNodes(results[0]));
    check(results[2].routes.map((route) => route.points)).toEqual(
      results[0].routes.map((route) => route.points),
    );
  });
}

for (const state of ['mermaid-nested-groups', 'mermaid-dense-graph'] as const) {
  const cases: { width: number; motion: 'reduced' | 'full' }[] = [
    { width: 420, motion: 'reduced' },
    { width: 960, motion: 'reduced' },
  ];
  // Full motion is a control for the compact transform/reduced-motion regression.
  if (state === 'mermaid-dense-graph') cases.push({ width: 420, motion: 'full' });
  for (const { width, motion } of cases) {
    const suffix = motion === 'full' ? ' with full motion' : '';
    test(`grouped spacing ${state} at ${width}px survives repeat fits${suffix}`, async ({
      page,
    }, info) => {
      const { root, hashes } = await open(page, state, width, false, 'dark', motion);
      await page.setViewportSize({ width: 1440, height: 1800 });
      const results = [];
      for (const currentWidth of [width, width === 420 ? 960 : 420, width]) {
        const renderer = root.locator('.mermaid-renderer');
        if (results.length) {
          const generation = await renderer.getAttribute('data-render-generation');
          await page.getByTestId('catalog-scene-focus').evaluate((host, value) => {
            host.style.width = `${value}px`;
          }, currentWidth);
          await expect(renderer).not.toHaveAttribute('data-render-generation', generation);
          await settled(page, root);
        }
        const routes = await localRouteGeometry(root);
        const groups = await root.locator('svg g.cluster').evaluateAll((groups) =>
          groups.map((group) => ({
            id: group.id,
            bounds: group.querySelector(':scope > rect')!.getBoundingClientRect().toJSON(),
            title: group.querySelector(':scope > .cluster-label')!.getBoundingClientRect().toJSON(),
          })),
        );
        const frame = await root.locator('.mermaid-svg > svg').boundingBox();
        const verticalRuns = (route: (typeof routes.routes)[number]) => {
          const runs: { x: number; top: number; bottom: number }[] = [];
          for (let i = 1; i < route.samples.length; i++) {
            const a = route.samples[i - 1],
              b = route.samples[i];
            if (Math.abs(a.x - b.x) > 0.001) continue;
            const last = runs.at(-1);
            if (last && Math.abs(last.x - a.x) < 0.001) {
              last.top = Math.min(last.top, b.y);
              last.bottom = Math.max(last.bottom, b.y);
            } else runs.push({ x: a.x, top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });
          }
          return runs.filter((run) => run.bottom - run.top > 20);
        };
        const route = (suffix: string) => routes.routes.find((route) => route.id.endsWith(suffix))!;
        const metrics: Record<string, number> = {};
        if (state === 'mermaid-nested-groups') {
          const outer = groups.find((group) => group.id.endsWith('Outer'))!.bounds;
          const inner = groups.find((group) => group.id.endsWith('Inner'))!.bounds;
          const gateway = routes.nodes.find((node) => node.name === 'Gateway')!.bounds;
          const request = verticalRuns(route('L_Client_Gateway_0')).toSorted(
            (a, b) => a.x - b.x,
          )[0];
          const enqueue = verticalRuns(route('L_Gateway_Queue_0')).toSorted(
            (a, b) => b.bottom - b.top - (a.bottom - a.top),
          )[0];
          const label = routes.labels.find((label) => label.text === 'enqueue')!.bounds;
          metrics.requestGap = outer.left - request.x;
          metrics.gatewayGap = inner.top - gateway.bottom;
          metrics.enqueueCenterOffset = enqueue.x - (inner.right + outer.right) / 2;
          metrics.enqueueLabelLeftGap = label.left - inner.right;
          metrics.enqueueLabelRightGap = outer.right - label.right;
        } else {
          const select = verticalRuns(route('L_D_E_0'));
          const feedback = verticalRuns(route('L_G_A_0'));
          metrics.laneGap = Math.min(
            ...select.flatMap((a) =>
              feedback
                .filter((b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 20)
                .map((b) => Math.abs(a.x - b.x)),
            ),
          );
        }
        results.push({ width: currentWidth, metrics, groups, frame, ...routes });
        await writeFile(
          info.outputPath('spacing.json'),
          JSON.stringify({ hashes, results }, null, 2),
        );
        await root
          .locator('.mermaid-presentation')
          .screenshot({ path: info.outputPath(`spacing-${currentWidth}-${results.length}.png`) });
      }
      const check = expect.configure({ soft: true });
      for (const result of results) {
        const metrics = result.metrics;
        if (state === 'mermaid-nested-groups') {
          check(metrics.requestGap).toBeGreaterThanOrEqual(16);
          check(metrics.gatewayGap).toBeGreaterThanOrEqual(16);
          check(Math.abs(metrics.enqueueCenterOffset)).toBeLessThanOrEqual(1);
          check(metrics.enqueueLabelLeftGap).toBeGreaterThanOrEqual(4);
          check(metrics.enqueueLabelRightGap).toBeGreaterThanOrEqual(4);
        } else check(metrics.laneGap).toBeGreaterThanOrEqual(16);
        for (const route of result.routes) {
          check(route.nodeHits).toEqual([]);
          check(route.labelHits).toEqual([]);
          check(route.sourceGap).toBeLessThanOrEqual(1);
          check(Math.abs(route.gap - 5)).toBeLessThanOrEqual(0.35);
          check(route.entersTarget).toBe(true);
        }
        for (const bounds of [
          ...result.nodes.map((n) => n.bounds),
          ...result.labels.map((l) => l.bounds),
          ...result.groups.map((g) => g.bounds),
        ]) {
          check(bounds.left).toBeGreaterThanOrEqual(result.frame!.x - 0.5);
          check(bounds.right).toBeLessThanOrEqual(result.frame!.x + result.frame!.width + 0.5);
          check(bounds.top).toBeGreaterThanOrEqual(result.frame!.y - 0.5);
          check(bounds.bottom).toBeLessThanOrEqual(result.frame!.y + result.frame!.height + 0.5);
        }
      }
      const localMetrics = (result: (typeof results)[number]) => {
        const scale = result.nodes[0].bounds.height / (width === 420 ? 42 : 54);
        return Object.fromEntries(
          Object.entries(result.metrics).map(([key, value]) => [key, value / scale]),
        );
      };
      const first = localMetrics(results[0]),
        last = localMetrics(results[2]);
      for (const key of Object.keys(first))
        check(Math.abs(first[key] - last[key])).toBeLessThanOrEqual(0.05);
    });
  }
}

async function geometry(root: Locator) {
  return root.locator('.mermaid-svg > svg').evaluate((svg: SVGSVGElement) => {
    const box = (element: Element) => element.getBoundingClientRect().toJSON();
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
      id: node.id.match(/-flowchart-(.+)-\d+$/)![1],
      element: node,
      shapes: [
        ...node.querySelectorAll<SVGGeometryElement>(
          '.label-container, .label-container path, .label-container rect, .label-container polygon',
        ),
      ].filter((shape) => typeof shape.isPointInFill === 'function'),
      bounds: box(node),
    }));
    const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
    const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
      .filter((label) => label.textContent?.trim())
      .map((label) => ({
        id: label.querySelector('[data-id]')?.getAttribute('data-id'),
        text: label.textContent,
        bounds: box(label),
      }));
    const inside = (p: DOMPoint, b: DOMRect) =>
      p.x > b.left + 0.5 && p.x < b.right - 0.5 && p.y > b.top + 0.5 && p.y < b.bottom - 0.5;
    const routes = paths.map((path) => {
      const id = path.id.match(/-(L_.+)$/)![1];
      const [, source, target] = id.match(/^L_([^_]+)_([^_]+)_/)!;
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      const count = Math.ceil(length * 2);
      const samples = Array.from({ length: count + 1 }, (_, i) =>
        path.getPointAtLength((length * i) / count).matrixTransform(matrix),
      );
      const end = samples.at(-1)!;
      const targetNode = nodes.find((node) => node.id === target)!;
      const gap =
        Math.min(
          Math.abs(end.x - targetNode.bounds.left),
          Math.abs(end.x - targetNode.bounds.right),
          Math.abs(end.y - targetNode.bounds.top),
          Math.abs(end.y - targetNode.bounds.bottom),
        ) - 0.5;
      const previous = samples.at(-2)!;
      const norm = Math.hypot(end.x - previous.x, end.y - previous.y);
      const entersTarget = (distance: number) =>
        targetNode.shapes.some((shape) =>
          shape.isPointInFill(
            new DOMPoint(
              end.x + ((end.x - previous.x) / norm) * distance,
              end.y + ((end.y - previous.y) / norm) * distance,
            ).matrixTransform(shape.getScreenCTM()!.inverse()),
          ),
        );
      let low = 0;
      let high = 30;
      if (entersTarget(high))
        for (let i = 0; i < 16; i++) {
          const middle = (low + high) / 2;
          if (entersTarget(middle)) high = middle;
          else low = middle;
        }
      return {
        id,
        source,
        target,
        d: path.getAttribute('d'),
        data: { ...path.dataset },
        length,
        gap,
        paintedGap: high - 0.5,
        stroke: getComputedStyle(path).strokeDasharray,
        start: { x: samples[0].x, y: samples[0].y },
        end: { x: end.x, y: end.y },
        nodeHits: nodes
          .filter(
            (node) =>
              node.id !== source &&
              node.id !== target &&
              samples.some((p) =>
                node.shapes.some((shape) =>
                  shape.isPointInFill(p.matrixTransform(shape.getScreenCTM()!.inverse())),
                ),
              ),
          )
          .map((node) => node.id),
        labelHits: labels
          .filter((label) => label.id !== id && samples.some((p) => inside(p, label.bounds)))
          .map((label) => label.id),
        samples: samples.map((p) => ({ x: p.x, y: p.y })),
      };
    });
    return {
      nodes: nodes.map(({ id, bounds, shapes }) => ({
        id,
        bounds,
        shapes: shapes.map((shape) => ({
          tag: shape.tagName,
          local: DOMRect.fromRect(shape.getBBox()).toJSON(),
          rx: getComputedStyle(shape).rx,
          ry: getComputedStyle(shape).ry,
        })),
      })),
      labels,
      routes,
      frame: box(svg),
      viewport: box(svg.closest('.mermaid-svg-viewport')!),
      viewBox: svg.getAttribute('viewBox'),
    };
  });
}

test('local routing cost on unchanged cycle snapshots', async ({ page }, info) => {
  const { root, hashes } = await open(page, 'mermaid-cycle-fanout', 960, false);
  const snapshot = process.env.ROUTING_COST_SNAPSHOT
    ? await readFile(process.env.ROUTING_COST_SNAPSHOT, 'utf8')
    : await root.locator('.mermaid-svg > svg').evaluate((svg) => svg.outerHTML);
  await writeFile(info.outputPath('snapshot.svg'), snapshot);
  const samples = await root.locator('.mermaid-svg > svg').evaluate(
    async (svg: SVGSVGElement, { snapshot, baselineModule }) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const helpers = await import(/* @vite-ignore */ modulePath);
      const baseline = baselineModule ? await import(/* @vite-ignore */ baselineModule) : null;
      const times = [];
      for (let i = 0; i < 30; i++) {
        const sample: Record<string, number> = {};
        const versions = baseline
          ? ([
              ['baseline', baseline],
              ['candidate', helpers],
            ] as const)
          : ([['candidate', helpers]] as const);
        for (const [name, module] of i % 2 ? [...versions].reverse() : versions) {
          const holder = document.createElement('div');
          holder.innerHTML = snapshot;
          const clone = holder.querySelector('svg');
          if (
            !clone ||
            clone.querySelectorAll('g.node').length !== 6 ||
            clone.querySelectorAll('.edgePaths path').length !== 9
          )
            throw new Error('Cost fixture is not the complete cycle SVG');
          svg.parentElement!.append(clone);
          clone.getBoundingClientRect();
          const start = performance.now();
          module.snapFlowchartPorts(clone);
          module.snapFlowchartFanoutPorts(clone);
          module.snapFlowchartFeedbackPorts(clone);
          module.snapFlowchartDiamondPorts(clone);
          const plannedLabels = module.repairFlowchartRouteClearance?.(clone);
          module.repairFlowchartLabelClearance?.(clone, plannedLabels);
          sample[name] = performance.now() - start;
          if (clone.querySelectorAll('.edgePaths path').length !== 9 || clone.getBBox().width <= 0)
            throw new Error('Cost fixture lost painted geometry');
          clone.remove();
        }
        times.push(sample);
      }
      return times;
    },
    { snapshot, baselineModule: process.env.ROUTING_COST_BASELINE_MODULE },
  );
  await writeFile(info.outputPath('cost.json'), JSON.stringify({ hashes, samples }, null, 2));
});

for (const note of [false, true]) {
  for (const width of [420, 960]) {
    test(`cycle routes avoid unrelated paint in ${note ? 'real note' : 'preview'} at ${width}px`, async ({
      page,
    }, info) => {
      const { root, hashes, ready } = await open(page, 'mermaid-cycle-fanout', width, note);
      const result = await geometry(root);
      await writeFile(
        info.outputPath('geometry.json'),
        JSON.stringify(
          {
            hashes,
            ready,
            source: MERMAID_WORKBENCH_CASES['mermaid-cycle-fanout'].source,
            ...result,
          },
          null,
          2,
        ),
      );
      await root.screenshot({ path: info.outputPath('cycle.png'), animations: 'disabled' });
      expect(result.nodes.map((node) => node.id).sort()).toEqual([
        'ER',
        'Flow',
        'Hub',
        'Review',
        'Sequence',
        'State',
      ]);
      expect(result.routes.map((route) => route.id).sort()).toEqual(
        [
          'L_Hub_Flow_0',
          'L_Hub_Sequence_0',
          'L_Hub_State_0',
          'L_Hub_ER_0',
          'L_Flow_Review_0',
          'L_Sequence_Review_0',
          'L_State_Review_0',
          'L_ER_Review_0',
          'L_Review_Hub_0',
        ].sort(),
      );
      for (const route of result.routes) {
        expect.soft(route.nodeHits, route.id).toEqual([]);
        expect.soft(route.labelHits, route.id).toEqual([]);
        expect.soft(Math.abs(route.gap - 5), route.id).toBeLessThanOrEqual(0.35);
        expect
          .soft(Math.abs(route.paintedGap - 5), `${route.id} painted target boundary`)
          .toBeLessThanOrEqual(0.35);
      }
      const straightPaint = (samples: { x: number; y: number }[]) => {
        const runs: { axis: 'x' | 'y'; fixed: number; low: number; high: number }[] = [];
        samples.slice(1).forEach((end, index) => {
          const start = samples[index];
          const axis =
            Math.abs(start.x - end.x) < 0.01 ? 'y' : Math.abs(start.y - end.y) < 0.01 ? 'x' : null;
          if (!axis) return;
          const fixed = start[axis === 'x' ? 'y' : 'x'];
          const low = Math.min(start[axis], end[axis]);
          const high = Math.max(start[axis], end[axis]);
          const last = runs.at(-1);
          if (
            last &&
            last.axis === axis &&
            Math.abs(last.fixed - fixed) < 0.01 &&
            low <= last.high + 0.01 &&
            high >= last.low - 0.01
          ) {
            last.low = Math.min(last.low, low);
            last.high = Math.max(last.high, high);
          } else runs.push({ axis, fixed, low, high });
        });
        return runs;
      };
      for (const [index, route] of result.routes.entries()) {
        for (const other of result.routes
          .slice(index + 1)
          .filter((other) => other.source !== route.source)) {
          const overlaps = straightPaint(route.samples).flatMap((a) =>
            straightPaint(other.samples)
              .filter((b) => a.axis === b.axis && Math.abs(a.fixed - b.fixed) < 0.5)
              .map((b) => Math.min(a.high, b.high) - Math.max(a.low, b.low)),
          );
          expect
            .soft(Math.max(0, ...overlaps), `${route.id} and ${other.id} unrelated shared paint`)
            .toBeLessThanOrEqual(8);
        }
      }
    });
  }
}

for (const state of [
  'mermaid-nested-routing',
  'mermaid-topology-stress',
  'mermaid-flow',
  'mermaid-long-labels',
  'mermaid-dense-graph',
] as const) {
  for (const width of [420, 960]) {
    test(`${state} keeps labels and routes clear at ${width}px`, async ({ page }, info) => {
      const { root, hashes, ready } = await open(page, state, width, false);
      const result = await geometry(root);
      await writeFile(
        info.outputPath('geometry.json'),
        JSON.stringify(
          { hashes, ready, source: MERMAID_WORKBENCH_CASES[state].source, ...result },
          null,
          2,
        ),
      );
      await root.screenshot({ path: info.outputPath('routes.png'), animations: 'disabled' });
      const frame = result.frame;
      for (const bounds of [
        ...result.nodes.map((node) => node.bounds),
        ...result.labels.map((label) => label.bounds),
      ]) {
        expect(bounds.left).toBeGreaterThanOrEqual(frame.left - 0.5);
        expect(bounds.right).toBeLessThanOrEqual(frame.right + 0.5);
        expect(bounds.top).toBeGreaterThanOrEqual(frame.top - 0.5);
        expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom + 0.5);
      }
      for (const route of result.routes) {
        expect(Math.min(...route.samples.map((p) => p.x))).toBeGreaterThanOrEqual(frame.left - 0.5);
        expect(Math.max(...route.samples.map((p) => p.x))).toBeLessThanOrEqual(frame.right + 0.5);
        expect(Math.min(...route.samples.map((p) => p.y))).toBeGreaterThanOrEqual(frame.top - 0.5);
        expect(Math.max(...route.samples.map((p) => p.y))).toBeLessThanOrEqual(frame.bottom + 0.5);
      }
      const reach = await root
        .locator('.mermaid-svg-viewport')
        .evaluate((viewport: HTMLElement) => {
          const before = viewport.querySelector('svg')!.getBoundingClientRect();
          viewport.scrollLeft = viewport.scrollWidth;
          const after = viewport.querySelector('svg')!.getBoundingClientRect();
          const bounds = viewport.getBoundingClientRect();
          const result = {
            moved: before.left - after.left,
            overflow: before.width - viewport.clientWidth,
            right: after.right,
            viewportRight: bounds.right,
            overflowX: getComputedStyle(viewport).overflowX,
          };
          viewport.scrollLeft = 0;
          return result;
        });
      if (reach.overflow > 1) {
        expect(reach.overflowX).toBe('auto');
        expect(reach.moved).toBeGreaterThanOrEqual(reach.overflow - 1);
        expect(reach.right).toBeLessThanOrEqual(reach.viewportRight + 1);
      }
      for (const route of result.routes) {
        expect.soft(route.nodeHits, route.id).toEqual([]);
        expect.soft(route.labelHits, route.id).toEqual([]);
      }
      for (const label of result.labels) {
        const overlaps = (b: DOMRect) =>
          label.bounds.left < b.right - 0.5 &&
          label.bounds.right > b.left + 0.5 &&
          label.bounds.top < b.bottom - 0.5 &&
          label.bounds.bottom > b.top + 0.5;
        expect
          .soft(
            result.nodes.filter((node) => overlaps(node.bounds)).map((node) => node.id),
            String(label.id),
          )
          .toEqual([]);
        expect
          .soft(
            result.labels
              .filter((other) => other !== label && overlaps(other.bounds))
              .map((other) => other.id),
            String(label.id),
          )
          .toEqual([]);
      }
    });
  }
}

for (const width of [420, 960]) {
  test(`nested retry uses a local return in real note at ${width}px`, async ({ page }, info) => {
    const { root, hashes, ready } = await open(page, 'mermaid-nested-routing', width, true);
    const result = await geometry(root);
    const groups = await root.locator('svg g.cluster').evaluateAll((groups) =>
      groups.map((group) => ({
        id: group.id,
        frame: group.querySelector(':scope > rect')!.getBoundingClientRect().toJSON(),
        title: (() => {
          const range = document.createRange();
          const text = document
            .createTreeWalker(
              group.querySelector(':scope > .cluster-label .nodeLabel')!,
              NodeFilter.SHOW_TEXT,
            )
            .nextNode()!;
          range.selectNodeContents(text);
          return range.getBoundingClientRect().toJSON();
        })(),
      })),
    );
    await writeFile(
      info.outputPath('nested.json'),
      JSON.stringify({ hashes, ready, groups, ...result }, null, 2),
    );
    await root.screenshot({ path: info.outputPath('nested.png'), animations: 'disabled' });
    expect(result.nodes.map((node) => node.id).sort()).toEqual([
      'Enrich',
      'Intake',
      'Merge',
      'Registry',
      'Validate',
    ]);
    expect(result.routes.map((route) => route.id).sort()).toEqual(
      [
        'L_Enrich_Merge_0',
        'L_Enrich_Validate_0',
        'L_Intake_Validate_0',
        'L_Intake_Validate_2',
        'L_Merge_Merge_0',
        'L_Merge_Registry_0',
        'L_Validate_Enrich_0',
        'L_Validate_Merge_0',
        'L_Validate_Merge_2',
      ].sort(),
    );
    const terminals = await root.locator('.mermaid-svg > svg').evaluate((svg) =>
      [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
        const end = path
          .getPointAtLength(path.getTotalLength())
          .matrixTransform(path.getScreenCTM()!);
        const node = svg.querySelector(`#${CSS.escape(path.dataset.terminalTarget!)}`)!;
        const shape = node.querySelector<SVGGeometryElement>(':scope > .label-container')!;
        const matrix = shape.getScreenCTM()!;
        const length = shape.getTotalLength();
        const count = Math.ceil(length * 8);
        let distance = Infinity;
        for (let i = 0; i <= count; i++) {
          const p = shape.getPointAtLength((length * i) / count).matrixTransform(matrix);
          distance = Math.min(distance, Math.hypot(end.x - p.x, end.y - p.y));
        }
        return { id: path.id.match(/-(L_.+)$/)![1], gap: distance - 0.5 };
      }),
    );
    for (const route of result.routes) {
      expect.soft(route.nodeHits, route.id).toEqual([]);
      expect.soft(route.labelHits, route.id).toEqual([]);
      expect
        .soft(Math.abs(terminals.find((item) => item.id === route.id)!.gap - 5), route.id)
        .toBeLessThanOrEqual(0.35);
      for (const group of groups)
        expect
          .soft(
            route.samples.some(
              (p) =>
                p.x > group.title.left &&
                p.x < group.title.right &&
                p.y > group.title.top &&
                p.y < group.title.bottom,
            ),
            `${route.id} heading ${group.id}`,
          )
          .toBe(false);
    }
    const retry = result.routes.find((route) => route.id === 'L_Enrich_Validate_0')!;
    const secondary = result.nodes.find((node) => node.id === 'Enrich')!.bounds;
    const decision = result.nodes.find((node) => node.id === 'Validate')!.bounds;
    expect(Math.max(...retry.samples.map((p) => p.y))).toBeLessThanOrEqual(secondary.bottom + 1);
    expect(Math.min(...retry.samples.map((p) => p.y))).toBeGreaterThanOrEqual(decision.top - 1);
    const coordinates = retry.d!.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)!.map(Number);
    expect(coordinates.every(Number.isFinite)).toBe(true);
    expect((retry.d!.match(/Q/g) ?? []).length).toBe(1);
    const distance = Math.abs(retry.start.x - retry.end.x) + Math.abs(retry.start.y - retry.end.y);
    const scale = result.nodes[0].bounds.height / result.nodes[0].shapes[0].local.height;
    expect(Math.abs(retry.length * scale - distance)).toBeLessThan(4);
    expect(result.labels.map((label) => label.text?.trim()).sort()).toEqual([
      'add',
      'done',
      'in',
      'meta',
      'no',
      'retry',
      'save',
      'yes',
    ]);
    expect(result.routes.find((route) => route.id === 'L_Intake_Validate_2')!.stroke).not.toBe(
      'none',
    );
    const label = result.labels.find((label) => label.id === retry.id)!;
    for (const group of groups) {
      expect(label.bounds.left).toBeGreaterThanOrEqual(group.frame.left);
      expect(label.bounds.right).toBeLessThanOrEqual(group.frame.right);
      expect(label.bounds.bottom).toBeLessThanOrEqual(group.frame.bottom);
    }
    const ownership = await root
      .locator('.mermaid-svg > svg')
      .evaluate(async (svg: SVGSVGElement) => {
        const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
        const helpers = await import(/* @vite-ignore */ modulePath);
        const snapshot = () =>
          [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => ({
            d: path.getAttribute('d'),
            points: path.dataset.manhattanPoints,
            direction: path.dataset.terminalDirection,
          }));
        const before = snapshot();
        helpers.snapFlowchartFanoutPorts(svg);
        helpers.repairFlowchartRouteClearance(svg);
        return { before, after: snapshot() };
      });
    expect(ownership.after).toEqual(ownership.before);
    await writeFile(
      info.outputPath('terminals-ownership.json'),
      JSON.stringify({ terminals, ownership }, null, 2),
    );
    if (width === 420) {
      await root.locator('.mermaid-svg-viewport').evaluate(
        (viewport, center) => {
          const bounds = viewport.getBoundingClientRect();
          viewport.scrollLeft += center - (bounds.left + bounds.width / 2);
        },
        (secondary.left + decision.right) / 2,
      );
      await root.screenshot({
        path: info.outputPath('nested-retry-reachable.png'),
        animations: 'disabled',
      });
    }
  });
}

test('nested local return retains an exterior lane when the local corridor is blocked', async ({
  page,
}, info) => {
  const { root } = await open(page, 'mermaid-nested-routing', 960, true);
  const result = await root.locator('.mermaid-svg > svg').evaluate(async (svg: SVGSVGElement) => {
    const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
    const helpers = await import(/* @vite-ignore */ modulePath);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    svg.parentElement!.append(clone);
    try {
      const path = clone.querySelector<SVGPathElement>(
        'path[data-nested-decision-route=secondary-retry]',
      )!;
      const originalLength = path.getTotalLength();
      const point = path.getPointAtLength(originalLength / 2);
      const blocker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      blocker.setAttribute('class', 'node');
      blocker.id = 'flowchart-corridor-blocker-99';
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'label-container');
      rect.setAttribute('x', String(point.x - 12));
      rect.setAttribute('y', String(point.y - 16));
      rect.setAttribute('width', '24');
      rect.setAttribute('height', '72');
      blocker.append(rect);
      clone.querySelector('g.nodes')!.append(blocker);
      helpers.routeFlowchartDecisionBranches(clone);
      return {
        originalLength,
        blockedLength: path.getTotalLength(),
        samples: Array.from({ length: 1025 }, (_, i) => {
          const p = path.getPointAtLength((path.getTotalLength() * i) / 1024);
          return rect.isPointInFill(
            p.matrixTransform(path.getScreenCTM()!).matrixTransform(rect.getScreenCTM()!.inverse()),
          );
        }),
        labels: [...clone.querySelectorAll('.edgeLabel')]
          .map((label) => label.textContent?.trim())
          .filter(Boolean),
      };
    } finally {
      clone.remove();
    }
  });
  await writeFile(info.outputPath('blocked.json'), JSON.stringify(result, null, 2));
  expect(result.blockedLength).toBeGreaterThan(result.originalLength * 1.5);
  expect(result.samples.some(Boolean)).toBe(false);
  expect(result.labels).toContain('retry');
});

test('nested local return cost on identical valid SVG snapshots', async ({ page }, info) => {
  const { root, hashes } = await open(page, 'mermaid-nested-routing', 960, true);
  const baselineModule = process.env.ROUTING_COST_BASELINE_MODULE;
  const snapshot = await root.locator('.mermaid-svg > svg').evaluate((svg) => svg.outerHTML);
  await writeFile(info.outputPath('snapshot.svg'), snapshot);
  const samples = await root.locator('.mermaid-svg > svg').evaluate(
    async (svg, { snapshot, baselineModule }) => {
      const modulePath = '/src/lib/components/markdown/mermaid-path-geometry.ts';
      const candidate = await import(/* @vite-ignore */ modulePath);
      const baseline = baselineModule ? await import(/* @vite-ignore */ baselineModule) : null;
      const samples: Record<string, number>[] = [];
      for (let i = 0; i < 30; i++) {
        const sample: Record<string, number> = {};
        const versions = baseline
          ? ([
              ['baseline', baseline],
              ['candidate', candidate],
            ] as const)
          : ([['candidate', candidate]] as const);
        for (const [name, helpers] of i % 2 ? [...versions].reverse() : versions) {
          const holder = document.createElement('div');
          holder.innerHTML = snapshot;
          const clone = holder.querySelector('svg')!;
          svg.parentElement!.append(clone);
          if (
            clone.querySelectorAll('g.node').length !== 5 ||
            clone.querySelectorAll('.edgePaths path').length !== 9 ||
            clone.getBBox().width <= 0
          )
            throw new Error('Invalid nested SVG cost input');
          const start = performance.now();
          helpers.routeFlowchartDecisionBranches(clone);
          helpers.snapFlowchartFanoutPorts(clone);
          const labels = helpers.repairFlowchartRouteClearance(clone);
          helpers.repairFlowchartLabelClearance(clone, labels);
          sample[name] = performance.now() - start;
          if (
            clone.querySelectorAll('.edgePaths path').length !== 9 ||
            !Number.isFinite(clone.getBBox().width) ||
            clone.getBBox().width <= 0
          )
            throw new Error('Invalid nested SVG cost output');
          clone.remove();
        }
        samples.push(sample);
      }
      return samples;
    },
    { snapshot, baselineModule },
  );
  const baselineSha256 = baselineModule
    ? createHash('sha256')
        .update(await readFile(baselineModule.replace(/^\//, '')))
        .digest('hex')
    : null;
  await writeFile(
    info.outputPath('cost.json'),
    JSON.stringify({ hashes, baselineSha256, samples }, null, 2),
  );
});

test('cycle routes survive actual note narrow-wide-narrow refits', async ({ page }, info) => {
  const { root } = await open(page, 'mermaid-cycle-fanout', 420, true);
  const results = [await geometry(root)];
  for (const width of [960, 420]) {
    const renderer = root.locator('.mermaid-renderer');
    const generation = await renderer.getAttribute('data-render-generation');
    await page.locator('#routing-note-host').evaluate((host, width) => {
      host.style.width = `${width}px`;
    }, width);
    await expect(renderer).not.toHaveAttribute('data-render-generation', generation);
    await settled(page, root);
    results.push(await geometry(root));
  }
  for (const result of results) {
    expect(result.routes).toHaveLength(9);
    for (const route of result.routes) {
      expect(route.nodeHits).toEqual([]);
      expect(Math.abs(route.paintedGap - 5)).toBeLessThanOrEqual(0.35);
    }
  }
  for (const route of results[0].routes) {
    const again = results[2].routes.find((other) => other.id === route.id)!;
    expect(again.stroke).toBe(route.stroke);
    expect(again.length).toBeCloseTo(route.length, 2);
  }
  await writeFile(info.outputPath('resize.json'), JSON.stringify(results, null, 2));
});
