import {
  test,
  expect,
  openDisclosure,
  captureDisclosure,
  expectReadable,
  outputJson,
  prepareFollowedDisclosure,
  expectFollowedAndSettled,
} from '../lib/chat-disclosure.mjs';

test('chat disclosure D12: reduced disclosure follows the real scroll owner and releases on removal', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const { exercise, scroll, trigger, details } = await prepareFollowedDisclosure(host);
  const before = await expectFollowedAndSettled(exercise);
  await captureDisclosure(page, scroll, 'reduced-follow-before', info);
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(
    details.getByRole('button', { name: 'Activate row detail', exact: true }),
  ).toBeVisible();
  const expanded = await expectFollowedAndSettled(exercise);
  expect(expanded.scrollHeight).toBeGreaterThan(before.scrollHeight);
  const node = await details.elementHandle();
  await trigger.press('Space');
  await expect(details).toHaveCount(0);
  expect(await node.evaluate((element) => element.isConnected)).toBe(false);
  await expectFollowedAndSettled(exercise);
  await captureDisclosure(page, scroll, 'reduced-follow-after', info);
});

// The original003 ChatNotice, attention wrappers, FailureDetails and action
// block define these contracts. Caller inputs exercise the real leaf; no
// production formatter, expected CSS value, fake event, or copied Store is used.
test('chat disclosure D1: controlled expansion forwards native pointer and keyboard activation once', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-operational');
  const display = exercise.getByTestId('chat-operational-native-frame');
  const trigger = display.getByRole('button', { name: 'Toggle caller operation', exact: true });
  const state = () => outputJson(exercise.getByTestId('chat-operational-state'));
  await captureDisclosure(page, display, 'row-closed-before', info);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const events = (await state()).observations.callbacks;
  expect(events.filter((event) => event.kind === 'click')).toHaveLength(3);
  expect(events.filter((event) => event.kind === 'keydown').map((event) => event.key)).toEqual([
    'Enter',
    ' ',
  ]);
  expect(events.every((event) => event.isTrusted && event.identity === 'primary')).toBe(true);
  await exercise
    .getByRole('switch', { name: 'Prevent row keyboard activation', exact: true })
    .click();
  await trigger.press('Enter');
  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const prevented = (await state()).observations.callbacks;
  expect(prevented.filter((event) => event.kind === 'click')).toHaveLength(3);
  expect(
    prevented.slice(-2).map((event) => ({
      key: event.key,
      prevented: event.defaultPrevented,
      trusted: event.isTrusted,
    })),
  ).toEqual([
    { key: 'Enter', prevented: true, trusted: true },
    { key: ' ', prevented: true, trusted: true },
  ]);
  await captureDisclosure(page, display, 'row-open-after', info);
});

test('chat disclosure D3: animated details control accessibility and preserve the wrapper ref when closed', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-operational');
  const display = exercise.getByTestId('chat-operational-native-frame');
  const trigger = display.getByTestId('operational-trigger');
  const state = () => outputJson(exercise.getByTestId('chat-operational-state'));
  const readRefs = exercise.getByRole('button', { name: 'Read row refs', exact: true });
  await readRefs.click();
  const initial = (await state()).observations.refs;
  expect(initial.details.connected).toBe(true);
  expect(initial.details.id).toBe('');
  const closed = display.locator('[data-response-group-motion="animated-height"]');
  await expect(closed).toHaveAttribute('inert', '');
  await expect(closed).toHaveAttribute('aria-hidden', 'true');
  await expect(
    display.getByRole('button', { name: 'Activate row detail', exact: true }),
  ).toHaveCount(0);
  await captureDisclosure(page, display, 'inert-before', info);
  await trigger.press('Enter');
  const detail = display.getByRole('button', { name: 'Activate row detail', exact: true });
  const wrapper = display.locator('[id="caller-row-details"]');
  await expect(trigger).toHaveAttribute('aria-controls', 'caller-row-details');
  await expect(wrapper).not.toHaveAttribute('inert');
  await expect(wrapper).toHaveAttribute('aria-hidden', 'false');
  await trigger.press('Tab');
  await expect(detail).toBeFocused();
  await page.keyboard.press('Enter');
  expect(
    (await state()).observations.callbacks.filter((entry) => entry.kind === 'detail-action'),
  ).toHaveLength(1);
  await exercise.getByRole('switch', { name: 'Make row details inert', exact: true }).click();
  await expect(wrapper).toHaveAttribute('inert', '');
  await trigger.press('Tab');
  expect(await wrapper.evaluate((node) => node.contains(document.activeElement))).toBe(false);
  await exercise
    .getByRole('switch', { name: 'Hide row details from accessibility', exact: true })
    .click();
  await expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  await expect(
    display.getByRole('button', { name: 'Activate row detail', exact: true }),
  ).toHaveCount(0);
  await trigger.press('Enter');
  await readRefs.click();
  const final = (await state()).observations.refs;
  expect(final.details.identity).toBe(initial.details.identity);
  expect(final.details.connected).toBe(true);
  expect(final.details.id).toBe('');
  await captureDisclosure(page, display, 'inert-after', info);
});

test('chat disclosure D5: typing hover resets once when hidden or unmounted under a stationary pointer', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-typing');
  const display = exercise.getByTestId('chat-typing-leaf');
  const row = display.locator('[data-streaming-typing-row]');
  const state = () => outputJson(exercise.getByTestId('chat-typing-state'));
  const visible = exercise.getByRole('switch', { name: 'Show typing indicator', exact: true });
  await captureDisclosure(page, display, 'typing-before', info);
  await visible.click();
  await expect(row).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(row).toBeVisible();
  await row.hover();
  await row.hover();
  await expect
    .poll(async () => (await state()).observations.hoverCallbacks)
    .toEqual([{ sequence: 1, identity: 'primary', hovered: true }]);
  await page.keyboard.press('Space');
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => (await state()).observations.hoverCallbacks)
    .toEqual([
      { sequence: 1, identity: 'primary', hovered: true },
      { sequence: 2, identity: 'primary', hovered: false },
    ]);
  await visible.click();
  await expect(row).toBeVisible();
  // Clicking the mount switch first leaves it focused; restoring with Space
  // then hovering allows a second Space to unmount without moving the pointer.
  const mount = exercise.getByRole('switch', {
    name: 'Mount StreamingTypingIndicator',
    exact: true,
  });
  await mount.click();
  await expect(display).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(row).toBeVisible();
  const old = await row.elementHandle();
  await row.hover();
  await page.keyboard.press('Space');
  await expect(display).toHaveCount(0);
  expect(await old.evaluate((node) => node.isConnected)).toBe(false);
  await expect
    .poll(async () => (await state()).observations.hoverCallbacks)
    .toEqual([
      { sequence: 1, identity: 'primary', hovered: true },
      { sequence: 2, identity: 'primary', hovered: false },
      { sequence: 3, identity: 'primary', hovered: true },
      { sequence: 4, identity: 'primary', hovered: false },
    ]);
  await mount.click();
  await captureDisclosure(page, display, 'typing-after', info);
});

test('chat disclosure D9: failure disclosure copies the current text through the actual clipboard', async ({
  page,
  context,
}, info) => {
  const host = await openDisclosure(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const exercise = host.getByTestId('chat-failure');
  const display = exercise.getByTestId('chat-failure-leaf');
  const trigger = display.getByRole('button', { name: 'Details', exact: true });
  const paste = exercise.getByRole('textbox', { name: 'Paste copied failure text', exact: true });
  const text = 'Current native diagnostic α\nSecond diagnostic line with a recovery reason.';
  await exercise.getByRole('textbox', { name: 'Failure text', exact: true }).fill(text);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await captureDisclosure(page, display, 'clipboard-before', info);
  await trigger.press('Enter');
  const region = display.getByRole('region', { name: 'Details', exact: true });
  await expect(region).toHaveAttribute('id', await trigger.getAttribute('aria-controls'));
  await expect(region).toHaveText(text);
  await display.getByRole('button', { name: 'Copy details', exact: true }).click();
  await paste.click();
  await page.keyboard.press('Control+V');
  await expect(paste).toHaveValue(text);
  const replacement = 'Replacement diagnostic β\nOnly this text belongs in the next copy.';
  await exercise.getByRole('textbox', { name: 'Failure text', exact: true }).fill(replacement);
  await expect(region).toHaveText(replacement);
  // Feedback changes the name after success. It remains the other actual
  // button in FailureDetails; invoke it with the keyboard before its timer ends.
  await trigger.press('Tab');
  await page.keyboard.press('Enter');
  await paste.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
  await expect(paste).toHaveValue(replacement);
  await trigger.press('Space');
  await expect(region).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await captureDisclosure(page, display, 'clipboard-after', info);
});

test('chat disclosure D7: announcement and timestamp changes preserve the notice content', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const exercise = host.getByTestId('chat-notice');
  const display = exercise.getByTestId('chat-notice-leaf');
  const banner = display.getByTestId('exercise-notice-banner');
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toHaveAttribute('aria-live', 'polite');
  await captureDisclosure(page, display, 'notice-before', info);
  await exercise
    .getByRole('textbox', { name: 'Notice title', exact: true })
    .fill('A new caller decision');
  await expect(banner.getByTestId('exercise-notice-label')).toHaveText('A new caller decision');
  await exercise.getByRole('switch', { name: 'Announce notice', exact: true }).click();
  await expect(banner).not.toHaveAttribute('role');
  await expect(banner).not.toHaveAttribute('aria-live');
  await exercise.getByRole('switch', { name: 'Include notice timestamp', exact: true }).click();
  const timestamp = banner.locator('[data-slot="tooltip-trigger"]');
  await timestamp.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('2026');
  const firstTimestamp = await tooltip.textContent();
  await exercise
    .getByRole('textbox', { name: 'Notice timestamp', exact: true })
    .fill('2020-02-03T04:05:00Z');
  await timestamp.hover();
  await expect(tooltip).toContainText('2020');
  expect(await tooltip.textContent()).not.toBe(firstTimestamp);
  await exercise.getByRole('switch', { name: 'Include notice timestamp', exact: true }).click();
  await expect(timestamp).toHaveCount(0);
  await expect(tooltip).toHaveCount(0);
  await exercise.getByRole('textbox', { name: 'Notice reason', exact: true }).fill('');
  await expect(banner.getByTestId('exercise-notice-reason')).toHaveCount(0);
  await exercise.getByRole('switch', { name: 'Announce notice', exact: true }).click();
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toHaveAttribute('aria-live', 'polite');
  await expect(banner.getByTestId('exercise-notice-label')).toHaveText('A new caller decision');
  await captureDisclosure(page, display, 'notice-after', info);
});

test('chat disclosure D8: attention wrappers preserve changed multiline content across lifetime changes', async ({
  page,
}, info) => {
  const host = await openDisclosure(page);
  const interruption = host.getByTestId('chat-interruption');
  const interruptionDisplay = interruption.getByTestId('chat-interruption-leaf');
  const longMessage =
    'The interrupted work keeps the complete caller explanation visible at a narrow width.\nThe user can read this second line before choosing what to do next.';
  await captureDisclosure(page, interruptionDisplay, 'interruption-before', info);
  await interruption
    .getByRole('textbox', { name: 'Interruption message', exact: true })
    .fill(longMessage);
  await interruption
    .getByRole('switch', { name: 'Use default interruption message', exact: true })
    .click();
  await expect(interruptionDisplay.getByRole('alert')).toHaveText(longMessage);
  await expectReadable(interruptionDisplay.getByRole('alert'));
  const oldAlert = await interruptionDisplay.getByRole('alert').elementHandle();
  await interruption
    .getByRole('button', { name: 'Remount InterruptionNotice', exact: true })
    .click();
  expect(await oldAlert.evaluate((node) => node.isConnected)).toBe(false);
  await expect(interruptionDisplay.getByRole('alert')).toHaveText(longMessage);
  await captureDisclosure(page, interruptionDisplay, 'interruption-after', info);

  const blocker = host.getByTestId('chat-blocker');
  const blockerDisplay = blocker.getByTestId('chat-blocker-leaf');
  await captureDisclosure(page, blockerDisplay, 'blocker-before', info);
  await blocker.getByRole('textbox', { name: 'Blocker reason', exact: true }).fill(longMessage);
  await expect(blockerDisplay.getByTestId('chat-notice-reason')).toHaveText(longMessage);
  await expectReadable(blockerDisplay.getByRole('alert'));
  const mount = blocker.getByRole('switch', { name: 'Mount BlockerReportNotice', exact: true });
  await mount.click();
  await expect(blockerDisplay).toHaveCount(0);
  await mount.click();
  await expect(blockerDisplay.getByRole('alert')).toHaveCount(1);
  await expect(blockerDisplay.getByTestId('chat-notice-reason')).toHaveText(longMessage);
  await captureDisclosure(page, blockerDisplay, 'blocker-after', info);
  await blocker.getByRole('textbox', { name: 'Blocker reason', exact: true }).fill('');
  await expect(blockerDisplay.getByTestId('chat-notice-reason')).toHaveCount(0);
  await expect(blockerDisplay.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
});
