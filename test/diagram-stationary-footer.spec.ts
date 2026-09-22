import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';
import type { DiagramPrimitive } from '../src/shared/types/notes-primitives';
import { expectDrawingReachable } from './diagram-scroll-reachability';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running preview server.');

async function mountNote(
  page: Page,
  diagram: DiagramPrimitive,
  info: TestInfo,
  width = 960,
  motion = 'full',
) {
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
  await expectLifecycleReady(root, info, 'mount', 'next');
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
    naturalHeight: Math.ceil(svg.getBoundingClientRect().height + 20),
    heightCap: window.innerHeight * 0.9,
    clipTop,
    clipBottom,
    enabled: { previous: !previous.disabled, next: !next.disabled },
    heightAnimating: viewport.getAnimations().some((a) => a.playState === 'running'),
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

// Only lifecycle boundaries may establish a new anchor. Ordinary steps never call this.
async function expectLifecycleReady(
  root: Locator,
  info: TestInfo,
  phase: string,
  target: 'next' | 'previous',
) {
  const readiness = await root.evaluate(
    async (element, { source, target }) => {
      const read = new Function(`return (${source})`)() as typeof readGeometry;
      const samples = [];
      const start = performance.now();
      let previous = '';
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const animations = element.getAnimations({ subtree: true });
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
          animations.push(...ancestor.getAnimations());
        const activeAnimations = animations.filter(
          (animation) =>
            Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) &&
            animation.playState !== 'finished' &&
            animation.playState !== 'idle',
        ).length;
        const geometry =
          element.querySelector('.diagram-svg-layer') && element.querySelector('.diagram-footer')
            ? read(element)
            : null;
        const signature =
          geometry &&
          JSON.stringify([
            geometry.presentation,
            geometry.frame,
            geometry.viewport,
            geometry.footer,
            geometry.previous,
            geometry.next,
            geometry.minFont,
            geometry.pageScroll,
            geometry.noteScroll,
          ]);
        const actionable =
          geometry?.settled === 'true' &&
          !activeAnimations &&
          !element.classList.contains('resizing') &&
          geometry.hitTargets[target];
        samples.push({ elapsedMs: performance.now() - start, activeAnimations, geometry });
        if (actionable && signature === previous) return { ready: true, samples };
        previous = actionable ? signature! : '';
      } while (performance.now() - start < 4000);
      return { ready: false, samples };
    },
    { source: readGeometry.toString(), target },
  );
  await writeFile(
    info.outputPath(`${phase}-readiness.json`),
    JSON.stringify({ phase, target, ...readiness }, null, 2),
  );
  expect(
    readiness.ready,
    `${phase}: settled, stable, animation-free and hit-testable ${target}`,
  ).toBe(true);
}

async function sampleAction(
  root: Locator,
  action: () => Promise<unknown>,
  info: TestInfo,
  phase: string,
) {
  await root.evaluate((element, source) => {
    const read = new Function(`return (${source})`)() as typeof readGeometry;
    (window as any).footerSamples = (async () => {
      const samples = [read(element)];
      const start = performance.now();
      do {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(read(element));
      } while (
        performance.now() - start < 4000 &&
        (performance.now() - start < 1000 || samples.at(-1)!.settled !== 'true')
      );
      return samples;
    })();
  }, readGeometry.toString());
  let samples: ReturnType<typeof readGeometry>[] = [];
  try {
    await action();
  } finally {
    samples = await root.page().evaluate(() => (window as any).footerSamples);
    await writeFile(
      info.outputPath(`${phase}-samples.json`),
      JSON.stringify({ phase, samples }, null, 2),
    );
  }
  return samples;
}

async function sampleClick(
  page: Page,
  root: Locator,
  target: 'next' | 'previous',
  info: TestInfo,
  phase: string,
) {
  const geometry = await root.evaluate(readGeometry);
  expect(geometry.hitTargets[target], `${phase}: actual pointer target is reachable`).toBe(true);
  const point = geometry[target];
  return sampleAction(root, () => page.mouse.click(point.cx, point.cy), info, phase);
}

function expectAttached(samples: ReturnType<typeof readGeometry>[]) {
  expect(samples.at(-1)!.settled).toBe('true');
  for (const sample of samples) {
    expect(sample.minFont).toBeGreaterThanOrEqual(12);
    expect(sample.viewport.height).toBeGreaterThan(0);
    expect(sample.viewport.height).toBeLessThanOrEqual(sample.heightCap + 1);
    expect(
      Math.abs(sample.footer.y - sample.viewport.y - sample.viewport.height),
      'footer remains attached to the drawing',
    ).toBeLessThanOrEqual(1);
    for (const target of ['next', 'previous'] as const) {
      expect(sample[target].y).toBeGreaterThanOrEqual(sample.footer.y);
      expect(sample[target].y + sample[target].height).toBeLessThanOrEqual(
        sample.footer.y + sample.footer.height,
      );
      if (sample.enabled[target])
        expect(sample.hitTargets[target], `${sample.state}: ${target} is hit-testable`).toBe(true);
    }
  }
  const last = samples.at(-1)!;
  expect(
    Math.abs(last.viewport.height - Math.min(last.naturalHeight, last.heightCap)),
    'settled viewport fits this step',
  ).toBeLessThanOrEqual(1);
  if (last.footer.height <= last.clipBottom - last.clipTop) {
    expect(last.footer.y).toBeGreaterThanOrEqual(last.clipTop - 1);
    expect(last.footer.y + last.footer.height).toBeLessThanOrEqual(last.clipBottom + 1);
  }
}

function expectStationary(
  before: ReturnType<typeof readGeometry>,
  samples: ReturnType<typeof readGeometry>[],
) {
  expect(samples.at(-1)!.settled).toBe('true');
  expect(Math.min(...samples.map((sample) => sample.minFont))).toBeGreaterThanOrEqual(12);
  for (const sample of samples) {
    for (const target of ['next', 'previous'] as const)
      for (const coordinate of ['cx', 'cy'] as const) {
        expect
          .soft(
            Math.abs(sample[target][coordinate] - before[target][coordinate]),
            `${target}.${coordinate}`,
          )
          .toBeLessThanOrEqual(1);
      }
    expect.soft(sample.noteScroll).toBe(before.noteScroll);
    expect.soft(sample.pageScroll).toEqual(before.pageScroll);
  }
}

function expectDirectHeight(samples: ReturnType<typeof readGeometry>[]) {
  const heights = samples.map((sample) => sample.viewport.height);
  const start = heights[0];
  const end = heights.at(-1)!;
  const destination = Math.min(samples.at(-1)!.naturalHeight, samples.at(-1)!.heightCap);
  expect(
    Math.abs(end - destination),
    'settled destination fits the incoming step',
  ).toBeLessThanOrEqual(1);
  expect(Math.min(...heights), 'height never undershoots either endpoint').toBeGreaterThanOrEqual(
    Math.min(start, destination) - 1,
  );
  expect(Math.max(...heights), 'height never overshoots either endpoint').toBeLessThanOrEqual(
    Math.max(start, destination) + 1,
  );
  let furthest = start;
  for (const height of heights) {
    expect(
      destination >= start ? furthest - height : height - furthest,
      'height progresses monotonically without a reverse detour',
    ).toBeLessThanOrEqual(1);
    furthest = destination >= start ? Math.max(furthest, height) : Math.min(furthest, height);
  }
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
  test(`per-step navigation stays attached and reachable in real note · ${fixture}`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const diagram = CUSTOM_WORKBENCH_CASES[fixture].diagram;
    const root = await mountNote(page, diagram, info);
    const before = await capture(root, info, 'initial', 'next');
    const transitions = [];
    for (let i = 1; i < diagram.states!.length; i++) {
      transitions.push(await sampleClick(page, root, 'next', info, `next-${i}`));
      expect(transitions.at(-1)!.at(-1)!.state).toBe(diagram.states![i].id);
      expectAttached(transitions.at(-1)!);
      const reach = await expectDrawingReachable(root);
      await writeFile(info.outputPath(`reach-${i}.json`), JSON.stringify(reach, null, 2));
    }
    const after = await capture(root, info, 'last');
    const viewport = root.locator('.diagram-scroll-container');
    await viewport.evaluate(async (element) => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const scrolled = await capture(root, info, 'last-scrolled');
    expectStationary(after, [scrolled]);
    await viewport.evaluate(
      (element, scroll) => element.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' }),
      after.scroll,
    );
    for (let i = diagram.states!.length - 2; i >= 0; i--) {
      transitions.push(await sampleClick(page, root, 'previous', info, `previous-${i}`));
      expect(transitions.at(-1)!.at(-1)!.state).toBe(diagram.states![i].id);
      expectAttached(transitions.at(-1)!);
    }
    const returned = await capture(root, info, 'returned');
    await writeFile(info.outputPath('transitions.json'), JSON.stringify(transitions, null, 2));
    expect.soft(after.state).toBe(diagram.states!.at(-1)!.id);
    expect.soft(returned.state).toBe(diagram.states![0].id);
    expect(returned.pageScroll).toEqual(before.pageScroll);
    expect(returned.viewport.height).toBeCloseTo(before.viewport.height, 0);
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
  const root = await mountNote(page, diagram, info, 320, 'reduced');
  await capture(root, info, 'narrow-initial', 'next');
  const samples = [];
  for (let i = 1; i < 3; i++) {
    samples.push(...(await sampleClick(page, root, 'next', info, `narrow-next-${i}`)));
    await writeFile(info.outputPath(`narrow-samples-${i}.json`), JSON.stringify(samples, null, 2));
    await capture(root, info, `narrow-step-${i}`);
    await expect(root).toHaveAttribute('data-diagram-state', diagram.states![i].id);
    await expectDrawingReachable(root);
  }
  for (let i = 1; i >= 0; i--) {
    samples.push(...(await sampleClick(page, root, 'previous', info, `narrow-previous-${i}`)));
    expect(samples.at(-1)!.state).toBe(diagram.states![i].id);
  }
  await capture(root, info, 'narrow-returned');
  await writeFile(info.outputPath('narrow-transitions.json'), JSON.stringify(samples, null, 2));
  expectAttached(samples);
  expect(
    samples.every((sample) => !sample.heightAnimating),
    'reduced motion never animates height',
  ).toBe(true);
  expect(samples.at(-1)!.state).toBe('orient');
});

test('rapid pointer and keyboard navigation preserve attachment and final focus', async ({
  page,
}, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, info);
  const before = await capture(root, info, 'rapid-initial', 'next');
  const samples = await sampleAction(
    root,
    async () => {
      await page.mouse.click(before.next.cx, before.next.cy);
      await root.getByRole('button', { name: 'Previous step' }).click();
      await root.getByRole('button', { name: 'Next step' }).click();
      await root.locator('[data-diagram-step-index="2"]').click();
    },
    info,
    'rapid-pointer',
  );
  expect(samples.at(-1)!.state).toBe('observe');
  expectAttached(samples);
  await root.locator('[data-diagram-step-index="2"]').focus();
  for (const [key, index] of [
    ['Home', 0],
    ['End', 2],
    ['ArrowLeft', 1],
    ['ArrowRight', 2],
  ] as const) {
    const frames = await sampleAction(
      root,
      () => page.keyboard.press(key),
      info,
      `keyboard-${key}`,
    );
    samples.push(...frames);
    expect(frames.at(-1)!.state).toBe(
      CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram.states![index].id,
    );
    expectAttached(frames);
    await expect(root.locator(`[data-diagram-step-index="${index}"]`)).toBeFocused();
  }
  await writeFile(info.outputPath('rapid-transitions.json'), JSON.stringify(samples, null, 2));
  await capture(root, info, 'rapid-final');
});

test('narrow Delivery drawing supports native wheel and keyboard scroll without moving footer', async ({
  page,
}, info) => {
  const root = await mountNote(
    page,
    CUSTOM_WORKBENCH_CASES['custom-delivery-walkthrough'].diagram,
    info,
    320,
    'reduced',
  );
  await capture(root, info, 'delivery-narrow-initial', 'next');
  const advanced = await sampleClick(page, root, 'next', info, 'delivery-next');
  expect(advanced.at(-1)!.state).toBe('verify');
  expectAttached(advanced);
  const step = advanced.at(-1)!;
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
  expectStationary(step, [wheeled]);
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
  expect(after.minFont).toBeGreaterThanOrEqual(12);
  expectStationary(step, [after]);
  expect(after.scroll[axis]).toBeGreaterThan(0);
});

test('architecture viewport fits each step instead of retaining the first height', async ({
  page,
}, info) => {
  const diagram = structuredClone(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  diagram.states!.reverse();
  diagram.currentStateId = diagram.states![0].id;
  const root = await mountNote(page, diagram, info, 960, 'reduced');
  const heights = [];
  for (let i = 0; i < diagram.states!.length; i++) {
    if (i > 0) {
      const samples = await sampleClick(page, root, 'next', info, `sizing-next-${i}`);
      expect(samples.at(-1)!.state).toBe(diagram.states![i].id);
    }
    const geometry = await capture(root, info, `architecture-step-${i + 1}`);
    heights.push(geometry.viewport.height);
    expect
      .soft(
        Math.abs(geometry.viewport.height - Math.min(geometry.naturalHeight, geometry.heightCap)),
        'viewport hugs the current SVG plus its breathing room, up to 90vh',
      )
      .toBeLessThanOrEqual(1);
  }
  expect(
    heights[0] - heights[2],
    'short final step releases the tall first step space',
  ).toBeGreaterThan(100);
});

test('height animates without scrolling a diagram that already fits', async ({ page }, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, info);
  await page.setViewportSize({ width: 1300, height: 1800 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '1650px';
  });
  await expectLifecycleReady(root, info, 'roomy', 'next');
  const before = await root.evaluate(readGeometry);
  const samples = await sampleClick(page, root, 'next', info, 'roomy-growth');
  expectAttached(samples);
  expectDirectHeight(samples);
  const end = samples.at(-1)!;
  expect(end.viewport.height).toBeGreaterThan(before.viewport.height + 100);
  expect(
    samples.some(
      (s) =>
        s.heightAnimating &&
        s.viewport.height > before.viewport.height + 1 &&
        s.viewport.height < end.viewport.height - 1,
    ),
    'a real intermediate height is painted, not a one-frame jump',
  ).toBe(true);
  for (const sample of samples) {
    expect(sample.noteScroll).toBe(before.noteScroll);
    expect(sample.pageScroll).toEqual(before.pageScroll);
  }
});

for (const { fixture, width, motion } of [
  { fixture: 'custom-architecture', width: 960, motion: 'full' },
  { fixture: 'custom-architecture', width: 960, motion: 'reduced' },
] as const) {
  test(`step height moves directly between endpoints · ${fixture} · ${width}px · ${motion}`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const diagram = CUSTOM_WORKBENCH_CASES[fixture].diagram;
    const root = await mountNote(page, diagram, info, width, motion);
    const transitions = [];
    for (const [target, index] of [
      ['next', 1],
      ['next', 2],
      ['previous', 1],
      ['previous', 0],
    ] as const) {
      const samples = await sampleClick(page, root, target, info, `direct-${target}-${index}`);
      expect(samples.at(-1)!.state).toBe(diagram.states![index].id);
      transitions.push(samples);
    }
    await capture(root, info, 'direct-returned');
    expect(transitions.some((s) => s.at(-1)!.viewport.height > s[0].viewport.height + 1)).toBe(
      true,
    );
    expect(transitions.some((s) => s.at(-1)!.viewport.height < s[0].viewport.height - 1)).toBe(
      true,
    );
    for (const samples of transitions) {
      expectDirectHeight(samples);
      expectAttached(samples);
    }
  });
}

test('narrow full-motion height stays between endpoints while the combined scene changes', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-walkthrough&width=420&motion=full`,
  );
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 30_000 });
  const root = page.locator('#custom-walkthrough .diagram-renderer');
  await root.scrollIntoViewIfNeeded();
  await expectLifecycleReady(root, info, 'narrow-direct', 'next');
  for (const [target, state] of [
    ['next', 'execute'],
    ['next', 'render'],
    ['previous', 'execute'],
    ['previous', 'request'],
  ] as const) {
    const samples = await sampleClick(page, root, target, info, `narrow-direct-${target}-${state}`);
    expect(samples.at(-1)!.state).toBe(state);
    expectDirectHeight(samples);
    expectAttached(samples);
  }
  await root.screenshot({ path: info.outputPath('narrow-direct.png') });
});

test('equal-height steps remain level throughout full motion', async ({ page }, info) => {
  const diagram = structuredClone(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram);
  diagram.states = [diagram.states![0], { ...diagram.states![0], id: 'same-height' }];
  const root = await mountNote(page, diagram, info);
  const samples = await sampleClick(page, root, 'next', info, 'equal-height');
  expect(samples.at(-1)!.state).toBe('same-height');
  expect(
    Math.abs(samples.at(-1)!.viewport.height - samples[0].viewport.height),
  ).toBeLessThanOrEqual(1);
  expectDirectHeight(samples);
  expectAttached(samples);
});

test('rapid height reversal retargets from the currently displayed height', async ({
  page,
}, info) => {
  const diagram = CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram;
  const root = await mountNote(page, diagram, info);
  for (const [initial, target] of [
    [0, 2],
    [2, 0],
  ] as const) {
    if (initial === 2) {
      const setup = await sampleAction(
        root,
        () => root.locator('.stepper-dot').nth(2).click(),
        info,
        'rapid-setup',
      );
      expectAttached(setup);
    }
    const result = await root.evaluate(
      async (element, { source, initial, target }) => {
        const read = new Function(`return (${source})`)() as typeof readGeometry;
        const start = read(element);
        element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[target].click();
        const started = performance.now();
        let interrupted = start;
        do {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          interrupted = read(element);
        } while (
          Math.abs(interrupted.viewport.height - start.viewport.height) < 4 &&
          performance.now() - started < 1000
        );
        const samples = [interrupted];
        element.querySelectorAll<HTMLButtonElement>('.stepper-dot')[initial].click();
        const reversed = performance.now();
        do {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          samples.push(read(element));
        } while (
          (performance.now() - reversed < 1000 || samples.at(-1)!.settled !== 'true') &&
          performance.now() - reversed < 4000
        );
        return { start, interrupted, samples };
      },
      { source: readGeometry.toString(), initial, target },
    );
    await writeFile(
      info.outputPath(`rapid-reverse-${initial}.json`),
      JSON.stringify(result, null, 2),
    );
    expect(result.interrupted.heightAnimating, 'interrupt an actual height transition').toBe(true);
    expect(
      Math.abs(result.interrupted.viewport.height - result.start.viewport.height),
    ).toBeGreaterThanOrEqual(4);
    expect(result.samples.at(-1)!.state).toBe(diagram.states![initial].id);
    expectDirectHeight(result.samples);
    expectAttached(result.samples);
  }
});

test('capped step transitions preserve natural scroll extent and bottommost paint reachability', async ({
  page,
}, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, info);
  await page.setViewportSize({ width: 1300, height: 500 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '450px';
  });
  await root.locator('[aria-label="Next step"]').scrollIntoViewIfNeeded();
  await expectLifecycleReady(root, info, 'capped-transitions', 'next');
  for (const [target, state, sourceCapped, destinationCapped] of [
    ['next', 'connect', false, true],
    ['next', 'observe', true, true],
    ['previous', 'connect', true, true],
    ['previous', 'orient', true, false],
  ] as const) {
    const samples = await sampleClick(
      page,
      root,
      target,
      info,
      `cap-transition-${target}-${state}`,
    );
    expect(samples[0].naturalHeight > samples[0].heightCap).toBe(sourceCapped);
    const last = samples.at(-1)!;
    expect(last.state).toBe(state);
    expect(last.naturalHeight > last.heightCap).toBe(destinationCapped);
    expectDirectHeight(samples);
    expectAttached(samples);
    for (const sample of samples)
      for (const paint of sample.paint)
        expect(
          paint.y + paint.height,
          `${state}: ${paint.id} remains inside the native vertical scroll extent`,
        ).toBeLessThanOrEqual(sample.viewport.y + sample.scroll.height - sample.scroll.y + 1);
    const reach = await expectDrawingReachable(root);
    await writeFile(
      info.outputPath(`cap-reach-${target}-${state}.json`),
      JSON.stringify(reach, null, 2),
    );
  }
});

test('90vh cap follows viewport-only resize and keeps overflowing paint reachable', async ({
  page,
}, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, info);
  await page.setViewportSize({ width: 1300, height: 650 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '600px';
  });
  await expectLifecycleReady(root, info, 'short-viewport', 'next');
  for (const state of ['connect', 'observe']) {
    const samples = await sampleClick(page, root, 'next', info, `capped-${state}`);
    expect(samples.at(-1)!.state).toBe(state);
    expectAttached(samples);
    expectDirectHeight(samples);
  }
  const capped = await capture(root, info, 'capped', 'previous');
  expect(capped.naturalHeight).toBeGreaterThan(capped.heightCap);
  expect(capped.viewport.height).toBeCloseTo(585, 0);
  await expectDrawingReachable(root);
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '920px';
  });
  await expect
    .poll(async () => (await root.evaluate(readGeometry)).viewport.height)
    .toBeCloseTo(capped.naturalHeight, 0);
  const expanded = await root.evaluate(readGeometry);
  expect(expanded.viewport.width).toBeCloseTo(capped.viewport.width, 0);
  const previous = await sampleClick(page, root, 'previous', info, 'after-viewport-resize');
  expect(previous.at(-1)!.state).toBe('connect');
  expectAttached(previous);
});

test('user wheel input interrupts step scrolling without fighting or leaving anchoring disabled', async ({
  page,
}, info) => {
  const root = await mountNote(page, CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, info);
  await root.evaluate((element) => {
    const space = document.createElement('div');
    space.style.cssText = 'height:2000px;min-height:2000px;flex-shrink:0';
    element.closest('#editor-content')!.append(space);
  });
  const before = await root.evaluate(readGeometry);
  const samples = await sampleAction(
    root,
    async () => {
      await page.mouse.click(before.next.cx, before.next.cy);
      await page.mouse.move(500, 50);
      await page.mouse.wheel(0, 900);
    },
    info,
    'user-wheel',
  );
  expect(samples.at(-1)!.state).toBe('connect');
  expect(samples.at(-1)!.settled).toBe('true');
  expect(samples.at(-1)!.noteScroll).toBeGreaterThan(0);
  const moving = samples.filter((s) => s.noteScroll > before.noteScroll);
  expect(moving.length).toBeGreaterThan(0);
  // Growing the diagram does not change the scroll range end in this long note.
  for (let i = 1; i < moving.length; i++)
    expect(moving[i].noteScroll).toBeGreaterThanOrEqual(moving[i - 1].noteScroll);
  expect(samples.at(-1)!.noteScroll - before.noteScroll).toBeCloseTo(900, 0);
  expect(
    await root.evaluate(
      (element) => (element.closest('#editor-content') as HTMLElement).style.overflowAnchor,
    ),
  ).toBe('');
  const after = await root.evaluate(readGeometry);
  await page.mouse.wheel(0, 150);
  await expect
    .poll(async () => (await root.evaluate(readGeometry)).noteScroll)
    .toBeGreaterThan(after.noteScroll);
});

test('explicit host resize and collapse reopen establish fresh local anchors', async ({
  page,
}, info) => {
  const root = await mountNote(
    page,
    CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram,
    info,
    960,
    'reduced',
  );
  await page.setViewportSize({ width: 1300, height: 1800 });
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.height = '1650px';
  });
  await expectLifecycleReady(root, info, 'viewport-resize', 'next');
  const initial = await capture(root, info, 'resize-initial', 'next');
  expect(initial.state).toBe('orient');
  for (const state of ['connect', 'observe']) {
    const samples = await sampleClick(page, root, 'next', info, `initial-next-${state}`);
    expect(samples.at(-1)!.state).toBe(state);
    expectAttached(samples);
  }
  await page.locator('#stationary-note').evaluate((element) => {
    element.style.width = '320px';
  });
  await expect
    .poll(() =>
      root.locator('.diagram-scroll-container').evaluate((element) => element.clientWidth),
    )
    .toBeLessThanOrEqual(312);
  await expectLifecycleReady(root, info, 'host-resize', 'previous');
  const resized = await capture(root, info, 'resize-narrow', 'previous');
  expect(resized.viewport.height).toBeGreaterThan(initial.viewport.height);
  expect(resized.state).toBe('observe');
  const resizedPrevious = await sampleClick(page, root, 'previous', info, 'resized-previous');
  expect(resizedPrevious.at(-1)!.state).toBe('connect');
  expectAttached(resizedPrevious);
  await expectDrawingReachable(root);
  const disclosure = page.locator(
    '#stationary-note [data-diagram-presentation-header] button[aria-expanded]',
  );
  await disclosure.click();
  await expect(root).toHaveCount(0);
  await disclosure.click();
  await expectLifecycleReady(root, info, 'reopen', 'next');
  const reopened = await capture(root, info, 'reopened', 'next');
  expect(reopened.state).toBe('connect');
  expect(reopened.scroll.y).toBe(0);
  expect(reopened.scroll.height - reopened.viewport.height).toBeLessThanOrEqual(1);
  const reopenedNext = await sampleClick(page, root, 'next', info, 'reopened-next');
  expect(reopenedNext.at(-1)!.state).toBe('observe');
  expectAttached(reopenedNext);
  await expectDrawingReachable(root);
  const reopenedPrevious = await sampleClick(page, root, 'previous', info, 'reopened-previous');
  expect(reopenedPrevious.at(-1)!.state).toBe('connect');
  expectAttached(reopenedPrevious);
});
