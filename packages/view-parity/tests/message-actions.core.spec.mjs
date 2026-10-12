// DRAFT ONLY; one native case per later coordinator-released invocation.
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
  clear,
  expectOrder,
  activate,
  tabTo,
  label,
  capture,
  geometry,
} from '../lib/message-actions.mjs';

test('message actions MA1: user admission order optional callbacks and zero argument activation', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item, 'user');
  await expectOrder(item, ['edit', 'copy', 'scroll-previous']);
  await capture(item, 'user-before', info);
  for (const [id, callback, via] of [
    ['edit', 'onEdit', 'click'],
    ['copy', 'onCopy', 'Enter'],
    ['scroll-previous', 'onScrollToPrevious', 'Space'],
  ])
    await activate(item, action(item, id), callback, [], via);
  // Removing a supplied callback changes the actual reachable action set.
  for (const [name, order] of [
    ['onEdit', ['copy', 'scroll-previous']],
    ['onCopy', ['scroll-previous']],
    ['onScrollToPrevious', []],
  ]) {
    await toggle(item, `Supply ${name}`, false);
    await expectOrder(item, order);
  }
  expect((await refresh(item)).callbacks.map((record) => record.callback)).toEqual([
    'onEdit',
    'onCopy',
    'onScrollToPrevious',
  ]);
  await capture(item, 'user-omitted', info);
  await toggle(item, 'Supply onCopy', true);
  await expectOrder(item, ['copy']);
  await activate(item, action(item, 'copy'), 'onCopy');
});

test('message actions MA2: assistant admission order and current callback replacement', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item);
  await expectOrder(item, [
    'regenerate',
    'scroll-previous',
    'fork',
    'vote-up',
    'vote-down',
    'copy',
  ]);
  await capture(item, 'assistant-before', info);
  const surface = await item.surface.elementHandle();
  for (const [id, name, via] of [
    ['regenerate', 'onRegenerate', 'click'],
    ['scroll-previous', 'onScrollToPrevious', 'Enter'],
    ['fork', 'onFork', 'Space'],
    ['copy', 'onCopy', 'click'],
  ])
    await activate(item, action(item, id), name, [], via);
  await control(item, 'Replace callbacks').click();
  await expect.poll(async () => (await item.state()).callbackRevision).toBe(1);
  expect(await item.surface.evaluate((node, old) => node === old, surface)).toBe(true);
  for (const [id, name] of [
    ['regenerate', 'onRegenerate'],
    ['scroll-previous', 'onScrollToPrevious'],
    ['fork', 'onFork'],
    ['copy', 'onCopy'],
  ])
    await activate(item, action(item, id), name);
  for (const [name, order] of [
    ['onRegenerate', ['scroll-previous', 'fork', 'vote-up', 'vote-down', 'copy']],
    ['onScrollToPrevious', ['fork', 'vote-up', 'vote-down', 'copy']],
    ['onFork', ['vote-up', 'vote-down', 'copy']],
    ['onVote', ['copy']],
    ['onCopy', []],
  ]) {
    await toggle(item, `Supply ${name}`, false);
    await expectOrder(item, order);
  }
  expect((await refresh(item)).callbacks).toHaveLength(8);
  await capture(item, 'assistant-omitted', info);
  await surface.dispose();
});

test('message actions MA3: loading previous action is disabled skipped and recovers', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item);
  await choice(item, 'Previous message loading', 'true');
  const previous = action(item, 'scroll-previous');
  await expect(previous).toBeDisabled();
  await expect(previous).toHaveAccessibleName(
    label('chat_messageActions_previousMessageLoading_label'),
  );
  await item.frame.scrollIntoViewIfNeeded();
  const box = await previous.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect((await refresh(item)).callbacks).toEqual([]);
  await tabTo(item, action(item, 'regenerate'));
  await page.keyboard.press('Tab');
  await expect(action(item, 'fork')).toBeFocused();
  await capture(item, 'loading-disabled', info);
  await choice(item, 'Previous message loading', 'false');
  await expect(previous).toBeEnabled();
  await expect(previous).toHaveAccessibleName(
    label('chat_messageActions_previousUserMessage_label'),
  );
  await activate(item, previous, 'onScrollToPrevious', [], 'Enter');
  await choice(item, 'Message role', 'user');
  await expect(previous).toHaveAccessibleName(label('chat_messageActions_scrollToPrevious_label'));
  await choice(item, 'Previous message loading', 'true');
  await expect(previous).toBeDisabled();
  await choice(item, 'Previous message loading', 'omit');
  await activate(item, previous, 'onScrollToPrevious', [], 'Space');
  await capture(item, 'loading-recovered', info);
});

test('message actions MA4: votes remain controlled and report exact current vote arguments', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item);
  const up = action(item, 'vote-up');
  const down = action(item, 'vote-down');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await activate(item, up, 'onVote', ['up']);
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await choice(item, 'Current vote', 'up');
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await capture(item, 'vote-up-controlled', info);
  await activate(item, down, 'onVote', ['down'], 'Enter');
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await choice(item, 'Current vote', 'down');
  await control(item, 'Replace callbacks').click();
  await activate(item, up, 'onVote', ['up'], 'Space');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await choice(item, 'Current vote', 'null');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await capture(item, 'vote-null-controlled', info);
});

test('message actions MA5: trusted Shift copy writes request ID and native paste observes it', async ({
  page,
}, info) => {
  const item = await openActions(page);
  await inline(item);
  const copy = action(item, 'copy');
  await activate(item, copy, 'onCopy');
  await clear(item);
  for (const request of ['session-A-雪', 'session-B-"current"']) {
    await field(item, 'Request ID').fill(request);
    await copy.click({ modifiers: ['Shift'] });
    const observations = await refresh(item);
    expect(observations.callbacks).toEqual([]);
    expect(
      observations.native.some(
        (event) =>
          event.type === 'click' &&
          event.isTrusted &&
          event.shiftKey &&
          event.target?.actionId === 'copy',
      ),
    ).toBe(true);
    const paste = item.host.getByTestId('message-actions-paste');
    await paste.fill('');
    await paste.click();
    await page.keyboard.press('Control+V');
    await expect(paste).toHaveValue(request);
    const receipt = await item.host
      .getByRole('status', { name: 'Message action paste observations', exact: true })
      .textContent();
    expect(JSON.parse(receipt).at(-1)).toMatchObject({
      type: 'paste',
      isTrusted: true,
      text: request,
    });
    expect(JSON.parse(receipt).at(-1).types).toContain('text/plain');
    await capture(
      item,
      `clipboard-${request.startsWith('session-A') ? 'first' : 'current'}`,
      info,
      paste,
    );
  }
  await activate(item, copy, 'onCopy', [], 'Enter');
  await toggle(item, 'Supply requestId', false);
  await copy.click({ modifiers: ['Shift'] });
  let result = await refresh(item);
  expect(result.callbacks.at(-1)).toMatchObject({
    callback: 'onCopy',
    args: [],
    argumentCount: 0,
    capturedEvent: { isTrusted: true, shiftKey: true },
  });
  expect(result.callbacks).toHaveLength(2);
  await toggle(item, 'Supply requestId', true);
  await field(item, 'Request ID').fill('');
  await copy.click({ modifiers: ['Shift'] });
  result = await refresh(item);
  expect(result.callbacks.at(-1)).toMatchObject({ callback: 'onCopy', args: [], argumentCount: 0 });
  expect(result.callbacks).toHaveLength(3);
  await geometry(item, 'clipboard-fallback', info);
});
