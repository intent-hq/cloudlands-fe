import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const CONCEPT_ADD_SOURCE = `graph LR
  A[Sidebar repo group] -->|click header| B[Project page]
  B -->|project.get| D[intentd project table]
  B -->|project.auditAgentContext| E[intentd repo scan of agent config]
  B -->|workspace.list filter| F[intentd workspace rows]
  D -->|project prompt| G[Agent prompt assembly rules layer]`;
const CONCEPT_NODES = ['A', 'B', 'D', 'E', 'F', 'G'];
const CONCEPT_ROUTES = ['L_A_B_0', 'L_B_D_0', 'L_B_E_0', 'L_B_F_0', 'L_D_G_0'];
const CONCEPT_LABELS = [
  'click header',
  'project.get',
  'project.auditAgentContext',
  'workspace.list filter',
  'project prompt',
];
const NATIVE_NOTE_HOST_WIDTH = 1336;
const CYCLE_NODES = ['Hub', 'Flow', 'Sequence', 'State', 'ER', 'Review'];
const CYCLE_ROUTES = [
  'L_Hub_Flow_0',
  'L_Hub_Sequence_0',
  'L_Hub_State_0',
  'L_Hub_ER_0',
  'L_Flow_Review_0',
  'L_Sequence_Review_0',
  'L_State_Review_0',
  'L_ER_Review_0',
  'L_Review_Hub_0',
];

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openState(page: Page, state: string, motion: 'full' | 'reduced' = 'reduced') {
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=${state}&theme=light&width=960&motion=${motion}`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function mountConceptAdd(page: Page, motion: 'full' | 'reduced') {
  await openState(page, 'mermaid-cycle-fanout', motion);
  await page.evaluate(async (source) => {
    const [{ mount }, { default: MermaidBlockNodeView }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/tiptap/MermaidBlockNodeView.svelte'),
    ]);
    const host = document.createElement('div');
    host.id = 'concept-add-test-host';
    host.style.cssText = 'width:1336px;container-type:inline-size';
    const positioning = document.createElement('div');
    positioning.style.cssText =
      'width:min(960px,100%);padding:0 48px;box-sizing:border-box;margin-inline:auto';
    const editor = document.createElement('div');
    editor.className = 'tiptap ProseMirror tiptap-editor';
    editor.style.width = '100%';
    const lane = document.createElement('div');
    lane.className = 'node-mermaidBlock svelte-renderer';
    editor.append(lane);
    positioning.append(editor);
    host.append(positioning);
    document.body.replaceChildren(host);
    mount(MermaidBlockNodeView, {
      target: lane,
      props: {
        node: { attrs: { code: source } },
        selected: false,
        updateAttributes: () => undefined,
        editor: { isEditable: true },
      },
    });
  }, CONCEPT_ADD_SOURCE);
}

async function mermaidGeometry(
  page: Page,
  selector: string,
  expected: { nodes: string[]; routes: string[]; labels: string[] },
) {
  return page.locator(selector).evaluate((root, contract) => {
    const renderer = root.querySelector<HTMLElement>('.mermaid-renderer');
    const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport');
    const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg');
    const round = (value: number) => Math.round(value * 100) / 100;
    const boundsOf = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return [bounds.left, bounds.top, bounds.width, bounds.height].map(round);
    };
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    if (!renderer || !viewport || !svg) return { missingRoot: true };

    const nodeElements = [...svg.querySelectorAll<SVGGElement>('g.node')];
    const pathElements = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')];
    const labelElements = [...svg.querySelectorAll<SVGGElement>('.edgeLabels > .edgeLabel')].filter(
      (element) => element.textContent?.trim(),
    );
    const nodes = contract.nodes.map((id) => {
      const element = nodeElements.find((candidate) => candidate.id.includes(`-flowchart-${id}-`));
      return element ? { id, bounds: boundsOf(element), visible: visible(element) } : { id };
    });
    const routes = contract.routes.map((id) => {
      const element = pathElements.find((candidate) => candidate.dataset.id === id);
      return element ? { id, bounds: boundsOf(element), visible: visible(element) } : { id };
    });
    const labels = contract.labels.map((text) => {
      const element = labelElements.find((candidate) => candidate.textContent?.trim() === text);
      return element ? { text, bounds: boundsOf(element), visible: visible(element) } : { text };
    });
    const painted = [...nodeElements, ...pathElements, ...labelElements];
    const viewportBounds = viewport.getBoundingClientRect();
    const svgBounds = svg.getBoundingClientRect();
    const lane = renderer.closest<HTMLElement>('.node-mermaidBlock');
    const nodeView = renderer.closest<HTMLElement>('[data-node-view-wrapper]');
    const presentation = renderer.closest<HTMLElement>('[data-diagram-presentation]');
    const matrix = svg.getScreenCTM();
    const records = [...nodes, ...routes, ...labels];
    return {
      missingRoot: false,
      fonts: document.fonts.status,
      generation: Number(renderer.dataset.renderGeneration),
      settled: renderer.dataset.renderSettled,
      layoutSettled: svg.dataset.layoutSettled,
      viewBox: svg.getAttribute('viewBox'),
      svgBounds: boundsOf(svg),
      viewportBounds: boundsOf(viewport),
      laneBounds: lane ? boundsOf(lane) : null,
      nodeViewBounds: nodeView ? boundsOf(nodeView) : null,
      presentationBounds: presentation ? boundsOf(presentation) : null,
      ctm: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round) : null,
      scroll: [
        viewport.scrollLeft,
        viewport.scrollTop,
        viewport.scrollWidth,
        viewport.scrollHeight,
      ],
      counts: [nodeElements.length, pathElements.length, labelElements.length],
      nodes,
      routes,
      labels,
      finite: records.every(
        (record) =>
          'bounds' in record &&
          record.bounds.length === 4 &&
          record.bounds.every(Number.isFinite) &&
          (record.bounds[2] > 0 || record.bounds[3] > 0),
      ),
      visible: records.every((record) => 'visible' in record && record.visible),
      contained:
        painted.length ===
          contract.nodes.length + contract.routes.length + contract.labels.length &&
        painted.every((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= viewportBounds.left - 1 &&
            bounds.right <= viewportBounds.right + 1 &&
            bounds.top >= viewportBounds.top - 1 &&
            bounds.bottom <= viewportBounds.bottom + 1
          );
        }),
      svgFinite: [
        svgBounds.left,
        svgBounds.top,
        svgBounds.width,
        svgBounds.height,
        ...(matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : [NaN]),
      ].every(Number.isFinite),
    };
  }, expected);
}

async function waitForStable(read: () => Promise<unknown>) {
  let previous = '';
  let equalReads = 0;
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await read());
        equalReads = current === previous ? equalReads + 1 : 0;
        previous = current;
        return equalReads >= 2;
      },
      { timeout: 30_000, intervals: [100, 100, 200] },
    )
    .toBe(true);
}

async function waitForMermaidStable(read: () => ReturnType<typeof mermaidGeometry>) {
  await expect
    .poll(
      async () => {
        const result = await read();
        return 'settled' in result ? [result.settled, result.layoutSettled] : [];
      },
      { timeout: 30_000 },
    )
    .toEqual(['true', 'true']);
  await waitForStable(read);
}

function expectMermaidContract(
  result: Awaited<ReturnType<typeof mermaidGeometry>>,
  expected: { nodes: string[]; routes: string[]; labels: string[] },
) {
  expect(result).toMatchObject({
    missingRoot: false,
    fonts: 'loaded',
    settled: 'true',
    layoutSettled: 'true',
    counts: [expected.nodes.length, expected.routes.length, expected.labels.length],
    finite: true,
    visible: true,
    contained: true,
    svgFinite: true,
  });
  if ('nodes' in result) expect(result.nodes.map((node) => node.id)).toEqual(expected.nodes);
  if ('routes' in result) expect(result.routes.map((route) => route.id)).toEqual(expected.routes);
  if ('labels' in result) expect(result.labels.map((label) => label.text)).toEqual(expected.labels);
}

for (const motion of ['full', 'reduced'] as const) {
  test(`keeps the exact concept-add Mermaid stable during root mutations with ${motion} motion`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const expected = { nodes: CONCEPT_NODES, routes: CONCEPT_ROUTES, labels: CONCEPT_LABELS };
    await mountConceptAdd(page, motion);
    const read = () => mermaidGeometry(page, '#concept-add-test-host', expected);
    await waitForMermaidStable(read);
    const initial = await read();
    expectMermaidContract(initial, expected);

    const observations: Array<{ elapsedMs: number; geometry: typeof initial }> = [];
    const startedAt = Date.now();
    let cycle = 0;
    do {
      await page.evaluate(
        (height) => {
          document.documentElement.style.setProperty('--terminal-overlay-height', `${height}px`);
        },
        [36, 48, 24, 40][cycle % 4],
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      observations.push({ elapsedMs: Date.now() - startedAt, geometry: await read() });
      cycle += 1;
      await page.waitForTimeout(250);
    } while (Date.now() - startedAt < 10_000);
    observations.push({ elapsedMs: Date.now() - startedAt, geometry: await read() });

    expect(observations.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(10_000);
    expect(observations.length).toBeGreaterThanOrEqual(20);
    for (const observation of observations) {
      expectMermaidContract(observation.geometry, expected);
      expect(observation.geometry).toEqual(initial);
    }

    for (const width of [420, NATIVE_NOTE_HOST_WIDTH]) {
      const priorGeneration = (await read()).generation;
      await page.locator('#concept-add-test-host').evaluate((element, value) => {
        element.style.width = `${value}px`;
      }, width);
      await expect
        .poll(async () => (await read()).generation, { timeout: 30_000 })
        .toBeGreaterThan(priorGeneration);
      await waitForMermaidStable(read);
      const resized = await read();
      expectMermaidContract(resized, expected);
      expect(resized.nodeViewBounds?.[2]).toBe(resized.laneBounds?.[2]);
    }

    if (motion === 'reduced') {
      const priorGeneration = (await read()).generation;
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--diagram-node-surface', '210 40% 70%');
      });
      await expect
        .poll(async () => (await read()).generation, { timeout: 30_000 })
        .toBeGreaterThan(priorGeneration);
      await waitForMermaidStable(read);
      expectMermaidContract(await read(), expected);
    }
  });
}

test('keeps cycle fan-out Mermaid elements present through panel resizes', async ({ page }) => {
  test.setTimeout(120_000);
  const state = 'mermaid-cycle-fanout';
  const expected = { nodes: CYCLE_NODES, routes: CYCLE_ROUTES, labels: [] };
  await openState(page, state);
  const read = () => mermaidGeometry(page, `#${state}`, expected);
  await waitForStable(read);
  expectMermaidContract(await read(), expected);

  for (const width of [420, 960]) {
    const previousGeneration = (await read()).generation;
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await expect
      .poll(async () => (await read()).generation, { timeout: 30_000 })
      .toBeGreaterThan(previousGeneration);
    await waitForStable(read);
    expectMermaidContract(await read(), expected);
  }
});

async function architectureGeometry(page: Page) {
  return page.locator('#custom-architecture').evaluate((section) => {
    const renderer = section.querySelector<HTMLElement>('.diagram-renderer')!;
    const viewport = section.querySelector<HTMLElement>('.diagram-scroll-container')!;
    const svg = section.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
    const nodeIds = ['user', 'renderer', 'daemon', 'notes', 'events'];
    const edgeIds = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const groupIds = ['client', 'runtime'];
    const bounds = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return [rect.left, rect.top, rect.width, rect.height].map(
        (value) => Math.round(value * 100) / 100,
      );
    };
    const nodes = nodeIds.map((id) => section.querySelector(`[data-node-id="${id}"]`));
    const routes = edgeIds.map((id) =>
      section.querySelector(`.diagram-edge[data-edge-id="${id}"] .edge-path`),
    );
    const labels = edgeIds.map((id) =>
      section.querySelector(`.edge-label-container[data-edge-id="${id}"]`),
    );
    const groups = groupIds.map((id) => section.querySelector(`[data-group-id="${id}"] .group-bg`));
    const elements = [...nodes, ...routes, ...labels, ...groups];
    const viewportBounds = viewport.getBoundingClientRect();
    const matrix = svg.getScreenCTM();
    return {
      state: renderer.dataset.diagramState,
      settled: renderer.dataset.diagramSettled,
      fonts: document.fonts.status,
      nodeIds: nodes.filter(Boolean).map((element) => element!.getAttribute('data-node-id')),
      edgeIds: routes
        .filter(Boolean)
        .map((element) => element!.closest<SVGGElement>('.diagram-edge')!.dataset.edgeId),
      labelIds: labels.filter(Boolean).map((element) => element!.getAttribute('data-edge-id')),
      groupIds: groups.filter(Boolean).map((element) => element!.parentElement!.dataset.groupId),
      elementBounds: elements.map((element) => (element ? bounds(element) : null)),
      svgBounds: bounds(svg),
      viewportBounds: bounds(viewport),
      ctm: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null,
      finite: elements.every((element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
          [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
          (rect.width > 0 || rect.height > 0)
        );
      }),
      visible: elements.every(
        (element) => element && Number(getComputedStyle(element).opacity) > 0,
      ),
      contained: elements.every((element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= viewportBounds.left - 1 &&
          rect.right <= viewportBounds.right + 1 &&
          rect.top >= viewportBounds.top - 1 &&
          rect.bottom <= viewportBounds.bottom + 1
        );
      }),
      minFontSize: Math.min(
        ...[...section.querySelectorAll<HTMLElement>('.node-label')].map((label) =>
          Number.parseFloat(getComputedStyle(label).fontSize),
        ),
      ),
    };
  });
}

test('keeps every final architecture element contained through panel resizes', async ({ page }) => {
  test.setTimeout(120_000);
  await openState(page, 'custom-architecture');
  const root = page.locator('#custom-architecture');
  await root.getByRole('button', { name: 'State 3: 3. Close the loop' }).click();

  for (const width of [420, 960]) {
    await page
      .getByTestId('catalog-scene-focus')
      .evaluate((element, value) => (element.style.width = `${value}px`), width);
    await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
    await waitForStable(() => architectureGeometry(page));
    const result = await architectureGeometry(page);
    expect(result).toMatchObject({
      state: 'observe',
      settled: 'true',
      fonts: 'loaded',
      nodeIds: ['user', 'renderer', 'daemon', 'notes', 'events'],
      edgeIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
      labelIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
      groupIds: ['client', 'runtime'],
      finite: true,
      visible: true,
      contained: true,
    });
    expect(result.ctm).toHaveLength(6);
    expect(result.ctm!.every(Number.isFinite)).toBe(true);
    expect(result.minFontSize, `${width}px readable architecture text`).toBeGreaterThanOrEqual(12);
  }
});
