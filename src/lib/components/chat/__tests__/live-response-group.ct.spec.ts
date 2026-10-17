import { expect, test } from '../../../../test/ct-test';
import LiveResponseGroupHost from './LiveResponseGroupHost.svelte';
import StreamingResponseGroupLifecycleHost from './StreamingResponseGroupLifecycleHost.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

async function readDrum(scroller: Locator) {
  return scroller.evaluate((node) => {
    const line = node.querySelectorAll('[data-testid="live-stream-line"]');
    const range = document.createRange();
    range.selectNodeContents(line[line.length - 1]);
    const fragments = Array.from(range.getClientRects());
    const last = fragments[fragments.length - 1];
    let clipTop = node.getBoundingClientRect().top;
    let clipBottom = node.getBoundingClientRect().bottom;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
        const bounds = parent.getBoundingClientRect();
        clipTop = Math.max(clipTop, bounds.top);
        clipBottom = Math.min(clipBottom, bounds.bottom);
      }
    }
    return {
      scrollTop: node.scrollTop,
      bottomGap: node.scrollHeight - node.clientHeight - node.scrollTop,
      lastLineTop: last.top,
      lastLineBottom: last.bottom,
      clipTop,
      clipBottom,
      lastLineVisible: last.top >= clipTop && last.bottom <= clipBottom + 1,
    };
  });
}

async function expectFollowing(scroller: Locator) {
  await expect.poll(() => readDrum(scroller)).toMatchObject({ lastLineVisible: true });
  await expect.poll(async () => (await readDrum(scroller)).bottomGap).toBeLessThanOrEqual(1);
}

test('keeps the final wrapped line readable when existing live text grows', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const component = await mount(LiveResponseGroupHost, { props: { chunk: 'Inspecting output.' } });
  const scroller = component.locator('.cylinder-scroller');
  await expectFollowing(scroller);
  await component.update({
    props: {
      chunk:
        'Inspecting output. The existing paragraph grows as live words arrive and wrap onto new lines. The newest sentence must remain readable at the bottom of the active group. Final words are visible.',
    },
  });
  try {
    await expectFollowing(scroller);
  } finally {
    await testInfo.attach('wrapped-drum-layout', {
      body: JSON.stringify(await readDrum(scroller), null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('wrapped-drum', {
      body: await component.screenshot({ path: testInfo.outputPath('wrapped-drum.png') }),
      contentType: 'image/png',
    });
  }
});

test('follows the final update in a burst without needing another update', async ({ mount }) => {
  const component = await mount(LiveResponseGroupHost);
  const scroller = component.locator('.cylinder-scroller');
  await expectFollowing(scroller);
  // The host appends on consecutive browser frames, including while an earlier
  // append is scrolling. There is no later mutation to rescue a dropped update.
  await component.update({ props: { burstLineCounts: [12, 14, 16, 18, 20, 22, 24, 26] } });
  await expect(component.getByTestId('live-stream-line')).toHaveCount(26);
  await expectFollowing(scroller);
});

test('follows reflow, preserves manual scrollback, and resumes at the bottom', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 480 });
  const component = await mount(LiveResponseGroupHost, {
    props: {
      chunk: 'Live output with enough words to wrap when the chat panel becomes narrower.',
      lineCount: 12,
    },
  });
  const scroller = component.locator('.cylinder-scroller');
  await expectFollowing(scroller);
  await page.setViewportSize({ width: 320, height: 480 });
  await expectFollowing(scroller);

  const followedTop = (await readDrum(scroller)).scrollTop;
  await scroller.hover();
  await page.mouse.wheel(0, -80);
  await expect.poll(async () => (await readDrum(scroller)).scrollTop).toBeLessThan(followedTop);
  const scrollbackTop = (await readDrum(scroller)).scrollTop;
  await component.update({ props: { lineCount: 14 } });
  await expect(component.getByTestId('live-stream-line')).toHaveCount(14);
  // Observe the quiet period too: a deferred follow must not pull the reader
  // back down after the wheel gesture has finished.
  await page.waitForTimeout(400);
  expect((await readDrum(scroller)).scrollTop).toBeCloseTo(scrollbackTop, 0);
  expect((await readDrum(scroller)).lastLineVisible).toBe(false);

  await page.mouse.wheel(0, 10000);
  await expectFollowing(scroller);
  await component.update({ props: { lineCount: 15 } });
  await expectFollowing(scroller);
});

test('preserves native keyboard scrollback through text growth and resumes at the bottom', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const chunk =
    'Inspecting the live output while earlier lines remain available for reading. '.repeat(9);
  const component = await mount(LiveResponseGroupHost, { props: { chunk } });
  const scroller = component.locator('.cylinder-scroller');
  await expectFollowing(scroller);
  const followed = await readDrum(scroller);
  // Start after the initial programmatic follow has settled.
  await page.waitForTimeout(400);

  await scroller.click({ position: { x: 120, y: 75 } });
  await page.keyboard.press('PageUp');
  await expect
    .poll(async () => (await readDrum(scroller)).scrollTop)
    .toBeLessThan(followed.scrollTop);
  // Let native keyboard scrolling settle before recording the reader's position.
  await page.waitForTimeout(400);
  const scrollback = await readDrum(scroller);
  expect(scrollback.scrollTop).toBeLessThan(followed.scrollTop);
  expect(scrollback.lastLineVisible).toBe(false);
  await testInfo.attach('keyboard-scrollback', {
    body: await component.screenshot({ path: testInfo.outputPath('keyboard-scrollback.png') }),
    contentType: 'image/png',
  });

  const grownChunk =
    chunk + 'New streamed text arrives after the user has deliberately scrolled upward. '.repeat(4);
  await component.update({ props: { chunk: grownChunk } });
  // A deferred follow must also leave the native PageUp position alone.
  await page.waitForTimeout(600);
  const afterGrowth = await readDrum(scroller);
  await testInfo.attach('keyboard-drum-layout', {
    body: JSON.stringify({ followed, scrollback, afterGrowth }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('keyboard-growth', {
    body: await component.screenshot({ path: testInfo.outputPath('keyboard-growth.png') }),
    contentType: 'image/png',
  });
  expect(afterGrowth.scrollTop).toBeCloseTo(scrollback.scrollTop, 0);
  expect(afterGrowth.lastLineVisible).toBe(false);

  await page.keyboard.press('End');
  await expectFollowing(scroller);
  await component.update({
    props: { chunk: grownChunk + 'Following resumes with the next output. '.repeat(4) },
  });
  await expectFollowing(scroller);
});

test('keeps following when a child input handles navigation keys', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'Inspecting output.', editable: true },
  });
  const scroller = component.locator('.cylinder-scroller');
  const input = component.getByRole('textbox', { name: 'Live child input' });
  await expectFollowing(scroller);
  await input.fill('reading');
  await input.press('Home');
  await input.press('x');
  await expect(input).toHaveValue('xreading');
  await component.update({ props: { chunk: 'More text wraps into the live drum. '.repeat(12) } });
  await expectFollowing(scroller);
});

test('preserves native PageUp scrollback from a focused child input', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'Inspecting output.', editable: true },
  });
  const scroller = component.locator('.cylinder-scroller');
  const input = component.getByRole('textbox', { name: 'Live child input' });
  await input.fill('reading');
  const chunk =
    'Inspecting the live output while earlier lines remain available for reading. '.repeat(9);
  await component.update({ props: { chunk } });
  await expectFollowing(scroller);
  await page.waitForTimeout(400);
  const followed = await readDrum(scroller);

  // Keep focus in the input: PageUp can scroll its ancestor without moving focus.
  await expect(input).toBeFocused();
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(400);
  const scrollback = await readDrum(scroller);
  expect(scrollback.scrollTop).toBeLessThan(followed.scrollTop);
  expect(scrollback.lastLineVisible).toBe(false);
  await expect(input).toBeFocused();

  const grownChunk =
    chunk + 'New streamed text arrives after the user has deliberately scrolled upward. '.repeat(4);
  await component.update({ props: { chunk: grownChunk } });
  await page.waitForTimeout(600);
  const afterGrowth = await readDrum(scroller);
  await testInfo.attach('child-keyboard-layout', {
    body: JSON.stringify({ followed, scrollback, afterGrowth }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('child-keyboard-growth', {
    body: await page.screenshot({ path: testInfo.outputPath('child-keyboard-growth.png') }),
    contentType: 'image/png',
  });
  expect(afterGrowth.scrollTop).toBeCloseTo(scrollback.scrollTop, 0);
  expect(afterGrowth.lastLineVisible).toBe(false);
  await expect(input).toBeFocused();

  await scroller.focus();
  await page.keyboard.press('End');
  await expectFollowing(scroller);
  await component.update({
    props: { chunk: grownChunk + 'Following resumes with the next output. '.repeat(4) },
  });
  await expectFollowing(scroller);
});

test('preserves the header seam and alignment through live disclosure changes', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(LiveResponseGroupHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const row = component.locator('[data-operational-disclosure-row]');
  // The host's mounted root is the response group, not a wrapper around it.
  const readSeam = () =>
    component.evaluate((node) => {
      const rect = (selector: string) => node.querySelector(selector)!.getBoundingClientRect();
      const row = rect('[data-operational-disclosure-row]');
      const scroller = rect('.cylinder-scroller');
      const summary = rect('[data-testid="response-group-name"]');
      const line = rect('[data-testid="live-stream-line"]');
      const icon = rect('[data-response-group-disclosure-icon] svg');
      const guide = rect('[data-operational-expanded-guide]');
      return {
        gap: scroller.top - row.bottom,
        contentOffset: line.x - summary.x,
        guideOffset: guide.x + guide.width / 2 - icon.x - icon.width / 2,
      };
    });
  const previewSeam = { gap: 8, contentOffset: 0, guideOffset: 0 };
  await expect.poll(readSeam).toEqual(previewSeam);
  const headerBox = await row.boundingBox();

  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(readSeam).toEqual({ ...previewSeam, gap: 16 });
  expect(await row.boundingBox()).toEqual(headerBox);

  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(readSeam).toEqual(previewSeam);
  await component.update({ props: { chunk: 'more live content', lineCount: 12 } });
  await expect
    .poll(() => component.locator('.cylinder-scroller').evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await expect.poll(readSeam).toEqual(previewSeam);
  expect(await row.boundingBox()).toEqual(headerBox);

  await component.update({ props: { isStreaming: false } });
  await expect(component.locator('.cylinder-scroller')).toHaveCount(0);
  const groupBox = await component.boundingBox();
  expect(groupBox!.height).toBe(headerBox!.height);
});

test('keeps only the current live row in the cylinder and all expanded history', async ({
  mount,
}) => {
  const component = await mount(LiveResponseGroupHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const preview = component.locator('[data-operational-preview-content]');
  const expanded = component.locator('[data-operational-expanded-content]');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByTestId('live-current-child')).toHaveText('current chunk');
  await expect(preview.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'new current chunk', isStreaming: true } });
  await expect(preview.getByTestId('live-current-child')).toHaveText('new current chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded.getByTestId('live-current-child')).toHaveCount(1);
  await expect(expanded.getByTestId('live-history-child')).toHaveCount(2);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded.getByTestId('live-history-child').last()).toHaveText('latest chunk');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByTestId('live-current-child')).toHaveText('latest chunk');
  await expect(preview.getByTestId('live-history-child')).toHaveCount(0);

  await component.update({ props: { chunk: 'latest chunk', isStreaming: false } });
  await expect(component.getByTestId('live-current-child')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toContainText('earlier chunk');
});

test('caps and follows tall live rows as a streaming cylinder', async ({ mount, page }) => {
  const component = await mount(LiveResponseGroupHost, {
    props: { chunk: 'streaming line', lineCount: 12, isStreaming: true },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  const scroller = component.locator('.cylinder-scroller');
  const currentLine = component.getByTestId('live-stream-line').first();
  const summary = component.getByTestId('response-group-name');
  const groupContent = component.locator('[data-response-group-content]');

  for (const width of [800, 320]) {
    await page.setViewportSize({ width, height: 480 });
    const [lineBox, summaryBox] = await Promise.all([
      currentLine.boundingBox(),
      summary.boundingBox(),
    ]);
    expect(lineBox!.x).toBeCloseTo(summaryBox!.x, 0);
  }

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(scroller).toHaveCSS('max-height', '100px');
  expect((await scroller.boundingBox())!.height).toBeLessThanOrEqual(100);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((node) => node.style.maskImage))
    .toContain('linear-gradient');

  await scroller.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => scroller.evaluate((node) => node.style.maskImage)).toBe('');
  await page.waitForTimeout(200);

  await component.update({
    props: { chunk: 'latest streaming line', lineCount: 14, isStreaming: true },
  });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((node) => node.style.maskImage))
    .toContain('linear-gradient');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(scroller).not.toHaveCSS('max-height', '100px');
  await expect(component.getByTestId('live-history-child')).toHaveCount(2);
  const [contentBox, guideBox] = await Promise.all([
    groupContent.boundingBox(),
    component.locator('.pointer-events-none.absolute.inset-y-0').boundingBox(),
  ]);
  expect(guideBox!.x + guideBox!.width / 2 - contentBox!.x).toBeCloseTo(18, 0);
});

test('reconciles a tag-first streaming group through explicit close and completion', async ({
  mount,
}) => {
  const component = await mount(StreamingResponseGroupLifecycleHost);
  const trigger = component.getByTestId('response-group-disclosure');
  const visibleChildren = component.locator('[data-response-group-child]');
  const previewChildren = component.locator(
    '[data-operational-preview-content] [data-response-group-child]',
  );
  const expandedChildren = component.locator(
    '[data-operational-expanded-content] [data-response-group-child]',
  );

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('response-group-name')).toHaveText('Thinking...');

  await component.update({ props: { phase: 'live', isStreaming: true } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(previewChildren).toHaveCount(1);
  await expect(
    component.locator(
      '[data-operational-preview-content] [data-response-group-child][data-message-content-block="tool_use"]',
    ),
  ).toHaveCount(1);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(expandedChildren).toHaveCount(7);
  await expect(
    component.getByText(
      'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    ),
  ).toBeVisible();
  const adjacentHistory = component.getByTestId('reasoning-history-title').first();
  await adjacentHistory.click();
  await expect(component.getByText('Searching workspace API for title setting')).toBeVisible();
  await expect(
    component.getByTestId('response-group').getByTestId('reasoning-disclosure'),
  ).toHaveCount(0);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(previewChildren).toHaveCount(1);

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(component.getByText('Workspace inspection complete.')).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(visibleChildren).toHaveCount(7);

  await component.update({ props: { phase: 'closed', isStreaming: false } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(visibleChildren).toHaveCount(7);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(visibleChildren).toHaveCount(0);
});

test('rehydrates a completed group collapsed and opens its full history', async ({ mount }) => {
  const component = await mount(StreamingResponseGroupLifecycleHost, {
    props: { phase: 'closed', isStreaming: false },
  });
  const trigger = component.getByTestId('response-group-disclosure');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('response-group-name')).toHaveText('Reasoning');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
  await expect(component.getByTestId('response-group-snippet')).toHaveCount(0);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(7);
  await component.getByTestId('reasoning-history-title').first().click();
  await expect(component.getByText('Searching workspace API for title setting')).toBeVisible();
  await expect(
    component.getByText(
      'I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    ),
  ).toBeVisible();
  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(component.locator('[data-response-group-child]')).toHaveCount(0);
});
