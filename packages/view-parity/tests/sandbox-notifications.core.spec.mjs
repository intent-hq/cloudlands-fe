// Four bounded regressions; run one released case, then manually review every PNG.
import {
  test,
  expect,
  open,
  button,
  field,
  defaultHost,
  activeToasts,
  oneDefaultHost,
  oneToast,
  sameHost,
  navigateCatalog,
  copyWithFeedback,
  label,
  outputJson,
  expectCode,
  capture,
  captureScopedToast,
} from '../lib/sandbox-notifications.mjs';

test('sandbox notifications SN1: progress lifecycle and keyed replacement render once in the default host', async ({
  page,
}, info) => {
  const fixture = await open(page, 'notify');
  await expect(activeToasts(defaultHost(page))).toHaveCount(0);
  await capture(page, fixture, 'sn1-before', info);
  await button(fixture, 'Loading').click();
  await oneToast(page, 'Live loading toast');
  const id = await fixture.getByTestId('notify-progress-id').textContent();
  expect(id).not.toBe('');
  await button(fixture, 'Update progress').click();
  await oneToast(page, 'Progress updated');
  await expect(page.getByText('Live loading toast', { exact: true })).toHaveCount(0);
  await button(fixture, 'Complete progress').click();
  await oneToast(page, 'Progress complete');
  await expect(fixture.getByTestId('notify-progress-id')).toHaveText(id);
  await button(fixture, 'Dismiss progress').click();
  await expect(defaultHost(page).locator('[data-sonner-toast]')).toHaveCount(0);
  await button(fixture, 'Start keyed notification').click();
  const first = await oneToast(page, 'Keyed first message');
  const firstNode = await first.elementHandle();
  try {
    // The existing keyed caller uses duration: Infinity; no test clock override.
    await capture(page, first, 'sn1-keyed-before', info);
    await button(fixture, 'Replace keyed notification').click();
    const replacement = await oneToast(page, 'Keyed replacement message');
    const ids = await outputJson(fixture.getByTestId('notify-keyed-ids'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(await replacement.evaluate((node, previous) => node === previous, firstNode)).toBe(true);
    await expect(page.getByText('Keyed first message', { exact: true })).toHaveCount(0);
    await capture(page, replacement, 'sn1-keyed-replaced', info);
    await button(replacement, label('ui_toast_close_ariaLabel')).click();
    await expect(defaultHost(page).locator('[data-sonner-toast]')).toHaveCount(0);
  } finally {
    await firstNode.dispose();
  }
  await capture(page, fixture, 'sn1-dismissed-after', info);
});

test('sandbox notifications SN2: catalog navigation keeps the default host and scoped previews stay independent', async ({
  page,
}, info) => {
  const notify = await open(page, 'notify');
  const originalHost = await defaultHost(page).elementHandle();
  try {
    await button(notify, 'Start keyed notification').click();
    await capture(page, await oneToast(page, 'Keyed first message'), 'sn2-notify-before', info);
    await navigateCatalog(page, 'toast');
    await sameHost(page, originalHost);
    // NotifyExample unmount dismisses only its own toast; named preview hosts coexist.
    await expect(activeToasts(defaultHost(page))).toHaveCount(0);
    const scoped = page.locator('[data-toast-preview="success"]');
    await expect(scoped).toHaveCount(1);
    const scopedToast = activeToasts(scoped);
    await expect(scopedToast).toHaveCount(1);
    await expect(scopedToast.getByText('Workspace saved', { exact: true })).toBeVisible();
    const scopedNode = await scopedToast.elementHandle();
    try {
      await capture(page, scoped, 'sn2-scoped-before', info);
      await captureScopedToast(page, scopedToast, 'sn2-complete-toast-before', info);
      const live = page.locator('[data-functional-example="notify"]');
      await button(live, 'Success').click();
      const liveToast = await oneToast(page, 'Live success toast');
      await expect(scopedToast.getByText('Workspace saved', { exact: true })).toBeVisible();
      // Assert transient live success directly; capture the persistent scoped card.
      await button(liveToast, label('ui_toast_close_ariaLabel')).click();
      await expect(defaultHost(page).locator('[data-sonner-toast]')).toHaveCount(0);
      expect(
        await scopedToast.evaluate(
          (node, previous) => node === previous && previous.isConnected,
          scopedNode,
        ),
      ).toBe(true);
      await capture(page, scoped, 'sn2-scoped-survives-default-dismiss', info);
      await captureScopedToast(page, scopedToast, 'sn2-complete-toast-after', info);
    } finally {
      await scopedNode.dispose();
    }
    await navigateCatalog(page, 'notify');
    await sameHost(page, originalHost);
    // This real page link, unlike a page.goto, preserves the existing app host.
    await page.locator('a[href="/sandbox/notify?example=interactive"]').click();
    await expect(page.locator('[data-functional-example="notify"]')).toBeVisible();
    await sameHost(page, originalHost);
    await expect(page.locator('[data-toast-preview]')).toHaveCount(0);
  } finally {
    await originalHost.dispose();
  }
  // Supplemental chat routes have no actual catalog links. These are native full
  // page navigations, not evidence of same-document host identity between them.
  for (const slug of ['chat-image', 'chat-reference', 'chat-command']) {
    const fixture = await open(page, slug);
    await expect(activeToasts(await oneDefaultHost(page))).toHaveCount(0);
    await capture(page, fixture.getByRole('heading').first(), `sn2-${slug}-loaded`, info);
  }
});

test('sandbox notifications SN3: CodeBlock copy keeps visible feedback and native paste after local host removal', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(process.env.PARITY_CANDIDATE_URL).origin,
  });
  const fixture = await open(page, 'chat-reference');
  const section = fixture.getByTestId('reference-code');
  const frame = section.getByTestId('reference-code-frame');
  const leaf = section.getByTestId('reference-code-leaf');
  const text =
    'const notificationRegression = "✓ & <literal>";\n\nconsole.log(notificationRegression);\n';
  await field(section, 'Code language').fill('plaintext');
  await field(section, 'Code').fill(text);
  await expectCode(leaf, text);
  await capture(page, frame, 'sn3-code-before', info);
  const copy = leaf.getByRole('button');
  await copyWithFeedback(
    page,
    leaf,
    copy,
    field(section, 'Paste copied code'),
    text,
    label('ui_copyButton_label'),
    label('ui_linkTooltip_copied_label'),
  );
  await capture(page, field(section, 'Paste copied code'), 'sn3-native-paste', info);
  await capture(page, frame, 'sn3-code-after', info);
});

test('sandbox notifications SN4: command copy keeps current feedback and native paste after local host removal', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(process.env.PARITY_CANDIDATE_URL).origin,
  });
  const fixture = await open(page, 'chat-command');
  const section = fixture.getByTestId('command-cli');
  const frame = section.getByTestId('command-cli-frame');
  const paste = field(section, 'Paste copied command');
  const copy = frame.getByTestId('chat-cli-copy');
  await capture(page, frame, 'sn4-command-before', info);
  const changed = 'printf "%s" "notification: ✓ $HOME & <literal>"';
  await field(section, 'Command').fill(changed);
  await expect(frame.locator('code')).toHaveText(changed);
  await copyWithFeedback(
    page,
    frame,
    copy,
    paste,
    changed,
    label('chat_cliBlock_copy_tooltip'),
    label('chat_cliBlock_copied_tooltip'),
  );
  await capture(page, paste, 'sn4-native-paste', info);
  await capture(page, frame, 'sn4-command-after', info);
});
