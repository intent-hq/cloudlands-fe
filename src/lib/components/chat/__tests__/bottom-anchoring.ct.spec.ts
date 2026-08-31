import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import BottomAnchoringHost from './BottomAnchoringHost.svelte';

test.describe.configure({ mode: 'serial' });

async function startFrameSampling(scroll: Locator, frameCount = 36) {
  await scroll.evaluate((node, count) => {
    const state = window as typeof window & {
      __bottomSamples?: number[];
      __bottomSamplingDone?: boolean;
    };
    state.__bottomSamples = [];
    state.__bottomSamplingDone = false;
    let remaining = count as number;
    const sample = () => {
      state.__bottomSamples!.push(node.scrollHeight - node.clientHeight - node.scrollTop);
      remaining -= 1;
      if (remaining > 0) requestAnimationFrame(sample);
      else state.__bottomSamplingDone = true;
    };
    requestAnimationFrame(sample);
  }, frameCount);
}

async function finishFrameSampling(page: Page): Promise<number[]> {
  await page.waitForFunction(() => {
    return (window as typeof window & { __bottomSamplingDone?: boolean }).__bottomSamplingDone;
  });
  return page.evaluate(() => {
    return (window as typeof window & { __bottomSamples?: number[] }).__bottomSamples ?? [];
  });
}

async function nextFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function unlockAt(scroll: Locator, top: number) {
  await scroll.evaluate((node, nextTop) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    node.scrollTop = nextTop as number;
    node.dispatchEvent(new Event('scroll'));
  }, top);
}

for (const config of [
  { theme: 'light' as const, width: 720, zoom: 1 },
  { theme: 'dark' as const, width: 320, zoom: 1 },
  { theme: 'dark' as const, width: 320, zoom: 2 },
]) {
  test(`keeps true bottom across production-shaped changes at ${config.width}px/${config.zoom}x ${config.theme}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(BottomAnchoringHost, { props: config });
    const scroll = component.getByTestId('transcript');
    await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await startFrameSampling(scroll);

    await component.update({ props: { ...config, messageCount: 3, streamHeight: 96 } });
    await component.update({
      props: {
        ...config,
        messageCount: 3,
        streamHeight: 150,
        subscriptionVisible: false,
        subscriptionExpanded: false,
        queueCount: 4,
        queueExpanded: true,
        queueEditing: true,
        composerHeight: 124,
        disclosureExpanded: true,
      },
    });
    await component.update({
      props: {
        ...config,
        messageCount: 4,
        streamHeight: 72,
        subscriptionVisible: true,
        subscriptionExpanded: true,
        queueCount: 1,
        queueExpanded: false,
        queueEditing: false,
        composerHeight: 64,
        disclosureExpanded: false,
      },
    });
    await component.update({
      props: {
        ...config,
        messageCount: 4,
        streamHeight: 72,
        subscriptionVisible: true,
        subscriptionExpanded: false,
        queueCount: 0,
        composerHeight: 64,
        disclosureExpanded: false,
      },
    });

    const distances = await finishFrameSampling(page);
    expect(distances.length).toBeGreaterThan(20);
    expect(Math.max(...distances.map(Math.abs))).toBeLessThanOrEqual(8);
    await expect(component.getByTestId('bottom-state')).toContainText('locked:0');
    await component.unmount();
  });
}

for (const zoom of [1, 2]) {
  test(`keeps a continuous stream and virtual swaps locked beyond the former settle window at ${zoom}x`, async ({
    mount,
    page,
  }) => {
    const props = {
      width: 420,
      zoom,
      messageCount: 2,
      streamHeight: 48,
      virtualHeight: 180,
      streamingActive: true,
    };
    const component = await mount(BottomAnchoringHost, { props });
    const scroll = component.getByTestId('transcript');
    await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await startFrameSampling(scroll, 96);

    for (let frame = 0; frame < 64; frame += 1) {
      await component.update({
        props: {
          ...props,
          messageCount: 2 + Math.floor(frame / 16),
          streamHeight: 48 + frame * 3,
          virtualHeight: frame % 8 < 4 ? 180 : 280,
        },
      });
      await nextFrame(page);
    }

    await component.update({
      props: { ...props, messageCount: 6, streamHeight: 260, virtualHeight: 340 },
    });
    const distances = await finishFrameSampling(page);

    expect(distances).toHaveLength(96);
    expect(Math.max(...distances.map(Math.abs))).toBeLessThanOrEqual(8);
    await expect(component.getByTestId('bottom-state')).toContainText('locked:0');
    await component.unmount();
  });
}

test('layout-neutral bottom anchor is a real anchor candidate with zero net scroll height', async ({
  mount,
}) => {
  const component = await mount(BottomAnchoringHost);
  const scroll = component.getByTestId('transcript');
  await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));

  const result = await scroll.evaluate((node) => {
    const anchor = node.querySelector<HTMLElement>('[data-follow-bottom-anchor]')!;
    // Eligibility: Chromium/Gecko reject zero-sized boxes as scroll-anchor
    // candidates, so the rendered box must be non-zero-sized.
    const anchorHeight = anchor.getBoundingClientRect().height;
    // Neutrality: removing the anchor must not change the scrollable extent.
    const withAnchor = node.scrollHeight;
    anchor.remove();
    const withoutAnchor = node.scrollHeight;
    node.append(anchor);
    return {
      anchorHeight,
      withAnchor,
      withoutAnchor,
      distance: node.scrollHeight - node.clientHeight - node.scrollTop,
    };
  });

  expect(result.anchorHeight).toBeGreaterThan(0);
  expect(result.withAnchor).toBe(result.withoutAnchor);
  expect(result.distance).toBe(0);
  await component.unmount();
});

test('preserves an unlocked viewport through send, stream, queue, subscription, and composer changes', async ({
  mount,
}) => {
  const component = await mount(BottomAnchoringHost);
  const scroll = component.getByTestId('transcript');
  const anchor = component.getByTestId('visible-anchor');
  await unlockAt(scroll, 760);
  const before = await anchor.evaluate((node) => node.getBoundingClientRect().top);
  const beforeTop = await scroll.evaluate((node) => node.scrollTop);

  await component.update({
    props: {
      messageCount: 5,
      streamHeight: 160,
      subscriptionVisible: false,
      subscriptionExpanded: false,
      queueCount: 5,
      queueExpanded: true,
      queueEditing: true,
      composerHeight: 140,
      disclosureExpanded: true,
    },
  });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(beforeTop);
  expect(await anchor.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(before, 1);
  await expect(component.getByTestId('bottom-state')).toContainText('unlocked');
  await component.unmount();
});

test('preserves the visible chat anchor when an adjacent panel narrows the column', async ({
  mount,
}) => {
  const component = await mount(BottomAnchoringHost, {
    props: { width: 720, reflowingContent: true },
  });
  const anchor = component.getByTestId('visible-anchor');
  await anchor.evaluate((node) => {
    const viewport = node.closest<HTMLElement>('[data-testid="transcript"]')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    viewport.scrollTop = node.offsetTop;
    viewport.dispatchEvent(new Event('scroll'));
  });
  const before = await anchor.evaluate((node) => node.getBoundingClientRect().top);

  await component.update({ props: { width: 360, reflowingContent: true } });

  await expect
    .poll(() => anchor.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(before, 1);
  await expect(component.getByTestId('bottom-state')).toContainText('unlocked');
  await component.unmount();
});

test('keeps user scroll-away unlocked and click-to-relock returns to the exact bottom', async ({
  mount,
}) => {
  const component = await mount(BottomAnchoringHost);
  const scroll = component.getByTestId('transcript');
  await unlockAt(scroll, 760);
  const unlockedTop = await scroll.evaluate((node) => node.scrollTop);

  await component.update({ props: { messageCount: 5, streamHeight: 180 } });
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(unlockedTop);
  await expect(component.getByTestId('bottom-state')).toContainText('unlocked');

  await component.getByTestId('relock').click();
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBe(0);
  await expect(component.getByTestId('bottom-state')).toContainText('locked:0');
  await component.unmount();
});

test('applies only exact above-viewport virtualization compensation when unlocked', async ({
  mount,
}) => {
  const component = await mount(BottomAnchoringHost, { props: { virtualHeight: 180 } });
  const scroll = component.getByTestId('transcript');
  const anchor = component.getByTestId('visible-anchor');
  await unlockAt(scroll, 900);
  const beforeTop = await scroll.evaluate((node) => node.scrollTop);
  const beforeAnchor = await anchor.evaluate((node) => node.getBoundingClientRect().top);

  await component.update({ props: { virtualHeight: 300 } });
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollTop))
    .toBeCloseTo(beforeTop + 120, 1);
  expect(await anchor.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(
    beforeAnchor,
    1,
  );
  await component.unmount();
});
