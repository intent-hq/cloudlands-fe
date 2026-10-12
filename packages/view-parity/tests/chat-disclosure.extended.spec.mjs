import {
  test,
  expect,
  openDisclosure,
  captureDisclosure,
  outputJson,
  prepareFollowedDisclosure,
  expectFollowedAndSettled,
  expectLeaseLifetime,
  readScrollSnapshot,
  observeScrollFrames,
  waitForDisclosedControl,
} from '../lib/chat-disclosure.mjs';

test.describe('isolated full motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('chat disclosure D13: full disclosure follows real growth and collapse through terminal lease release', async ({
    page,
  }, info) => {
    const host = await openDisclosure(page, 'full');
    const { exercise, scroll, trigger, details } = await prepareFollowedDisclosure(host);
    const before = await expectFollowedAndSettled(exercise);
    await captureDisclosure(page, scroll, 'full-follow-before', info);
    const finishGrowth = await observeScrollFrames(scroll);
    let growth;
    try {
      await trigger.press('Enter');
      await finishGrowth.waitForActive();
      await expect(
        details.getByRole('button', { name: 'Activate row detail', exact: true }),
      ).toBeVisible();
      await expectFollowedAndSettled(exercise);
    } finally {
      growth = await finishGrowth('full-follow-growth', info);
    }
    expectLeaseLifetime(growth);
    const expanded = await readScrollSnapshot(exercise);
    expect(expanded.scrollHeight).toBeGreaterThan(before.scrollHeight);
    const finalHeight = await details.evaluate((node) => node.getBoundingClientRect().height);
    expect(
      growth.some((sample) => sample.detailsHeight > 0 && sample.detailsHeight < finalHeight),
      'Full motion must actually traverse an intermediate layout before settling',
    ).toBe(true);
    await captureDisclosure(page, scroll, 'full-follow-expanded', info);
    const finishCollapse = await observeScrollFrames(scroll);
    let collapse;
    try {
      await trigger.press('Space');
      await finishCollapse.waitForActive();
      await expect(details).toHaveCount(0);
      await expectFollowedAndSettled(exercise);
    } finally {
      collapse = await finishCollapse('full-follow-collapse', info);
    }
    expectLeaseLifetime(collapse);
    expect(
      collapse.some((sample) => sample.detailsHeight > 0 && sample.detailsHeight < finalHeight),
    ).toBe(true);
    await captureDisclosure(page, scroll, 'full-follow-collapsed', info);
  });

  test('chat disclosure D14: full disclosure reversal and unmount dispose old scroll ownership before reacquiring', async ({
    page,
  }, info) => {
    const host = await openDisclosure(page, 'full');
    const { exercise, scroll, trigger, details } = await prepareFollowedDisclosure(host);
    await expectFollowedAndSettled(exercise);
    await trigger.press('Enter');
    await expectFollowedAndSettled(exercise);
    await captureDisclosure(page, scroll, 'reversal-before', info);
    const retained = await details.elementHandle();
    const finish = await observeScrollFrames(scroll);
    let samples;
    try {
      // Consecutive native keys reverse the same in-flight disclosure; no clock
      // manipulation, fake click, deliberate sleep, or forced hit target.
      await trigger.press('Enter');
      await finish.waitForShrink();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expectFollowedAndSettled(exercise);
    } finally {
      samples = await finish('reversal', info);
    }
    expectLeaseLifetime(samples);
    expect(
      await retained.evaluate((node) => node.isConnected),
      'Re-entry retains the actual outgoing details node',
    ).toBe(true);
    expect(
      samples.some(
        (sample) => sample.detailsHeight < samples[0].detailsHeight && sample.detailsHeight > 0,
      ),
    ).toBe(true);
    await captureDisclosure(page, scroll, 'reversal-after', info);
    const rowMount = exercise.getByRole('switch', {
      name: 'Mount row within scroll host',
      exact: true,
    });
    const oldRow = await exercise.getByTestId('operational-row').elementHandle();
    const finishRemoval = await observeScrollFrames(scroll);
    let removal;
    try {
      await trigger.press('Enter');
      await finishRemoval.waitForShrink();
      await rowMount.press('Space');
      await expect(exercise.getByTestId('operational-row')).toHaveCount(0);
      expect(await oldRow.evaluate((node) => node.isConnected)).toBe(false);
      // The follower remains alive: its cleanup cannot hide a leaked row lease.
      await expect(scroll).toHaveCount(1);
      await expectFollowedAndSettled(exercise);
    } finally {
      removal = await finishRemoval('row-removal-with-live-follower', info);
    }
    expectLeaseLifetime(removal);
    await rowMount.press('Space');
    await trigger.press('Enter');
    await expectFollowedAndSettled(exercise);
    const oldViewport = await scroll.elementHandle();
    const mount = exercise.getByRole('switch', { name: 'Mount ChatOperationalRow', exact: true });
    const finishOwnerRemoval = await observeScrollFrames(scroll);
    let ownerRemoval;
    try {
      await trigger.press('Enter');
      await finishOwnerRemoval.waitForShrink();
      await mount.press('Space');
      await expect(scroll).toHaveCount(0);
    } finally {
      ownerRemoval = await finishOwnerRemoval('owner-removal', info);
    }
    expectLeaseLifetime(ownerRemoval, false);
    expect(await oldViewport.evaluate((node) => node.isConnected)).toBe(false);
    const readLifetime = exercise.getByRole('button', {
      name: 'Read row scroll lifetime',
      exact: true,
    });
    await readLifetime.press('Enter');
    const state = () => outputJson(exercise.getByTestId('chat-operational-state'));
    expect((await state()).observations.scrollLifetime.current).toEqual({
      connected: false,
      isFollowing: false,
      hasActiveMutation: false,
    });
    await mount.press('Space');
    await trigger.press('Enter');
    await expectFollowedAndSettled(exercise);
    await readLifetime.press('Enter');
    expect((await state()).observations.scrollLifetime).toEqual({
      current: { connected: true, isFollowing: true, hasActiveMutation: false },
      previous: { connected: false, isFollowing: false, hasActiveMutation: false },
    });
    await captureDisclosure(page, scroll, 'reacquired-after', info);
  });

  test('chat disclosure D15: native wheel input detaches following and the real follow control resumes it', async ({
    page,
  }, info) => {
    const host = await openDisclosure(page, 'full');
    const { exercise, scroll, details } = await prepareFollowedDisclosure(host);
    await expectFollowedAndSettled(exercise);
    await captureDisclosure(page, scroll, 'detachment-before', info);
    await scroll.hover();
    await page.mouse.wheel(0, -180);
    const state = () => outputJson(exercise.getByTestId('chat-disclosure-scroll-state'));
    await expect.poll(async () => (await state()).follow).toBe(false);
    const detached = await readScrollSnapshot(exercise);
    expect(detached.isFollowing).toBe(false);
    expect(detached.scrollHeight - detached.clientHeight - detached.scrollTop).toBeGreaterThan(0);
    // Change caller intent with a native control outside the scroll owner, so
    // focusing an offscreen row cannot itself move the viewport under test.
    await exercise.getByRole('switch', { name: 'Expand row', exact: true }).press('Space');
    await expect(details).toHaveCount(1);
    await waitForDisclosedControl(details);
    await expect
      .poll(async () => (await readScrollSnapshot(exercise)).hasActiveMutation)
      .toBe(false);
    const after = await readScrollSnapshot(exercise);
    expect(after.isFollowing).toBe(false);
    expect(Math.abs(after.scrollTop - detached.scrollTop)).toBeLessThanOrEqual(1);
    await exercise
      .getByRole('button', { name: 'Follow row to bottom', exact: true })
      .press('Enter');
    await expectFollowedAndSettled(exercise);
    expect((await state()).followCallbacks).toEqual([false, true]);
    await captureDisclosure(page, scroll, 'detachment-resumed', info);
  });

  test('chat disclosure D16: the existing CSS transition consumer keeps native draft focus and lifetime behavior', async ({
    page,
  }, info) => {
    const host = await openDisclosure(page, 'full');
    const exercise = host.getByTestId('chat-disclosure-css');
    const display = exercise.getByTestId('chat-disclosure-css-leaf');
    const trigger = display.getByRole('button', { name: 'Local CSS motion panel', exact: true });
    const input = display.getByRole('textbox', { name: 'CSS panel draft', exact: true });
    await expect(input).toBeVisible();
    await (await display.elementHandle()).waitForElementState('stable');
    await captureDisclosure(page, display, 'css-consumer-before', info);
    await input.fill('A native draft retained by the caller');
    await trigger.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('A native draft retained by the caller');
    await (await display.elementHandle()).waitForElementState('stable');
    await trigger.press('Tab');
    await expect(input).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(' after reopening');
    await expect(input).toHaveValue('A native draft retained by the caller after reopening');
    const old = await input.elementHandle();
    await exercise.getByRole('button', { name: 'Remount CollapsiblePanel', exact: true }).click();
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await expect(input).toHaveValue('A native draft retained by the caller after reopening');
    await (await display.elementHandle()).waitForElementState('stable');
    await captureDisclosure(page, display, 'css-consumer-after', info);
    await exercise.getByRole('switch', { name: 'Mount CollapsiblePanel', exact: true }).click();
    await expect(display).toHaveCount(0);
    await exercise.getByRole('switch', { name: 'Mount CollapsiblePanel', exact: true }).click();
    await expect(input).toHaveValue('A native draft retained by the caller after reopening');
    await trigger.press('Enter');
    await expect(input).toHaveCount(0);
  });
});

test('chat disclosure D2: header admission and slot changes preserve the static and interactive branches', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-operational');
  const display = exercise.getByTestId('chat-operational-native-frame');
  const trigger = display.getByTestId('operational-trigger');
  await captureDisclosure(page, display, 'header-before', info);
  await exercise.getByRole('switch', { name: 'Expand row', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await exercise
    .getByRole('textbox', { name: 'Row summary', exact: true })
    .fill('Changed operation summary');
  await expect(display.getByTestId('operational-summary')).toHaveText('Changed operation summary');
  await exercise
    .getByRole('textbox', { name: 'Row trailing text', exact: true })
    .fill('Changed trailing information');
  await expect(display.locator('[data-operational-trailing]')).toContainText(
    'Changed trailing information',
  );
  await exercise.getByRole('switch', { name: 'Show row trailing', exact: true }).click();
  await expect(display.getByText('Changed trailing information', { exact: true })).toHaveCount(0);
  await exercise.getByRole('switch', { name: 'Show row chevron', exact: true }).click();
  await expect(display.locator('[data-operational-trailing]')).toHaveCount(0);
  const oldTrigger = await trigger.elementHandle();
  await exercise.getByRole('switch', { name: 'Admit row header', exact: true }).click();
  await expect(trigger).toHaveCount(0);
  expect(await oldTrigger.evaluate((node) => node.isConnected)).toBe(false);
  await expect(display.locator('[data-operational-header-spacer]')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(
    display.getByRole('button', { name: 'Activate row detail', exact: true }),
  ).toBeVisible();
  await expect(display.locator('[data-operational-preview-content]')).toContainText(
    'Caller preview slot',
  );
  await exercise.getByRole('switch', { name: 'Show row preview', exact: true }).click();
  await expect(display.locator('[data-operational-preview-content]')).toHaveCount(0);
  await exercise.getByRole('switch', { name: 'Admit row header', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await exercise.getByRole('switch', { name: 'Interactive row', exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await expect(display.getByTestId('operational-summary')).toHaveText('Changed operation summary');
  await expect(display.getByTestId('operational-summary')).toHaveAttribute(
    'aria-label',
    'Toggle caller operation',
  );
  await exercise.getByRole('switch', { name: 'Animate row details height', exact: true }).click();
  await expect(display.locator('[id="caller-row-details"]')).toBeVisible();
  await exercise.getByRole('switch', { name: 'Show row details', exact: true }).click();
  await expect(display.locator('[id="caller-row-details"]')).toHaveCount(0);
  await exercise.getByRole('switch', { name: 'Show row preview', exact: true }).click();
  await expect(display.locator('[data-operational-preview-content]')).toContainText(
    'Caller preview slot',
  );
  await captureDisclosure(page, display, 'header-after', info);
});

test('chat disclosure D4: canonical search delivers the latest callbacks and refs clear on unmount', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-operational');
  const display = exercise.getByTestId('chat-operational-native-frame');
  const row = display.getByTestId('operational-row');
  const trigger = display.getByTestId('operational-trigger');
  const state = () => outputJson(exercise.getByTestId('chat-operational-state'));
  const expand = exercise.getByRole('button', { name: 'Search expand row', exact: true });
  const restore = exercise.getByRole('button', { name: 'Search restore row', exact: true });
  const readRefs = exercise.getByRole('button', { name: 'Read row refs', exact: true });
  await captureDisclosure(page, display, 'search-before', info);
  await expand.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toHaveAttribute('data-chat-search-expanded', 'true');
  await exercise
    .getByRole('radiogroup', { name: 'Row callback identity', exact: true })
    .getByRole('radio', { name: 'replacement', exact: true })
    .click();
  await restore.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(row).toHaveAttribute('data-chat-search-expanded', 'false');
  await expand.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(
    (await state()).observations.callbacks.map(({ kind, identity }) => ({ kind, identity })),
  ).toEqual([
    { kind: 'search-expand', identity: 'primary' },
    { kind: 'search-restore', identity: 'replacement' },
    { kind: 'search-expand', identity: 'replacement' },
  ]);
  await readRefs.click();
  const before = (await state()).observations.refs;
  expect(before.trigger.connected).toBe(true);
  expect(before.details.connected).toBe(true);
  const oldTrigger = await trigger.elementHandle();
  const oldDetails = await display.locator('[id="caller-row-details"]').elementHandle();
  const mount = exercise.getByRole('switch', { name: 'Mount ChatOperationalRow', exact: true });
  await mount.click();
  await expect(display).toHaveCount(0);
  expect(await oldTrigger.evaluate((node) => node.isConnected)).toBe(false);
  expect(await oldDetails.evaluate((node) => node.isConnected)).toBe(false);
  await readRefs.click();
  const gone = (await state()).observations.refs;
  expect(gone.trigger).toBeNull();
  expect(gone.details).toBeNull();
  expect(gone.lastTrigger.connected).toBe(false);
  expect(gone.lastDetails.connected).toBe(false);
  await expand.click();
  await restore.click();
  expect((await state()).observations.callbacks).toHaveLength(3);
  await mount.click();
  await restore.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect((await state()).observations.callbacks.at(-1)).toMatchObject({
    kind: 'search-restore',
    identity: 'replacement',
    sequence: 4,
  });
  await readRefs.click();
  const remounted = (await state()).observations.refs;
  expect(remounted.trigger.identity).not.toBe(before.trigger.identity);
  expect(remounted.details.identity).not.toBe(before.details.identity);
  await captureDisclosure(page, display, 'search-after', info);
});

test('chat disclosure D6: typing replaces callbacks and respects message compact and elapsed branches', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-typing');
  const display = exercise.getByTestId('chat-typing-leaf');
  const row = display.locator('[data-streaming-typing-row]');
  const state = () => outputJson(exercise.getByTestId('chat-typing-state'));
  await captureDisclosure(page, display, 'typing-copy-before', info);
  await exercise
    .getByRole('textbox', { name: 'Typing message', exact: true })
    .fill('Preparing the current response');
  await exercise
    .getByRole('textbox', { name: 'Typing phase', exact: true })
    .fill('Reading the latest result');
  await exercise
    .getByRole('textbox', { name: 'Typing elapsed', exact: true })
    .fill('Caller duration');
  await expect(display.getByTestId('streaming-status-thinking-label')).toHaveText(
    'Preparing the current response',
  );
  await expect(display.getByTestId('streaming-status-phase')).toHaveText(
    'Reading the latest result',
  );
  await expect(display.getByTestId('streaming-status-elapsed')).toHaveAttribute('aria-live', 'off');
  await exercise.getByRole('switch', { name: 'Show typing message', exact: true }).click();
  expect(await row.ariaSnapshot()).toContain('Preparing the current response');
  await exercise
    .getByRole('radiogroup', { name: 'Typing callback identity', exact: true })
    .getByRole('radio', { name: 'replacement', exact: true })
    .click();
  await row.hover();
  await row.hover();
  await expect
    .poll(async () => (await state()).observations.hoverCallbacks)
    .toEqual([{ sequence: 1, identity: 'replacement', hovered: true }]);
  await exercise.getByRole('textbox', { name: 'Typing phase', exact: true }).hover();
  await expect
    .poll(async () => (await state()).observations.hoverCallbacks)
    .toEqual([
      { sequence: 1, identity: 'replacement', hovered: true },
      { sequence: 2, identity: 'replacement', hovered: false },
    ]);
  await exercise.getByRole('switch', { name: 'Compact typing indicator', exact: true }).click();
  await expect(display.getByTestId('streaming-status-thinking')).toHaveCount(0);
  await expect(display.getByTestId('streaming-status-elapsed')).toHaveText('Caller duration');
  await exercise.getByRole('switch', { name: 'Compact typing indicator', exact: true }).click();
  await exercise.getByRole('textbox', { name: 'Typing message', exact: true }).fill('');
  await expect(display.getByTestId('streaming-status-thinking')).toHaveCount(0);
  await exercise
    .getByRole('textbox', { name: 'Typing message', exact: true })
    .fill('A restored accessible message');
  await exercise.getByRole('textbox', { name: 'Typing elapsed', exact: true }).fill('');
  await expect(display.getByTestId('streaming-status-elapsed')).toHaveCount(0);
  await expect(display.getByTestId('streaming-status-thinking-label')).toHaveText(
    'A restored accessible message',
  );
  await captureDisclosure(page, display, 'typing-copy-after', info);
});

test('chat disclosure D10: diagnostics remain keyboard scrollable with current text and reset on remount', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-failure');
  const display = exercise.getByTestId('chat-failure-leaf');
  const region = display.getByRole('region', { name: 'Details', exact: true });
  const trigger = display.getByRole('button', { name: 'Details', exact: true });
  const longText = Array.from(
    { length: 60 },
    (_, index) =>
      `Diagnostic record ${index + 1}: the actual scroll region must keep this caller detail reachable.`,
  ).join('\n');
  await captureDisclosure(page, display, 'failure-collapsed-before', info);
  await exercise.getByRole('textbox', { name: 'Failure text', exact: true }).fill(longText);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(region).toHaveAttribute('id', await trigger.getAttribute('aria-controls'));
  await expect(region).toHaveText(longText);
  await trigger.press('Tab');
  await expect(display.getByRole('button', { name: 'Copy details', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused();
  await page.keyboard.press('End');
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      region.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop)),
    )
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('Home');
  await expect.poll(() => region.evaluate((node) => node.scrollTop)).toBe(0);
  const updated = 'Only the current diagnostic should remain after replacement.';
  await exercise.getByRole('textbox', { name: 'Failure text', exact: true }).fill(updated);
  await expect(region).toHaveText(updated);
  await exercise.getByRole('switch', { name: 'Use default failure label', exact: true }).click();
  const renamed = display.getByRole('button', { name: 'Inspect caller diagnostics', exact: true });
  await expect(renamed).toHaveAttribute('aria-expanded', 'true');
  await captureDisclosure(page, display, 'failure-current-after', info);
  const oldRegion = await region.elementHandle();
  await exercise.getByRole('button', { name: 'Remount FailureDetails', exact: true }).click();
  expect(await oldRegion.evaluate((node) => node.isConnected)).toBe(false);
  await expect(region).toHaveCount(0);
  await expect(renamed).toHaveAttribute('aria-expanded', 'false');
  await renamed.press('Space');
  await expect(region).toHaveText(updated);
  await expect(region).toHaveAttribute('id', await renamed.getAttribute('aria-controls'));
});

test('chat disclosure D11: replacing and remounting an action goal does not create horizontal overflow', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-agent-action');
  const display = exercise.getByTestId('chat-agent-action-leaf');
  await captureDisclosure(page, display, 'action-before', info);
  const longGoal =
    'Continue reviewing the original conversation and preserve the complete action goal while the narrow action block remains contained.';
  await exercise.getByRole('textbox', { name: 'Agent action goal', exact: true }).fill(longGoal);
  await expect(display).toHaveText(longGoal);
  const bounds = await display.evaluate((node) => ({
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
    width: innerWidth,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  const previous = await display.elementHandle();
  await exercise.getByRole('button', { name: 'Remount ChatAgentActionBlock', exact: true }).click();
  expect(await previous.evaluate((node) => node.isConnected)).toBe(false);
  await expect(display).toHaveText(longGoal);
  await captureDisclosure(page, display, 'action-after', info);
});
