import { expect, test } from '../../../test/ct-test';
import DiscussionHost from './__tests__/DiscussionHost.svelte';

async function recorded(component: import('@playwright/test').Locator) {
  return JSON.parse(
    (await component.locator('[data-discussion-requests]').textContent()) || '[]',
  ) as Array<{ method: string; params: Record<string, unknown> }>;
}

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
  expect(
    await composer.evaluate(
      (el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
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

test('Enter uses the current input before the rendered draft catches up', async ({
  mount,
}, testInfo) => {
  const component = await mount(DiscussionHost);
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('🌎'.repeat(4097));
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(composer).toHaveAttribute('aria-invalid', 'true');
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

test('older messages preserve the reading anchor, draft and focus; live arrivals do not pull the reader down', async ({
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
  const anchor = component.locator('[data-discussion-message="message-11"]');
  const top = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await component
    .getByRole('button', { name: 'Finish history' })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(component.locator('[data-discussion-message="message-1"]')).toHaveCount(1);
  // Browsers round scrollTop while message rows can land on half pixels.
  await expect
    .poll(async () =>
      Math.abs((await anchor.evaluate((el) => el.getBoundingClientRect().top)) - top),
    )
    .toBeLessThanOrEqual(1);
  await expect(composer).toHaveValue('Unsent thought');
  await expect(composer).toBeFocused();
  await component
    .getByRole('button', { name: 'Receive live message' })
    .evaluate((el: HTMLButtonElement) => el.click());
  await expect(component.locator('[data-discussion-message="message-100"]')).toHaveCount(1);
  await expect
    .poll(async () =>
      Math.abs((await anchor.evaluate((el) => el.getBoundingClientRect().top)) - top),
    )
    .toBeLessThanOrEqual(1);
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
    .poll(async () =>
      (await recorded(component)).filter((call) => call.method === 'discussion.list').at(-1),
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
  await expect(indicator).toHaveText('Alex and Samira are typing…');
  const line = await indicator.boundingBox();
  const input = await component
    .getByRole('textbox', { name: 'Message', exact: true })
    .boundingBox();
  const pane = await component.locator('[data-discussion-test-pane]').boundingBox();
  expect(line && input && pane).toBeTruthy();
  expect(line!.x).toBeGreaterThanOrEqual(pane!.x);
  expect(line!.x + line!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
  expect(line!.y + line!.height).toBeLessThanOrEqual(input!.y);
  expect(input!.x + input!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
  expect(input!.y + input!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
  await component
    .locator('[data-discussion-test-pane]')
    .screenshot({ path: testInfo.outputPath('discussion-typing.png') });
  await expect(indicator).toBeEmpty({ timeout: 5000 });
  await component.getByRole('button', { name: 'Receive peer typing', exact: true }).click();
  await expect(indicator).toBeEmpty();
  await component.getByRole('button', { name: 'Renew peer typing', exact: true }).click();
  await expect(indicator).toHaveText('Alex and Samira are typing…');
  await component.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(indicator).toBeEmpty();
});
