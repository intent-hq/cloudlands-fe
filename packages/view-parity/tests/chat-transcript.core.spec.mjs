import {
  test,
  expect,
  openTranscript,
  outputJson,
  captureTranscript,
  chooseProp,
} from '../lib/chat-transcript.mjs';

// Oracles come from original003 source APIs, original label helpers and en.json.
// Do not import the new formatter or manufacture model/provider catalog entries.
test('chat transcript T1: separator and dismissal title survive prop changes and remount', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const divider = host.getByTestId('chat-divider');
  const marker = divider.getByRole('separator', { name: 'New messages', exact: true });
  await captureTranscript(page, divider.getByTestId('chat-divider-leaf'), 'divider-before', info);
  await divider.getByRole('switch', { name: 'Mount NewMessagesDivider', exact: true }).click();
  await expect(marker).toHaveCount(0);
  await divider.getByRole('switch', { name: 'Mount NewMessagesDivider', exact: true }).click();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAccessibleName('New messages');
  await captureTranscript(page, divider.getByTestId('chat-divider-leaf'), 'divider-after', info);

  const questions = host.getByTestId('chat-questions');
  const status = questions.getByTestId('chat-questions-leaf').getByRole('status');
  await expect(status).toHaveAttribute('title', 'Caller supplied dismissal title');
  await captureTranscript(
    page,
    questions.getByTestId('chat-questions-leaf'),
    'questions-before',
    info,
  );
  await questions
    .getByRole('textbox', { name: 'Questions notice title', exact: true })
    .fill('Changed delivered question explanation');
  await expect(status).toHaveAttribute('title', 'Changed delivered question explanation');
  await expect(status).toHaveText('Questions dismissed');
  await questions.getByRole('switch', { name: 'Use questions title', exact: true }).click();
  await expect(status).not.toHaveAttribute('title');
  await questions
    .getByRole('button', { name: 'Remount QuestionsDismissedNotice', exact: true })
    .click();
  await expect(status).toHaveText('Questions dismissed');
  await expect(status).not.toHaveAttribute('title');
  await captureTranscript(
    page,
    questions.getByTestId('chat-questions-leaf'),
    'questions-after',
    info,
  );
});

test('chat transcript T2: tool transitions replace accessible status without stale labels', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const tool = host.getByTestId('chat-tool');
  const display = tool.getByTestId('chat-tool-leaf');
  await expect(display.getByRole('img', { name: 'Running', exact: true })).toBeVisible();
  await captureTranscript(page, display, 'tool-before', info);
  for (const [value, label] of [
    ['completed', 'Success'],
    ['error', 'Failed'],
    ['running', 'Running'],
  ]) {
    await tool
      .getByRole('radiogroup', { name: 'Tool status', exact: true })
      .getByRole('radio', { name: value, exact: true })
      .click();
    const image = display.getByRole('img');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAccessibleName(label);
    await expect(image).toHaveAttribute('title', label);
    await captureTranscript(page, display, `tool-${value}`, info);
  }
  await tool.getByRole('switch', { name: 'Mount ToolStatusIcon', exact: true }).click();
  await expect(display).toHaveCount(0);
  await tool.getByRole('switch', { name: 'Mount ToolStatusIcon', exact: true }).click();
  await expect(display.getByRole('img')).toHaveAccessibleName('Running');
});

test('chat transcript T3: inline scroll uses native pointer keyboard and tooltip focus', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-scroll');
  const display = exercise.getByTestId('chat-scroll-leaf');
  const button = display.getByRole('button', { name: 'Scroll to bottom', exact: true });
  const state = () => outputJson(exercise.getByTestId('chat-scroll-state'));
  const tooltip = page.getByRole('tooltip', { name: 'Scroll to bottom', exact: true });
  await captureTranscript(page, display, 'scroll-before', info);
  await button.hover();
  await expect(tooltip).toBeVisible();
  await expect(button).toHaveAccessibleDescription('Scroll to bottom');
  expect((await state()).callbacks).toEqual([]);
  await button.click();
  await expect
    .poll(async () => (await state()).callbacks)
    .toEqual([{ sequence: 1, identity: 'primary' }]);
  await expect(tooltip).toHaveCount(0);
  await button.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  await expect(tooltip).toBeVisible();
  await expect(button).toHaveAccessibleDescription('Scroll to bottom');
  await button.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(button).toBeFocused();
  expect((await state()).callbackCount).toBe(1);
  await button.press('Enter');
  await button.press('Space');
  await expect
    .poll(async () => (await state()).callbacks)
    .toEqual([
      { sequence: 1, identity: 'primary' },
      { sequence: 2, identity: 'primary' },
      { sequence: 3, identity: 'primary' },
    ]);
  const events = (await state()).nativeEvents;
  expect(events.every((event) => event.isTrusted)).toBe(true);
  expect(events.filter((event) => event.type === 'click').map((event) => event.detail)).toEqual([
    1, 0, 0,
  ]);
  expect(events.filter((event) => event.type === 'keydown').map((event) => event.key)).toEqual([
    'Tab',
    'Escape',
    'Enter',
    ' ',
  ]);
  await captureTranscript(page, display, 'scroll-after', info);
});

test('chat transcript T5: effort labels distinguish Auto Off and case-insensitive known values', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-effort');
  const display = exercise.getByTestId('chat-effort-leaf');
  const status = display.getByRole('status');
  await expect(status).toHaveText('Effort changed from Auto to High');
  await captureTranscript(page, display, 'effort-before', info);
  await chooseProp(page, exercise, 'Effort notice case', 'none');
  await expect(status).toHaveText('Effort changed from Off to Max');
  await chooseProp(page, exercise, 'Effort notice case', 'canonical-case');
  await expect(status).toHaveText('Effort changed from Minimal to Extra high');
  await captureTranscript(page, display, 'effort-after', info);
});

test('chat transcript T7: model props use raw IDs provider defaults and incomplete fallback', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-model');
  const display = exercise.getByTestId('chat-model-leaf');
  const status = display.getByRole('status');
  await expect(status).toHaveText('Switched from org/model:alpha to org/model:beta');
  await captureTranscript(page, display, 'model-before', info);
  // Original selectors return unresolved raw provider IDs; null is provider default,
  // whereas a null model without any provider cannot describe that side.
  const cases = [
    [
      'canonical',
      'Switched from sonnet4.6 (auggie / sonnet4.6) to gpt-5-codex (codex / gpt-5-codex)',
    ],
    [
      'unknown-providers',
      'Switched from org/Unlisted-Model:A (provider/Unlisted-A / org/Unlisted-Model:A) to org/Unlisted-Model:B (provider/Unlisted-B / org/Unlisted-Model:B)',
    ],
    ['defaults', 'Switched from auggie default model (auggie) to codex default model (codex)'],
    [
      'from-null',
      'Switched from auggie default model (auggie) to gpt-5-codex (codex / gpt-5-codex)',
    ],
    ['to-null', 'Switched from sonnet4.6 (auggie / sonnet4.6) to codex default model (codex)'],
  ];
  for (const [value, label] of cases) {
    await chooseProp(page, exercise, 'Model notice case', value);
    await expect(status).toHaveText(label);
  }
  await host
    .getByRole('textbox', { name: 'Notice workspace ID', exact: true })
    .fill('caller-workspace');
  await expect(status).toHaveText(cases.at(-1)[1]);
  await chooseProp(page, exercise, 'Model notice case', 'incomplete');
  await expect(status).toHaveText('Model changed');
  await host.getByRole('switch', { name: 'Use custom notice fallback', exact: true }).click();
  await expect(status).toHaveText('Caller supplied notice fallback');
  await host
    .getByRole('textbox', { name: 'Notice fallback text', exact: true })
    .fill('Changed caller model fallback');
  await expect(status).toHaveText('Changed caller model fallback');
  await captureTranscript(page, display, 'model-after', info);
});

test('chat transcript T8: provider notices distinguish disabled defaults and missing metadata', async ({
  page,
}, info) => {
  const host = await openTranscript(page);
  const exercise = host.getByTestId('chat-provider');
  const display = exercise.getByTestId('chat-provider-leaf');
  const status = display.getByRole('status');
  await expect(status).toHaveText(
    'sonnet4.6 (auggie) is no longer available — auggie was disabled in Settings > Agents; this agent now runs on codex.',
  );
  await captureTranscript(page, display, 'provider-before', info);
  await chooseProp(page, exercise, 'Provider notice case', 'unknown-providers');
  await expect(status).toHaveText(
    'org/Unlisted-Model:A (provider/Unlisted-A) is no longer available — provider/Unlisted-A was disabled in Settings > Agents; this agent now runs on provider/Unlisted-B.',
  );
  await chooseProp(page, exercise, 'Provider notice case', 'defaults');
  const defaults =
    'The default model (auggie) is no longer available — auggie was disabled in Settings > Agents; this agent now runs on codex.';
  await expect(status).toHaveText(defaults);
  await host
    .getByRole('textbox', { name: 'Notice workspace ID', exact: true })
    .fill('another-caller-workspace');
  await expect(status).toHaveText(defaults);
  for (const value of ['missing-from-provider', 'missing-to-provider', 'unknown-reason']) {
    await chooseProp(page, exercise, 'Provider notice case', value);
    await expect(status).toHaveText('Provider changed');
  }
  await host.getByRole('switch', { name: 'Use custom notice fallback', exact: true }).click();
  await expect(status).toHaveText('Caller supplied notice fallback');
  await captureTranscript(page, display, 'provider-after', info);
});
