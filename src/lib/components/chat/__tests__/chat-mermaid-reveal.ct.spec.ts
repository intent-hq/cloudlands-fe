import { readFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import StreamingMessageContent from '../StreamingMessageContent.svelte';
import MessageContent from '../MessageContent.svelte';
import MermaidRenderer from '../../markdown/MermaidRenderer.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
const first = 'flowchart LR\n A[Draft] --> B[Review]';
const content = (source: string, closed = false) => [
  { type: 'text' as const, text: `~~~mermaid\n${source}${closed ? '\n~~~' : ''}` },
];

// Pause real CSS animations at their start as soon as layout releases them.
// Browser timing assertions below seek the animation clock, never wall time.
async function captureReveals(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const captured = new WeakSet<Element>();
    new MutationObserver(() => {
      for (const svg of document.querySelectorAll('.mermaid-svg > svg')) {
        if (captured.has(svg) || svg.getAttribute('data-mermaid-reveal-ready') !== 'true') continue;
        captured.add(svg);
        // Keep CSS in control so removing a reveal also cancels its animation.
        for (const part of svg.querySelectorAll<SVGElement>('[data-mermaid-reveal]')) {
          part.style.animationPlayState = 'paused';
        }
        svg.setAttribute('data-test-reveal-captured', 'true');
      }
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
}

test('streaming chat starts shapes before labels and only reveals additions', async ({
  mount,
  page,
}) => {
  await captureReveals(page);
  const component = await mount(StreamingMessageContent, {
    props: { content: content(first), isStreaming: true },
  });
  const svg = component.locator('.mermaid-svg > svg');
  await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
  const timing = await svg.evaluate((root) => {
    const node = root.querySelector('g.node')!;
    const shape = node.querySelector('[data-mermaid-reveal="shape"]')!;
    const label = node.querySelector('[data-mermaid-reveal="label"]')!;
    const shapeAnimation = shape.getAnimations()[0];
    const labelAnimation = label.getAnimations()[0];
    const shapeDelay = shapeAnimation.effect!.getTiming().delay;
    const labelDelay = labelAnimation.effect!.getTiming().delay;
    const start = {
      shape: getComputedStyle(shape).opacity,
      label: getComputedStyle(label).opacity,
    };
    shapeAnimation.currentTime = labelDelay / 2;
    labelAnimation.currentTime = labelDelay / 2;
    return {
      shapeDelay,
      labelDelay,
      start,
      shapeVisible: Number(getComputedStyle(shape).opacity),
      labelVisible: Number(getComputedStyle(label).opacity),
    };
  });
  expect(timing.start).toEqual({ shape: '0', label: '0' });
  expect(timing.shapeDelay).toBe(0);
  expect(timing.labelDelay).toBeGreaterThan(timing.shapeDelay);
  expect(timing.shapeVisible).toBeGreaterThan(0);
  expect(timing.labelVisible).toBe(0);

  const second = `${first}\n B --> C[Release]`;
  await component.update({ props: { content: content(second), isStreaming: true } });
  await expect(svg.locator('g.node')).toHaveCount(3);
  await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
  const additions = await svg.evaluate((root) =>
    [...root.querySelectorAll('g.node')].map((node) => ({
      label: node.textContent?.trim(),
      animations: node.getAnimations({ subtree: true }).length,
      visible: [...node.querySelectorAll('rect, foreignObject')].every(
        (part) => Number(getComputedStyle(part).opacity) === 1,
      ),
    })),
  );
  expect(additions.find((node) => node.label === 'Draft')).toMatchObject({
    animations: 0,
    visible: true,
  });
  expect(additions.find((node) => node.label === 'Review')).toMatchObject({
    animations: 0,
    visible: true,
  });
  expect(additions.find((node) => node.label === 'Release')!.animations).toBeGreaterThan(0);
  await svg.evaluate((root) =>
    root.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
  );
  await expect
    .poll(() => svg.evaluate((root) => root.getAnimations({ subtree: true }).length))
    .toBe(0);

  await component.update({ props: { content: content(second, true), isStreaming: true } });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
});

test('theme and responsive rerenders keep revealed content visible', async ({ mount, page }) => {
  await captureReveals(page);
  const component = await mount(StreamingMessageContent, {
    props: { content: content(first), isStreaming: true },
  });
  const renderer = component.locator('.mermaid-renderer');
  const svg = component.locator('.mermaid-svg > svg');
  await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
  for (const change of ['theme', 'width']) {
    const generation = Number(await renderer.getAttribute('data-render-generation'));
    if (change === 'theme')
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    else await page.setViewportSize({ width: 390, height: 800 });
    await expect
      .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
      .toBeGreaterThan(generation);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true');
    expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
    expect(
      await svg
        .locator('g.node text, g.node foreignObject')
        .evaluateAll((labels) =>
          labels.every((label) => Number(getComputedStyle(label).opacity) === 1),
        ),
    ).toBe(true);
  }
});

for (const preference of ['os', 'battery']) {
  test(`${preference} reduced motion settles a paused reveal immediately and stays settled`, async ({
    mount,
    page,
  }) => {
    await captureReveals(page);
    const component = await mount(StreamingMessageContent, {
      props: { content: content(first), isStreaming: true },
    });
    const svg = component.locator('.mermaid-svg > svg');
    await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
    if (preference === 'os') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
    await expect
      .poll(() =>
        svg.evaluate((root) => ({
          parts: root.querySelectorAll('[data-mermaid-reveal]').length,
          opacity: getComputedStyle(root.querySelector('foreignObject')!).opacity,
          animations: root.getAnimations({ subtree: true }).length,
        })),
      )
      .toMatchObject({ parts: 0, opacity: '1', animations: 0 });
    expect(
      await svg
        .locator('g.node rect, g.node foreignObject')
        .evaluateAll((parts) =>
          parts.every((part) => Number(getComputedStyle(part).opacity) === 1),
        ),
    ).toBe(true);
    await component.update({
      props: { content: content(`${first}\n B --> C[Release]`), isStreaming: true },
    });
    await expect(svg.locator('g.node')).toHaveCount(3);
    await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
    expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  });
}

test('fullscreen and exported SVG contain complete content during a reveal', async ({
  mount,
  page,
}) => {
  await captureReveals(page);
  const component = await mount(StreamingMessageContent, {
    props: { content: content(first), isStreaming: true },
  });
  const svg = component.locator('.mermaid-svg > svg');
  await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
  await component.locator('.mermaid-svg-container').hover();
  await component.getByRole('button', { name: /expand/i }).click();
  const fullscreen = page.locator('.fullscreen-diagram > svg');
  await expect(fullscreen).toBeVisible();
  expect(await fullscreen.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  expect(
    await fullscreen
      .locator('g.node rect, g.node foreignObject')
      .evaluateAll((parts) => parts.every((part) => Number(getComputedStyle(part).opacity) === 1)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await component.update({
    props: { content: content(`${first}\n B --> C[Release]`), isStreaming: true },
  });
  await expect(svg.locator('g.node')).toHaveCount(3);
  await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
  await component.locator('.mermaid-svg-container').hover();
  await component.getByRole('button', { name: /diagram actions/i }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /download svg/i }).click();
  const download = await downloading;
  const exported = await readFile((await download.path())!, 'utf8');
  const visible = await page.evaluate((markup) => {
    const exportedSvg = new DOMParser().parseFromString(markup, 'image/svg+xml');
    return [...exportedSvg.querySelectorAll('g.node rect, g.node foreignObject')].map((part) => ({
      opacity: (part as SVGElement).style.opacity,
      text: part.textContent?.trim(),
    }));
  }, exported);
  expect(visible.some((part) => part.text === 'Release')).toBe(true);
  expect(visible.every((part) => part.opacity === '1')).toBe(true);
  // Export settles only its snapshot, leaving the chat's paused reveal in place.
  expect(
    await svg.evaluate((root) => root.getAnimations({ subtree: true }).length),
  ).toBeGreaterThan(0);
  expect(
    await svg
      .locator('g.node')
      .filter({ hasText: 'Release' })
      .locator('foreignObject')
      .evaluate((label) => getComputedStyle(label).opacity),
  ).toBe('0');
});

test('completed history and non-chat diagrams do not animate their contents', async ({
  mount,
  page,
}) => {
  await captureReveals(page);
  const component = await mount(MermaidRenderer, { props: { code: first, isStreaming: true } });
  const renderer = page.locator('.mermaid-renderer');
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  expect(
    await component
      .locator('.mermaid-svg > svg')
      .evaluate((root) => root.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await component.update({ props: { code: first, isStreaming: false, revealNewContent: true } });
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  expect(
    await component
      .locator('.mermaid-svg > svg')
      .evaluate((root) => root.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

for (const compartments of [false, true]) {
  test(`class boxes ${compartments ? 'with members and methods' : 'without compartments'} reveal visible geometry before labels without replay`, async ({
    mount,
    page,
  }) => {
    await captureReveals(page);
    const source = 'classDiagram\n class Draft';
    const appended = `${source}\n Draft --> Release${compartments ? '\n class Release {\n +String version\n +publish()\n }' : ''}`;
    const component = await mount(StreamingMessageContent, {
      props: { content: content(source), isStreaming: true },
    });
    const svg = component.locator('.mermaid-svg > svg');
    await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
    await component.update({ props: { content: content(appended), isStreaming: true } });
    const release = svg.locator('g.node').filter({ hasText: 'Release' });
    await expect(release).toBeVisible();
    await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');

    // Layout replaces Mermaid's hidden outer paths. Inspect the geometry the user sees.
    const shapes = release.locator(':scope > .class-box-outline, :scope > .class-box-divider');
    await expect(shapes).toHaveCount(compartments ? 3 : 1);
    const start = await shapes.evaluateAll((parts) =>
      parts.map((part) => ({
        displayed: getComputedStyle(part).display !== 'none',
        width: part.getBoundingClientRect().width,
        opacity: Number(getComputedStyle(part).opacity),
        animations: part.getAnimations().length,
      })),
    );
    for (const part of start) {
      expect(part.displayed).toBe(true);
      expect(part.width).toBeGreaterThan(0);
      expect(part.opacity).toBe(0);
      expect(part.animations).toBe(1);
    }
    const timing = await release.evaluate((node) => {
      const geometry = [
        ...node.querySelectorAll(':scope > .class-box-outline, :scope > .class-box-divider'),
      ];
      const labels = [...node.querySelectorAll('text')];
      const labelDelay = Math.min(
        ...labels.map((label) => label.getAnimations()[0].effect!.getTiming().delay),
      );
      const shapeDelays = geometry.map((part) => part.getAnimations()[0].effect!.getTiming().delay);
      for (const part of [...geometry, ...labels]) {
        part.getAnimations()[0].currentTime = labelDelay / 2;
      }
      return {
        shapeDelays,
        labelDelay,
        shapes: geometry.map((part) => Number(getComputedStyle(part).opacity)),
        labels: labels.map((part) => Number(getComputedStyle(part).opacity)),
      };
    });
    expect(timing.labelDelay).toBeGreaterThan(0);
    expect(timing.shapeDelays.every((delay) => delay === 0)).toBe(true);
    expect(timing.shapes.every((opacity) => opacity > 0)).toBe(true);
    expect(timing.labels.length).toBeGreaterThan(0);
    expect(timing.labels.every((opacity) => opacity === 0)).toBe(true);

    for (const existing of ['Draft', 'Release']) {
      if (existing === 'Release') {
        await component.update({
          props: { content: content(`${appended}\n Release --> Published`), isStreaming: true },
        });
        await expect(svg.locator('g.node')).toHaveCount(3);
        await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
      }
      const node = svg.locator('g.node').filter({ hasText: existing });
      expect(
        await node.evaluate((element) => element.getAnimations({ subtree: true }).length),
      ).toBe(0);
      expect(
        await node
          .locator(':scope > .class-box-outline, :scope > .class-box-divider, text')
          .evaluateAll((parts) =>
            parts.every((part) => Number(getComputedStyle(part).opacity) === 1),
          ),
      ).toBe(true);
    }
    await component.update({
      props: { content: content(`${appended}\n Release --> Published`, true), isStreaming: false },
    });
    await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
    expect(
      await svg
        .locator('.class-box-outline, .class-box-divider, text')
        .evaluateAll((parts) =>
          parts.every((part) => Number(getComputedStyle(part).opacity) === 1),
        ),
    ).toBe(true);
  });
}

for (const diagram of [
  { name: 'sequence', source: 'sequenceDiagram\n A->>B: Draft', addition: '\n B->>C: Release' },
  { name: 'state', source: 'stateDiagram-v2\n [*] --> Draft', addition: '\n Draft --> Release' },
  {
    name: 'entity',
    source: 'erDiagram\n DRAFT ||--o{ REVIEW : starts',
    addition: '\n REVIEW ||--o{ RELEASE : ends',
  },
]) {
  test(`${diagram.name} reveals arriving geometry and labels through the native SVG structure`, async ({
    mount,
    page,
  }) => {
    await captureReveals(page);
    const component = await mount(StreamingMessageContent, {
      props: { content: content(diagram.source), isStreaming: true },
    });
    const svg = component.locator('.mermaid-svg > svg');
    await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
    await component.update({
      props: { content: content(diagram.source + diagram.addition), isStreaming: true },
    });
    await expect(svg).toContainText(/Release|RELEASE/);
    await expect(svg).toHaveAttribute('data-test-reveal-captured', 'true');
    const phases = await svg.evaluate((root) =>
      root.getAnimations({ subtree: true }).map((animation) => {
        const target = (animation.effect as KeyframeEffect).target!;
        return {
          phase: target.getAttribute('data-mermaid-reveal'),
          delay: animation.effect!.getTiming().delay,
        };
      }),
    );
    expect(phases.some((part) => part.phase === 'shape' && part.delay === 0)).toBe(true);
    expect(phases.some((part) => part.phase === 'label' && part.delay > 0)).toBe(true);
    await component.update({
      props: { content: content(diagram.source + diagram.addition, true), isStreaming: false },
    });
    await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
      'data-render-settled',
      'true',
    );
    expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  });
}

test('unfamiliar diagram structure remains visible while streaming', async ({ mount, page }) => {
  await captureReveals(page);
  const component = await mount(StreamingMessageContent, {
    props: { content: content('pie\n "Draft" : 2\n "Review" : 3'), isStreaming: true },
  });
  const svg = component.locator('.mermaid-svg > svg');
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(await svg.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(svg).toContainText('Review');
  expect(
    await svg
      .locator('text')
      .evaluateAll((labels) =>
        labels.every((label) => Number(getComputedStyle(label).opacity) > 0),
      ),
  ).toBe(true);
});

test('static chat history is fully visible on initial load', async ({ mount, page }) => {
  await captureReveals(page);
  const component = await mount(MessageContent, {
    props: { content: content(first, true), isStreaming: false },
  });
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(
    await component
      .locator('.mermaid-svg > svg')
      .evaluate((root) => root.getAnimations({ subtree: true }).length),
  ).toBe(0);
});
