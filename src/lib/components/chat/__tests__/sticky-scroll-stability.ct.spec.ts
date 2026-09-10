import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import StickyScrollStabilityHost from './StickyScrollStabilityHost.svelte';
import type { AgentMessage } from '$shared/types';

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function transitionPoint(scroll: Locator, source: Locator) {
  return source.evaluate(
    (node, scrollNode) => {
      const scale = Number.parseFloat(getComputedStyle(node.closest('section')!).zoom) || 1;
      const sourceRect = node.getBoundingClientRect();
      const scrollRect = (scrollNode as HTMLElement).getBoundingClientRect();
      return (
        (scrollNode as HTMLElement).scrollTop + (sourceRect.bottom - scrollRect.top) / scale + 2
      );
    },
    await scroll.elementHandle(),
  );
}

async function geometry(scroll: Locator, anchor: Locator, source: Locator) {
  return scroll.evaluate(
    (node, args) => {
      const [anchorNode, sourceNode] = args as HTMLElement[];
      const scale = Number.parseFloat(getComputedStyle(node.closest('section')!).zoom) || 1;
      return {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        anchorDocumentTop: anchorNode.getBoundingClientRect().top + node.scrollTop * scale,
        sourceHeight: sourceNode.getBoundingClientRect().height,
      };
    },
    [await anchor.elementHandle(), await source.elementHandle()],
  );
}

test('pins automated triggers without shifting the transcript and returns to each source', async ({
  mount,
  page,
}, testInfo) => {
  const turnMessages = [
    {
      id: 'event',
      role: 'user',
      contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            data: { agentName: 'Layout verifier' },
            timestamp: '2026-09-10T00:00:00Z',
          },
        ],
      },
    },
    {
      id: 'hook',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: '[Background hook "Build watch"] Checks passed; continue the review.',
        },
      ],
    },
    {
      id: 'agent',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'The audit is ready for the next pass.' }],
      metadata: { type: 'agent_message', fromAgentId: 'agent-reviewer', fromAgentName: 'Reviewer' },
    },
    {
      id: 'human',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Please verify the follow-up.' }],
    },
    {
      id: 'pr',
      role: 'user',
      contentBlocks: [{ type: 'text', text: '[PR monitor intent-hq/intent#42] Checks passed.' }],
    },
  ] as AgentMessage[];
  const config = { turnMessages, width: 320, responseHeight: 600 };
  const component = await mount(StickyScrollStabilityHost, { props: config });
  const scroll = component.getByTestId('sticky-scroll');
  const pinned = component.getByTestId('pinned-user-prompt');
  const measurements = [];
  const labels = [
    'Layout verifier',
    'Build watch',
    'Reviewer',
    'Please verify',
    'intent-hq/intent #42',
  ];

  for (let index = 0; index < turnMessages.length; index++) {
    const source = component.getByTestId(`source-${index}`);
    const anchor = component.getByTestId(`anchor-${index}`);
    const entry = await transitionPoint(scroll, source);
    await scroll.evaluate((node, top) => node.scrollTo(0, top), entry - 4);
    await settle(page);
    await expect(pinned).toHaveCount(0);
    const before = await geometry(scroll, anchor, source);
    await scroll.evaluate((node, top) => node.scrollTo(0, top), entry);
    await expect(pinned).toBeVisible();
    await expect(pinned).toHaveAttribute('title', new RegExp(labels[index]));
    const after = await geometry(scroll, anchor, source);
    measurements.push({ trigger: turnMessages[index].id, before, after });
    expect(after.scrollHeight).toBe(before.scrollHeight);
    expect(after.sourceHeight).toBe(before.sourceHeight);
    expect(after.anchorDocumentTop).toBeCloseTo(before.anchorDocumentTop, 1);
    expect(after.scrollTop).toBeCloseTo(entry, 1);
    const bounds = (await pinned.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.height).toBeLessThan(60);
    if (index === 0) {
      await component.update({ props: { ...config, streamGrowth: 90 } });
      await settle(page);
      expect((await geometry(scroll, anchor, source)).scrollTop).toBeCloseTo(entry, 1);
      await component.screenshot({ path: testInfo.outputPath('sticky-subscription.png') });
    }
    if (index % 2 === 0) await pinned.press('Enter');
    else await pinned.click();
    await expect(pinned).toHaveCount(0);
    await expect(source).toBeInViewport();
  }
  await testInfo.attach('sticky-trigger-geometry', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
});

for (const config of [
  { width: 720, zoom: 1 },
  { width: 320, zoom: 1 },
  { width: 320, zoom: 2 },
]) {
  test(`keeps enter, release, handoff, and streaming geometry stable at ${config.width}px/${config.zoom}x`, async ({
    mount,
    page,
  }) => {
    const component = await mount(StickyScrollStabilityHost, { props: config });
    const scroll = component.getByTestId('sticky-scroll');
    const source = component.getByTestId('source-0');
    const anchor = component.getByTestId('anchor-0');
    const entry = await transitionPoint(scroll, source);

    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry - 4);
    await settle(page);
    const before = await geometry(scroll, anchor, source);
    await expect(component.getByTestId('pinned-user-prompt')).toHaveCount(0);

    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry);
    await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();
    await settle(page);
    const entered = await geometry(scroll, anchor, source);
    expect(entered.scrollTop).toBeCloseTo(entry, 1);
    expect(entered.scrollHeight).toBe(before.scrollHeight);
    expect(entered.sourceHeight).toBeCloseTo(before.sourceHeight, 1);
    expect(entered.anchorDocumentTop).toBeCloseTo(before.anchorDocumentTop, 1);

    await component.update({ props: { ...config, streamGrowth: 90 } });
    await settle(page);
    const streamed = await geometry(scroll, anchor, source);
    expect(streamed.scrollTop).toBeCloseTo(entry, 1);
    expect(streamed.scrollHeight - entered.scrollHeight).toBeCloseTo(90, 1);

    for (let crossing = 0; crossing < 4; crossing += 1) {
      await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry - 5);
      await settle(page);
      await expect(component.getByTestId('pinned-user-prompt')).toHaveCount(0);
      await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry + 1);
      await settle(page);
      await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();
    }

    const firstTurnRelease = (await transitionPoint(scroll, component.getByTestId('turn-0'))) - 2;
    const secondSource = component.getByTestId('source-1');
    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), firstTurnRelease - 2);
    await settle(page);
    await expect(component.getByTestId('pinned-user-prompt')).toContainText('prompt-0');
    const beforeRelease = await geometry(scroll, secondSource, secondSource);
    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), firstTurnRelease + 2);
    await settle(page);
    await expect(component.getByTestId('pinned-user-prompt')).toHaveCount(0);
    const released = await geometry(scroll, secondSource, secondSource);
    expect(released.scrollTop).toBeCloseTo(firstTurnRelease + 2, 1);
    expect(released.scrollHeight).toBe(beforeRelease.scrollHeight);
    expect(released.anchorDocumentTop).toBeCloseTo(beforeRelease.anchorDocumentTop, 1);

    const secondEntry = await transitionPoint(scroll, secondSource);
    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), secondEntry - 4);
    await settle(page);
    const beforeHandoff = await geometry(scroll, secondSource, secondSource);
    await scroll.evaluate((node, top) => node.scrollTo(0, top as number), secondEntry);
    await settle(page);
    await expect(component.getByTestId('pinned-user-prompt')).toContainText('prompt-1');
    const handedOff = await geometry(scroll, secondSource, secondSource);
    expect(handedOff.scrollTop).toBeCloseTo(secondEntry, 1);
    expect(handedOff.scrollHeight).toBe(beforeHandoff.scrollHeight);
    expect(handedOff.anchorDocumentTop).toBeCloseTo(beforeHandoff.anchorDocumentTop, 1);
  });
}

test('keeps bottom distance exact when sticky entry reaches the transcript end', async ({
  mount,
  page,
}) => {
  const component = await mount(StickyScrollStabilityHost, {
    props: { promptHeights: [44], responseHeight: 250, tailHeight: 0 },
  });
  const scroll = component.getByTestId('sticky-scroll');
  const maxScroll = await scroll.evaluate((node) => node.scrollHeight - node.clientHeight);
  await scroll.evaluate((node, top) => node.scrollTo(0, top as number), maxScroll - 4);
  await settle(page);
  await expect(component.getByTestId('pinned-user-prompt')).toHaveCount(0);

  await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await settle(page);
  await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();
  expect(
    await scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeCloseTo(0, 1);
});

test('composes sticky crossings with slow wheel, fast wheel, and keyboard scrolling', async ({
  mount,
  page,
}) => {
  const component = await mount(StickyScrollStabilityHost);
  const scroll = component.getByTestId('sticky-scroll');
  const entry = await transitionPoint(scroll, component.getByTestId('source-0'));
  const box = (await scroll.boundingBox())!;
  await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry - 3);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const slowBefore = await scroll.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 6);
  await settle(page);
  const slowAfter = await scroll.evaluate((node) => node.scrollTop);
  expect(slowAfter - slowBefore).toBeGreaterThan(0);
  expect(slowAfter - slowBefore).toBeLessThanOrEqual(12);
  await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

  await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry - 120);
  const fastBefore = await scroll.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 180);
  await settle(page);
  const fastAfter = await scroll.evaluate((node) => node.scrollTop);
  expect(fastAfter - fastBefore).toBeGreaterThan(100);
  expect(fastAfter - fastBefore).toBeLessThanOrEqual(200);

  await scroll.evaluate((node, top) => node.scrollTo(0, top as number), entry - 20);
  await scroll.focus();
  await expect(scroll).toBeFocused();
  const keyBefore = await scroll.evaluate((node) => node.scrollTop);
  await scroll.press('ArrowDown');
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(keyBefore);
  const keyAfter = await scroll.evaluate((node) => node.scrollTop);
  expect(keyAfter).toBeGreaterThan(keyBefore);
  expect(keyAfter - keyBefore).toBeLessThanOrEqual(80);
});
