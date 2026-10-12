import {
  test,
  expect,
  openTranscript,
  outputJson,
  captureTranscript,
  chooseProp,
  expectReadable,
} from '../lib/chat-transcript.mjs';

test('chat transcript T4: disabled floating scroll respects callback replacement and lifetime', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-scroll');
  const display = exercise.getByTestId('chat-scroll-leaf');
  const button = display.getByRole('button', { name: 'Scroll to bottom', exact: true });
  const state = () => outputJson(exercise.getByTestId('chat-scroll-state'));
  const disabled = exercise.getByRole('switch', { name: 'Disable scroll button', exact: true });
  const floating = exercise.getByRole('switch', { name: 'Float scroll button', exact: true });
  const before = exercise.getByRole('button', {
    name: 'Remount ScrollToBottomButton',
    exact: true,
  });
  const after = host.getByRole('combobox', { name: 'Gap combination', exact: true });
  await button.click();
  await expect.poll(async () => (await state()).callbackCount).toBe(1);
  await disabled.click();
  await expect(button).toBeDisabled();
  await captureTranscript(page, display, 'disabled-inline-before', info);
  // Real pointer input on the disabled native control; no forced locator click or
  // programmatic DOM event. Browser suppression must leave the callback untouched.
  let bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  expect((await state()).callbackCount).toBe(1);
  await before.press('Tab');
  await expect(after).toBeFocused();
  await expect(button).not.toBeFocused();
  await floating.click();
  await expect(button).toBeDisabled();
  await captureTranscript(page, display, 'disabled-floating-after', info);
  bounds = await button.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  expect((await state()).callbackCount).toBe(1);
  await before.press('Tab');
  await expect(after).toBeFocused();
  await expect(button).not.toBeFocused();
  await exercise
    .getByRole('radiogroup', { name: 'Scroll callback identity', exact: true })
    .getByRole('radio', { name: 'replacement', exact: true })
    .click();
  await disabled.click();
  await expect(button).toBeEnabled();
  await button.press('Enter');
  await expect
    .poll(async () => (await state()).callbacks)
    .toEqual([
      { sequence: 1, identity: 'primary' },
      { sequence: 2, identity: 'replacement' },
    ]);
  await button.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  await expect(page.getByRole('tooltip', { name: 'Scroll to bottom', exact: true })).toBeVisible();
  const mount = exercise.getByRole('switch', { name: 'Mount ScrollToBottomButton', exact: true });
  const oldButton = await button.elementHandle();
  await mount.click();
  await expect(display).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(await oldButton.evaluate((element) => element.isConnected)).toBe(false);
  expect((await state()).callbackCount).toBe(2);
  await mount.click();
  await button.press('Space');
  await expect
    .poll(async () => (await state()).callbacks)
    .toEqual([
      { sequence: 1, identity: 'primary' },
      { sequence: 2, identity: 'replacement' },
      { sequence: 3, identity: 'replacement' },
    ]);
  await exercise.getByRole('button', { name: 'Remount ScrollToBottomButton', exact: true }).click();
  await button.click();
  await expect
    .poll(async () => (await state()).callbacks)
    .toEqual([
      { sequence: 1, identity: 'primary' },
      { sequence: 2, identity: 'replacement' },
      { sequence: 3, identity: 'replacement' },
      { sequence: 4, identity: 'replacement' },
    ]);
  expect((await state()).nativeEvents.every((event) => event.isTrusted)).toBe(true);
  await captureTranscript(page, display, 'floating-remounted', info);
});

test('chat transcript T6: missing effort uses fallback while provider spelling remains verbatim', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-effort');
  const status = exercise.getByRole('status');
  const display = exercise.getByTestId('chat-effort-leaf');
  await captureTranscript(page, display, 'effort-fallback-before', info);
  await chooseProp(page, exercise, 'Effort notice case', 'provider');
  await expect(status).toHaveText('Effort changed from provider/Deep-Think to custom-Mixed_CASE');
  for (const value of ['incomplete-from', 'incomplete-to']) {
    await chooseProp(page, exercise, 'Effort notice case', value);
    await expect(status).toHaveText('Effort changed');
  }
  await host.getByRole('switch', { name: 'Use custom notice fallback', exact: true }).click();
  await expect(status).toHaveText('Caller supplied notice fallback');
  await host
    .getByRole('textbox', { name: 'Notice fallback text', exact: true })
    .fill('Saved effort explanation from caller');
  await expect(status).toHaveText('Saved effort explanation from caller');
  await chooseProp(page, exercise, 'Effort notice case', 'provider');
  await expect(status).toHaveText('Effort changed from provider/Deep-Think to custom-Mixed_CASE');
  await captureTranscript(page, display, 'effort-fallback-after', info);
});

test('chat transcript T9: long notice text remains readable through unmount and remount', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  // Ordinary fallback caller text exercises the source's wrapping promise without
  // fabricating metadata, a model catalog, or a daemon response.
  const longText =
    'Caller preserved a detailed explanation of the changed conversation settings so the complete reason remains readable when the transcript is narrow. This explanation must survive replacing the mounted notice.';
  await host.getByRole('textbox', { name: 'Notice fallback text', exact: true }).fill(longText);
  await host.getByRole('switch', { name: 'Use custom notice fallback', exact: true }).click();
  const cases = [
    ['model', 'ModelChangeNotice', 'Model notice case', 'incomplete'],
    ['provider', 'ProviderRehomedNotice', 'Provider notice case', 'unknown-reason'],
    ['effort', 'EffortChangeNotice', 'Effort notice case', 'incomplete-from'],
  ];
  for (const [id, name, label, value] of cases) {
    const exercise = host.getByTestId(`chat-${id}`);
    const display = exercise.getByTestId(`chat-${id}-leaf`);
    const status = exercise.getByRole('status');
    await chooseProp(page, exercise, label, value);
    await expect(status).toHaveText(longText);
    await expectReadable(status);
    await captureTranscript(page, display, `${id}-long-before`, info);
    const element = await status.elementHandle();
    const mount = exercise.getByRole('switch', { name: `Mount ${name}`, exact: true });
    await mount.click();
    await expect(status).toHaveCount(0);
    expect(await element.evaluate((node) => node.isConnected)).toBe(false);
    await mount.click();
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText(longText);
    await exercise.getByRole('button', { name: `Remount ${name}`, exact: true }).click();
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText(longText);
    await expectReadable(status);
    await captureTranscript(page, display, `${id}-long-after`, info);
  }
});

test('chat transcript T10: source gap combinations retain hidden semantics and measured evidence', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-gap');
  const display = exercise.getByTestId('chat-gap-leaf');
  const gap = display.getByTestId('conversation-turn-gap');
  // These names select source-supported ordinary props. Capture actual geometry
  // and native AX; there is intentionally no decorative-value or parity oracle.
  const combinations = [
    'ordinary',
    'current-event',
    'current-event-with-assistant',
    'next-user',
    'event-over-user',
    'compact-over-user',
    'zero-over-compact',
    'batched-over-zero',
    'cards-over-batched',
    'content-over-batched',
    'attention-over-cards',
  ];
  const evidence = [];
  for (const value of combinations) {
    if (value !== 'ordinary') await chooseProp(page, exercise, 'Gap combination', value);
    await expect(gap).toHaveCount(1);
    await expect(gap).toHaveAttribute('aria-hidden', 'true');
    await expect(display.getByRole('button')).toHaveCount(0);
    const measured = await captureTranscript(page, display, `gap-${value}`, info);
    evidence.push({
      value,
      inputs: (await outputJson(exercise.getByTestId('chat-gap-state'))).inputs,
      measured,
      aria: await display.ariaSnapshot(),
    });
  }
  const mount = exercise.getByRole('switch', { name: 'Mount ConversationTurnGap', exact: true });
  await mount.click();
  await expect(gap).toHaveCount(0);
  await mount.click();
  await expect(gap).toHaveAttribute('aria-hidden', 'true');
  await info.attach('gap-combinations.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});
