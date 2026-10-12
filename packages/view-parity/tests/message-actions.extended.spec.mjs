// DRAFT ONLY. These cases cannot establish source pixels, full motion or internal cleanup.
import {
  test,
  expect,
  openActions,
  inline,
  action,
  control,
  field,
  choice,
  toggle,
  refresh,
  expectOrder,
  activate,
  label,
  capture,
  captureFocusedActionTooltip,
  geometry,
  expectContained,
  originalFormats,
  disconnected,
} from '../lib/message-actions.mjs';

test('message actions MA6: canonical and fallback dates retain original formatting and invalid omission', async ({
  page,
}, info) => {
  const item = await openActions(page);
  const formats = await originalFormats(info);
  const now = await page.evaluate(() => new Date().toISOString());
  const past = '2024-01-15T12:34:56.000Z';
  const fallback = '2023-06-01T08:15:00.000Z';
  const time = item.surface.locator('time');
  await choice(item, 'Message role', 'user');
  await field(item, 'Created at value').fill(fallback);
  await choice(item, 'Created at type', 'string');
  const cases = [
    {
      mode: 'string',
      input: now,
      oracleInput: now,
      iso: now,
      compact: formats.formatTime(now),
      name: 'today-canonical',
    },
    {
      mode: 'Date',
      input: past,
      oracleInput: new Date(past),
      iso: past,
      compact: formats.formatDateTime(past),
      name: 'past-Date',
    },
    {
      mode: 'number',
      input: String(Date.parse(past)),
      oracleInput: Date.parse(past),
      iso: past,
      compact: formats.formatDateTime(past),
      name: 'past-number',
    },
    {
      mode: 'string',
      input: 'invalid-timestamp',
      oracleInput: 'invalid-timestamp',
      iso: fallback,
      compact: formats.formatDateTime(fallback),
      name: 'invalid-fallback',
    },
    {
      mode: 'string',
      input: '',
      oracleInput: '',
      iso: fallback,
      compact: formats.formatDateTime(fallback),
      name: 'empty-fallback',
    },
    {
      mode: 'null',
      input: '',
      oracleInput: null,
      iso: fallback,
      compact: formats.formatDateTime(fallback),
      name: 'null-fallback',
    },
    {
      mode: 'omit',
      input: '',
      oracleInput: undefined,
      iso: fallback,
      compact: formats.formatDateTime(fallback),
      name: 'absent-fallback',
    },
  ];
  for (const entry of cases) {
    const originalDate = formats.resolveMessageActionDate(entry.oracleInput, fallback);
    expect(originalDate?.toISOString()).toBe(entry.iso);
    // Set string data before selecting a numeric/Date input representation.
    await choice(item, 'Timestamp type', 'omit');
    await field(item, 'Timestamp value').fill(entry.input);
    await choice(item, 'Timestamp type', entry.mode);
    await expect(time).toHaveAttribute('datetime', entry.iso);
    await expect(time).toHaveText(entry.compact);
    await expect(time).toHaveAttribute('title', formats.formatFullDateTime(entry.iso));
    await expect(time).toHaveAttribute('aria-label', formats.formatFullDateTime(entry.iso));
    await capture(item, `date-${entry.name}`, info);
  }
  await choice(item, 'Timestamp type', 'string');
  await field(item, 'Timestamp value').fill('invalid-canonical');
  await field(item, 'Created at value').fill('invalid-fallback');
  expect(formats.resolveMessageActionDate('invalid-canonical', 'invalid-fallback')).toBeNull();
  await expect(time).toHaveCount(0);
  await choice(item, 'Created at type', 'omit');
  await expect(time).toHaveCount(0);
  await capture(item, 'date-invalid-omitted', info);
  await field(item, 'Timestamp value').fill(now);
  await expect(time).toHaveAttribute('datetime', now);
  // Crossing midnight is evidence that this today case changed, never a reason to fake time.
  expect((await page.evaluate(() => new Date().toISOString())).slice(0, 10)).toBe(now.slice(0, 10));
  await expect(time).toHaveText(formats.formatTime(now));
  expect((await refresh(item)).callbacks).toEqual([]);
});

test('message actions MA7: narrow dated assistant menu preserves selection and wide hit targets', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await choice(item, 'Frame width', '280');
  await choice(item, 'Current vote', 'up');
  await choice(item, 'Previous message loading', 'true');
  await item.frame.scrollIntoViewIfNeeded();
  let probe = await geometry(item, 'narrow-before', info);
  expect(probe.parent.width).toBeLessThan(320);
  await expectOrder(item, ['regenerate']);
  const trigger = item.surface.getByRole('button', {
    name: label('lib_commandPalette_quickActions_ariaLabel'),
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await capture(item, 'narrow-before', info);
  await trigger.click();
  const menu = page.getByRole('menu', {
    name: label('lib_commandPalette_quickActions_ariaLabel'),
    exact: true,
  });
  await expect(menu).toBeVisible();
  await expect
    .poll(() =>
      menu
        .locator('[data-action-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-action-id'))),
    )
    .toEqual(['scroll-previous', 'fork', 'vote-up', 'vote-down', 'copy']);
  await expect(menu.locator('[data-action-id="scroll-previous"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(
    menu.getByRole('menuitemcheckbox', {
      name: label('chat_messageActions_goodResponse_label'),
      exact: true,
    }),
  ).toBeChecked();
  await capture(item, 'narrow-menu', info, menu);
  await menu
    .getByRole('menuitemcheckbox', {
      name: label('chat_messageActions_badResponse_label'),
      exact: true,
    })
    .click();
  // Checked entries remain open and controlled; native click reports only the requested vote.
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole('menuitemcheckbox', {
      name: label('chat_messageActions_goodResponse_label'),
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    menu.getByRole('menuitemcheckbox', {
      name: label('chat_messageActions_badResponse_label'),
      exact: true,
    }),
  ).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  let observations = await refresh(item);
  expect(observations.callbacks).toHaveLength(1);
  expect(observations.callbacks[0]).toMatchObject({
    callback: 'onVote',
    args: ['down'],
    argumentCount: 1,
  });
  await trigger.click();
  await page.keyboard.press('Home');
  await expect(menu.locator('[data-action-id="fork"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  observations = await refresh(item);
  expect(observations.callbacks).toHaveLength(2);
  expect(observations.callbacks.at(-1)).toMatchObject({
    callback: 'onFork',
    args: [],
    argumentCount: 0,
  });
  // Both original and port select menu entries with a CustomEvent lacking shiftKey.
  // A real Shift-click in overflow therefore keeps the ordinary copy callback path.
  await trigger.click();
  await menu.locator('[data-action-id="copy"]').click({ modifiers: ['Shift'] });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  observations = await refresh(item);
  expect(observations.callbacks).toHaveLength(3);
  expect(observations.callbacks.at(-1)).toMatchObject({
    callback: 'onCopy',
    args: [],
    argumentCount: 0,
    capturedEvent: { isTrusted: true, shiftKey: true },
  });
  await page.setViewportSize({ width: 420, height: 900 });
  await choice(item, 'Frame width', '420');
  await choice(item, 'Previous message loading', 'false');
  await item.frame.scrollIntoViewIfNeeded();
  probe = await geometry(item, 'wide-before', info);
  expect(probe.parent.width).toBeGreaterThanOrEqual(320);
  await expect(trigger).toHaveCount(0);
  await expectOrder(item, [
    'regenerate',
    'scroll-previous',
    'fork',
    'vote-up',
    'vote-down',
    'copy',
  ]);
  await expectContained(item, 'wide-controls', info);
  await activate(item, action(item, 'fork'), 'onFork');
  await capture(item, 'wide-after', info);
});

test('message actions MA8: ordinary hover and keyboard focus reveal reachable actions', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item);
  await choice(item, 'Show on hover', 'omit');
  await item.frame.scrollIntoViewIfNeeded();
  // Choice focus is outside the message group; moving outside does not synthesize blur/focus.
  await page.mouse.move(1, 1);
  let probe = await geometry(item, 'hidden-initial', info);
  expect(probe.actions.every((entry) => !entry.hit)).toBe(true);
  await capture(item, 'hidden-before', info);
  await item.parent.hover();
  await expect
    .poll(
      async () =>
        await action(item, 'copy').evaluate((node) => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return node === hit || node.contains(hit);
        }),
    )
    .toBe(true);
  await capture(item, 'hover-revealed', info);
  await control(item, 'Focus message').click();
  await page.mouse.move(1, 1);
  await page.keyboard.press('Tab');
  await expect(action(item, 'regenerate')).toBeFocused();
  await expectContained(item, 'focus-revealed', info);
  await capture(item, 'focus-revealed', info);
  await captureFocusedActionTooltip(item, 'regenerate', 'focus-regenerate-tooltip', info);
  await page.keyboard.press('Enter');
  expect((await refresh(item)).callbacks.at(-1)).toMatchObject({
    callback: 'onRegenerate',
    args: [],
    argumentCount: 0,
  });
  await item.frame.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  probe = await geometry(item, 'hidden-after-blur', info);
  expect(probe.actions.every((entry) => !entry.hit)).toBe(true);
  await capture(item, 'hidden-after', info);
  await choice(item, 'Show on hover', 'false');
  await item.frame.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await expectContained(item, 'always-shown', info);
});

test('message actions MA9: actual controls roots and native viewport activation render usable controls', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item, 'user');
  await choice(item, 'Controls root', 'none');
  await expect(item.viewport).not.toHaveAttribute('data-message-controls-root');
  await expectOrder(item, ['edit', 'copy', 'scroll-previous']);
  await activate(item, action(item, 'copy'), 'onCopy');
  await capture(item, 'unrooted', info);
  await choice(item, 'Controls root', 'root');
  await toggle(item, 'Place actions below viewport', true);
  await control(item, 'Remount actions').click();
  await expect(item.viewport).toHaveAttribute('data-message-controls-root', '');
  await item.frame.scrollIntoViewIfNeeded();
  const offscreen = await geometry(item, 'rooted-offscreen', info);
  expect(offscreen.scrollHeight).toBeGreaterThan(offscreen.clientHeight);
  expect(offscreen.parent.top).toBeGreaterThanOrEqual(offscreen.viewport.bottom);
  // Original queue drains on frames, including offscreen entries. No latency/order claim.
  await expect(action(item, 'copy')).toHaveCount(1);
  await capture(item, 'rooted-offscreen', info);
  await item.viewport.hover();
  await page.mouse.wheel(0, 320);
  await expect.poll(() => item.viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() =>
      item.parent.evaluate((node) => {
        const root = node.closest('[data-message-controls-root]').getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return box.top >= root.top && box.bottom <= root.bottom;
      }),
    )
    .toBe(true);
  await control(item, 'Focus message').click();
  await page.keyboard.press('Tab');
  await expect(action(item, 'edit')).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await refresh(item)).callbacks.at(-1)).toMatchObject({
    callback: 'onEdit',
    args: [],
    argumentCount: 0,
  });
  await choice(item, 'Queue info', 'value');
  await expect(item.surface.getByTestId('queued-message-notice')).toHaveCount(1);
  await capture(item, 'rooted-user-notice', info);
  await choice(item, 'Message role', 'assistant');
  await expect(item.surface.getByTestId('queued-message-notice')).toHaveCount(0);
  await choice(item, 'Message role', 'user');
  await field(item, 'Waited milliseconds').fill('0');
  await expect(item.surface.getByTestId('queued-message-notice')).toHaveCount(0);
  await capture(item, 'rooted-zero-wait', info);
});

test('message actions MA10: real detach remount and changed callbacks stay single activation', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item, 'user');
  for (const root of ['root', 'none']) {
    await choice(item, 'Controls root', root);
    await expect(action(item, 'copy')).toHaveCount(1);
    const old = await item.surface.elementHandle();
    await activate(item, action(item, 'copy'), 'onCopy');
    await capture(item, `${root}-before-detach`, info);
    await control(item, 'Unmount actions').click();
    await expect(item.surface).toHaveCount(0);
    await disconnected(old);
    const count = (await refresh(item)).callbacks.length;
    await control(item, 'Focus message').click();
    await page.keyboard.press('Enter');
    expect((await refresh(item)).callbacks).toHaveLength(count);
    await control(item, 'Replace callbacks').click();
    await control(item, 'Remount actions').click();
    await expect(item.surface).toHaveCount(1);
    expect(await item.surface.evaluate((node, previous) => node === previous, old)).toBe(false);
    await activate(item, action(item, 'copy'), 'onCopy', [], 'Space');
    await capture(item, `${root}-remounted`, info);
    await old.dispose();
  }
  await control(item, 'Unmount actions').click();
  await expect(item.surface).toHaveCount(0);
  await capture(item, 'finally-detached', info);
  // No observer/timer instrumentation: exact internal cleanup and midnight behavior stay gaps.
});
