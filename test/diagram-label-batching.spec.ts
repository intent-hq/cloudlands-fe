import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import {
  CUSTOM_WORKBENCH_CASES,
  MERMAID_WORKBENCH_CASES,
} from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

async function openPreview(page: Page, info: TestInfo) {
  const paths = [
    'src/lib/components/markdown/MermaidRenderer.svelte',
    'src/lib/components/markdown/mermaid-label-knockouts.ts',
  ];
  const responses = paths.map((path) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/${path}` && !url.searchParams.has('type');
    }),
  );
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?state=mermaid-flow&motion=reduced`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  for (const [index, response] of responses.entries()) {
    const path = paths[index];
    const body = await (await response).text();
    const encoded = body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const map = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8'));
    const source =
      map.sourcesContent[
        map.sources.findIndex((source: string) => source.endsWith(path.split('/').at(-1)!))
      ];
    expect(source).toBe(await readFile(path, 'utf8'));
    await info.attach('source-identity', {
      body: JSON.stringify({ path, sha256: createHash('sha256').update(source).digest('hex') }),
      contentType: 'application/json',
    });
  }
  await page.evaluate(() => document.fonts.ready);
}

test('sequence conditions keep the dependent synchronous knockout caller', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __conditionInsertions: { svgId: string; gaps: number[] }[];
    };
    w.__conditionInsertions = [];
    const insert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(node: T, before: Node | null): T {
      const condition =
        before instanceof SVGTextElement && before.matches('.sequence-branch-condition')
          ? before
          : null;
      const bounds = condition?.getBBox();
      const result = insert.call(this, node, before) as T;
      if (
        bounds &&
        condition &&
        node instanceof SVGRectElement &&
        node.matches('.edge-label-knockout')
      ) {
        const paint = node.getBBox();
        w.__conditionInsertions.push({
          svgId: condition.ownerSVGElement?.id ?? '',
          gaps: [
            bounds.x - paint.x,
            paint.x + paint.width - bounds.x - bounds.width,
            bounds.y - paint.y,
            paint.y + paint.height - bounds.y - bounds.height,
          ],
        });
      }
      return result;
    };
  });
  await openPreview(page, info);
  const root = page.locator('#mermaid-sequence-alt');
  await root.scrollIntoViewIfNeeded();
  await expect(root.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
    timeout: 30_000,
  });
  await expect(root.locator('.mermaid-error')).toHaveCount(0);
  const result = await root.locator('svg[data-layout-settled=true]').evaluate((svg) => {
    const conditions = [...svg.querySelectorAll<SVGTextElement>('.sequence-branch-condition')].map(
      (text) => {
        const bounds = text.getBBox();
        const background = text.previousElementSibling as SVGRectElement;
        const paint = background.getBBox();
        return {
          condition: text.getAttribute('aria-label'),
          lines: text.querySelectorAll('tspan').length,
          gaps: [
            bounds.x - paint.x,
            paint.x + paint.width - bounds.x - bounds.width,
            bounds.y - paint.y,
            paint.y + paint.height - bounds.y - bounds.height,
          ],
        };
      },
    );
    const w = window as typeof window & {
      __conditionInsertions: { svgId: string; gaps: number[] }[];
    };
    return {
      conditions,
      insertions: w.__conditionInsertions.filter((row) => row.svgId === svg.id),
    };
  });
  await info.attach('dependent-condition-geometry', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  expect(result.conditions.map((r) => r.condition)).toEqual(['request valid', 'validation failed']);
  expect(result.insertions.length).toBeGreaterThanOrEqual(2);
  for (const insertion of result.insertions) {
    for (const [index, gap] of insertion.gaps.entries())
      expect(gap).toBeCloseTo(index < 2 ? 6 : 4, 2);
  }
  for (const condition of result.conditions) {
    expect(condition.lines).toBeGreaterThan(0);
    // Later presentation styles can change text metrics; it must remain inside its knockout.
    for (const gap of condition.gaps) expect(gap).toBeGreaterThanOrEqual(0);
  }
  await root
    .locator('.mermaid-svg')
    .screenshot({ path: info.outputPath('sequence-conditions.png') });
});

test('knockouts preserve real font geometry, local offsets, order and idempotency', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await openPreview(page, info);
  const result = await page.evaluate(async () => {
    const { addMermaidLabelKnockouts } =
      await import('/src/lib/components/markdown/mermaid-label-knockouts.ts');
    const host = document.createElement('div');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400">
      <style>.edge-label-knockout { fill: #fff; stroke: #ccc; }</style>
      <g transform="translate(50 50) scale(1.25)" style="font:italic 18px 'Inter Variable',sans-serif">
        <g class="edgeLabel"><title>Edge</title><text id="edge" x="120" y="30" text-anchor="middle">Actual glyph widths</text></g>
        <text class="messageText" id="message" x="20" y="90"><tspan x="20">Long first line</tspan><tspan x="20" dy="24">Short</tspan></text>
      </g>
      <g transform="translate(440 60) scale(0.8)" style="font:600 22px monospace">
        <text class="loopText" id="loop" x="140" y="25" text-anchor="end">Repeat until complete</text>
      </g>
      <g class="edgeLabel"><rect class="background"/><text>Existing</text></g>
      <g class="edgeLabel"><foreignObject width="50" height="20"/></g>
      <text class="messageText"> </text>
    </svg>`;
    document.body.replaceChildren(host);
    await document.fonts.ready;
    const svg = host.querySelector('svg')!;
    const texts = [...svg.querySelectorAll<SVGTextElement>('text[id]')];
    const original = texts.map((text) => ({
      text,
      bounds: text.getBoundingClientRect().toJSON(),
      font: getComputedStyle(text).font,
      transform: text.parentElement!.getAttribute('transform'),
    }));
    const events: string[] = [];
    const bbox = SVGGraphicsElement.prototype.getBBox;
    const insert = Node.prototype.insertBefore;
    SVGGraphicsElement.prototype.getBBox = function (...args) {
      events.push('read');
      return bbox.apply(this, args);
    };
    Node.prototype.insertBefore = function (node, before) {
      events.push('write');
      return insert.call(this, node, before);
    };
    try {
      addMermaidLabelKnockouts(svg);
    } finally {
      SVGGraphicsElement.prototype.getBBox = bbox;
      Node.prototype.insertBefore = insert;
    }
    const geometry = original.map(({ text, bounds, font, transform }) => {
      const rect = (
        text.id === 'edge' ? text.parentElement!.firstElementChild : text.previousElementSibling
      ) as SVGRectElement;
      const paint = rect.getBoundingClientRect();
      const scale = Math.hypot(rect.getScreenCTM()!.a, rect.getScreenCTM()!.b);
      return {
        id: text.id,
        bounds,
        after: text.getBoundingClientRect().toJSON(),
        clearances: [
          (bounds.left - paint.left) / scale,
          (paint.right - bounds.right) / scale,
          (bounds.top - paint.top) / scale,
          (paint.bottom - bounds.bottom) / scale,
        ],
        fontUnchanged: font === getComputedStyle(text).font,
        transformUnchanged: transform === text.parentElement!.getAttribute('transform'),
      };
    });
    const once = svg.outerHTML;
    addMermaidLabelKnockouts(svg);
    return { geometry, events, idempotent: svg.outerHTML === once };
  });
  await info.attach('real-svg-geometry', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('knockout-geometry.png') });
  expect(result.geometry).toHaveLength(3);
  for (const label of result.geometry) {
    expect(label.after).toEqual(label.bounds);
    expect(label.fontUnchanged && label.transformUnchanged).toBe(true);
    for (const [index, clearance] of label.clearances.entries()) {
      expect(clearance).toBeCloseTo(index < 2 ? 6 : 4, 2);
    }
  }
  expect(result.idempotent).toBe(true);
  expect(result.events).toEqual(['read', 'read', 'read', 'write', 'write', 'write']);
});

const mermaidKeys = [
  'mermaid-flow',
  'mermaid-sequence-simple',
  'mermaid-sequence-alt',
  'mermaid-sequence-loop',
  'mermaid-sequence-note',
  'mermaid-state',
  'mermaid-class',
  'mermaid-entity-relationship',
  'mermaid-long-labels',
  'mermaid-nested-routing',
  'mermaid-cycle-fanout',
  'mermaid-topology-stress',
] as const;
const customKeys = [
  'custom-architecture',
  'custom-sequence',
  'custom-state-machine',
  'custom-data-flow',
  'custom-flowchart',
  'custom-network',
  'custom-timeline',
  'custom-dependency-graph',
  'custom-walkthrough',
  'custom-delivery-walkthrough',
  'custom-service-boundaries',
  'custom-long-multiline-labels',
] as const;

test('real 24-block note accepts pending inputs and exposes successful offscreen output', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const hostLoad = loadavg();
  await openPreview(page, info);
  const blocks = [
    ...mermaidKeys.map((key) => {
      const fixture = MERMAID_WORKBENCH_CASES[key];
      return `## ${fixture.title}\n\n~~~mermaid\n${fixture.source}\n~~~`;
    }),
    ...customKeys.map((key) => {
      const fixture = CUSTOM_WORKBENCH_CASES[key];
      const currentStateId =
        key === 'custom-walkthrough'
          ? 'render'
          : key === 'custom-delivery-walkthrough'
            ? 'observe'
            : fixture.diagram.currentStateId;
      return `## ${fixture.title}\n\n\`\`\`diagram\n${JSON.stringify({ ...fixture.diagram, currentStateId })}\n\`\`\``;
    }),
  ];
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.name));
  await page.mouse.move(200, 200);
  await page.evaluate(async (content) => {
    const [{ mount }, { default: NoteWithComments }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/workspace/NoteWithComments.svelte'),
    ]);
    const host = document.createElement('div');
    host.id = 'batching-note-host';
    host.style.cssText = 'width:960px;height:900px;margin-left:80px';
    document.body.replaceChildren(host);
    const pending = () =>
      [...host.querySelectorAll('.mermaid-renderer')].filter(
        (e) => e.getAttribute('data-render-settled') !== 'true',
      ).length;
    const metrics = {
      started: performance.now(),
      longTasks: [] as number[],
      inputs: [] as { type: string; pending: number; trusted: boolean; latency: number }[],
    };
    const observer = new PerformanceObserver((list) => {
      metrics.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ type: 'longtask' });
    const onInput = (event: Event) =>
      metrics.inputs.push({
        type: event.type,
        pending: pending(),
        trusted: event.isTrusted,
        latency: Math.max(0, performance.now() - event.timeStamp),
      });
    host.addEventListener('keydown', onInput, true);
    host.addEventListener('wheel', onInput, { capture: true, passive: true });
    Object.assign(window, {
      __batchingMetrics: metrics,
      __stopBatchingMetrics: () => observer.disconnect(),
    });
    mount(NoteWithComments, {
      target: host,
      props: {
        workspace: {
          id: 'local-batching-test',
          title: 'Local batching test',
          branch: 'test',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: 'Active',
          createdAt: '2026-09-12T00:00:00.000Z',
          updatedAt: '2026-09-12T00:00:00.000Z',
        },
        content,
        editable: true,
        showSuggestions: false,
        showComments: false,
      },
    });
  }, blocks.join('\n\n'));
  const note = page.locator('#batching-note-host');
  await note.locator('.ProseMirror h2').first().click({ timeout: 10_000 });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowDown');
    await page.mouse.wheel(0, i % 2 ? -90 : 180);
  }
  await expect(note.locator('.node-mermaidBlock')).toHaveCount(12);
  await expect(note.locator('.node-diagram_block')).toHaveCount(12);
  await expect(note.locator('.mermaid-renderer[data-render-settled=true]')).toHaveCount(12, {
    timeout: 30_000,
  });
  await expect(note.locator('.diagram-renderer[data-diagram-settled=true]')).toHaveCount(12, {
    timeout: 30_000,
  });
  const metrics = await page.evaluate(() => {
    const w = window as typeof window & {
      __batchingMetrics: { started: number };
      __stopBatchingMetrics: () => void;
    };
    w.__stopBatchingMetrics();
    return { ...w.__batchingMetrics, elapsed: performance.now() - w.__batchingMetrics.started };
  });
  await info.attach('local-loading', {
    body: JSON.stringify({ hostLoad, finalHostLoad: loadavg(), metrics }),
    contentType: 'application/json',
  });
  const errors = await note.locator('.mermaid-error, .diagram-error').evaluateAll((cards) =>
    cards.map((card) => ({
      source: card.querySelector('.error-source-code')?.textContent,
      error: card.querySelector('.error-message')?.textContent,
    })),
  );
  await info.attach('diagram-errors', {
    body: JSON.stringify(errors),
    contentType: 'application/json',
  });
  const inputs = (metrics as typeof metrics & { inputs: { pending: number; trusted: boolean }[] })
    .inputs;
  expect(inputs.filter((input) => input.trusted && input.pending > 0).length).toBeGreaterThan(0);
  const lanes = note.locator('.node-mermaidBlock, .node-diagram_block');
  const geometry = await lanes.evaluateAll((lanes) =>
    lanes.map((lane) => {
      const viewport = lane.querySelector('.mermaid-svg-viewport, .diagram-scroll-container');
      const svg = viewport?.querySelector('svg');
      if (!svg) return { width: 0, height: 0, paint: 0, finite: false, visiblePaint: 0 };
      const bounds = svg.getBoundingClientRect();
      const paint = [...svg.querySelectorAll<SVGGraphicsElement>('path, text, rect, foreignObject')]
        .filter((e) => !e.closest('defs'))
        .map((e) => e.getBoundingClientRect());
      return {
        width: bounds.width,
        height: bounds.height,
        paint: paint.length,
        finite: paint.every((r) => [r.x, r.y, r.width, r.height].every(Number.isFinite)),
        visiblePaint: paint.filter((r) => r.width > 0 || r.height > 0).length,
      };
    }),
  );
  await info.attach('all-block-geometry', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  for (const index of [12, 22, 23]) {
    const drawing = lanes.nth(index).locator('.mermaid-svg > svg, .diagram-svg-layer');
    await drawing.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await expect(drawing).toBeInViewport();
  }
  await note.screenshot({ path: info.outputPath('last-section.png') });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(geometry).toHaveLength(24);
  for (const row of geometry) {
    expect(row.finite).toBe(true);
    expect(row.width).toBeGreaterThan(0);
    expect(row.height).toBeGreaterThan(0);
    expect(row.visiblePaint).toBeGreaterThan(0);
  }
});
