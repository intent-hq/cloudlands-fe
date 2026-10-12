import {
  test,
  expect,
  openCommand,
  captureCommand,
  toggle,
  actionButton,
  expectedCallback,
  expectCallbacks,
  nativePaste,
  expectCommandContained,
} from '../lib/chat-command.mjs';

test('chat command Q5: callback replacement and unmount remount retain only the current owner', async ({
  page,
}, info) => {
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-queued-actions');
  const frame = exercise.getByTestId('command-queued-actions-frame');
  const callbacks = [];
  const actions = [
    ['edit', 'Edit'],
    ['sendNow', 'Send immediately'],
    ['remove', 'Remove'],
  ];
  await captureCommand(page, frame, 'callback-owner-before', info);
  for (const [action, label] of actions) {
    await actionButton(exercise, label).click();
    callbacks.push(expectedCallback(action));
    await expectCallbacks(exercise, callbacks);
  }
  const old = await actionButton(exercise, 'Edit').elementHandle();
  try {
    await exercise.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
    for (const [action, label] of actions) {
      await actionButton(exercise, label).press('Enter');
      callbacks.push(expectedCallback(action, 1, 0));
      await expectCallbacks(exercise, callbacks);
    }
    // New callbacks alone must not remount the action node.
    expect(await old.evaluate((node) => node.isConnected)).toBe(true);
    await toggle(exercise, 'Include send callback').click();
    await expect(actionButton(exercise, 'Send immediately')).toHaveCount(0);
    await toggle(exercise, 'Mount Queued actions').click();
    await expect(frame.getByRole('button')).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await exercise.getByRole('button', { name: 'Replace callbacks', exact: true }).click();
    await expectCallbacks(exercise, callbacks);
    await captureCommand(page, frame, 'callback-owner-unmounted', info);
    await toggle(exercise, 'Mount Queued actions').click();
    await expect(actionButton(exercise, 'Send immediately')).toHaveCount(0);
    await toggle(exercise, 'Include send callback').click();
    for (const [action, label] of actions) {
      await actionButton(exercise, label).press('Space');
      callbacks.push(expectedCallback(action, 2, 0));
      await expectCallbacks(exercise, callbacks);
    }
    const mounted = await actionButton(exercise, 'Edit').elementHandle();
    try {
      await exercise.getByRole('button', { name: 'Remount Queued actions', exact: true }).click();
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
    } finally {
      await mounted.dispose();
    }
    await actionButton(exercise, 'Edit').click();
    callbacks.push(expectedCallback('edit', 2));
    await expectCallbacks(exercise, callbacks);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await captureCommand(page, frame, 'callback-owner-after', info);
  } finally {
    await old.dispose();
  }
});

test('chat command Q7: long and multiline commands keep copy accessible and preserve the full clipboard', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(process.env.PARITY_CANDIDATE_URL).origin,
  });
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-cli');
  const frame = exercise.getByTestId('command-cli-frame');
  const copy = frame.getByTestId('chat-cli-copy');
  const paste = exercise.getByRole('textbox', { name: 'Paste copied command', exact: true });
  await captureCommand(page, frame, 'containment-before', info);
  // Independent caller inputs exercise both unbroken overflow and line breaks.
  // Source deliberately truncates the displayed code; full text belongs in copy.
  for (const [name, command] of [
    ['long', `printf '%s' '${'command-segment-'.repeat(80)}'`],
    ['multiline', 'git status --short\nprintf "%s" "雪 and ✓"\nprintf "%s" "spaces  remain"'],
  ]) {
    await exercise.getByRole('textbox', { name: 'Command', exact: true }).fill(command);
    expect(await frame.locator('code').textContent()).toBe(command);
    await expectCommandContained(frame, info, name);
    await captureCommand(page, frame, `containment-${name}`, info);
    await copy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    await nativePaste(paste, command);
    await expect(copy).toHaveAccessibleName('Copy command');
  }
  await captureCommand(page, frame, 'containment-after', info);
});

test('chat command Q8: copy feedback and current command recover after unmount and keyed remount', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(process.env.PARITY_CANDIDATE_URL).origin,
  });
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-cli');
  const frame = exercise.getByTestId('command-cli-frame');
  const copy = frame.getByTestId('chat-cli-copy');
  const paste = exercise.getByRole('textbox', { name: 'Paste copied command', exact: true });
  await captureCommand(page, frame, 'copy-lifetime-before', info);
  await copy.click();
  await expect(copy).toHaveAccessibleName('Copied');
  await nativePaste(paste, 'pnpm run check');
  const old = await copy.elementHandle();
  try {
    await toggle(exercise, 'Mount Command card').click();
    await expect(copy).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    const changed = 'printf "current after remount"';
    await exercise.getByRole('textbox', { name: 'Command', exact: true }).fill(changed);
    await captureCommand(page, frame, 'copy-lifetime-unmounted', info);
    await toggle(exercise, 'Mount Command card').click();
    await expect(copy).toHaveAccessibleName('Copy command');
    await copy.press('Enter');
    await expect(copy).toHaveAccessibleName('Copied');
    await nativePaste(paste, changed);
    const mounted = await copy.elementHandle();
    try {
      await exercise.getByRole('button', { name: 'Remount Command card', exact: true }).click();
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(false);
    } finally {
      await mounted.dispose();
    }
    await expect(copy).toHaveAccessibleName('Copy command');
    await copy.press('Space');
    await expect(copy).toHaveAccessibleName('Copied');
    await nativePaste(paste, changed);
    await expect(copy).toHaveAccessibleName('Copy command');
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await captureCommand(page, frame, 'copy-lifetime-after', info);
  } finally {
    await old.dispose();
  }
});
