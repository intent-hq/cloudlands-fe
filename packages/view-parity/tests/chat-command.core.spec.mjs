import {
  test,
  expect,
  openCommand,
  captureCommand,
  toggle,
  actionButton,
  actionState,
  expectedCallback,
  expectCallbacks,
  clearActions,
  nativeClickDisabled,
  tabThroughActions,
  nativePaste,
} from '../lib/chat-command.mjs';

// Oracles are original003 QueuedMessageActions, ChatCliBlock and canonical
// Button/CopyButton behavior. Labels locate real controls; callback payloads,
// disabled state, bubbling and clipboard content are the assertions.
test('chat command Q1: permissions and optional send callback independently gate admission', async ({
  page,
}, info) => {
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-queued-actions');
  const frame = exercise.getByTestId('command-queued-actions-frame');
  await captureCommand(page, frame, 'admission-before', info);
  const permissions = [
    ['Allow edit', 'Edit'],
    ['Allow send now', 'Send immediately'],
    ['Allow remove', 'Remove'],
  ];
  for (const [permission, label] of permissions) {
    await toggle(exercise, permission).click();
    await expect(actionButton(exercise, label)).toHaveCount(0);
    for (const [, other] of permissions.filter(([, name]) => name !== label)) {
      await expect(actionButton(exercise, other)).toBeEnabled();
    }
    await toggle(exercise, permission).click();
    await expect(actionButton(exercise, label)).toBeEnabled();
  }
  await toggle(exercise, 'Include send callback').click();
  await expect(actionButton(exercise, 'Send immediately')).toHaveCount(0);
  await toggle(exercise, 'Allow send now').click();
  await toggle(exercise, 'Include send callback').click();
  await expect(actionButton(exercise, 'Send immediately')).toHaveCount(0);
  await toggle(exercise, 'Allow edit').click();
  await toggle(exercise, 'Allow remove').click();
  await expect(exercise.getByTestId('command-queued-parent').getByRole('button')).toHaveCount(0);
  await expectCallbacks(exercise, []);
  await captureCommand(page, frame, 'admission-none', info);
  await toggle(exercise, 'Allow send now').click();
  await actionButton(exercise, 'Send immediately').press('Enter');
  await expectCallbacks(exercise, [expectedCallback('sendNow', 0, 0)]);
  await captureCommand(page, frame, 'admission-restored', info);
});

test('chat command Q2: disabled flags and sending suppress activation and skip keyboard focus', async ({
  page,
}, info) => {
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-queued-actions');
  const frame = exercise.getByTestId('command-queued-actions-frame');
  await captureCommand(page, frame, 'disabled-before', info);
  const all = ['Edit', 'Send immediately', 'Remove'];
  await tabThroughActions(page, host, all, 'enabled', info);
  for (const [flag, label] of [
    ['Disable edit', 'Edit'],
    ['Disable send now', 'Send immediately'],
    ['Disable remove', 'Remove'],
  ]) {
    await toggle(exercise, flag).click();
    await nativeClickDisabled(page, actionButton(exercise, label));
    await tabThroughActions(
      page,
      host,
      all.filter((name) => name !== label),
      flag,
      info,
    );
    await expectCallbacks(exercise, []);
    await toggle(exercise, flag).click();
    await expect(actionButton(exercise, label)).toBeEnabled();
  }
  await toggle(exercise, 'Sending').click();
  const sending = actionButton(exercise, 'Sending…');
  await expect(sending).toHaveAttribute('aria-busy', 'true');
  await nativeClickDisabled(page, sending);
  await tabThroughActions(page, host, ['Edit', 'Remove'], 'sending', info);
  await toggle(exercise, 'Disable edit').click();
  await toggle(exercise, 'Disable remove').click();
  await tabThroughActions(page, host, [], 'all-unavailable', info);
  await expectCallbacks(exercise, []);
  await captureCommand(page, frame, 'sending-disabled', info);
  await toggle(exercise, 'Sending').click();
  const send = actionButton(exercise, 'Send immediately');
  await expect(send).toBeEnabled();
  await expect(send).not.toHaveAttribute('aria-busy');
  await send.press('Enter');
  await expectCallbacks(exercise, [expectedCallback('sendNow', 0, 0)]);
  await captureCommand(page, frame, 'disabled-recovered', info);
});

test('chat command Q3: pointer callbacks preserve exact payloads and parent bubbling differences', async ({
  page,
}, info) => {
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-queued-actions');
  const frame = exercise.getByTestId('command-queued-actions-frame');
  await captureCommand(page, frame, 'pointer-before', info);
  // Positive observer control: the real neutral parent receives native input.
  await exercise
    .getByTestId('command-queued-parent')
    .getByText('Parent observation area', { exact: true })
    .click();
  await expect
    .poll(() => actionState(exercise))
    .toEqual({
      callbacks: [],
      parentClicks: [{ label: null, trusted: true, detail: 1 }],
      parentPointerDowns: [{ label: null, trusted: true, detail: 0 }],
    });
  await clearActions(exercise);
  const callbacks = [];
  const parentClicks = [];
  for (const [action, label] of [
    ['edit', 'Edit'],
    ['sendNow', 'Send immediately'],
    ['remove', 'Remove'],
  ]) {
    await actionButton(exercise, label).click();
    callbacks.push(expectedCallback(action));
    if (action !== 'edit') parentClicks.push({ label, trusted: true, detail: 1 });
    await expect
      .poll(() => actionState(exercise))
      .toEqual({ callbacks, parentClicks, parentPointerDowns: [] });
  }
  await captureCommand(page, frame, 'pointer-after', info);
});

test('chat command Q4: Enter and Space invoke each current action once with keyboard bubbling', async ({
  page,
}, info) => {
  const host = await openCommand(page);
  const exercise = host.getByTestId('command-queued-actions');
  const frame = exercise.getByTestId('command-queued-actions-frame');
  await captureCommand(page, frame, 'keyboard-before', info);
  const callbacks = [];
  const parentClicks = [];
  for (const [action, label] of [
    ['edit', 'Edit'],
    ['sendNow', 'Send immediately'],
    ['remove', 'Remove'],
  ]) {
    const button = actionButton(exercise, label);
    for (const key of ['Enter', 'Space']) {
      await button.press(key);
      await expect(button).toBeFocused();
      callbacks.push(expectedCallback(action, 0, 0));
      if (action !== 'edit') parentClicks.push({ label, trusted: true, detail: 0 });
      await expect
        .poll(() => actionState(exercise))
        .toEqual({ callbacks, parentClicks, parentPointerDowns: [] });
    }
  }
  await captureCommand(page, frame, 'keyboard-after', info);
});

test('chat command Q6: real clipboard and native paste follow current changed and empty commands', async ({
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
  await captureCommand(page, frame, 'clipboard-before', info);
  await copy.click();
  await expect(copy).toHaveAccessibleName('Copied');
  await nativePaste(paste, 'pnpm run check');
  const changed = 'printf "%s" "queued: ✓ $HOME & <literal>"';
  await exercise.getByRole('textbox', { name: 'Command', exact: true }).fill(changed);
  await copy.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(changed);
  await nativePaste(paste, changed);
  await exercise
    .getByRole('radiogroup', { name: 'Command preset', exact: true })
    .getByRole('radio', { name: 'empty', exact: true })
    .click();
  await copy.press('Space');
  // The clipboard must actually be empty; clearing the paste target alone is
  // not evidence that an empty command replaced the previous clipboard value.
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await nativePaste(paste, '');
  await expect(copy).toHaveAccessibleName('Copied');
  // Let source-owned feedback end naturally before taking stable images.
  await expect(copy).toHaveAccessibleName('Copy command');
  await captureCommand(page, frame, 'clipboard-empty-after', info);
});
