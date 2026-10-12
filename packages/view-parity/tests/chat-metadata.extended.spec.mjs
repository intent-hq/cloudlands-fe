import {
  test,
  expect,
  openMetadata,
  captureMetadata,
  outputJson,
  choice,
  frame,
  toggle,
  observeNativeLifetime,
  observeRealTime,
} from '../lib/chat-metadata.mjs';

test('chat metadata M2: one real grace deadline survives eligible phase changes and visible copy stays current', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-live-phase');
  const display = frame(exercise, 'metadata-live-phase');
  const message = display.getByTestId('live-stream-phase-message');
  await choice(exercise, 'Stream phase', 'connecting');
  await captureMetadata(page, display, 'grace-before', info);
  const observation = await observeNativeLifetime(
    exercise,
    '[data-testid="live-stream-phase-indicator"]',
  );
  let evidence;
  try {
    await toggle(exercise, 'Turn in flight').click();
    await expect(message).toHaveCount(0);
    await observeRealTime(page, 120);
    await choice(exercise, 'Stream phase', 'awaiting-snapshot');
    await observeRealTime(page, 120);
    await choice(exercise, 'Stream phase', 'resyncing');
    await expect(message).toHaveText('Re-syncing live stream...');
    for (const [phase, text] of [
      ['delayed', 'Live updates delayed — retrying...'],
      ['connecting', 'Connecting live stream...'],
      ['awaiting-snapshot', 'Reticulating splines...'],
    ]) {
      await choice(exercise, 'Stream phase', phase);
      await expect(message).toHaveText(text);
    }
    await captureMetadata(page, display, 'grace-after', info);
  } finally {
    evidence = await observation.finish('eligible-grace', info);
  }
  const start = evidence.inputs.find(({ name }) => name === 'Turn in flight');
  const changed = evidence.inputs.find(({ name }) => name === 'resyncing');
  const appeared = evidence.samples.find(({ nodes }) => nodes.length);
  expect(start?.trusted).toBe(true);
  expect(changed?.trusted).toBe(true);
  // This is the source's semantic debounce contract, not a speed budget. One
  // millisecond allows browser timestamp/timer quantization at the 500ms edge.
  expect(
    appeared.at - start.at,
    'Never appear before the original grace deadline',
  ).toBeGreaterThanOrEqual(499);
  expect(changed.at, 'The phase input must occur while grace is pending').toBeLessThan(appeared.at);
  expect(
    appeared.at - changed.at,
    'Changing eligible phase must not start another 500ms grace',
  ).toBeLessThan(499);
  const visible = evidence.samples.slice(evidence.samples.indexOf(appeared));
  expect(
    visible.every(({ nodes }) => nodes.length === 1 && nodes[0].id === appeared.nodes[0].id),
    'Visible eligible changes retain the actual indicator without another hidden period',
  ).toBe(true);
});

test('chat metadata M3: ineligibility and unmount cancel pending grace and remount starts fresh', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-live-phase');
  const display = frame(exercise, 'metadata-live-phase');
  const indicator = display.getByTestId('live-stream-phase-indicator');
  await choice(exercise, 'Stream phase', 'connecting');
  await captureMetadata(page, display, 'grace-cancel-before', info);
  const observation = await observeNativeLifetime(
    exercise,
    '[data-testid="live-stream-phase-indicator"]',
  );
  let evidence;
  try {
    await toggle(exercise, 'Turn in flight').click();
    await observeRealTime(page, 120);
    await toggle(exercise, 'Turn in flight').click();
    await observeRealTime(page, 550);
    await expect(indicator).toHaveCount(0);
    await toggle(exercise, 'Turn in flight').click();
    await observeRealTime(page, 120);
    await choice(exercise, 'Stream phase', 'live');
    await observeRealTime(page, 550);
    await expect(indicator).toHaveCount(0);
    await choice(exercise, 'Stream phase', 'delayed');
    await observeRealTime(page, 120);
    await toggle(exercise, 'Mount Live stream phase').click();
    await observeRealTime(page, 550);
    await expect(indicator).toHaveCount(0);
    await toggle(exercise, 'Mount Live stream phase').click();
    await expect(indicator).toHaveCount(0);
    await expect(indicator).toBeVisible();
    await choice(exercise, 'Stream phase', 'null');
    await expect(indicator).toHaveCount(0);
    await choice(exercise, 'Stream phase', 'delayed');
    await expect(indicator).toHaveCount(0);
    await expect(indicator).toBeVisible();
    await captureMetadata(page, display, 'grace-cancel-after', info);
  } finally {
    evidence = await observation.finish('grace-cancel-reset', info);
  }
  const remount = evidence.inputs.filter(({ name }) => name === 'Mount Live stream phase').at(-1);
  const appeared = evidence.samples.find(({ nodes }) => nodes.length);
  expect(remount?.trusted).toBe(true);
  expect(
    appeared.at - remount.at,
    'Stale cancelled timers cannot reveal the new mount early',
  ).toBeGreaterThanOrEqual(499);
  expect(
    evidence.samples.filter(({ at }) => at < remount.at).every(({ nodes }) => !nodes.length),
  ).toBe(true);
  const reset = evidence.inputs.filter(({ name }) => name === 'delayed').at(-1);
  const reappeared = evidence.samples.find(({ at, nodes }) => at > reset.at && nodes.length);
  expect(
    reappeared.at - reset.at,
    'Losing eligibility after visibility must reset grace too',
  ).toBeGreaterThanOrEqual(499);
});

test('chat metadata M8: diagnostics scroll with keyboard and remount resets local expansion', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-failure');
  const display = frame(exercise, 'metadata-failure');
  await exercise.getByRole('button', { name: 'Use long failure reason', exact: true }).click();
  const expand = display.locator('button[aria-controls]');
  await captureMetadata(page, display, 'failure-scroll-before', info);
  await expand.press('Enter');
  const details = display.getByRole('region', { name: 'Details', exact: true });
  await expect(details).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Tab');
  await expect(display.getByRole('button', { name: 'Copy details', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details).toBeFocused();
  const initial = await details.evaluate((node) => ({
    top: node.scrollTop,
    height: node.clientHeight,
    total: node.scrollHeight,
    width: node.clientWidth,
    contentWidth: node.scrollWidth,
  }));
  expect(initial.total).toBeGreaterThan(initial.height);
  expect(
    initial.contentWidth,
    'Long diagnostics wrap without hiding text to the side',
  ).toBeLessThanOrEqual(initial.width + 1);
  const scrollBefore = await page.evaluate(() => scrollY);
  await details.press('End');
  await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBeGreaterThan(initial.top);
  await expect(details).toBeFocused();
  expect(await page.evaluate(() => scrollY), 'The diagnostic region owns keyboard scrolling').toBe(
    scrollBefore,
  );
  await details.press('Home');
  await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBe(0);
  await captureMetadata(page, display, 'failure-scroll-after', info);
  await exercise.getByRole('button', { name: 'Remount Failure history', exact: true }).click();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toHaveCount(0);
  await expand.press('Space');
  await expect(details).toBeVisible();
  await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBe(0);
});

test('chat metadata M10: queue tooltip opens on real hover and keyboard focus with current timestamp', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-queued');
  const display = frame(exercise, 'metadata-queued');
  const trigger = display.locator('[data-tooltip-trigger]');
  const notice = display.getByTestId('queued-message-notice');
  await captureMetadata(page, display, 'queue-tooltip-before', info);
  await trigger.hover();
  const tooltip = page.locator('[data-tooltip-content]');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Waited in queue for 1m 5s');
  await expect(tooltip).toContainText('Mon, Oct 12, 2026, 03:00:00 AM');
  await expect(notice).toHaveAttribute('title', 'Mon, Oct 12, 2026, 03:00:00 AM');
  await captureMetadata(page, tooltip, 'queue-hover-tooltip', info);
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await exercise.getByLabel('Queue wait milliseconds', { exact: true }).fill('1500');
  await exercise
    .getByLabel('Queued at timestamp', { exact: true })
    .fill('2026-10-13T04:05:06.000Z');
  const remount = exercise.getByRole('button', { name: 'Remount Queued message', exact: true });
  await remount.press('Enter');
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Waited in queue for 2s');
  await expect(tooltip).toContainText('Tue, Oct 13, 2026, 04:05:06 AM');
  await expect(notice).toHaveAttribute('title', 'Tue, Oct 13, 2026, 04:05:06 AM');
  await captureMetadata(page, tooltip, 'queue-focus-tooltip', info);
  await trigger.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await toggle(exercise, 'Mount Queued message').click();
  await expect(trigger).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await toggle(exercise, 'Mount Queued message').click();
  await captureMetadata(page, display, 'queue-tooltip-after', info);
});

test('chat metadata M12: hook title follows raw name and real overflow through content changes and remount', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-hook');
  const display = frame(exercise, 'metadata-hook');
  const name = display.getByTestId('hook-wake-primary-label');
  const raw = exercise.getByLabel('Hook raw name', { exact: true });
  const input = exercise.getByLabel('Hook display name', { exact: true });
  await input.fill('Hook');
  await expect(name).not.toHaveAttribute('title');
  await captureMetadata(page, display, 'hook-title-before', info);
  await raw.fill('  Verbatim hook name  ');
  await expect(name).toHaveAttribute('title', '  Verbatim hook name  ');
  await exercise.getByRole('button', { name: 'Use long hook name', exact: true }).click();
  await expect.poll(() => name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(name).toHaveAttribute('title', '  Verbatim hook name  ');
  await raw.fill('');
  const longName = await input.inputValue();
  await expect(name).toHaveAttribute('title', longName);
  await raw.fill(longName);
  await expect(name).toHaveAttribute('title', longName);
  await raw.fill('');
  await input.fill('Hook');
  await expect.poll(() => name.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(name).not.toHaveAttribute('title');
  const detached = await name.elementHandle();
  try {
    await toggle(exercise, 'Mount Hook wake attribution').click();
    await expect(name).toHaveCount(0);
    expect(await detached.evaluate((node) => node.isConnected)).toBe(false);
    await input.fill('A newly mounted hook');
    await raw.fill('Canonical raw identity');
    await toggle(exercise, 'Mount Hook wake attribution').click();
    await expect(name).toHaveAttribute('title', 'Canonical raw identity');
    await raw.fill('');
    await input.fill('Hook');
    await expect(name).not.toHaveAttribute('title');
    await captureMetadata(page, display, 'hook-title-after', info);
  } finally {
    await detached.dispose();
  }
  // This proves real observer-driven updates and DOM lifetime. Internal observer
  // disconnect/font-listener cleanup is statically reviewed, not inferred from
  // a disconnected node or an absence of browser errors.
});

test.describe('discussion native outro lifetime', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('chat metadata M13: full-motion discussion reversal retains its node and only completed exit calls back', async ({
    page,
  }, info) => {
    const host = await openMetadata(page, 'full');
    const exercise = host.getByTestId('metadata-discussion');
    const display = frame(exercise, 'metadata-discussion');
    const banner = display.getByRole('alert');
    const present = toggle(exercise, 'Discussion present');
    const state = () => outputJson(exercise.getByTestId('metadata-discussion-state'));
    await captureMetadata(page, display, 'discussion-full-before', info);
    const node = await banner.elementHandle();
    const observation = await observeNativeLifetime(exercise, '[data-chat-notice]');
    let evidence;
    try {
      await present.press('Enter');
      expect(
        await observation.waitForShrink(),
        'The actual outgoing notice must shrink while retained',
      ).toBe(true);
      await present.press('Enter');
      await expect(banner).toBeVisible();
      expect(await node.evaluate((element) => element.isConnected)).toBe(true);
      await captureMetadata(page, display, 'discussion-full-reversed', info);
      expect((await state()).observations.exitCount).toBe(0);
      await present.press('Enter');
      await expect(banner).toHaveCount(0);
      await expect.poll(async () => (await state()).observations.exitCount).toBe(1);
      expect(await node.evaluate((element) => element.isConnected)).toBe(false);
      await present.press('Enter');
      await expect(banner).toBeVisible();
      await captureMetadata(page, display, 'discussion-full-after', info);
      await toggle(exercise, 'Mount Discussion request').click();
      await expect(banner).toHaveCount(0);
      await observeRealTime(page, 550);
      expect(
        (await state()).observations.exitCount,
        'Owner teardown cannot emit another completed-exit callback',
      ).toBe(1);
    } finally {
      evidence = await observation.finish('discussion-reversal', info);
      await node.dispose();
    }
    const first = evidence.samples.find(({ nodes }) => nodes.length).nodes[0];
    const removed = evidence.samples.findIndex(({ nodes }) => !nodes.length);
    expect(removed).toBeGreaterThan(0);
    expect(
      evidence.samples
        .slice(0, removed)
        .every(({ nodes }) => nodes.length === 1 && nodes[0].id === first.id),
    ).toBe(true);
    expect(evidence.samples.at(-1).nodes).toEqual([]);
  });
});
