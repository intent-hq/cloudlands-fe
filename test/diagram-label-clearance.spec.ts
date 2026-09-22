import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { DiagramPrimitive } from '../src/shared/types/notes-primitives';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import { expectDrawingReachable } from './diagram-scroll-reachability';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

function input(reciprocal: boolean): DiagramPrimitive {
  return {
    id: reciprocal ? 'reciprocal-clearance' : 'exhausted-clearance',
    type: 'diagram',
    version: 1,
    createdAt: '2026-09-12T00:00:00.000Z',
    createdBy: 'user',
    grammar: 'flowchart',
    label: 'Connector clearance',
    model: {
      nodes: [
        {
          id: 'source',
          label: 'Source',
          kind: 'process',
          position: { x: 0, y: 0 },
          size: { width: 120, height: 60 },
        },
        {
          id: 'target',
          label: 'Target',
          kind: 'process',
          position: { x: 0, y: reciprocal ? 260 : 1060 },
          size: { width: 120, height: 60 },
        },
        ...(reciprocal
          ? [
              {
                id: 'obstacle',
                label: 'Nearby node',
                kind: 'process',
                position: { x: 126, y: 100 },
                size: { width: 120, height: 60 },
              },
            ]
          : [
              {
                id: 'upper',
                label: 'Upper obstacle',
                kind: 'process',
                position: { x: 100, y: 80 },
                size: { width: 120, height: 385 },
              },
              {
                id: 'lower',
                label: 'Lower obstacle',
                kind: 'process',
                position: { x: 110, y: 505 },
                size: { width: 120, height: 535 },
              },
            ]),
      ],
      edges: [
        { id: 'forward', from: 'source', to: 'target', label: 'Forward message' },
        ...(reciprocal
          ? [{ id: 'reverse', from: 'target', to: 'source', label: 'Reverse message' }]
          : []),
      ],
    },
    baseView: { layout: { type: 'manual', direction: 'TB' } },
    states: [{ id: 'all' }],
    currentStateId: 'all',
  };
}

async function mountNote(page: Page, width: number, diagram: DiagramPrimitive) {
  await page.setViewportSize({ width: 1300, height: 1400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(
    async ({ width, diagram }) => {
      const legacyModule = '/@id/svelte/legacy';
      const noteModule = '/src/lib/components/workspace/NoteWithComments.svelte';
      const [{ createClassComponent }, { default: NoteWithComments }] = await Promise.all([
        import(/* @vite-ignore */ legacyModule),
        import(/* @vite-ignore */ noteModule),
      ]);
      const host = document.createElement('div');
      host.id = 'clearance-note';
      host.style.cssText = `width:${width}px;height:1300px;margin-left:80px`;
      document.body.replaceChildren(host);
      createClassComponent({
        component: NoteWithComments,
        target: host,
        props: {
          workspace: {
            id: 'clearance-test',
            title: 'Local test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-12T00:00:00.000Z',
            updatedAt: '2026-09-12T00:00:00.000Z',
          },
          content: `## Connector clearance\n\nAdjacent note text.\n\n\`\`\`diagram\n${JSON.stringify(diagram)}\n\`\`\`\n\nFollowing note text.`,
          editable: true,
          showSuggestions: false,
          showComments: true,
        },
      });
    },
    { width, diagram },
  );
  const root = page.locator('#clearance-note .diagram-renderer');
  await expect(root).toHaveCount(1);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  return root;
}

async function paint(root: Locator) {
  return root.evaluate((root) => {
    const box = (e: Element) => e.getBoundingClientRect().toJSON();
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      a.right > b.left + 0.5 &&
      a.top < b.bottom - 0.5 &&
      a.bottom > b.top + 0.5;
    const nodes = [...root.querySelectorAll<HTMLElement>('.diagram-node-html')].map((e) => ({
      id: e.closest<SVGForeignObjectElement>('[data-node-id]')!.dataset.nodeId!,
      bounds: box(e),
    }));
    const headers = [...root.querySelectorAll('.group-label')].map((e) => ({
      text: e.textContent,
      bounds: box(e),
    }));
    const paths = [...root.querySelectorAll<SVGPathElement>('.diagram-edge .edge-path')];
    const routes = paths.map((path) => {
      const length = path.getTotalLength();
      const matrix = path.getScreenCTM()!;
      const steps = Math.ceil(length * Math.hypot(matrix.a, matrix.b));
      const samples = Array.from({ length: steps + 1 }, (_, i) =>
        path.getPointAtLength((length * i) / steps).matrixTransform(matrix),
      );
      return {
        id: path.closest<SVGGElement>('[data-edge-id]')!.dataset.edgeId,
        d: path.getAttribute('d'),
        marker: path.getAttribute('marker-end'),
        dash: getComputedStyle(path).strokeDasharray,
        headerHits: headers
          .filter((header) =>
            samples.some(
              (p) =>
                p.x > header.bounds.left &&
                p.x < header.bounds.right &&
                p.y > header.bounds.top &&
                p.y < header.bounds.bottom,
            ),
          )
          .map((header) => header.text),
        samples,
      };
    });
    const labels = [...root.querySelectorAll<SVGForeignObjectElement>('.edge-label-container')];
    const labelResults = labels.map((label) => {
      const bounds = label.getBoundingClientRect();
      const id = label.dataset.edgeId;
      const content = label.querySelector<HTMLElement>('.edge-label-html')!;
      const matrix = label.getScreenCTM()!;
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const distances = routes.map((route) => ({
        id: route.id,
        distance: Math.min(...route.samples.map((p) => Math.hypot(p.x - center.x, p.y - center.y))),
      }));
      const range = document.createRange();
      range.selectNodeContents(content);
      return {
        id,
        text: content.textContent,
        bounds: box(label),
        glyphs: [...range.getClientRects()].map((r) => r.toJSON()),
        fontSize: parseFloat(getComputedStyle(content).fontSize) * Math.hypot(matrix.a, matrix.b),
        nodeHits: nodes.filter((node) => intersects(bounds, node.bounds)).map((node) => node.id),
        headerHits: headers
          .filter((header) => intersects(bounds, header.bounds))
          .map((header) => header.text),
        labelHits: labels
          .filter((other) => other !== label && intersects(bounds, other.getBoundingClientRect()))
          .map((other) => other.dataset.edgeId),
        unrelatedRouteHits: routes
          .filter(
            (route) =>
              route.id !== id &&
              route.samples.some(
                (p) =>
                  p.x > bounds.left + 0.5 &&
                  p.x < bounds.right - 0.5 &&
                  p.y > bounds.top + 0.5 &&
                  p.y < bounds.bottom - 0.5,
              ),
          )
          .map((route) => route.id),
        distances,
      };
    });
    return {
      nodes,
      headers,
      labels: labelResults,
      routes: routes.map(({ samples, ...route }) => ({
        ...route,
        sharedRuns: routes
          .filter((other) => {
            if (other.id === route.id) return false;
            let run = 0;
            return samples.some((point) => {
              const near = other.samples.some(
                (p) => Math.hypot(p.x - point.x, p.y - point.y) < 0.5,
              );
              run = near ? run + 1 : 0;
              return run >= 10;
            });
          })
          .map((other) => other.id),
        start: { x: samples[0].x, y: samples[0].y },
        end: { x: samples.at(-1)!.x, y: samples.at(-1)!.y },
      })),
      viewport: box(root.querySelector('.diagram-scroll-container')!),
      footer: root.querySelector('.diagram-controls')
        ? box(root.querySelector('.diagram-controls')!)
        : null,
    };
  });
}

function assertClear(
  result: Awaited<ReturnType<typeof paint>>,
  diagram: DiagramPrimitive,
  stateId = diagram.currentStateId ?? diagram.states?.[0]?.id,
) {
  const state = diagram.states?.find((state) => state.id === stateId);
  const visibleEdges = diagram.model.edges.filter(
    (edge) => !state?.visibleEdges || state.visibleEdges.includes(edge.id),
  );
  expect(result.routes.map((r) => r.id).sort()).toEqual(visibleEdges.map((e) => e.id).sort());
  expect(result.labels).toHaveLength(visibleEdges.filter((e) => e.label).length);
  const distanceToNode = (point: { x: number; y: number }, id: string) => {
    const node = result.nodes.find((node) => node.id === id)!.bounds;
    return Math.hypot(
      Math.max(node.left - point.x, point.x - node.right, 0),
      Math.max(node.top - point.y, point.y - node.bottom, 0),
    );
  };
  for (const edge of visibleEdges) {
    const route = result.routes.find((route) => route.id === edge.id)!;
    expect(route.marker, `${edge.id} destination arrow`).toBeTruthy();
    expect(
      distanceToNode(route.start, edge.from),
      `${edge.id} source ownership`,
    ).toBeLessThanOrEqual(2.5);
    expect(distanceToNode(route.end, edge.to), `${edge.id} terminal gap`).toBeCloseTo(5.5, 0);
  }
  for (const label of result.labels) {
    expect(label.nodeHits, `${label.id} nodes`).toHaveLength(0);
    expect(label.headerHits, `${label.id} headers`).toHaveLength(0);
    expect(label.labelHits, `${label.id} labels`).toHaveLength(0);
    expect(label.unrelatedRouteHits, `${label.id} unrelated routes`).toHaveLength(0);
    expect(
      label.distances.find((r) => r.id === label.id)!.distance,
      `${label.id} own edge`,
    ).toBeLessThanOrEqual(1.5);
    expect(label.fontSize).toBeGreaterThanOrEqual(10 - 0.01);
    expect(
      label.glyphs.every(
        (r) =>
          r.left >= label.bounds.left - 0.5 &&
          r.right <= label.bounds.right + 0.5 &&
          r.top >= label.bounds.top - 0.5 &&
          r.bottom <= label.bounds.bottom + 0.5,
      ),
      `${label.id} readable glyphs`,
    ).toBe(true);
  }
}

for (const reciprocal of [true, false]) {
  test(`clears ${reciprocal ? 'reciprocal two-point' : 'exhausted candidate'} labels in a real note`, async ({
    page,
  }, info) => {
    const diagram = input(reciprocal);
    const root = await mountNote(page, 960, diagram);
    const result = await paint(root);
    await writeFile(info.outputPath('paint.json'), JSON.stringify({ diagram, result }, null, 2));
    await root.screenshot({ path: info.outputPath('note.png'), animations: 'disabled' });
    assertClear(result, diagram);
  });
}

for (const width of [320, 960]) {
  for (const name of ['custom-walkthrough', 'custom-architecture'] as const) {
    test(`preserves untouched ${name} note paint at ${width}px`, async ({ page }, info) => {
      const diagram = CUSTOM_WORKBENCH_CASES[name].diagram;
      const root = await mountNote(page, width, diagram);
      const states = diagram.states!;
      for (const [index, state] of states.entries()) {
        if (index > 0) {
          await root.locator(`[data-diagram-step-index="${index}"]`).click();
          await expect(root).toHaveAttribute('data-diagram-state', state.id);
          await expect(root).toHaveAttribute('data-diagram-settled', 'true');
        }
        const result = await paint(root);
        await writeFile(info.outputPath(`step-${index}.json`), JSON.stringify(result, null, 2));
        await root.screenshot({
          path: info.outputPath(`step-${index}.png`),
          animations: 'disabled',
        });
        assertClear(result, diagram, state.id);
        await expectDrawingReachable(root);
      }
    });
  }
}

for (const name of ['custom-state-machine', 'custom-architecture'] as const) {
  test(`separates authored ${name} routes through narrow, wide and resize`, async ({
    page,
  }, info) => {
    const diagram = CUSTOM_WORKBENCH_CASES[name].diagram;
    const width = name === 'custom-architecture' ? 420 : 320;
    const root = await mountNote(page, width, diagram);
    for (const [resizeIndex, hostWidth] of [width, 960, width].entries()) {
      await page.locator('#clearance-note').evaluate(async (host, value) => {
        host.style.width = `${value}px`;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, hostWidth);
      await expect
        .poll(() => page.locator('#clearance-note').evaluate((host) => host.clientWidth))
        .toBe(hostWidth);
      const states = diagram.states ?? [{ id: undefined }];
      for (const [index, state] of states.entries()) {
        if (states.length > 1) await root.locator(`[data-diagram-step-index="${index}"]`).click();
        if (state.id) await expect(root).toHaveAttribute('data-diagram-state', state.id);
        await expect(root).toHaveAttribute('data-diagram-settled', 'true');
        const result = await paint(root);
        await writeFile(
          info.outputPath(`resize-${resizeIndex}-${hostWidth}-step-${index}.json`),
          JSON.stringify(result, null, 2),
        );
        await root.screenshot({
          path: info.outputPath(`resize-${resizeIndex}-${hostWidth}-step-${index}.png`),
          animations: 'disabled',
        });
        assertClear(result, diagram, state.id);
        for (const route of result.routes) {
          expect(route.headerHits, `${route.id} avoids painted group titles`).toHaveLength(0);
          expect(route.sharedRuns, `${route.id} distinct branch and return ownership`).toHaveLength(
            0,
          );
          const edge = diagram.model.edges.find((edge) => edge.id === route.id)!;
          expect(route.dash !== 'none', `${route.id} preserves dashes`).toBe(
            Boolean(edge.dashed || edge.animated),
          );
        }
        await expectDrawingReachable(root);
      }
    }
  });
}
