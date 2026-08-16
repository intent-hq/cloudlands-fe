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
  });
}

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
});
