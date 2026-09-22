import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
const exactSource = `flowchart TD
A[Update available] --> B[Download in background]
B --> C{Safe to restart?}
C -->|Work active| D[Keep current version running]
D --> C
C -->|Yes| E[Briefly pause new work]
E --> F[Save state and restart]
F --> G[Check health]
G --> H[Clients reconnect]`;

async function mountNote(page: Page, source: string, width: number, info: TestInfo) {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=light&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible();
  const paths = [
    'src/lib/components/markdown/MermaidRenderer.svelte',
    'src/lib/components/markdown/mermaid-path-geometry.ts',
  ];
  const responses = paths.map((path) =>
    page.waitForResponse((r) => new URL(r.url()).pathname === `/${path}`),
  );
  await page.evaluate(
    async ({ source, width }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'restart-note-host';
      host.style.cssText = `width:${width}px;min-height:1000px;margin:0 auto`;
      document.body.replaceChildren(host);
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'synthetic-restart',
            title: 'Synthetic restart',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
          content: `~~~mermaid\n${source}\n~~~`,
          editable: false,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { source, width },
  );
  const hashes = [];
  for (const [index, response] of responses.entries()) {
    const served = await (await response).text();
    const map = served.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
    expect(map).not.toBeNull();
    const disk = await readFile(paths[index], 'utf8');
    expect(JSON.parse(Buffer.from(map![1], 'base64').toString()).sourcesContent).toContain(disk);
    hashes.push({ path: paths[index], sha256: createHash('sha256').update(disk).digest('hex') });
  }
  await writeFile(
    info.outputPath('source-identity.json'),
    JSON.stringify({ source, hashes }, null, 2),
  );
}

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('#restart-note-host .mermaid-renderer');
  await expect(root).toHaveAttribute('data-render-settled', 'true');
  await root.evaluate(
    (root) =>
      new Promise<void>((resolve, reject) => {
        let previous = '',
          stable = 0;
        const start = performance.now();
        const sample = () => {
          const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg');
          const signature = JSON.stringify([
            root.getBoundingClientRect(),
            svg?.getAttribute('viewBox'),
            root.getAttribute('data-render-generation'),
            [
              ...(svg?.querySelectorAll('g.node, .edgePaths path, .edgeLabels > .edgeLabel') ?? []),
            ].map((e) => [
              e.getBoundingClientRect(),
              e.getAttribute('d'),
              e.getAttribute('transform'),
            ]),
          ]);
          stable =
            signature === previous &&
            root.getAttribute('data-render-settled') === 'true' &&
            svg?.dataset.layoutSettled === 'true'
              ? stable + 1
              : 0;
          previous = signature;
          if (stable >= 8) resolve();
          else if (performance.now() - start > 10000)
            reject(new Error('Restart flow did not settle'));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  return root;
}

async function measure(page: Page, info: TestInfo, name: string) {
  const root = await settled(page);
  const svg = root.locator('.mermaid-svg > svg');
  const result = await svg.evaluate(async (svg: SVGSVGElement) => {
    const rect = (e: Element) => e.getBoundingClientRect().toJSON();
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
      const shape = node.querySelector<SVGGraphicsElement>(':scope > .label-container')!;
      const bounds = rect(shape);
      const label = node.querySelector('.nodeLabel')!;
      return {
        id: node.id.match(/flowchart-(.+)-\d+$/)![1],
        text: label.textContent,
        ...bounds,
        cx: bounds.x + bounds.width / 2,
        cy: bounds.y + bounds.height / 2,
        diamond: shape.tagName === 'polygon',
        font: parseFloat(getComputedStyle(label).fontSize) * svg.getScreenCTM()!.a,
      };
    });
    const labels = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')]
      .map((label) => ({
        id: label.querySelector('[data-id]')?.getAttribute('data-id'),
        text: label.textContent?.trim(),
        ...rect(label),
      }))
      .filter((label) => label.text);
    const routes = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
      const match = path.id.match(/-L_(.+)_(.+)_\d+$/)!;
      const length = path.getTotalLength(),
        matrix = path.getScreenCTM()!;
      const at = (distance: number) => {
        const point = path.getPointAtLength(distance).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      };
      const samples = Array.from({ length: Math.ceil(length) + 1 }, (_, i) =>
        at(Math.min(i, length)),
      );
      return {
        source: match[1],
        target: match[2],
        id: `L_${match[1]}_${match[2]}_0`,
        d: path.getAttribute('d'),
        start: at(0),
        next: at(Math.min(8, length)),
        end: at(length),
        before: at(Math.max(0, length - 8)),
        samples,
        markerEnd: getComputedStyle(path).markerEnd,
        markerStart: getComputedStyle(path).markerStart,
        metadata: { ...path.dataset },
      };
    });
    const inside = (p: { x: number; y: number }, n: (typeof nodes)[number]) =>
      n.diamond
        ? Math.abs(p.x - n.cx) / (n.width / 2) + Math.abs(p.y - n.cy) / (n.height / 2) < 0.98
        : p.x > n.left + 1 && p.x < n.right - 1 && p.y > n.top + 1 && p.y < n.bottom - 1;
    const nodeCollisions = routes.flatMap((route) =>
      nodes.flatMap((node) =>
        route.samples.some((p) => inside(p, node))
          ? [`${route.source}->${route.target}:${node.id}`]
          : [],
      ),
    );
    const labelCollisions = routes.flatMap((route) =>
      labels.flatMap((label) =>
        label.id !== route.id &&
        route.samples.some(
          (p) => p.x > label.left && p.x < label.right && p.y > label.top && p.y < label.bottom,
        )
          ? [`${route.source}->${route.target}:${label.text}`]
          : [],
      ),
    );
    const crossings = routes.flatMap((a, i) =>
      routes
        .slice(i + 1)
        .flatMap((b) =>
          a.samples.some((p) => b.samples.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1))
            ? [`${a.source}->${a.target}/${b.source}->${b.target}`]
            : [],
        ),
    );
    // Rasterize each actual marker, not a metadata-reconstructed arrow. A small
    // SVG-space crop preserves the live transform, marker units and computed styles.
    const markerPaint = [];
    for (const path of svg.querySelectorAll<SVGPathElement>('.edgePaths path')) {
      const markerId = getComputedStyle(path).markerEnd.match(/#([^\)"']+)/)?.[1];
      if (!markerId) {
        markerPaint.push([]);
        continue;
      }
      const matrix = svg.getScreenCTM()!.inverse().multiply(path.getScreenCTM()!);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const crop = document.createElementNS(svg.namespaceURI, 'svg') as SVGSVGElement;
      crop.setAttribute('viewBox', `${end.x - 16} ${end.y - 16} 32 32`);
      crop.setAttribute('width', '128');
      crop.setAttribute('height', '128');
      const defs = document.createElementNS(svg.namespaceURI, 'defs');
      for (const marker of svg.querySelectorAll('marker')) {
        const copy = marker.cloneNode(true) as SVGMarkerElement;
        const originals = [marker, ...marker.querySelectorAll('*')];
        [copy, ...copy.querySelectorAll('*')].forEach((element, i) => {
          for (const property of [
            'fill',
            'stroke',
            'stroke-width',
            'stroke-linecap',
            'stroke-linejoin',
          ])
            (element as SVGElement).style.setProperty(
              property,
              getComputedStyle(originals[i]).getPropertyValue(property),
            );
        });
        defs.append(copy);
      }
      crop.append(defs);
      const copy = path.cloneNode(true) as SVGPathElement;
      copy.removeAttribute('style');
      copy.setAttribute('transform', matrix.toString());
      copy.style.stroke = 'transparent';
      copy.style.fill = 'none';
      copy.style.strokeWidth = getComputedStyle(path).strokeWidth;
      copy.setAttribute('marker-end', `url(#${markerId})`);
      crop.append(copy);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(crop))}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, 128, 128).data;
      const painted = [];
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          if (pixels[(y * 128 + x) * 4 + 3] < 32) continue;
          const point = new DOMPoint(
            end.x - 16 + (x + 0.5) / 4,
            end.y - 16 + (y + 0.5) / 4,
          ).matrixTransform(svg.getScreenCTM()!);
          painted.push({ x: point.x, y: point.y });
        }
      markerPaint.push(painted);
    }
    const markerCollisions = markerPaint.flatMap((points, index) =>
      nodes.flatMap((node) =>
        points.some((point) => inside(point, node)) ? [`${routes[index].id}:${node.id}`] : [],
      ),
    );
    const frame = svg.getBoundingClientRect();
    const clippedPaint = [...routes.flatMap((route) => route.samples), ...markerPaint.flat()].some(
      (point) =>
        point.x < frame.left ||
        point.x > frame.right ||
        point.y < frame.top ||
        point.y > frame.bottom,
    );
    const ownership = labels.map((label) => {
      const route = routes.find((route) => route.id === label.id)!;
      return {
        id: label.id,
        text: label.text,
        distance: Math.min(
          ...route.samples.map((p) =>
            Math.hypot(p.x - label.x - label.width / 2, p.y - label.y - label.height / 2),
          ),
        ),
      };
    });
    return {
      nodes,
      labels,
      routes,
      nodeCollisions,
      labelCollisions,
      crossings,
      markerPaint,
      markerCollisions,
      clippedPaint,
      ownership,
      svg: rect(svg),
      viewport: rect(svg.closest('.mermaid-svg-viewport')!),
      viewBox: svg.getAttribute('viewBox'),
      scale: svg.getScreenCTM()!.a,
    };
  });
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(result, null, 2));
  await writeFile(info.outputPath(`${name}.svg`), await svg.evaluate((svg) => svg.outerHTML));
  await root.screenshot({ path: info.outputPath(`${name}.png`) });
  return result;
}

function expectClearPaint(result: Awaited<ReturnType<typeof measure>>) {
  expect(result.nodeCollisions).toEqual([]);
  expect(result.labelCollisions).toEqual([]);
  expect(result.crossings).toEqual([]);
  expect(result.markerCollisions).toEqual([]);
  expect(result.clippedPaint).toBe(false);
  for (const label of result.ownership) expect(label.distance).toBeLessThan(1);
  for (const node of result.nodes) expect(node.font).toBeGreaterThanOrEqual(11.9);
  for (const [index, route] of result.routes.entries()) {
    expect(route.markerEnd).not.toBe('none');
    expect(route.markerStart).toBe('none');
    const target = result.nodes.find((node) => node.id === route.target)!;
    const dx = route.end.x - route.before.x,
      dy = route.end.y - route.before.y;
    expect(
      dx * (target.cx - route.end.x) + dy * (target.cy - route.end.y),
      'arrow points toward authored target',
    ).toBeGreaterThan(0);
    const painted = result.markerPaint[index];
    expect(painted.length, 'actual arrowhead has painted pixels').toBeGreaterThan(10);
    const tip = painted.toSorted((a, b) => (b.x - a.x) * dx + (b.y - a.y) * dy)[0];
    const corners = target.diamond
      ? [
          [target.cx, target.top],
          [target.right, target.cy],
          [target.cx, target.bottom],
          [target.left, target.cy],
        ]
      : [
          [target.left, target.top],
          [target.right, target.top],
          [target.right, target.bottom],
          [target.left, target.bottom],
        ];
    const gap = Math.min(
      ...corners.map(([x, y], i) => {
        const [nx, ny] = corners[(i + 1) % corners.length];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((tip.x - x) * (nx - x) + (tip.y - y) * (ny - y)) / ((nx - x) ** 2 + (ny - y) ** 2),
          ),
        );
        return Math.hypot(tip.x - x - t * (nx - x), tip.y - y - t * (ny - y));
      }),
    );
    expect(gap, `${route.source}->${route.target} painted arrow clearance`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(gap, `${route.source}->${route.target} painted arrow contact`).toBeLessThanOrEqual(5.5);
  }
}

function expectRestart(result: Awaited<ReturnType<typeof measure>>) {
  const node = (id: string) => result.nodes.find((node) => node.id === id)!;
  expect(result.nodes).toHaveLength(8);
  expect(result.routes.map((r) => `${r.source}->${r.target}`).sort()).toEqual(
    ['A->B', 'B->C', 'C->D', 'D->C', 'C->E', 'E->F', 'F->G', 'G->H'].sort(),
  );
  for (const [source, target] of [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'E'],
    ['E', 'F'],
    ['F', 'G'],
    ['G', 'H'],
  ]) {
    expect(
      node(target).top - node(source).bottom,
      `${source}->${target} continues down`,
    ).toBeGreaterThan(12);
  }
  expect(node('D').left - node('C').right, 'retry work is a side branch').toBeGreaterThan(12);
  expect(
    Math.abs(node('D').cy - node('C').cy),
    'side branch stays alongside the decision',
  ).toBeLessThan(1);
  expect(result.labels.map(({ id, text }) => ({ id, text }))).toEqual([
    { id: 'L_C_D_0', text: 'Work active' },
    { id: 'L_C_E_0', text: 'Yes' },
  ]);
  expectClearPaint(result);
}

async function reachSideBranch(
  page: Page,
  result: Awaited<ReturnType<typeof measure>>,
  info: TestInfo,
  name: string,
) {
  const root = page.locator('#restart-note-host .mermaid-renderer');
  const viewport = root.locator('.mermaid-svg-viewport');
  await viewport.scrollIntoViewIfNeeded();
  await viewport.hover();
  await page.mouse.wheel(2000, 0);
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollLeft))
    .toBeGreaterThanOrEqual(
      await viewport.evaluate((e) => Math.max(0, e.scrollWidth - e.clientWidth - 1)),
    );
  const rightmost = result.nodes.toSorted((a, b) => b.right - a.right)[0];
  // Generated node indices are not source identity. Locate the actual ID suffix.
  const visible = await root.locator('g.node').evaluateAll((nodes, id) => {
    const node = nodes.find((node) => node.id.match(/flowchart-(.+)-\d+$/)?.[1] === id)!;
    const n = node.getBoundingClientRect(),
      v = node.closest('.mermaid-svg-viewport')!.getBoundingClientRect();
    return { left: n.left, right: n.right, viewportLeft: v.left, viewportRight: v.right };
  }, rightmost.id);
  expect(visible.left).toBeGreaterThanOrEqual(visible.viewportLeft - 1);
  expect(visible.right).toBeLessThanOrEqual(visible.viewportRight + 1);
  await root.screenshot({ path: info.outputPath(`${name}-scrolled.png`) });
  await page.mouse.wheel(-2000, 0);
  await expect.poll(() => viewport.evaluate((e) => e.scrollLeft)).toBe(0);
}

for (const width of [360, 1000]) {
  test(`exact restart decision at ${width}px`, async ({ page }, info) => {
    await mountNote(page, exactSource, width, info);
    const initial = await measure(page, info, 'initial');
    expectRestart(initial);
    await reachSideBranch(page, initial, info, 'initial');
    for (const [index, next] of [width === 360 ? 1000 : 360, width].entries()) {
      await page.locator('#restart-note-host').evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, next);
      const result = await measure(page, info, `resize-${index}-${next}`);
      expectRestart(result);
      await reachSideBranch(page, result, info, `resize-${index}-${next}`);
      if (next === width) {
        const relative = (r: typeof result) =>
          r.nodes.map((n) => ({
            id: n.id,
            x: n.x - r.svg.x,
            y: n.y - r.svg.y,
            width: n.width,
            height: n.height,
            font: n.font,
          }));
        expect(relative(result)).toEqual(relative(initial));
        // Transform roundoff is not a route change: compare the same commands
        // and coordinates within a millionth of an SVG unit, not their spelling.
        const numbers = /-?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g;
        for (const [index, route] of result.routes.entries()) {
          const before = initial.routes[index].d!;
          expect(route.d!.replace(numbers, '#')).toBe(before.replace(numbers, '#'));
          const actual = route.d!.match(numbers)!.map(Number);
          const expected = before.match(numbers)!.map(Number);
          expect(actual).toHaveLength(expected.length);
          actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(1e-6));
        }
        expect(result.viewBox).toEqual(initial.viewBox);
      }
    }
  });
}

for (const direction of ['TD', 'BT', 'RL'] as const) {
  test(`generic shuffled decision cycle preserves ${direction}`, async ({ page }, info) => {
    const source = `flowchart ${direction}\nFinish[Complete]\nHold[Wait]\nGate{Available?}\nBegin[Receive]\nApply[Continue]\nGate -->|Available| Apply\nApply --> Finish\nHold --> Gate\nBegin --> Gate\nGate -->|Occupied| Hold`;
    await mountNote(page, source, 360, info);
    for (const [index, width] of [360, 1000, 360].entries()) {
      await page.locator('#restart-note-host').evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, width);
      const result = await measure(page, info, `${index}-${width}`);
      const node = (id: string) => result.nodes.find((node) => node.id === id)!;
      expect(result.routes.map((r) => `${r.source}->${r.target}`).sort()).toEqual(
        ['Gate->Apply', 'Apply->Finish', 'Hold->Gate', 'Begin->Gate', 'Gate->Hold'].sort(),
      );
      for (const [a, b] of [
        ['Begin', 'Gate'],
        ['Gate', 'Apply'],
        ['Apply', 'Finish'],
      ]) {
        if (direction === 'TD') expect(node(b).top - node(a).bottom).toBeGreaterThan(12);
        else if (direction === 'BT') expect(node(a).top - node(b).bottom).toBeGreaterThan(12);
        else expect(node(a).left - node(b).right).toBeGreaterThan(12);
      }
      if (direction === 'TD') expectClearPaint(result);
      else {
        expect(result.routes.every((r) => !r.metadata.decisionCycleRoute)).toBe(true);
        expect(result.nodes.every((n) => n.font >= 11.9)).toBe(true);
      }
    }
  });
}

test('paint oracle rejects a false return connection and missing marker pixels', async ({
  page,
}, info) => {
  await mountNote(page, exactSource, 1000, info);
  const result = await measure(page, info, 'control');
  expectRestart(result);
  const path = page.locator('#restart-note-host .edgePaths path[id$="-L_D_C_0"]');
  const original = await path.getAttribute('d');
  await path.evaluate((path: SVGPathElement) => {
    const svg = path.ownerSVGElement!;
    const node = [...svg.querySelectorAll<SVGGElement>('g.node')].find((node) =>
      /flowchart-E-\d+$/.test(node.id),
    )!;
    const box = node.getBoundingClientRect();
    const middle = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
      path.getScreenCTM()!.inverse(),
    );
    const start = path.getPointAtLength(0),
      end = path.getPointAtLength(path.getTotalLength());
    path.setAttribute('d', `M${start.x},${start.y}L${middle.x},${middle.y}L${end.x},${end.y}`);
  });
  expect(() => expectRestart(result)).not.toThrow();
  const crossing = await measure(page, info, 'crossing');
  expect(crossing.nodeCollisions).toContain('D->C:E');
  expect(() => expectRestart(crossing)).toThrow();
  await path.evaluate((path, d) => {
    path.setAttribute('d', d!);
    path.style.markerEnd = 'none';
  }, original);
  const invisible = await measure(page, info, 'invisible-marker');
  expect(invisible.markerPaint[3]).toEqual([]);
  expect(() => expectRestart(invisible)).toThrow();
});

test('marker intrusion oracle rejects inward paint with an unchanged shaft', async ({
  page,
}, info) => {
  await mountNote(page, exactSource, 1000, info);
  const before = await measure(page, info, 'outside-marker');
  expectRestart(before);
  const path = page.locator('#restart-note-host .edgePaths path[id$="-L_D_C_0"]');
  await path.evaluate((path: SVGPathElement) => {
    const id = getComputedStyle(path).markerEnd.match(/#([^\)"']+)/)![1];
    const marker = [...path.ownerSVGElement!.querySelectorAll('marker')].find(
      (marker) => marker.id === id,
    )!;
    const inward = marker.cloneNode(true) as SVGMarkerElement;
    inward.id = `${marker.id}-inward-control`;
    // Move only this actual marker's paint along its existing inward orientation.
    // The path data, transform and router metadata remain untouched.
    inward.setAttribute('refX', String(marker.refX.baseVal.value - 15));
    marker.parentNode!.appendChild(inward);
    path.style.markerEnd = `url(#${inward.id})`;
  });
  const inward = await measure(page, info, 'inward-marker');
  expect(inward.routes.map(({ d, samples }) => ({ d, samples }))).toEqual(
    before.routes.map(({ d, samples }) => ({ d, samples })),
  );
  expect(inward.nodeCollisions).toEqual([]);
  expect(inward.markerCollisions).toContain('L_D_C_0:C');
  expect(() => expect(inward.markerCollisions).toEqual([])).toThrow();
  expect(() => expectRestart(inward)).toThrow();
});
