import { expect, test } from '../../../test/ct-test';
import MultipleDiscussionHost from './__tests__/MultipleDiscussionHost.svelte';
import NewDiscussionPreview from './new-discussion.preview.svelte';
import type { Locator } from '@playwright/test';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function revealPeople(component: Locator) {
  const card = component.locator('[data-sidebar-card-tab="people"]');
  if (!(await card.isVisible())) {
    await component.getByRole('button', { name: 'People', exact: true }).click();
  }
  await expect(card).toBeVisible();
}

const calls = async (component: Locator) =>
  JSON.parse(
    (await component.locator('[data-discussion-requests]').textContent()) || '[]',
  ) as Array<{ method: string; params: Record<string, unknown> }>;
const panel = async (component: Locator) =>
  JSON.parse((await component.locator('[data-discussion-panel]').textContent()) || '{}') as {
    activeTabId: string;
    tabs: Array<{ id: string; title: string; data: { conversationId: string } }>;
  };

test('unread navigation follows incoming messages and only clears after focused reading', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const component = await mount(MultipleDiscussionHost);
  const alex = '0199e991-0000-7000-8000-000000000001';
  const jordan = '0199e991-0000-7000-8000-000000000002';
  const alexRow = component.locator(`[data-workspace-discussion-open="${alex}"]`);
  const unread = alexRow.locator('[data-discussion-unread-badge]');
  await alexRow.click();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  expect(await calls(component)).toContainEqual({
    method: 'discussion.list',
    params: { workspaceId: 'people-tile-preview', conversationId: alex, limit: 50 },
  });
  await component.locator(`[data-workspace-discussion-open="${jordan}"]`).click();
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Jordan');
  await component.getByRole('button', { name: 'Receive own Alex message', exact: true }).click();
  await expect(unread).toHaveCount(0);
  await component.getByRole('button', { name: 'Receive Alex message', exact: true }).click();
  await expect(unread).toContainText('1');
  await component.getByRole('button', { name: 'Toggle pane focus' }).click();
  await component.getByTestId('pane-stack-selector-trigger').press('Enter');
  const menu = page.locator('[data-pane-stack-menu]');
  const alexItem = menu.getByRole('menuitem', { name: /Alex.*1/ });
  await expect(alexItem.locator('[data-discussion-unread-badge]')).toBeVisible();
  const screenshot = testInfo.outputPath('discussion-unread-navigation.png');
  const frame = await component.locator('[data-multiple-discussion-host]').boundingBox();
  await page.screenshot({ path: screenshot, clip: frame! });
  await testInfo.attach('Unread discussion navigation', {
    path: screenshot,
    contentType: 'image/png',
  });
  await alexItem.press('Enter');
  await expect(component.getByRole('log')).toContainText('A new discussion update.');
  await expect(unread).toContainText('1');
  await component.getByRole('button', { name: 'Toggle pane focus' }).click();
  await expect(unread).toHaveCount(0);

  await component.locator(`[data-workspace-discussion-open="${jordan}"]`).click();
  await component.getByRole('button', { name: 'Receive Alex message', exact: true }).click();
  await expect(unread).toContainText('1');
  const sidebarOption = alexRow.locator('..');
  await sidebarOption.focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Alex');
  await expect(unread).toHaveCount(0);
});

test('People plus retains a local composer, creates a group on first send, and reopens its history', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const plus = component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]');
  await plus.click();
  const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
  await expect(picker).toBeEditable();
  await picker.fill('Alex');
  await page.getByRole('option', { name: /^Alex(?:\s|$)/ }).click();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await expect(picker).toBeFocused();
  await picker.click();
  await expect(page.getByRole('option', { name: /^Alex(?:\s|$)/ })).toHaveCount(0);
  await picker.fill('Jordan');
  await page.getByRole('option', { name: /^Jordan(?:\s|$)/ }).click();
  await picker.press('Escape');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Let’s review the new flow together.');
  expect((await calls(component)).filter((call) => call.method === 'discussion.send')).toHaveLength(
    0,
  );
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await revealPeople(component);
  expect((await calls(component)).filter((call) => call.method === 'discussion.send')).toHaveLength(
    0,
  );
  await plus.click();
  await expect(composer).toHaveValue('Let’s review the new flow together.');
  await expect(component.getByRole('button', { name: 'Remove Alex' })).toBeVisible();
  await expect(component.getByRole('button', { name: 'Remove Jordan' })).toBeVisible();
  await plus.click();
  expect((await panel(component)).tabs).toHaveLength(1);
  const tabId = (await panel(component)).activeTabId;
  await composer.press('Enter');
  await expect(component.locator('[data-discussion-recipients]')).toHaveCount(0);
  await expect(composer).toHaveValue('');
  await expect(component.getByRole('log')).toContainText('Let’s review the new flow together.');
  const after = await panel(component);
  expect(after.activeTabId).toBe(tabId);
  const conversationId = after.tabs[0].data.conversationId;
  expect(conversationId).not.toBe('new');
  expect(after.tabs[0].title).toBe('Alex, Jordan');
  const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toEqual([
    {
      method: 'discussion.send',
      params: {
        workspaceId: 'people-tile-preview',
        messageId: expect.any(String),
        recipientPrincipalIds: ['alex', 'jordan'],
        body: 'Let’s review the new flow together.',
      },
    },
  ]);
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await revealPeople(component);
  await component.locator(`[data-workspace-discussion-open="${conversationId}"]`).click();
  await expect(component.getByRole('log')).toContainText('Let’s review the new flow together.');
  await expect(component.locator('[data-sidebar-card-tab="people"]')).toContainText('Activity');
});

test('narrow recipient entry supports keyboard additions and restores removed people to suggestions', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const component = await mount(NewDiscussionPreview, { props: { narrow: true } });
  const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
  await picker.fill('Alex');
  await expect(page.getByRole('option', { name: 'Alex', exact: true })).toBeVisible();
  await picker.press('Enter');
  await expect(component.getByRole('button', { name: 'Remove Alex' })).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await expect(picker).toBeFocused();
  await picker.click();
  await expect(page.getByRole('option', { name: 'Alex', exact: true })).toHaveCount(0);
  await picker.fill('Jordan');
  await picker.press('Enter');
  await expect(component.getByRole('button', { name: 'Remove Jordan' })).toBeVisible();
  await component.getByRole('button', { name: 'Remove Alex' }).click();
  await picker.fill('Alex');
  await expect(page.getByRole('option', { name: 'Alex', exact: true })).toBeVisible();
  await picker.press('Enter');
  await expect(component.getByRole('button', { name: 'Remove Alex' })).toHaveCount(1);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await component.getByRole('button', { name: 'Remove Jordan' }).click();
  await expect(component.getByRole('button', { name: 'Remove Jordan' })).toHaveCount(0);
});

test('switching between two saved discussions preserves independent drafts and send targets', async ({
  mount,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const alex = '0199e991-0000-7000-8000-000000000001';
  const jordan = '0199e991-0000-7000-8000-000000000002';
  await component.locator(`[data-workspace-discussion-open="${alex}"]`).click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Alex draft');
  await component.locator(`[data-workspace-discussion-open="${jordan}"]`).click();
  await expect(composer).toHaveValue('');
  await composer.fill('Jordan draft');
  await component.locator(`[data-workspace-discussion-open="${alex}"]`).click();
  await expect(composer).toHaveValue('Alex draft');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await component.locator(`[data-workspace-discussion-open="${jordan}"]`).click();
  await expect(composer).toHaveValue('Jordan draft');
  await expect(component.getByRole('log')).not.toContainText('Alex draft');
  const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toEqual([
    {
      method: 'discussion.send',
      params: {
        workspaceId: 'people-tile-preview',
        conversationId: alex,
        messageId: expect.any(String),
        body: 'Alex draft',
      },
    },
  ]);
  expect((await panel(component)).tabs).toHaveLength(2);
});

test('failed first send locks recipients and retry creates the original group while retaining a newer draft', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { failSend: true } });
  await component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]').click();
  const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
  await expect(picker).toBeEditable();
  await picker.fill('Morgan');
  await page.getByRole('option', { name: /^Morgan(?:\s|$)/ }).click();
  await picker.press('Escape');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First message');
  await composer.press('Enter');
  await expect(component.getByRole('alert')).toBeVisible();
  await expect(picker).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await composer.fill('A follow-up thought');
  await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await component
    .locator('[data-discussion-failed]')
    .getByRole('button', { name: 'Retry', exact: true })
    .click();
  await expect(component.locator('[data-discussion-recipients]')).toHaveCount(0);
  await expect(composer).toHaveValue('A follow-up thought');
  await expect(component.getByRole('log')).toContainText('First message');
  const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(sends[1].params.recipientPrincipalIds).toEqual(['morgan']);
});

test('first-send completion promotes a closed composer before a fresh discussion starts', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { deferSend: true } });
  const plus = component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]');
  await plus.click();
  const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
  await expect(picker).toBeEditable();
  await picker.fill('Alex');
  await page.getByRole('option', { name: /^Alex(?:\s|$)/ }).click();
  await picker.press('Escape');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Sent while the pane closes');
  await composer.press('Enter');
  await expect
    .poll(
      async () =>
        (await calls(component)).filter((call) => call.method === 'discussion.send').length,
    )
    .toBe(1);
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await revealPeople(component);
  await expect(composer).toHaveCount(0);
  await component.getByRole('button', { name: 'Finish sending' }).click();
  await revealPeople(component);
  const closed = async () =>
    JSON.parse(
      (await component.locator('[data-discussion-closed]').textContent()) || '[]',
    ) as Array<{ tab: { data: { conversationId: string } } }>;
  await expect.poll(async () => (await closed())[0]?.tab.data.conversationId).not.toBe('new');
  const savedId = (await closed())[0].tab.data.conversationId;
  await plus.click();
  await expect(composer).toHaveValue('');
  await expect(component.locator('[data-discussion-recipients]')).toBeVisible();
  await component.getByRole('button', { name: 'Reopen closed discussion' }).click();
  await expect(component.locator('[data-discussion-recipients]')).toHaveCount(0);
  await expect(component.getByRole('log')).toContainText('Sent while the pane closes');
  const after = await panel(component);
  expect(after.tabs.map((tab) => tab.data.conversationId).sort()).toEqual([savedId, 'new'].sort());
  expect((await calls(component)).filter((call) => call.method === 'discussion.send')).toHaveLength(
    1,
  );
});

for (const rejection of ['invalid', 'forbidden'] as const) {
  test(`a ${rejection} first send displays the error and allows corrected recipients`, async ({
    mount,
    page,
  }) => {
    const component = await mount(MultipleDiscussionHost, { props: { rejectSend: rejection } });
    await component
      .locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]')
      .click();
    const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
    await expect(picker).toBeEditable();
    await picker.fill('Alex');
    await page.getByRole('option', { name: /^Alex(?:\s|$)/ }).click();
    await picker.press('Escape');
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep my message');
    await composer.press('Enter');
    await expect(component.getByRole('alert')).toHaveText(
      'The discussion could not be created. Check the recipients and try again.',
    );
    await expect(composer).toHaveValue('Keep my message');
    await expect(picker).toBeEditable();
    await component.getByRole('button', { name: 'Remove Alex', exact: true }).click();
    await picker.fill('Jordan');
    await page.getByRole('option', { name: /^Jordan(?:\s|$)/ }).click();
    await picker.press('Escape');
    await component.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(component.locator('[data-discussion-recipients]')).toHaveCount(0);
    await expect(composer).toHaveValue('');
    await expect(component.getByRole('log')).toContainText('Keep my message');
    const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
    expect(sends).toHaveLength(2);
    expect(sends[1].params.recipientPrincipalIds).toEqual(['jordan']);
    expect(sends[1].params.messageId).not.toBe(sends[0].params.messageId);
  });
}

test('recipient search finds a login that differs from its display name', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost);
  await component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]').click();
  const picker = component.getByRole('combobox', { name: 'Discussion recipients' });
  await expect(picker).toBeEditable();
  await picker.fill('river-runner');
  const option = page.getByRole('option', { name: /^Alex(?:\s|$)/ });
  await expect(option).toContainText('@river-runner');
  await option.click();
  await picker.press('Escape');
  await expect(component.getByRole('button', { name: 'Remove Alex', exact: true })).toBeVisible();
  const queries = (await calls(component)).filter(
    (call) => call.method === 'discussion.recipients',
  );
  expect(queries.some((call) => call.params.query === 'river-runner')).toBe(true);
});

test('discussion panes use the shared switcher and keep New discussion and Refresh in panel actions', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const alex = '0199e991-0000-7000-8000-000000000001';
  const jordan = '0199e991-0000-7000-8000-000000000002';
  await component.locator(`[data-workspace-discussion-open="${alex}"]`).click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Alex draft');
  await component.locator(`[data-workspace-discussion-open="${jordan}"]`).click();
  const selector = component.getByTestId('pane-stack-selector-trigger');
  await selector.press('Enter');
  const menu = page.locator('[data-pane-stack-menu]');
  await expect(menu.getByRole('menuitem', { name: 'Jordan', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('menuitem', { name: 'New discussion', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Alex', exact: true }).press('Enter');
  await expect(menu).toBeHidden();
  await expect(selector).toContainText('Alex');
  await expect(composer).toHaveValue('Alex draft');
  await selector.press('Enter');
  await menu.evaluate(async (element) => {
    await Promise.allSettled(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
  const actions = component.getByTestId('panel-actions-trigger').filter({ visible: true });
  const before = (await calls(component)).filter(
    (call) => call.method === 'discussion.list',
  ).length;
  await actions.click();
  await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await calls(component)).filter((call) => call.method === 'discussion.list').length,
    )
    .toBeGreaterThan(before);
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole('menuitem', { name: 'New discussion', exact: true }).click();
  await expect(selector).toContainText('New discussion');
  await expect(component.getByRole('combobox', { name: 'Discussion recipients' })).toBeVisible();
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await expect(component.getByRole('combobox', { name: 'Discussion recipients' })).toHaveCount(0);
  await selector.click();
  await expect(menu.getByRole('menuitem', { name: 'New discussion', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Alex', exact: true }).click();
  await expect(selector).toContainText('Alex');
  await expect(composer).toHaveValue('Alex draft');
});
