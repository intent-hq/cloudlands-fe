import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import type { DiagramPrimitive } from '../src/shared/types/notes-primitives';
import { expectDrawingReachable } from './diagram-scroll-reachability';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

async function mountNote(page: Page, diagram: DiagramPrimitive, width = 960, motion = 'reduced') {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.emulateMedia({ reducedMotion: motion === 'full' ? 'no-preference' : 'reduce' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&motion=${motion}`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const noteModule = '/src/lib/components/workspace/NoteWithComments.svelte';
  // Vite serves this browser module; Vitest warmImport cannot warm page.evaluate's context.
  expect((await page.request.get(`${baseUrl}${noteModule}`)).ok()).toBe(true);
  await page.evaluate(
    async ({ diagram, width, noteModule }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import(/* @vite-ignore */ noteModule),
      ]);
      const host = document.createElement('div');
      host.id = 'stationary-note';
      host.style.cssText = `width:${width}px;height:920px;margin-left:40px`;
      document.body.replaceChildren(host);
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'stationary-local',
            title: 'Local footer',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-12T00:00:00.000Z',
            updatedAt: '2026-09-12T00:00:00.000Z',
          },
          content: `Adjacent prose.\n\n\`\`\`diagram\n${JSON.stringify(diagram)}\n\`\`\`\n\nFollowing prose.`,
          editable: true,
          showSuggestions: false,
          showComments: true,
        },
      });
    },
    { diagram, width, noteModule },
  );
  await page.evaluate(async () => {
    const fonts = document.fonts;
    await fonts.ready;
    return fonts.status;
  });
  const root = page.locator('#stationary-note .diagram-renderer');
  await root.locator('[aria-label="Next step"]').scrollIntoViewIfNeeded();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expect(page.locator('#stationary-note [data-diagram-presentation]')).toHaveAttribute(
    'data-diagram-presentation-settled',
    'true',
  );
  return root;
}

function readGeometry(element: Element) {
  const rect = (e: Element) => {
    const r = e.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
    };
  };
  const viewport = element.querySelector<HTMLElement>('.diagram-scroll-container')!;
  const svg = viewport.querySelector<SVGSVGElement>('.diagram-svg-layer')!;
  const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
  const previous = element.querySelector<HTMLButtonElement>('[aria-label="Previous step"]')!;
  const next = element.querySelector<HTMLButtonElement>('[aria-label="Next step"]')!;
  const hit = (button: HTMLButtonElement) => {
    const { cx, cy } = rect(button);
    return !button.disabled && button.contains(document.elementFromPoint(cx, cy));
  };
  let clipTop = 0;
  let clipBottom = window.innerHeight;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (!/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    clipTop = Math.max(clipTop, bounds.top + parent.clientTop);
    clipBottom = Math.min(clipBottom, bounds.top + parent.clientTop + parent.clientHeight);
  }
  return {
    state: element.getAttribute('data-diagram-state'),
    settled: element.getAttribute('data-diagram-settled'),
    presentationSettled:
      !element.closest('[data-diagram-presentation]') ||
      element
        .closest('[data-diagram-presentation]')
        ?.getAttribute('data-diagram-presentation-settled') === 'true',
    hasVerticalOverflow: viewport.scrollHeight > viewport.clientHeight + 1,
    clipTop,
    clipBottom,
    enabled: { previous: !previous.disabled, next: !next.disabled },
    frame: rect(element),
    // The standalone workbench renderer has no note presentation wrapper.
    presentation: rect(element.closest('[data-diagram-presentation]') ?? element),
    viewport: rect(viewport),
    footer: rect(element.querySelector('.diagram-footer')!),
    previous: rect(previous),
    next: rect(next),
    hitTargets: { previous: hit(previous), next: hit(next) },
    hitElements: [previous, next].map((button) => {
      const { cx, cy } = rect(button);
      const hit = document.elementFromPoint(cx, cy);
      return { tag: hit?.tagName, class: hit?.getAttribute('class') };
    }),
    scroll: {
      x: viewport.scrollLeft,
      y: viewport.scrollTop,
      width: viewport.scrollWidth,
      height: viewport.scrollHeight,
      overflowX: getComputedStyle(viewport).overflowX,
      overflowY: getComputedStyle(viewport).overflowY,
    },
    pageScroll: [window.scrollX, window.scrollY],
    noteScroll: element.closest('#editor-content')?.scrollTop ?? 0,
    paint: [
      ...viewport.querySelectorAll(
        '[data-node-id], .edge-label-container, .edge-path, .group-bg, .group-label',
      ),
    ].map((e) => ({ id: e.getAttribute('data-node-id') ?? e.getAttribute('class'), ...rect(e) })),
    minFont: Math.min(
      ...[...viewport.querySelectorAll('.node-label')].map(
        (e) => parseFloat(getComputedStyle(e).fontSize) * scale,
      ),
    ),
  };
}

function expectAttached(geometry: ReturnType<typeof readGeometry>) {
  expect(geometry.settled).toBe('true');
  expect(geometry.presentationSettled).toBe(true);
  expect(geometry.viewport.height).toBeGreaterThan(0);
  expect(
    Math.abs(geometry.footer.y - geometry.viewport.y - geometry.viewport.height),
  ).toBeLessThanOrEqual(1);
  for (const target of ['next', 'previous'] as const) {
    expect(geometry[target].y).toBeGreaterThanOrEqual(geometry.footer.y);
    expect(geometry[target].y + geometry[target].height).toBeLessThanOrEqual(
      geometry.footer.y + geometry.footer.height,
    );
    if (geometry.enabled[target]) expect(geometry.hitTargets[target]).toBe(true);
  }
  if (geometry.footer.height <= geometry.clipBottom - geometry.clipTop) {
    expect(geometry.footer.y).toBeGreaterThanOrEqual(geometry.clipTop - 1);
    expect(geometry.footer.y + geometry.footer.height).toBeLessThanOrEqual(geometry.clipBottom + 1);
  }
}

function expectStationary(
  before: ReturnType<typeof readGeometry>,
  after: ReturnType<typeof readGeometry>,
) {
  for (const target of ['next', 'previous'] as const) {
    for (const coordinate of ['cx', 'cy'] as const) {
      expect(Math.abs(after[target][coordinate] - before[target][coordinate])).toBeLessThanOrEqual(
        1,
      );
    }
  }
  expect(after.noteScroll).toBe(before.noteScroll);
  expect(after.pageScroll).toEqual(before.pageScroll);
}

async function capture(root: Locator, info: TestInfo, name: string, target?: 'next' | 'previous') {
  const geometry = await root.evaluate(readGeometry);
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(geometry, null, 2));
  if (target)
    expect(geometry.hitTargets[target], `${name}: captured ${target} anchor is hit-testable`).toBe(
      true,
    );
  await root
    .page()
    .locator('#stationary-note')
    .screenshot({ path: info.outputPath(`${name}.png`) });
  return geometry;
}

for (const fixture of ['custom-architecture', 'custom-delivery-walkthrough'] as const) {
  test(`navigation stays attached and reachable in real note · ${fixture}`, async ({
    page,
  }, info) => {
    const diagram = CUSTOM_WORKBENCH_CASES[fixture].diagram;
    const root = await mountNote(page, diagram);
    const before = await capture(root, info, 'initial', 'next');
    for (const [direction, indices] of [
      ['Next step', Array.from({ length: diagram.states!.length - 1 }, (_, i) => i + 1)],
      [
        'Previous step',
        Array.from(
          { length: diagram.states!.length - 1 },
          (_, i) => diagram.states!.length - 2 - i,
        ),
      ],
    ] as const) {
      for (const index of indices) {
        await root.getByRole('button', { name: direction }).click();
        await expect(root).toHaveAttribute('data-diagram-state', diagram.states![index].id);
        await expect(root).toHaveAttribute('data-diagram-settled', 'true');
        expectAttached(await root.evaluate(readGeometry));
        await expectDrawingReachable(root);
      }
    }
    const returned = await capture(root, info, 'returned');
    expect(returned.pageScroll).toEqual(before.pageScroll);
  });
}

test('narrow varying and absent narrative keeps navigation attached and reachable', async ({
  page,
}, info) => {
  const diagram = structuredClone(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  diagram.states![0].narrative = undefined;
  diagram.states![1].narrative = {
    title: 'A longer explanation',
    text: 'Read the complete explanation without moving the step controls. '.repeat(8),
  };
  diagram.states![2].narrative = 'Short explanation';
  const root = await mountNote(page, diagram, 320);
  for (const index of [1, 2, 1, 0]) {
    await root.locator(`[data-diagram-step-index="${index}"]`).click();
    await expect(root).toHaveAttribute('data-diagram-state', diagram.states![index].id);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    expectAttached(await root.evaluate(readGeometry));
    await expectDrawingReachable(root);
  }
  await capture(root, info, 'narrow-returned');
});

test('keyboard navigation selects the expected step and preserves focus', async ({ page }) => {
  const diagram = CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram;
  const root = await mountNote(page, diagram);
  await root.locator('[data-diagram-step-index="2"]').focus();
  for (const [key, index] of [
    ['Home', 0],
    ['End', 2],
    ['ArrowLeft', 1],
    ['ArrowRight', 2],
  ] as const) {
    await page.keyboard.press(key);
    await expect(root).toHaveAttribute('data-diagram-state', diagram.states![index].id);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await expect(root.locator(`[data-diagram-step-index="${index}"]`)).toBeFocused();
    expectAttached(await root.evaluate(readGeometry));
  }
});

test('narrow Delivery drawing supports native wheel and keyboard scroll without moving footer', async ({
  page,
}, info) => {
  const root = await mountNote(
    page,
    CUSTOM_WORKBENCH_CASES['custom-delivery-walkthrough'].diagram,
    320,
    'reduced',
  );
  await capture(root, info, 'delivery-narrow-initial', 'next');
  await root.getByRole('button', { name: 'Next step' }).click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const step = await root.evaluate(readGeometry);
  expectAttached(step);
  await expect(root).toHaveAttribute('data-diagram-state', 'verify');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const viewport = root.locator('.diagram-scroll-container');
  const reach = await expectDrawingReachable(root);
  await writeFile(info.outputPath('delivery-narrow-reach.json'), JSON.stringify(reach, null, 2));
  const overflow = await viewport.evaluate((e) => ({
    x: e.scrollWidth - e.clientWidth,
    y: e.scrollHeight - e.clientHeight,
  }));
  const axis = overflow.y > 0 ? 'y' : 'x';
  expect(overflow[axis], 'authored drawing must genuinely overflow').toBeGreaterThan(0);
  await viewport.evaluate((e) => e.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await viewport.hover();
  await page.mouse.wheel(axis === 'x' ? 150 : 0, axis === 'y' ? 150 : 0);
  const position = () =>
    viewport.evaluate((e, axis) => (axis === 'x' ? e.scrollLeft : e.scrollTop), axis);
  await expect.poll(position).toBeGreaterThan(0);
  const wheeled = await capture(root, info, 'delivery-narrow-wheeled');
  expectStationary(step, wheeled);
  await viewport.evaluate((e) => e.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await viewport.focus();
  if (axis === 'y') await page.keyboard.press('Control+End');
  await expect
    .poll(async () => {
      if (axis === 'x') await page.keyboard.press('ArrowRight');
      return Math.abs((await position()) - overflow[axis]);
    })
    .toBeLessThanOrEqual(1);
  const after = await capture(root, info, 'delivery-narrow-scrolled');

  expectStationary(step, after);
  expect(after.scroll[axis]).toBeGreaterThan(0);
});

test('architecture viewport fits each step instead of retaining the first height', async ({
  page,
}, info) => {
  const diagram = structuredClone(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  diagram.states!.reverse();
  diagram.currentStateId = diagram.states![0].id;
  const root = await mountNote(page, diagram);
  const heights = [];
  for (let i = 0; i < diagram.states!.length; i++) {
    if (i > 0) await root.getByRole('button', { name: 'Next step' }).click();
    await expect(root).toHaveAttribute('data-diagram-state', diagram.states![i].id);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const geometry = await capture(root, info, `architecture-step-${i + 1}`);
    heights.push(geometry.viewport.height);
  }
  expect(
    heights[0] - heights[2],
    'short final step releases the tall first step space',
  ).toBeGreaterThan(0);
});

test('step changes preserve scrolling when the diagram already fits', async ({ page }) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  await page.setViewportSize({ width: 1300, height: 1800 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '1650px';
  });
  const before = await root.evaluate(readGeometry);
  await root.getByRole('button', { name: 'Next step' }).click();
  await expect(root).toHaveAttribute('data-diagram-state', 'connect');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const after = await root.evaluate(readGeometry);
  expectAttached(after);
  expect(after.noteScroll).toBe(before.noteScroll);
  expect(after.pageScroll).toEqual(before.pageScroll);
});

test('capped steps preserve natural scroll extent and bottommost content reachability', async ({
  page,
}) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  await page.setViewportSize({ width: 1300, height: 500 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '450px';
  });
  await root.locator('[aria-label="Next step"]').scrollIntoViewIfNeeded();
  for (const [index, state, overflow] of [
    [1, 'connect', true],
    [2, 'observe', true],
    [1, 'connect', true],
    [0, 'orient', false],
  ] as const) {
    await root.locator(`[data-diagram-step-index="${index}"]`).click();
    await expect(root).toHaveAttribute('data-diagram-state', state);
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const current = await root.evaluate(readGeometry);
    expect(current.hasVerticalOverflow).toBe(overflow);
    expectAttached(current);
    for (const paint of current.paint) {
      expect(paint.y + paint.height).toBeLessThanOrEqual(
        current.viewport.y + current.scroll.height - current.scroll.y + 1,
      );
    }
    await expectDrawingReachable(root);
  }
});

test('90vh cap follows viewport-only resize and keeps overflowing paint reachable', async ({
  page,
}, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  await page.setViewportSize({ width: 1300, height: 650 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '600px';
  });
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  for (const state of ['connect', 'observe']) {
    await root.getByRole('button', { name: 'Next step' }).click();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const samples = await root.evaluate(readGeometry);
    expect(samples.state).toBe(state);
    expectAttached(samples);
  }
  const capped = await capture(root, info, 'capped', 'previous');
  expect(capped.hasVerticalOverflow).toBe(true);
  await expectDrawingReachable(root);
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '920px';
  });
  await expect
    .poll(async () => (await root.evaluate(readGeometry)).viewport.height)
    .toBeGreaterThan(capped.viewport.height);
  const expanded = await root.evaluate(readGeometry);
  expect(expanded.viewport.width).toBeCloseTo(capped.viewport.width, 0);
  await root.getByRole('button', { name: 'Previous step' }).click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const previous = await root.evaluate(readGeometry);
  expect(previous.state).toBe('connect');
  expectAttached(previous);
});

test('explicit host resize and collapse reopen establish fresh local anchors', async ({
  page,
}, info) => {
  const root = await mountNote(
    page,
    CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram,
    960,
    'reduced',
  );
  await page.setViewportSize({ width: 1300, height: 1800 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '1650px';
  });
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const initial = await capture(root, info, 'resize-initial', 'next');
  expect(initial.state).toBe('orient');
  for (const state of ['connect', 'observe']) {
    await root.getByRole('button', { name: 'Next step' }).click();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const samples = await root.evaluate(readGeometry);
    expect(samples.state).toBe(state);
    expectAttached(samples);
  }
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.width = '320px';
  });
  await expect
    .poll(() =>
      root.locator('.diagram-scroll-container').evaluate((element) => element.clientWidth),
    )
    .toBeLessThan(initial.viewport.width);
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const resized = await capture(root, info, 'resize-narrow', 'previous');
  expect(resized.viewport.height).toBeGreaterThan(initial.viewport.height);
  expect(resized.state).toBe('observe');
  await root.getByRole('button', { name: 'Previous step' }).click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const resizedPrevious = await root.evaluate(readGeometry);
  expect(resizedPrevious.state).toBe('connect');
  expectAttached(resizedPrevious);
  await expectDrawingReachable(root);
  const disclosure = page.locator(
    '#stationary-note [data-diagram-presentation-header] button[aria-expanded]',
  );
  await disclosure.click();
  await expect(root).toHaveCount(0);
  await disclosure.click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const reopened = await capture(root, info, 'reopened', 'next');
  expect(reopened.state).toBe('connect');
  expect(reopened.scroll.y).toBe(0);
  expect(reopened.scroll.height - reopened.viewport.height).toBeLessThanOrEqual(1);
  await root.getByRole('button', { name: 'Next step' }).click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const reopenedNext = await root.evaluate(readGeometry);
  expect(reopenedNext.state).toBe('observe');
  expectAttached(reopenedNext);
  await expectDrawingReachable(root);
  await root.getByRole('button', { name: 'Previous step' }).click();
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  const reopenedPrevious = await root.evaluate(readGeometry);
  expect(reopenedPrevious.state).toBe('connect');
  expectAttached(reopenedPrevious);
});
