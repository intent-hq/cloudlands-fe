import { expect, test } from '../../../test/ct-test';
import DiscussionHost from './__tests__/DiscussionHost.svelte';

async function recorded(component: import('@playwright/test').Locator) {
  return JSON.parse(
    (await component.locator('[data-discussion-requests]').textContent()) || '[]',
  ) as Array<{ method: string; params: Record<string, unknown> }>;
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`send confirmation preserves the message node, focus, draft and bottom anchor with ${reducedMotion} motion`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(DiscussionHost, { props: { deferSend: true } });
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeEditable();
    await composer.fill('A message awaiting confirmation');
    await composer.press('Enter');
    const pending = component
      .locator('[data-discussion-message]')
      .filter({ hasText: 'A message awaiting confirmation' });
    await expect(pending.getByRole('status')).toBeVisible();
    const transitions = await pending.evaluateHandle((element) => {
      const properties: string[] = [];
      element.addEventListener('transitionrun', (event) => {
        if (event.target === element) properties.push((event as TransitionEvent).propertyName);
      });
      return properties;
    });
    const original = await pending.elementHandle();
    const retryId = await pending.getAttribute('data-discussion-message');
    await composer.fill('My next thought');
    await component
      .getByRole('button', { name: 'Confirm send', exact: true })
      .evaluate((el: HTMLButtonElement) => el.click());
    await expect(pending.getByRole('status')).toHaveCount(0);
    await expect(pending).toHaveCount(1);
    expect(await pending.evaluate((element, previous) => element === previous, original)).toBe(
      true,
    );
    await expect(pending).not.toHaveAttribute('data-discussion-message', retryId!);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue('My next thought');
    await expect
      .poll(() =>
        component
          .locator('[data-discussion-scroll]')
          .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
      )
      .toBeLessThan(2);
    await expect.poll(() => pending.evaluate((element) => element.getAnimations().length)).toBe(0);
    if (reducedMotion === 'reduce') {
      expect(
        await pending.evaluate((element) => getComputedStyle(element).transitionProperty),
      ).toBe('none');
      expect(await transitions.jsonValue()).toEqual([]);
    } else {
      await expect.poll(() => transitions.jsonValue()).toContain('opacity');
    }
    await transitions.dispose();
  });
}

test('a consecutive send announces progress and keeps its row and newer draft through failure and retry', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost, {
    props: { deferSend: true, failSend: true, recentHistory: true },
  });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('A follow-up from the same author');
  await composer.press('Enter');
  const row = component
    .locator('[data-discussion-message]')
    .filter({ hasText: 'A follow-up from the same author' });
  await expect(row).toHaveAttribute('data-discussion-continuation', 'true');
  await expect(row.getByRole('status')).toHaveCount(1);
  const original = await row.elementHandle();
  await composer.fill('Keep my newer draft');
  await component
    .getByRole('button', { name: 'Confirm send', exact: true })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(row.getByRole('alert')).toBeVisible();
  await expect
    .poll(() =>
      component
        .locator('[data-discussion-scroll]')
        .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeLessThan(2);
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveCount(0);
  await expect(row.getByRole('status')).toHaveCount(0);
  expect(await row.evaluate((element, previous) => element === previous, original)).toBe(true);
  await expect(composer).toHaveValue('Keep my newer draft');
  await expect(composer).toBeFocused();
  const sends = (await recorded(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});

test('confirmation leaves a reader in older history at the same visible message', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost, { props: { deferSend: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Confirm while I read');
  await composer.press('Enter');
  await expect(component.getByRole('log').getByRole('status')).toBeVisible();
  const anchor = component.locator('[data-discussion-message="message-20"]');
  await anchor.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  const before = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  await component
    .getByRole('button', { name: 'Confirm send', exact: true })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(component.getByRole('log').getByRole('status')).toHaveCount(0);
  await expect
    .poll(async () =>
      Math.abs((await anchor.evaluate((element) => element.getBoundingClientRect().top)) - before),
    )
    .toBeLessThan(2);
  await expect(composer).toBeFocused();
});

test('composer preserves multiline drafts, ignores composition Enter, and sends through the daemon contract', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('First line');
  await composer.press('Shift+Enter');
  await composer.press('x');
  await expect(composer).toHaveValue('First line\nx');
  await composer.dispatchEvent('compositionstart');
  await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  expect((await recorded(component)).filter((r) => r.method === 'discussion.send')).toHaveLength(0);
  await composer.dispatchEvent('compositionend');
  await component.getByRole('button', { name: 'Toggle discussion' }).click();
  await component.getByRole('button', { name: 'Toggle discussion' }).click();
  await expect(composer).toHaveValue('First line\nx');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
  await expect(component.getByRole('log')).toContainText('First line\nx');
  await expect(component.locator('[data-discussion-unread]')).toHaveCount(0);
  const calls = await recorded(component);
  expect(calls.find((call) => call.method === 'discussion.list')).toEqual({
    method: 'discussion.list',
    params: { workspaceId: 'discussion-test', limit: 50 },
  });
  const sends = calls.filter((r) => r.method === 'discussion.send');
  expect(sends).toHaveLength(1);
  expect(sends[0]).toEqual({
    method: 'discussion.send',
    params: {
      workspaceId: 'discussion-test',
      messageId: expect.any(String),
      body: 'First line\nx',
    },
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await component.getByRole('button', { name: 'Disable multiplayer' }).click();
  await expect(composer).toHaveCount(0);
});

test('failed sends keep the draft and retry the same message identity', async ({ mount }) => {
  const component = await mount(DiscussionHost, { props: { failSend: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Keep this message');
  await composer.press('Enter');
  await expect(component.getByRole('alert')).toBeVisible();
  await expect(composer).toHaveValue('Keep this message');
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(composer).toHaveValue('');
  const sends = (await recorded(component)).filter((r) => r.method === 'discussion.send');
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  await expect(
    component.getByRole('log').getByText('Keep this message', { exact: true }),
  ).toHaveCount(1);
});

for (const initialDraft of ['empty', 'oversized'] as const) {
  test(`Enter sends from an ${initialDraft} draft before the rendered draft catches up`, async ({
    mount,
  }, testInfo) => {
    const component = await mount(DiscussionHost);
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeEditable();
    if (initialDraft === 'oversized') {
      await composer.fill('🌎'.repeat(4097));
      await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      await expect(composer).toHaveAttribute('aria-invalid', 'true');
    } else {
      await expect(composer).toHaveValue('');
    }
    await composer.evaluate((element: HTMLTextAreaElement) => {
      element.value = 'Send the current input';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expect(composer).toHaveValue('');
    const sends = (await recorded(component)).filter((r) => r.method === 'discussion.send');
    expect(sends).toHaveLength(1);
    expect(sends[0].params.body).toBe('Send the current input');
    await expect(component.getByRole('log')).toContainText('Send the current input');
    await component.locator('[data-discussion-test-pane]').screenshot({
      path: testInfo.outputPath('discussion-immediate-send.png'),
    });
  });
}

test('older messages preserve draft and focus; live arrivals receive an unread marker', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(component.locator('[data-discussion-message="message-35"]')).toBeVisible();
  await composer.fill('Unsent thought');
  const scroller = component.locator('[data-discussion-scroll]');
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await component.getByRole('button', { name: 'Load older messages' }).click();
  await expect
    .poll(async () => (await recorded(component)).some((r) => r.params.beforeSequence === 11))
    .toBe(true);
  await composer.focus();
  await component
    .getByRole('button', { name: 'Finish history' })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(component.locator('[data-discussion-message="message-1"]')).toHaveCount(1);
  await expect(composer).toHaveValue('Unsent thought');
  await expect(composer).toBeFocused();
  await component
    .getByRole('button', { name: 'Receive live message' })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(component.locator('[data-discussion-message="message-100"]')).toHaveCount(1);
  await expect(component.locator('[data-discussion-unread]')).toHaveCount(1);
  expect(
    await component
      .locator('[data-discussion-message="message-100"]')
      .evaluate((el) => el.previousElementSibling?.hasAttribute('data-discussion-unread')),
  ).toBe(true);
});

test('retry resumes a partial reconnect page before requesting older history', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  await expect(component.locator('[data-discussion-message="message-35"]')).toBeVisible();
  await component.getByRole('button', { name: 'Fail reconnect catch-up' }).click();
  await expect(component.getByRole('alert')).toBeVisible();
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await recorded(component)).filter((call) => call.method === 'discussion.list')[1],
    )
    .toEqual({
      method: 'discussion.list',
      params: { workspaceId: 'discussion-test', limit: 50, afterSequence: 100 },
    });
  await expect(component.getByRole('log')).toContainText('Recovered after reconnect.');
  await expect(component.getByRole('alert')).toHaveCount(0);
});

test('retrying an earlier failed message leaves a newer draft intact', async ({ mount }) => {
  const component = await mount(DiscussionHost, { props: { failSend: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Earlier thought');
  await composer.press('Enter');
  await expect(component.getByRole('alert')).toBeVisible();
  await composer.fill('A new thought');
  const failed = component.locator('[data-discussion-failed]');
  await expect(failed).toContainText('Earlier thought');
  await failed.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(failed).toHaveCount(0);
  await expect(composer).toHaveValue('A new thought');
  const sends = (await recorded(component)).filter((r) => r.method === 'discussion.send');
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});

test('composer enforces the UTF-8 byte limit and keeps oversized drafts editable', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('🌎'.repeat(4097));
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await composer.press('Enter');
  expect((await recorded(component)).filter((r) => r.method === 'discussion.send')).toHaveLength(0);
  await expect(composer).toHaveValue('🌎'.repeat(4097));
  await composer.fill('🌎'.repeat(4096));
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  expect((await recorded(component)).filter((r) => r.method === 'discussion.send')).toHaveLength(1);
});

test('disconnection keeps loaded history and the draft visible while disabling sends', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await expect(component.locator('[data-discussion-message]')).toHaveCount(25);
  await composer.fill('Keep this until I reconnect');
  await component.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(composer).not.toBeEditable();
  await expect(composer).toHaveValue('Keep this until I reconnect');
  await expect(component.locator('[data-discussion-message]')).toHaveCount(25);
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await composer.press('Enter');
  expect((await recorded(component)).filter((r) => r.method === 'discussion.send')).toHaveLength(0);
});

test('discussion typing uses pooled presence reports and clears without reviving a retained draft', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  const typingReports = async () =>
    (await recorded(component)).filter(
      (call) => call.method === 'presence.update' && call.params.discussionTyping,
    );
  expect(await typingReports()).toHaveLength(0);
  await composer.fill('Working through this');
  await expect.poll(async () => (await typingReports()).length).toBeGreaterThan(0);
  const active = (await typingReports()).at(-1);
  expect(active?.params).toEqual({
    focus: [{ workspaceId: 'discussion-test' }],
    typing: null,
    discussionTyping: { workspaceId: 'discussion-test' },
  });
  await component.getByRole('button', { name: 'Toggle discussion' }).click();
  await expect
    .poll(
      async () =>
        (await recorded(component)).filter((call) => call.method === 'presence.update').at(-1)
          ?.params.discussionTyping,
    )
    .toBeUndefined();
  const sent = (await typingReports()).length;
  await component.getByRole('button', { name: 'Toggle discussion' }).click();
  await expect(composer).toHaveValue('Working through this');
  expect(await typingReports()).toHaveLength(sent);
  await composer.fill('A fresh edit');
  await expect.poll(async () => (await typingReports()).length).toBeGreaterThan(sent);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect
    .poll(
      async () =>
        (await recorded(component)).filter((call) => call.method === 'presence.update').at(-1)
          ?.params.discussionTyping,
    )
    .toBeUndefined();
});

test('discussion typing shows other people once, expires unchanged pulses, and renews on new input', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const component = await mount(DiscussionHost);
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  const indicator = component.locator('[data-discussion-typing]');
  await component.getByRole('button', { name: 'Receive peer typing', exact: true }).click();
  await expect(indicator).toHaveAttribute('role', 'status');
  await expect(indicator).toContainText('Alex and Samira are typing…');
  await component
    .locator('[data-discussion-test-pane]')
    .screenshot({ path: testInfo.outputPath('discussion-typing.png') });
  await expect(indicator).toHaveCount(0, { timeout: 5000 });
  await component.getByRole('button', { name: 'Receive peer typing', exact: true }).click();
  await expect(indicator).toHaveCount(0);
  await component.getByRole('button', { name: 'Renew peer typing', exact: true }).click();
  await expect(indicator).toContainText('Alex and Samira are typing…');
  await component.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(indicator).toHaveCount(0);
});

test('reply and reaction controls use the real discussion saga and preserve message identity', async ({
  mount,
  page,
}) => {
  const component = await mount(DiscussionHost);
  const row = component.locator('[data-discussion-message="message-35"]');
  await expect(row).toBeVisible();
  await row.hover();
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await page.getByRole('menuitem', { name: '👍', exact: true }).click();
  const reaction = row.getByRole('button', { name: '👍, 1 reactions', exact: true });
  await expect(reaction).toHaveAttribute('aria-pressed', 'true');
  await reaction.click();
  await expect(reaction).toHaveCount(0);
  const calls = (await recorded(component)).filter((call) => call.method === 'discussion.react');
  expect(calls.map((call) => call.params)).toEqual([
    { workspaceId: 'discussion-test', messageId: 'message-35', reaction: '👍', active: true },
    { workspaceId: 'discussion-test', messageId: 'message-35', reaction: '👍', active: false },
  ]);
  await row.hover();
  await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await page.getByRole('menuitem', { name: '🙂', exact: true }).click();
  await expect(row.getByRole('button', { name: '🙂, 1 reactions', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    (await recorded(component)).filter((call) => call.method === 'discussion.react').at(-1)?.params,
  ).toEqual({
    workspaceId: 'discussion-test',
    messageId: 'message-35',
    reaction: '🙂',
    active: true,
  });
  await expect(component.locator('[data-discussion-unread]')).toHaveCount(0);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await row.hover();
  await row.getByRole('button', { name: 'Message actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Review note 35: keeping the discussion in view while the team works through the plan.');
  await row.hover();
  await row.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(component.locator('[data-discussion-reply-preview]')).toContainText(
    'Review note 35',
  );
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeFocused();
  await composer.fill('Agreed with this review note');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(component.locator('[data-discussion-reply-to="message-35"]')).toContainText(
    'Review note 35',
  );
  expect(
    (await recorded(component)).find((call) => call.method === 'discussion.send')?.params,
  ).toEqual({
    workspaceId: 'discussion-test',
    messageId: expect.any(String),
    body: 'Agreed with this review note',
    replyToMessageId: 'message-35',
  });
});

test('older daemons keep discussion text usable without unsupported reply or reaction controls', async ({
  mount,
}) => {
  const component = await mount(DiscussionHost, { props: { messageActions: false } });
  await expect(component.locator('[data-discussion-message="message-35"]')).toBeVisible();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  await expect(component.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Add reaction', exact: true })).toHaveCount(0);
});
