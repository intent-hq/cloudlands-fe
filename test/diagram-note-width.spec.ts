import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const validSource =
  'graph LR\n A[Receive request] -->|validate| B[Process request] -->|complete| C[Return result]';
type Kind = 'mermaid' | 'custom' | 'stateful';
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

async function mountNote(
  page: Page,
  width: number,
  kind: Kind,
  source = validSource,
  comments = false,
) {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?state=mermaid-flow&motion=reduced`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const fixture =
    CUSTOM_WORKBENCH_CASES[kind === 'stateful' ? 'custom-architecture' : 'custom-flowchart'];
  const block =
    kind === 'mermaid'
      ? `~~~mermaid\n${source}\n~~~`
      : `\`\`\`diagram\n${source === validSource ? JSON.stringify(fixture.diagram) : source}\n\`\`\``;
  await page.evaluate(
    async ({ width, block, comments }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'diagram-note-host';
      host.style.cssText = `width:${width}px;height:900px;margin-left:80px`;
      document.body.replaceChildren(host);
      if (comments) {
        const { commentsClient } = await import('/src/features/comments/comments.client.ts');
        // Keep the real manager/sidebar lifecycle, but never contact a daemon.
        commentsClient.list = async () => ({ ok: true, data: [] });
      }
      // The real note host and node views, with no note ID or persistence callback.
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'diagram-note-width-test',
            title: 'Local width test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-11T00:00:00.000Z',
            updatedAt: '2026-09-11T00:00:00.000Z',
          },
          content: `## Diagram lane\n\nAdjacent note text.\n\n${block}\n\nFollowing note text.`,
          // No matching note exists in the store, so editor updates cannot persist.
          noteId: comments ? 'diagram-width-fixture' : undefined,
          editable: true,
          showSuggestions: false,
          showComments: true,
        },
      });
    },
    { width, block, comments },
  );
  await settled(page, kind);
}

function laneFor(page: Page, kind: Kind) {
  return page.locator(kind === 'mermaid' ? '.node-mermaidBlock' : '.node-diagram_block');
}

async function settled(page: Page, kind: Kind) {
  const lane = laneFor(page, kind);
  await expect(lane).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  if (kind === 'mermaid') {
    await expect(lane.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true', {
      timeout: 30_000,
    });
    await expect(lane.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
  } else {
    await expect(lane.locator('.diagram-renderer')).toHaveAttribute(
      'data-diagram-settled',
      'true',
      { timeout: 30_000 },
    );
  }
}

async function geometry(page: Page, kind: Kind) {
  return laneFor(page, kind).evaluate((lane) => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const note = lane.closest<HTMLElement>('#editor-content')!;
    const viewport = lane.querySelector<HTMLElement>(
      '.mermaid-svg-viewport, .diagram-scroll-container',
    )!;
    const ancestors = [];
    for (let e: Element | null = viewport; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      ancestors.push({
        tag: e.tagName,
        class: e.getAttribute('class'),
        ...bounds(e),
        paddingLeft: s.paddingLeft,
        paddingRight: s.paddingRight,
        containerType: s.containerType,
        transform: s.transform,
        overflowX: s.overflowX,
      });
      if (e === note) break;
    }
    const paint = [
      ...viewport.querySelectorAll<SVGGraphicsElement>(
        'g.node, .edgePaths path, .edgeLabels > .edgeLabel, [data-node-id], .edge-path, .edge-label-container, .group-bg, .group-label',
      ),
    ]
      .filter((element) => {
        for (let e: Element | null = element; e && e !== viewport; e = e.parentElement) {
          const style = getComputedStyle(e);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          )
            return false;
        }
        return true;
      })
      .map((element) => ({
        id: element.getAttribute('data-node-id') ?? element.getAttribute('class'),
        elementId: element.id,
        ...bounds(element),
      }));
    return {
      note: bounds(note),
      prose: bounds(lane.previousElementSibling!),
      lane: bounds(lane),
      presentation: bounds(lane.querySelector('[data-diagram-presentation]')!),
      header: lane.querySelector('[data-diagram-presentation-header]')
        ? bounds(lane.querySelector('[data-diagram-presentation-header]')!)
        : null,
      footer: lane.querySelector('.diagram-footer')
        ? bounds(lane.querySelector('.diagram-footer')!)
        : null,
      content: bounds(lane.querySelector('[data-diagram-presentation-content]')!),
      viewport: bounds(viewport),
      svg: bounds(viewport.querySelector('svg')!),
      mermaidLabels: [
        ...viewport.querySelectorAll<HTMLElement>('g.node .nodeLabel, .edgeLabels p'),
      ].map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const r = range.getBoundingClientRect();
        const matrix = label.closest<SVGGraphicsElement>('foreignObject')!.getScreenCTM()!;
        return {
          text: label.textContent,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          fontSize:
            Number.parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b),
        };
      }),
      paint,
      actions: bounds(lane.querySelector('[data-diagram-presentation-actions]')!),
      noteOverflow: note.scrollWidth - note.clientWidth,
      viewportOverflow: viewport.scrollWidth - viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      generation: lane.querySelector('.mermaid-renderer')?.getAttribute('data-render-generation'),
      svgScale: viewport.querySelector<SVGSVGElement>('svg')?.getScreenCTM()?.a,
      labels: [...viewport.querySelectorAll<SVGGraphicsElement>('[data-node-id]')].map((node) => {
        const label = node.querySelector('.node-label')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const r = range.getBoundingClientRect();
        return {
          id: node.getAttribute('data-node-id'),
          text: label.textContent,
          width: r.width,
          height: r.height,
          fontSize: Number.parseFloat(getComputedStyle(label).fontSize) * node.getScreenCTM()!.a,
        };
      }),
      ancestors,
    };
  });
}

async function capture(page: Page, kind: Kind, info: TestInfo, name: string) {
  await laneFor(page, kind).hover();
  const result = await geometry(page, kind);
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(result, null, 2));
  await info.attach(name, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  await page.locator('#diagram-note-host').screenshot({ path: info.outputPath(`${name}.png`) });
  return result;
}

function expectLane(result: Awaited<ReturnType<typeof geometry>>) {
  const left = result.lane.left - result.note.left;
  const right = result.note.right - result.lane.right;
  expect(left).toBeGreaterThanOrEqual(4);
  expect(left).toBeLessThanOrEqual(8);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  expect(result.noteOverflow).toBeLessThanOrEqual(1);
  expect(result.pageOverflow).toBeLessThanOrEqual(1);
  expect(result.actions.left).toBeGreaterThanOrEqual(result.lane.left);
  expect(result.actions.right).toBeLessThanOrEqual(result.lane.right);
}

function expectPaint(
  result: Awaited<ReturnType<typeof geometry>>,
  count: number,
  horizontalMermaid = false,
) {
  expect(result.paint).toHaveLength(count);
  const horizontalBounds = horizontalMermaid ? result.svg : result.viewport;
  for (const painted of result.paint) {
    expect([painted.left, painted.top, painted.width, painted.height].every(Number.isFinite)).toBe(
      true,
    );
    expect(painted.width > 0 || painted.height > 0, painted.id ?? '').toBe(true);
    expect(painted.left, painted.id ?? '').toBeGreaterThanOrEqual(horizontalBounds.left - 1);
    expect(painted.right, painted.id ?? '').toBeLessThanOrEqual(horizontalBounds.right + 1);
    expect(painted.top, painted.id ?? '').toBeGreaterThanOrEqual(result.viewport.top - 1);
    expect(painted.bottom, painted.id ?? '').toBeLessThanOrEqual(result.viewport.bottom + 1);
  }
  if (horizontalMermaid) {
    expect(result.mermaidLabels).toHaveLength(5);
    for (const label of result.mermaidLabels) {
      expect(label.fontSize).toBeGreaterThanOrEqual(11.9);
      expect(label.left).toBeGreaterThanOrEqual(result.svg.left - 1);
      expect(label.right).toBeLessThanOrEqual(result.svg.right + 1);
      expect(label.top).toBeGreaterThanOrEqual(result.viewport.top - 1);
      expect(label.bottom).toBeLessThanOrEqual(result.viewport.bottom + 1);
    }
  }
}

async function expectHorizontalReachability(page: Page, info: TestInfo, name: string) {
  const initial = await geometry(page, 'mermaid');
  expectPaint(initial, paintCounts.mermaid, true);
  const viewport = laneFor(page, 'mermaid').locator('.mermaid-svg-viewport');
  const samples = [];
  // Overlapping wheel positions cover the entire painted SVG, including long
  // edges that cannot fit in a single viewport. No programmatic scroll writes.
  const step = Math.max(1, Math.floor(initial.viewport.width / 2));
  const targets = [0];
  for (let x = step; x < initial.viewportOverflow; x += step) targets.push(x);
  if (initial.viewportOverflow > 0) targets.push(initial.viewportOverflow);
  for (const target of targets) {
    const previous = await geometry(page, 'mermaid');
    const hitPoint = await viewport.evaluate((viewport) => {
      const r = viewport.getBoundingClientRect();
      for (const yFraction of [0.5, 0.1, 0.9]) {
        for (const xFraction of [0.5, 0.1, 0.9]) {
          const x = r.left + r.width * xFraction;
          const y = r.top + r.height * yFraction;
          if (viewport.contains(document.elementFromPoint(x, y))) return { x, y };
        }
      }
      return null;
    });
    if (!hitPoint) {
      await page
        .locator('#diagram-note-host')
        .screenshot({ path: info.outputPath(`${name}-occluded.png`) });
      throw new Error('No exposed diagram viewport point accepts wheel input');
    }
    await page.mouse.move(hitPoint.x, hitPoint.y);
    await page.mouse.wheel(target - previous.scrollLeft, 0);
    await expect
      .poll(async () => (await geometry(page, 'mermaid')).scrollLeft)
      .toBeCloseTo(target, 0);
    const observed = await geometry(page, 'mermaid');
    expectPaint(observed, paintCounts.mermaid, true);
    expect(observed.paint.map((p) => p.elementId)).toEqual(initial.paint.map((p) => p.elementId));
    expect(observed.mermaidLabels.map((p) => p.text)).toEqual(
      initial.mermaidLabels.map((p) => p.text),
    );
    expect(observed.noteOverflow).toBeLessThanOrEqual(1);
    expect(observed.pageOverflow).toBeLessThanOrEqual(1);
    expect(observed.generation).toBe(initial.generation);
    samples.push(observed);
  }
  const windows = samples.map((s) => ({
    left: s.viewport.left - s.svg.left,
    right: s.viewport.right - s.svg.left,
  }));
  for (const painted of [...initial.paint, ...initial.mermaidLabels]) {
    const left = painted.left - initial.svg.left;
    const right = painted.right - initial.svg.left;
    let reached = left;
    for (const window of windows) {
      if (window.left <= reached + 1) reached = Math.max(reached, window.right);
    }
    expect(reached, 'every horizontal paint portion is wheel-reachable').toBeGreaterThanOrEqual(
      right - 1,
    );
    if (painted.width <= initial.viewport.width) {
      expect(
        windows.some((w) => w.left <= left + 1 && w.right >= right - 1),
        'complete node/label enters view',
      ).toBe(true);
    }
  }
  await writeFile(info.outputPath(`${name}-wheel.json`), JSON.stringify(samples, null, 2));
  await page.mouse.wheel(-samples.at(-1)!.scrollLeft, 0);
  await expect.poll(async () => (await geometry(page, 'mermaid')).scrollLeft).toBe(0);
}

async function resizeNote(page: Page, width: number, kind: Kind, crossesBreakpoint = true) {
  const renderer = laneFor(page, kind).locator('.mermaid-renderer');
  const generation =
    kind === 'mermaid' ? await renderer.getAttribute('data-render-generation') : null;
  await page.locator('#diagram-note-host').evaluate(async (host, width) => {
    host.style.width = `${width}px`;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, width);
  // These resize steps cross the compact breakpoint. The old generation's
  // settled marker is not evidence that the requested new layout has finished.
  if (generation !== null && crossesBreakpoint) {
    await expect(renderer).not.toHaveAttribute('data-render-generation', generation);
  }
  await settled(page, kind);
}

const paintCounts = { mermaid: 7, custom: 17, stateful: 6 };

for (const kind of ['mermaid', 'custom', 'stateful'] as const) {
  for (const width of [320, 420, 960]) {
    test(`${kind} uses the actual note lane at ${width}px`, async ({ page }, info) => {
      test.setTimeout(60_000);
      await mountNote(page, width, kind);
      const result = await capture(page, kind, info, 'note-geometry');
      expectLane(result);
      expectPaint(result, paintCounts[kind], kind === 'mermaid');
      if (kind === 'mermaid') await expectHorizontalReachability(page, info, 'note-geometry');
      const inset = kind === 'mermaid' ? 8 : 0;
      expect(result.viewport.left - result.presentation.left).toBeCloseTo(inset, 0);
      expect(result.presentation.right - result.viewport.right).toBeCloseTo(inset, 0);
      expect(result.prose.left - result.note.left).toBeCloseTo(48, 0);
      expect(result.note.right - result.prose.right).toBeCloseTo(48, 0);
    });
  }

  test(`${kind} keeps paint contained through repeated narrow-wide note resizing`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await mountNote(page, 960, kind);
    for (const [index, width] of [320, 960, 420, 960, 320].entries()) {
      await resizeNote(page, width, kind);
      if (kind === 'custom' && index === 0) {
        // Stateless diagrams preserve actual-size mode after a wide mount.
        // Verify all horizontal paint is reachable, then exercise the fit control.
        const unfit = await capture(page, kind, info, 'actual-size-scroll');
        expectLane(unfit);
        expect(unfit.paint).toHaveLength(paintCounts.custom);
        const viewport = laneFor(page, kind).locator('.diagram-scroll-container');
        const fit = laneFor(page, kind).getByRole('button', {
          name: 'Fit diagram to width',
          exact: true,
        });
        await expect(fit).toHaveAttribute('aria-pressed', 'false');
        const scrollSamples = [];
        for (const [paintIndex, painted] of unfit.paint.entries()) {
          const target = Math.round(
            Math.max(
              0,
              Math.min(
                unfit.viewportOverflow,
                (painted.left + painted.right) / 2 -
                  unfit.viewport.left +
                  unfit.scrollLeft -
                  unfit.viewport.width / 2,
              ),
            ),
          );
          const previousScroll = (await geometry(page, kind)).scrollLeft;
          await viewport.hover();
          await page.mouse.wheel(target - previousScroll, 0);
          await expect
            .poll(async () => (await geometry(page, kind)).scrollLeft)
            .toBeCloseTo(target, 0);
          const observed = await geometry(page, kind);
          expectLane(observed);
          expect(observed.paint).toHaveLength(paintCounts.custom);
          expect(observed.paint[paintIndex].id).toBe(painted.id);
          // Each complete route, label and node must actually enter the viewport,
          // not merely lie inside the element's theoretical scroll extent.
          expectPaint({ ...observed, paint: [observed.paint[paintIndex]] }, 1);
          scrollSamples.push({ paintIndex, ...observed });
        }
        expect(Math.max(...scrollSamples.map((sample) => sample.scrollLeft))).toBeGreaterThan(0);
        await writeFile(
          info.outputPath('actual-size-wheel-samples.json'),
          JSON.stringify(scrollSamples, null, 2),
        );
        await fit.click();
        await expect(
          laneFor(page, kind).getByRole('button', {
            name: 'Show diagram at actual size',
            exact: true,
          }),
        ).toHaveAttribute('aria-pressed', 'true');
        await settled(page, kind);
      }
      const result = await capture(page, kind, info, `resize-${index}-${width}`);
      if (kind === 'custom') {
        await expect(laneFor(page, kind).locator('.diagram-fit-button')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      }
      expectLane(result);
      expectPaint(result, paintCounts[kind], kind === 'mermaid');
      if (kind === 'mermaid')
        await expectHorizontalReachability(page, info, `resize-${index}-${width}`);
      const started = Date.now();
      const samples: Awaited<ReturnType<typeof geometry>>[] = [];
      await expect
        .poll(
          async () => {
            samples.push(await geometry(page, kind));
            return Date.now() - started;
          },
          { timeout: 5_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(1_000);
      for (const sample of samples) {
        expectLane(sample);
        expectPaint(sample, paintCounts[kind], kind === 'mermaid');
        expect(sample.viewport.width).toBeCloseTo(result.viewport.width, 0);
        expect(sample.viewport.height).toBeCloseTo(result.viewport.height, 0);
        expect(sample.generation).toBe(result.generation);
      }
    }
  });
}

test('small diagrams retain intrinsic paint size and fullscreen uses the window, not the note', async ({
  page,
}, info) => {
  await mountNote(page, 320, 'mermaid', 'graph TB\n A[Small graph]');
  const narrow = await capture(page, 'mermaid', info, 'small-narrow');
  expectPaint(narrow, 1);
  await resizeNote(page, 960, 'mermaid');
  const wide = await capture(page, 'mermaid', info, 'small-wide');
  expectLane(wide);
  expectPaint(wide, 1);
  // Compact Mermaid intentionally uses different node padding. Check intrinsic
  // sizing within one layout mode, not equality across that layout breakpoint.
  await resizeNote(page, 800, 'mermaid', false);
  const medium = await capture(page, 'mermaid', info, 'small-medium');
  expectLane(medium);
  expectPaint(medium, 1);
  expect(medium.paint[0].width).toBeCloseTo(wide.paint[0].width, 0);
  expect(medium.paint[0].height).toBeCloseTo(wide.paint[0].height, 0);
  for (const result of [narrow, medium, wide]) {
    expect.soft(result.presentation.width).toBeCloseTo(result.prose.width, 0);
    // A prose-sized viewport need not be twice the node width. Assert actual
    // intrinsic rendering, rather than the superseded full-lane size ratio.
    expect(result.svgScale).toBeLessThanOrEqual(1);
    expect((result.paint[0].left + result.paint[0].right) / 2).toBeCloseTo(
      (result.viewport.left + result.viewport.right) / 2,
      0,
    );
  }
  const opener = laneFor(page, 'mermaid').getByRole('button', {
    name: 'Fullscreen',
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 1500, height: 1000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expectLane(await geometry(page, 'mermaid'));
});

test('Architecture presentation follows prose and the current scene without enlarging paint', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await mountNote(page, 960, 'stateful');
  const lane = laneFor(page, 'stateful');
  const small = await capture(page, 'stateful', info, 'architecture-small');
  expect.soft(small.presentation.width).toBeCloseTo(small.prose.width, 0);
  expectPaint(small, paintCounts.stateful);
  for (const outer of [small.header!, small.footer!]) {
    expect.soft(outer.left).toBeCloseTo(small.presentation.left, 0);
    expect.soft(outer.right).toBeCloseTo(small.presentation.right, 0);
  }
  const dots = lane.locator('[data-diagram-step-index]');
  await dots.last().click();
  await expect(lane.locator('.diagram-renderer')).toHaveAttribute('data-diagram-state', 'observe');
  await settled(page, 'stateful');
  const large = await capture(page, 'stateful', info, 'architecture-large');
  expectLane(large);
  expect(large.presentation.width).toBeGreaterThanOrEqual(large.prose.width - 1);
  expect(large.presentation.width).toBeLessThanOrEqual(large.lane.width + 1);
  await dots.first().click();
  await expect(lane.locator('.diagram-renderer')).toHaveAttribute('data-diagram-state', 'orient');
  await settled(page, 'stateful');
  const returned = await capture(page, 'stateful', info, 'architecture-returned');
  expect.soft(returned.presentation.width).toBeCloseTo(returned.prose.width, 0);
  expectPaint(returned, paintCounts.stateful);
  expect(returned.labels).toEqual(small.labels);
  await resizeNote(page, 800, 'stateful');
  const medium = await capture(page, 'stateful', info, 'architecture-medium');
  expect.soft(medium.presentation.width).toBeCloseTo(medium.prose.width, 0);
  for (const [index, label] of medium.labels.entries()) {
    expect(label.text).toBe(small.labels[index].text);
    expect(label.width).toBeCloseTo(small.labels[index].width, 0);
    expect(label.height).toBeCloseTo(small.labels[index].height, 0);
    expect.soft(label.fontSize).toBeLessThanOrEqual(13.01);
  }
  await resizeNote(page, 320, 'stateful');
  const narrow = await capture(page, 'stateful', info, 'architecture-narrow');
  expectLane(narrow);
  expectPaint(narrow, paintCounts.stateful);
  expect(narrow.presentation.width).toBeGreaterThanOrEqual(narrow.prose.width - 1);
  for (const label of narrow.labels) expect(label.fontSize).toBeGreaterThanOrEqual(11.99);
  await resizeNote(page, 960, 'stateful');
  const recovered = await capture(page, 'stateful', info, 'architecture-recovered');
  expect.soft(recovered.presentation.width).toBeCloseTo(recovered.prose.width, 0);
  expect(recovered.labels).toEqual(small.labels);
});

test('wide current content grows the presentation beyond prose without filling unused lane', async ({
  page,
}, info) => {
  const fixture = CUSTOM_WORKBENCH_CASES['custom-disconnected-extremes'].diagram;
  await mountNote(page, 960, 'custom', JSON.stringify(fixture));
  const result = await capture(page, 'custom', info, 'wide-current-content');
  expectLane(result);
  expectPaint(result, 8);
  const span =
    Math.max(...result.paint.map((p) => p.right)) - Math.min(...result.paint.map((p) => p.left));
  expect(result.presentation.width).toBeGreaterThan(result.prose.width);
  expect(result.presentation.width).toBeLessThan(result.lane.width);
  expect(result.presentation.width - span / result.svgScale!).toBeLessThanOrEqual(100);
  expect(result.labels.every((label) => label.fontSize >= 11.99)).toBe(true);
});

for (const width of [320, 960]) {
  test(`Architecture width follows actual prose and comments reserve at ${width}px`, async ({
    page,
  }, info) => {
    await mountNote(page, width, 'stateful', validSource, true);
    const before = await capture(page, 'stateful', info, 'architecture-before-comments');
    await loadComment(page);
    const sidebar = page.locator('[data-comment-id="width-comment"]');
    await expect(sidebar).toBeVisible();
    await expect
      .poll(async () => (await geometry(page, 'stateful')).lane.width)
      .toBeLessThan(before.lane.width);
    await settled(page, 'stateful');
    const active = await capture(page, 'stateful', info, 'architecture-active-comments');
    expectPaint(active, paintCounts.stateful);
    expect(active.noteOverflow).toBeLessThanOrEqual(1);
    expect(active.pageOverflow).toBeLessThanOrEqual(1);
    expect(active.presentation.width).toBeGreaterThanOrEqual(active.prose.width - 1);
    expect(active.presentation.width).toBeLessThanOrEqual(active.lane.width + 1);
    expect(active.presentation.right).toBeLessThanOrEqual((await sidebar.boundingBox())!.x);
    if (width === 960) expect(active.presentation.width).toBeCloseTo(active.prose.width, 0);
    expect(active.footer!.width).toBeCloseTo(active.presentation.width, 0);
  });
}

test('valid to error to valid keeps expanded source aligned at the minimum note width', async ({
  page,
}, info) => {
  await mountNote(page, 320, 'mermaid');
  const lane = laneFor(page, 'mermaid');
  await lane.hover();
  await lane.getByRole('button', { name: 'Edit code', exact: true }).click();
  const invalid = `unsupportedDiagram ${'long-source-segment'.repeat(100)}`;
  await lane.locator('textarea').fill(invalid);
  const card = lane.locator('.mermaid-error');
  await expect(card).toBeVisible();
  await card.locator('summary').click();
  await expect(card.locator('details')).toHaveJSProperty('open', true);
  const failed = await lane.evaluate((lane) => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    const note = lane.closest<HTMLElement>('#editor-content')!;
    return {
      prose: bounds(lane.previousElementSibling!),
      card: bounds(lane.querySelector('.mermaid-error')!),
      noteOverflow: note.scrollWidth - note.clientWidth,
      source: [...lane.querySelectorAll('.mermaid-error pre')].map(bounds),
    };
  });
  expect(failed.card).toEqual(failed.prose);
  expect(failed.noteOverflow).toBeLessThanOrEqual(1);
  expect(failed.source).toHaveLength(2);
  for (const block of failed.source) {
    expect(block.left).toBeGreaterThanOrEqual(failed.card.left);
    expect(block.right).toBeLessThanOrEqual(failed.card.right);
  }
  await page
    .locator('#diagram-note-host')
    .screenshot({ path: info.outputPath('expanded-error.png') });
  await lane.locator('textarea').fill(validSource);
  await settled(page, 'mermaid');
  await expect(card).toHaveCount(0);
  const recovered = await capture(page, 'mermaid', info, 'recovered');
  expectLane(recovered);
  expectPaint(recovered, paintCounts.mermaid, true);
  await expectHorizontalReachability(page, info, 'recovered');
});

test('horizontal note oracle rejects paint made inaccessible to wheel scrolling', async ({
  page,
}, info) => {
  await mountNote(page, 320, 'mermaid');
  await expectHorizontalReachability(page, info, 'reachable-control');
  await laneFor(page, 'mermaid')
    .locator('.mermaid-svg-viewport')
    .evaluate((viewport) => {
      viewport.style.overflowX = 'hidden';
    });
  // The full SVG and scrollWidth are unchanged: only actual user reachability fails.
  await expect(expectHorizontalReachability(page, info, 'inaccessible-control')).rejects.toThrow();
});

async function loadComment(page: Page, content = 'Synthetic sidebar comment') {
  await page.evaluate(async (content) => {
    const [{ store }, { loadCommentsAction }] = await Promise.all([
      import('/src/store/renderer/store.ts'),
      import('/src/store/renderer/slices/comments/comments-slice.ts'),
    ]);
    store.dispatch(
      loadCommentsAction([
        {
          id: 'width-comment',
          threadId: 'width-thread',
          content,
          author: 'Reviewer',
          authorType: 'user',
          type: 'comment',
          status: 'open',
          createdAt: '2026-09-11T00:00:00.000Z',
          updatedAt: '2026-09-11T00:00:00.000Z',
        },
      ]),
    );
  }, content);
}

async function commentBounds(sidebar: Locator) {
  return sidebar.evaluate((element) => {
    const bounds = (target: Element) => {
      const r = target.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    return {
      mode: element.querySelector('.icon-mode')
        ? 'icon'
        : element.querySelector('.compact-mode')
          ? 'compact'
          : 'full',
      card: bounds(element),
      controls: [element, ...element.querySelectorAll('button, [contenteditable="true"]')]
        .filter((control) => control.getBoundingClientRect().width > 0)
        .map(bounds),
    };
  });
}

for (const width of [320, 960]) {
  test(`active comments constrain the diagram away from the real sidebar at ${width}px`, async ({
    page,
  }, info) => {
    await mountNote(page, width, 'mermaid', validSource, true);
    const before = await geometry(page, 'mermaid');
    await loadComment(page);
    const sidebar = page.locator('[data-comment-id="width-comment"]');
    await expect(sidebar).toBeVisible();
    await expect
      .poll(async () => (await geometry(page, 'mermaid')).lane.width)
      .toBeLessThan(before.lane.width);
    if (width === 960) {
      await expect(laneFor(page, 'mermaid').locator('.mermaid-renderer')).not.toHaveAttribute(
        'data-render-generation',
        before.generation!,
      );
    }
    await settled(page, 'mermaid');
    const active = await capture(page, 'mermaid', info, 'active-comments');
    expectPaint(active, paintCounts.mermaid, true);
    await expectHorizontalReachability(page, info, 'active-comments');
    expect(active.noteOverflow).toBeLessThanOrEqual(1);
    expect(active.pageOverflow).toBeLessThanOrEqual(1);
    const comment = (await sidebar.boundingBox())!;
    expect(active.lane.left - active.note.left).toBeCloseTo(width === 320 ? 4 : 48, 0);
    expect(active.prose.left - active.note.left).toBeCloseTo(48, 0);
    expect(active.actions.right).toBeLessThanOrEqual(comment.x);
    expect(active.viewport.right).toBeLessThanOrEqual(comment.x);
    const collapsed = await commentBounds(sidebar);
    expect(collapsed.mode).toBe(width === 320 ? 'icon' : 'full');
    await sidebar.focus();
    await page.keyboard.press('Enter');
    await expect(sidebar.locator('[contenteditable="true"]')).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width)
      .toBeCloseTo(active.note.right - 50, 0);
    const focused = await commentBounds(sidebar);
    const focusedDiagram = await geometry(page, 'mermaid');
    await page
      .locator('#diagram-note-host')
      .screenshot({ path: info.outputPath('focused-comment.png') });
    await page.keyboard.press('Escape');
    await expect(sidebar.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect
      .poll(async () => (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width)
      .toBeCloseTo(active.note.right, 0);
    const unfocused = await commentBounds(sidebar);
    await writeFile(
      info.outputPath('comment-keyboard-bounds.json'),
      JSON.stringify({ collapsed, focused, unfocused, focusedDiagram }, null, 2),
    );
    await page.evaluate(async () => {
      const [{ store }, { clearCommentsAction }] = await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/comments/comments-slice.ts'),
      ]);
      store.dispatch(clearCommentsAction());
    });
    await expect(sidebar).toHaveCount(0);
    await expect
      .poll(async () => (await geometry(page, 'mermaid')).lane.width)
      .toBeCloseTo(before.lane.width, 0);
    if (width === 960) {
      await expect(laneFor(page, 'mermaid').locator('.mermaid-renderer')).not.toHaveAttribute(
        'data-render-generation',
        active.generation!,
      );
    }
    await settled(page, 'mermaid');
    const recovered = await capture(page, 'mermaid', info, 'comments-closed');
    for (const state of [collapsed, focused, unfocused]) {
      expect(state.controls.length).toBeGreaterThan(0);
      for (const bounds of [state.card, ...state.controls]) {
        expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
        expect(bounds.left).toBeGreaterThanOrEqual(active.note.left - 1);
        expect(bounds.right).toBeLessThanOrEqual(active.note.right + 1);
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      }
    }
    expectPaint(focusedDiagram, paintCounts.mermaid, true);
    expect(focusedDiagram.noteOverflow).toBeLessThanOrEqual(1);
    expect(focusedDiagram.pageOverflow).toBeLessThanOrEqual(1);
    expectLane(recovered);
    await expectHorizontalReachability(page, info, 'comments-closed');
  });
}

test('focused comments keep long text and controls usable through narrow-wide-narrow note resizing', async ({
  page,
}, info) => {
  await mountNote(page, 320, 'mermaid', validSource, true);
  const content =
    'Review the complete request path, including validation, processing and the final response. Every label and comment action should remain readable inside a narrow note.';
  await loadComment(page, content);
  const sidebar = page.locator('[data-comment-id="width-comment"]');
  await expect(sidebar).toBeVisible();
  await sidebar.focus();
  await page.keyboard.press('Space');
  const reply = sidebar.locator('[contenteditable="true"]');
  await expect(reply).toBeVisible();
  const samples = [];
  for (const width of [320, 960, 320]) {
    const previous = await geometry(page, 'mermaid');
    await page.locator('#diagram-note-host').evaluate((host, width) => {
      host.style.width = `${width}px`;
    }, width);
    if (width !== previous.note.width) {
      await expect(laneFor(page, 'mermaid').locator('.mermaid-renderer')).not.toHaveAttribute(
        'data-render-generation',
        previous.generation!,
      );
    }
    await settled(page, 'mermaid');
    await expect
      .poll(async () => (await commentBounds(sidebar)).card.width)
      .toBeCloseTo(width === 320 ? 270 : 300, 0);
    const diagram = await geometry(page, 'mermaid');
    const comment = await commentBounds(sidebar);
    expect(comment.card.right).toBeCloseTo(diagram.note.right - 50, 0);
    for (const bounds of [comment.card, ...comment.controls]) {
      expect(bounds.left).toBeGreaterThanOrEqual(diagram.note.left - 1);
      expect(bounds.right).toBeLessThanOrEqual(diagram.note.right + 1);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    }
    await reply.click();
    await page.keyboard.type('Local unsent reply');
    await expect(reply).toContainText('Local unsent reply');
    await reply.press('ControlOrMeta+A');
    await reply.press('Backspace');
    const text = sidebar.locator('.comment-content');
    await text.hover();
    const edit = sidebar.getByRole('button', { name: 'Edit', exact: true });
    await expect(edit).toHaveCSS('pointer-events', 'auto');
    await expect
      .poll(() =>
        edit.evaluate((element) => {
          let opacity = 1;
          for (let node: Element | null = element; node; node = node.parentElement) {
            opacity *= Number(getComputedStyle(node).opacity);
          }
          return opacity;
        }),
      )
      .toBe(1);
    for (const control of await sidebar.locator('button').all()) {
      await control.click({ trial: true });
    }
    await expect(text).toHaveText(content);
    const wrapped = await text.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        lines: [...range.getClientRects()].map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        })),
      };
    });
    expect(wrapped.scrollWidth).toBeLessThanOrEqual(wrapped.clientWidth + 1);
    expect(new Set(wrapped.lines.map((line) => line.top)).size).toBeGreaterThan(1);
    for (const line of wrapped.lines) {
      expect(line.left).toBeGreaterThanOrEqual(diagram.note.left - 1);
      expect(line.right).toBeLessThanOrEqual(diagram.note.right + 1);
    }
    expectPaint(diagram, paintCounts.mermaid, true);
    expect(diagram.noteOverflow).toBeLessThanOrEqual(1);
    expect(diagram.pageOverflow).toBeLessThanOrEqual(1);
    samples.push({ width, comment, diagram, wrapped });
  }
  await writeFile(info.outputPath('focused-resize.json'), JSON.stringify(samples, null, 2));
  await page
    .locator('#diagram-note-host')
    .screenshot({ path: info.outputPath('focused-narrow-final.png') });
  await sidebar.locator('.comment-content').hover();
  await sidebar.getByRole('button', { name: 'Collapse' }).click();
  await expect(reply).toHaveCount(0);
  await sidebar.focus();
  await page.keyboard.press('Enter');
  await expect(reply).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reply).toHaveCount(0);
});

test('collapsed comments allow wheel scrolling and reopen intact through narrow-wide-narrow resizing', async ({
  page,
}, info) => {
  await mountNote(page, 320, 'mermaid', validSource, true);
  const content =
    'Review the complete request path, including validation, processing and the final response. Every label and comment action should remain readable inside a narrow note.';
  await loadComment(page, content);
  const sidebar = page.locator('[data-comment-id="width-comment"]');
  const reply = sidebar.locator('[contenteditable="true"]');
  await expect(sidebar).toBeVisible();
  for (const [index, width] of [320, 960, 320].entries()) {
    if (index) await resizeNote(page, width, 'mermaid');
    await sidebar.focus();
    await page.keyboard.press('Enter');
    await expect(reply).toBeVisible();
    await expect(sidebar.locator('.comment-content')).toHaveText(content);
    expectPaint(await geometry(page, 'mermaid'), paintCounts.mermaid, true);
    if (index === 1) {
      await sidebar.locator('.comment-content').hover();
      await sidebar.getByRole('button', { name: 'Collapse', exact: true }).click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(reply).toHaveCount(0);
    await expectHorizontalReachability(page, info, `collapsed-${index}-${width}`);
    await sidebar.focus();
    await page.keyboard.press('Enter');
    await expect(reply).toBeVisible();
    await expect(sidebar.locator('.comment-content')).toHaveText(content);
    await reply.click();
    await page.keyboard.type('Local unsent reply');
    await expect(reply).toContainText('Local unsent reply');
    await reply.press('ControlOrMeta+A');
    await reply.press('Backspace');
    await sidebar.locator('.comment-content').hover();
    for (const control of await sidebar.locator('button').all()) {
      await control.click({ trial: true });
    }
    await page.keyboard.press('Escape');
    await expect(reply).toHaveCount(0);
  }
});
