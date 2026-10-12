import {
  test,
  expect,
  openMetadata,
  captureMetadata,
  expectReadable,
  outputJson,
  choice,
  frame,
  toggle,
  observeNativeLifetime,
  observeRealTime,
  nativePaste,
} from '../lib/chat-metadata.mjs';

// Conditional text, timestamps, ordering and clipboard expectations below are
// independent examples of original003's public contracts, not values imported
// from the candidate formatter/projection or a copied fake Store.
test('chat metadata M1: idle and absent or live phases never flash an indicator', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-live-phase');
  const display = frame(exercise, 'metadata-live-phase');
  const observation = await observeNativeLifetime(
    exercise,
    '[data-testid="live-stream-phase-indicator"]',
  );
  let evidence;
  try {
    await captureMetadata(page, display, 'phase-gated-before', info);
    for (const phase of [
      'omitted',
      'null',
      'connecting',
      'awaiting-snapshot',
      'resyncing',
      'delayed',
      'live',
    ]) {
      await choice(exercise, 'Stream phase', phase);
      await observeRealTime(page, 550);
      await expect(display.getByTestId('live-stream-phase-indicator')).toHaveCount(0);
    }
    await toggle(exercise, 'Turn in flight').click();
    for (const phase of ['live', 'null', 'omitted']) {
      await choice(exercise, 'Stream phase', phase);
      await observeRealTime(page, 550);
      await expect(display.getByTestId('live-stream-phase-indicator')).toHaveCount(0);
    }
    await captureMetadata(page, display, 'phase-gated-after', info);
  } finally {
    evidence = await observation.finish('phase-gates', info);
  }
  expect(
    evidence.samples.every(({ nodes }) => nodes.length === 0),
    'No transient indicator may flash between assertions',
  ).toBe(true);
  // Keep framework-generated hidden-input events in the receipt, while checking
  // that actual radio/switch activation came from native input.
  const controls = evidence.inputs.filter(({ role }) => role === 'radio' || role === 'switch');
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every(({ trusted }) => trusted)).toBe(true);
});

test('chat metadata M4: discussion reason changes and omitted reason preserve announcement and exit callback', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-discussion');
  const display = frame(exercise, 'metadata-discussion');
  const banner = display.getByRole('alert');
  const state = () => outputJson(exercise.getByTestId('metadata-discussion-state'));
  await expect(banner).toHaveAttribute('aria-live', 'polite');
  await captureMetadata(page, display, 'discussion-before', info);
  const reason =
    'Choose the release scope.\nKeep the original evidence for review. ' +
    'Readable-long-reason-'.repeat(18);
  await exercise.getByLabel('Discussion reason', { exact: true }).fill(reason);
  await expect(banner.getByTestId('chat-notice-reason')).toHaveText(reason);
  await expectReadable(banner);
  await toggle(exercise, 'Include discussion reason').click();
  await expect(banner.getByTestId('chat-notice-reason')).toHaveCount(0);
  await expect(banner).toHaveAttribute('aria-live', 'polite');
  await toggle(exercise, 'Include discussion reason').click();
  await expect(banner.getByTestId('chat-notice-reason')).toHaveText(reason);
  await toggle(exercise, 'Discussion present').click();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => (await state()).observations.exitCount).toBe(1);
  await toggle(exercise, 'Discussion present').click();
  await expect(banner.getByTestId('chat-notice-reason')).toHaveText(reason);
  await expect.poll(async () => (await state()).observations.exitCount).toBe(1);
  await captureMetadata(page, display, 'discussion-after', info);
});

test('chat metadata M5: draft status and auto-unarchived title follow mount and optional props', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const draft = host.getByTestId('metadata-draft');
  const draftFrame = frame(draft, 'metadata-draft');
  const status = draftFrame.getByRole('status');
  await expect(status).toBeVisible();
  await captureMetadata(page, draftFrame, 'draft-before', info);
  const node = await status.elementHandle();
  try {
    await toggle(draft, 'Mount Draft loading gate').click();
    await expect(status).toHaveCount(0);
    expect(await node.evaluate((element) => element.isConnected)).toBe(false);
    await toggle(draft, 'Mount Draft loading gate').click();
    await expect(status).toBeVisible();
    await expectReadable(status);
    await captureMetadata(page, draftFrame, 'draft-after', info);
  } finally {
    await node.dispose();
  }
  const exercise = host.getByTestId('metadata-unarchived');
  const display = frame(exercise, 'metadata-unarchived');
  const unarchived = display.getByRole('status');
  await captureMetadata(page, display, 'unarchived-before', info);
  const title = 'Persisted explanation\nfrom the current transcript row.';
  await exercise.getByLabel('Auto-unarchived title', { exact: true }).fill(title);
  await expect(unarchived).toHaveAttribute('title', title);
  await toggle(exercise, 'Include unarchived title').click();
  await expect(unarchived).not.toHaveAttribute('title');
  await exercise
    .getByRole('button', { name: 'Remount Auto-unarchived notice', exact: true })
    .click();
  await expect(unarchived).not.toHaveAttribute('title');
  await toggle(exercise, 'Include unarchived title').click();
  await expect(unarchived).toHaveAttribute('title', title);
  await expectReadable(unarchived);
  await captureMetadata(page, display, 'unarchived-after', info);
});

test('chat metadata M6: historical failures distinguish fallback empty single and ordered multiple records', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-failure');
  const display = frame(exercise, 'metadata-failure');
  const expand = display.locator('button[aria-controls]');
  const details = display.getByRole('region', { name: 'Details', exact: true });
  await captureMetadata(page, display, 'history-collapsed-before', info);
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.press('Enter');
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect(details).toHaveAttribute('id', await expand.getAttribute('aria-controls'));
  // The newer first timestamp must remain first: the component is a presenter,
  // not a sorter or a reconstructor of history.
  expect(
    await details.locator('time').evaluateAll((nodes) => nodes.map((node) => node.dateTime)),
  ).toEqual(['2026-10-12T03:20:00.000Z', '2026-10-12T03:10:00.000Z']);
  expect(
    await details
      .locator('[data-failure-message-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-failure-message-id'))),
  ).toEqual(['history-first', 'history-second']);
  await choice(exercise, 'Failure records', 'single');
  await expect(expand).toHaveAccessibleName('1 recorded failure');
  await expect(details.locator('pre')).toHaveCount(1);
  await choice(exercise, 'Failure records', 'empty');
  await expect(expand).toHaveAccessibleName('0 recorded failures');
  await expect(details.locator('pre')).toHaveCount(0);
  await expect(details).toHaveCount(1);
  await exercise
    .getByLabel('Failure fallback reason', { exact: true })
    .fill('Current fallback diagnostic.');
  await choice(exercise, 'Failure records', 'fallback');
  await expect(expand).toHaveAccessibleName('1 recorded failure');
  await expect(details.locator('pre')).toHaveText('Current fallback diagnostic.');
  await expect(details.locator('time')).toHaveCount(0);
  await exercise.getByLabel('Failure fallback reason', { exact: true }).fill('');
  await expect(details.locator('pre')).toBeEmpty();
  await choice(exercise, 'Failure records', 'multiple');
  await expect(expand).toHaveAccessibleName('2 recorded failures');
  await expect(details.locator('pre')).toHaveText([
    'First recorded failure.\nCheck the provider response.',
    'Second recorded failure.',
  ]);
  await captureMetadata(page, display, 'history-expanded-after', info);
});

test('chat metadata M7: clipboard contains current ordered raw diagnostics and handles empty history', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: process.env.PARITY_CANDIDATE_URL,
  });
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-failure');
  const display = frame(exercise, 'metadata-failure');
  const paste = exercise.getByLabel('Paste copied failure details', { exact: true });
  await display.locator('button[aria-controls]').press('Enter');
  await captureMetadata(page, display, 'clipboard-before', info);
  const copy = display.getByRole('button', { name: /^(Copy details|Copied!)$/ });
  await copy.click();
  await nativePaste(
    paste,
    '2026-10-12T03:20:00.000Z\nFirst recorded failure.\nCheck the provider response.\n\n2026-10-12T03:10:00.000Z\nSecond recorded failure.',
  );
  await exercise
    .getByLabel('Failure first reason', { exact: true })
    .fill('Replaced first diagnostic.');
  await exercise.getByLabel('Failure first timestamp', { exact: true }).fill('');
  await exercise
    .getByLabel('Failure second reason', { exact: true })
    .fill('Replaced second diagnostic.');
  await copy.click();
  await nativePaste(
    paste,
    'Replaced first diagnostic.\n\n2026-10-12T03:10:00.000Z\nReplaced second diagnostic.',
  );
  await choice(exercise, 'Failure records', 'empty');
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await nativePaste(paste, '');
  await choice(exercise, 'Failure records', 'fallback');
  await exercise
    .getByLabel('Failure fallback reason', { exact: true })
    .fill('Fallback without timestamp.');
  await copy.click();
  await nativePaste(paste, 'Fallback without timestamp.');
  await captureMetadata(page, display, 'clipboard-after', info);
});

test('chat metadata M9: queue notice disappears below the nearest-second cutoff and returns at 500ms', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-queued');
  const display = frame(exercise, 'metadata-queued');
  const wait = exercise.getByLabel('Queue wait milliseconds', { exact: true });
  const notice = display.getByTestId('queued-message-notice');
  await captureMetadata(page, display, 'queue-before', info);
  await wait.fill('499');
  await expect(notice).toHaveCount(0);
  await expect(display.locator('[data-tooltip-trigger]')).toHaveCount(0);
  await wait.fill('500');
  await expect(notice.getByTestId('queued-message-notice-text')).toHaveText(
    'Waited in queue for 1s',
  );
  await wait.fill('0');
  await expect(notice).toHaveCount(0);
  await wait.fill('59600');
  await expect(notice.getByTestId('queued-message-notice-text')).toHaveText(
    'Waited in queue for 1m',
  );
  await captureMetadata(page, display, 'queue-after', info);
});

test('chat metadata M11: hook state distinguishes absent false true eviction and unrelated reason', async ({
  page,
}, info) => {
  const host = await openMetadata(page);
  const exercise = host.getByTestId('metadata-hook');
  const display = frame(exercise, 'metadata-hook');
  const status = display.getByTestId('hook-wake-status');
  const reason = exercise.getByLabel('Hook reason', { exact: true });
  await captureMetadata(page, display, 'hook-state-before', info);
  await expect(status).toHaveText('woke the agent');
  await choice(exercise, 'Hook still active', 'false');
  await expect(status).toHaveText('woke the agent and is now retired');
  await choice(exercise, 'Hook still active', 'true');
  await expect(status).toHaveText('woke the agent and will continue to run');
  await choice(exercise, 'Hook still active', 'absent');
  await expect(status).toHaveText('woke the agent');
  await reason.fill('evicted');
  await expect(status).toHaveText('woke the agent and is now retired');
  await choice(exercise, 'Hook still active', 'true');
  await expect(status).toHaveText('woke the agent and is now retired');
  await reason.fill('other');
  await expect(status).toHaveText('woke the agent');
  await expect(display.getByRole('link')).toHaveCount(0);
  await expect(display.getByRole('button')).toHaveCount(0);
  await captureMetadata(page, display, 'hook-state-after', info);
});
