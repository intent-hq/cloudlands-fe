import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import Preview from '../../diagrams/diagram-workbench.preview.svelte';

const flowTargets = ['Valid?', 'Process request', 'Repair input', 'Valid?', 'Ready'];

async function settled(page: Page, state: string) {
  const root = page.locator(`#${state}`);
  const mermaid = state.startsWith('mermaid-');
  const renderer = root.locator(mermaid ? '.mermaid-renderer' : '.diagram-renderer');
  await expect(renderer).toHaveAttribute(
    mermaid ? 'data-render-settled' : 'data-diagram-settled',
    'true',
    { timeout: 90_000 },
  );
  if (mermaid) {
    const svg = root.locator('.mermaid-svg > svg');
    await expect(svg).toHaveAttribute('data-layout-settled', 'true');
    await expect(svg).toHaveAttribute(
      'data-layout-generation',
      (await renderer.getAttribute('data-render-generation'))!,
    );
  }
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
    { timeout: 90_000 },
  );
  await root.scrollIntoViewIfNeeded();
  await root.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  return root;
}

async function terminals(root: Locator, targets: string[]) {
  return root.evaluate((section, expectedTargets) => {
    const mermaid = section.id.startsWith('mermaid-');
    const flowchart = section.id === 'mermaid-flow';
    const paths = [
      ...section.querySelectorAll<SVGPathElement>(
        mermaid
          ? '.edgePaths path[marker-end], .edges.edgePath path[marker-end]'
          : '.diagram-edge path[marker-end]',
      ),
    ];
    const nodes = mermaid
      ? [...section.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
          id: node.id,
          label: node.textContent?.trim() ?? '',
          shape: node.querySelector<SVGGraphicsElement>(
            ':scope > .label-container, :scope > rect, :scope > circle, :scope > ellipse, :scope > .outer-path, :scope > .basic.label-container, :scope > polygon',
          )!,
        }))
      : [...section.querySelectorAll<HTMLElement>('.diagram-node-html')].map((node) => ({
          id: node.parentElement!.id,
          label: node.querySelector('.node-label')?.textContent?.trim() ?? '',
          shape: node.parentElement as unknown as SVGGraphicsElement,
        }));
    return paths.map((path, index) => {
      const target = path.dataset.terminalTarget
        ? nodes.find((node) => node.id === path.dataset.terminalTarget)!
        : nodes.find((node) => node.label === expectedTargets[index])!;
      const shape = target.shape;
      const bounds = shape.getBoundingClientRect();
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      const end = path.getPointAtLength(length);
      const tangent = path.getPointAtLength(Math.max(0, length - 0.25));
      const angle = Math.atan2(end.y - tangent.y, end.x - tangent.x);
      const markerId = path.getAttribute('marker-end')!.match(/#([^)'"\s]+)/)![1];
      const marker = section.querySelector<SVGMarkerElement>(`marker[id="${markerId}"]`)!;
      const markerPath = marker.querySelector('path')!;
      const markerLength = markerPath.getTotalLength();
      const samples = Array.from({ length: 65 }, (_, i) =>
        markerPath.getPointAtLength((markerLength * i) / 64),
      );
      const markerTip = samples.toSorted((a, b) => b.x - a.x)[0];
      const refX = marker.refX.baseVal.value;
      const refY = marker.refY.baseVal.value;
      const sx = marker.hasAttribute('viewBox')
        ? marker.markerWidth.baseVal.value / marker.viewBox.baseVal.width
        : 1;
      const sy = marker.hasAttribute('viewBox')
        ? marker.markerHeight.baseVal.value / marker.viewBox.baseVal.height
        : 1;
      const tip = new DOMPoint(
        end.x +
          (markerTip.x - refX) * sx * Math.cos(angle) -
          (markerTip.y - refY) * sy * Math.sin(angle),
        end.y +
          (markerTip.x - refX) * sx * Math.sin(angle) +
          (markerTip.y - refY) * sy * Math.cos(angle),
      ).matrixTransform(matrix);
      const screenEnd = new DOMPoint(end.x, end.y).matrixTransform(matrix);
      const screenTangent = new DOMPoint(tangent.x, tangent.y).matrixTransform(matrix);
      let distance: number;
      if (flowchart) {
        // Sample the actual native outline, including diamonds, independently of
        // the renderer's target-intersection and terminal-trimming helpers.
        const outline =
          shape instanceof SVGGeometryElement
            ? shape
            : shape.querySelector<SVGGeometryElement>('path')!;
        const outlineLength = outline.getTotalLength();
        const count = Math.ceil(outlineLength * 8);
        const transform = outline.getScreenCTM()!;
        distance = Infinity;
        for (let i = 0; i <= count; i++) {
          const p = outline
            .getPointAtLength((outlineLength * i) / count)
            .matrixTransform(transform);
          distance = Math.min(distance, Math.hypot(tip.x - p.x, tip.y - p.y));
        }
      } else {
        // Preserve the existing state/custom terminal oracle. These controls
        // exercise their established routes, not flowchart diamond bounds.
        const dx = Math.max(bounds.left - tip.x, 0, tip.x - bounds.right);
        const dy = Math.max(bounds.top - tip.y, 0, tip.y - bounds.bottom);
        distance =
          dx || dy
            ? Math.hypot(dx, dy)
            : -Math.min(
                tip.x - bounds.left,
                bounds.right - tip.x,
                tip.y - bounds.top,
                bounds.bottom - tip.y,
              );
      }
      return {
        id: path.id,
        target: target.label,
        gap: distance - Number.parseFloat(getComputedStyle(markerPath).strokeWidth) / 2,
        inward:
          (tip.x - screenTangent.x) * (bounds.left + bounds.width / 2 - tip.x) +
          (tip.y - screenTangent.y) * (bounds.top + bounds.height / 2 - tip.y),
        join: Math.min(...samples.map((p) => Math.hypot((p.x - refX) * sx, (p.y - refY) * sy))),
        tipToEnd: Math.hypot(tip.x - screenEnd.x, tip.y - screenEnd.y),
        nonempty: length > 0,
      };
    });
  }, targets);
}

function expectTerminals(
  rows: Awaited<ReturnType<typeof terminals>>,
  targets: string[],
  width: 320 | 960 = 320,
) {
  expect(rows.map((row) => row.target)).toEqual(targets);
  for (const row of rows) {
    if (row.target === 'Repair input') {
      // Independent unchanged-production full-motion measurements on 6c8197a0,
      // at the corresponding width. This is closeness to that reference, not
      // exact five-pixel clearance or unchanged reduced-motion corner geometry.
      // The existing rounded-corner limitation is outside #6934's sizing fix.
      const reference = width === 320 ? 6.513054463 : 5.857023819;
      expect(
        Math.abs(row.gap - reference),
        `${row.id} full-motion corner reference`,
      ).toBeLessThanOrEqual(0.35);
    } else {
      expect(Math.abs(row.gap - 5), `${row.id} painted terminal gap`).toBeLessThanOrEqual(0.35);
    }
    expect(row.inward, `${row.id} inward direction`).toBeGreaterThan(0);
    expect(row.join, `${row.id} shaft continuity`).toBeLessThanOrEqual(0.1);
    expect(row.tipToEnd, `${row.id} marker at shaft end`).toBeLessThanOrEqual(0.1);
    expect(row.nonempty).toBe(true);
  }
}

const cases = [
  { state: 'mermaid-flow', motion: 'catalog-reduced', targets: flowTargets },
  { state: 'mermaid-flow', motion: 'system-reduced', targets: flowTargets },
  { state: 'mermaid-flow', motion: 'full', targets: flowTargets },
  {
    state: 'mermaid-state-recovery',
    motion: 'catalog-reduced',
    targets: ['Running', 'Complete', 'Failed', 'Running', '', ''],
  },
  {
    state: 'custom-state-machine',
    motion: 'catalog-reduced',
    targets: ['Loading', 'Ready', 'Invalid source', 'Idle'],
  },
];

for (const { state, motion, targets } of cases) {
  test(`keeps arrow targets connected at readable scale: ${state} ${motion}`, async ({
    mount,
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.emulateMedia({
      colorScheme: 'light',
      reducedMotion: motion === 'system-reduced' ? 'reduce' : 'no-preference',
    });
    await page.locator('#root').evaluate((root, motion) => {
      document.documentElement.classList.add('light');
      if (motion !== 'system-reduced')
        document.documentElement.classList.add(
          motion === 'full' ? 'catalog-full-motion' : 'catalog-reduced-motion',
        );
      root.setAttribute(
        'style',
        'width:320px;max-width:100%;padding:0;border:0;font-family:var(--font-ui);--font-ui:"Inter Variable",Inter,system-ui,sans-serif',
      );
    }, motion);
    await page.evaluate(async () => {
      await document.fonts.load('13px "Inter Variable"');
      await document.fonts.ready;
    });
    await mount(Preview, {
      hooksConfig: { geometrySnapshot: { scene: 'diagram-workbench', state } },
    });
    const root = await settled(page, state);
    const rows = await terminals(root, targets);
    await info.attach('initial-terminals', {
      body: JSON.stringify(rows, null, 2),
      contentType: 'application/json',
    });
    expectTerminals(rows, targets);
    await info.attach('diagram', {
      body: await root
        .locator(state.startsWith('mermaid-') ? '.mermaid-renderer' : '.diagram-renderer')
        .screenshot(),
      contentType: 'image/png',
    });
    if (state === 'mermaid-flow' && motion === 'catalog-reduced') {
      const expectNativeLayout = async () => {
        const layout = await root.locator('.mermaid-svg > svg').evaluate((svg) => ({
          nodes: [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => ({
            id: node.id.match(/-flowchart-(.+)-\d+$/)![1],
            x: node.transform.baseVal.consolidate()!.matrix.e,
          })),
          routes: [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map(
            (path) => path.id.match(/-(L_.+)$/)![1],
          ),
        }));
        expect(layout.nodes.map((node) => node.id).sort()).toEqual([
          'Check',
          'Done',
          'Fix',
          'Start',
          'Work',
        ]);
        expect(layout.routes).toEqual([
          'L_Start_Check_0',
          'L_Check_Work_0',
          'L_Check_Fix_0',
          'L_Fix_Check_0',
          'L_Work_Done_0',
        ]);
        const x = (id: string) => layout.nodes.find((node) => node.id === id)!.x;
        expect(x('Start')).toBeLessThan(x('Check'));
        expect(x('Check')).toBeLessThan(x('Work'));
        expect(x('Check')).toBeLessThan(x('Fix'));
        expect(x('Work')).toBeLessThan(x('Done'));
      };
      await expectNativeLayout();
      for (const width of [960, 320] as const) {
        await page.locator('#root').evaluate((el, width) => {
          el.style.width = `${width}px`;
        }, width);
        await settled(page, state);
        const resized = await terminals(root, targets);
        await info.attach(`terminals-at-${width}`, {
          body: JSON.stringify(resized, null, 2),
          contentType: 'application/json',
        });
        expectTerminals(resized, targets, width);
        await expectNativeLayout();
      }
    }
  });
}
