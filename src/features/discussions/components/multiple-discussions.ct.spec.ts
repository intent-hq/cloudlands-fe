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
  const planning = '0199e991-0000-7000-8000-000000000001';
  const design = '0199e991-0000-7000-8000-000000000002';
  const planningRow = component.locator(`[data-workspace-discussion-open="${planning}"]`);
  const unread = planningRow.locator('[data-discussion-unread-badge]');
  await planningRow.click();
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).toBeEditable();
  expect(await calls(component)).toContainEqual({
    method: 'discussion.list',
    params: { workspaceId: 'people-tile-preview', conversationId: planning, limit: 50 },
  });
  await component.locator(`[data-workspace-discussion-open="${design}"]`).click();
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Design');
  await component
    .getByRole('button', { name: 'Receive own Planning message', exact: true })
    .click();
  await expect(unread).toHaveCount(0);
  await component.getByRole('button', { name: 'Receive Planning message', exact: true }).click();
  await expect(unread).toContainText('1');
  await component.getByRole('button', { name: 'Toggle pane focus' }).click();
  await component.getByTestId('pane-stack-selector-trigger').press('Enter');
  const menu = page.locator('[data-pane-stack-menu]');
  const planningItem = menu.getByRole('menuitem', { name: /Planning.*1/ });
  await expect(planningItem.locator('[data-discussion-unread-badge]')).toBeVisible();
  const screenshot = testInfo.outputPath('discussion-unread-navigation.png');
  const frame = await component.locator('[data-multiple-discussion-host]').boundingBox();
  await page.screenshot({ path: screenshot, clip: frame! });
  await testInfo.attach('Unread discussion navigation', {
    path: screenshot,
    contentType: 'image/png',
  });
  await planningItem.press('Enter');
  await expect(component.getByRole('log')).toContainText('A new discussion update.');
  await expect(unread).toContainText('1');
  await component.getByRole('button', { name: 'Toggle pane focus' }).click();
  await expect(unread).toHaveCount(0);

  await component.locator(`[data-workspace-discussion-open="${design}"]`).click();
  await component.getByRole('button', { name: 'Receive Planning message', exact: true }).click();
  await expect(unread).toContainText('1');
  const sidebarOption = planningRow.locator('..');
  await sidebarOption.focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Planning');
  await expect(unread).toHaveCount(0);
});

test('People plus retains a local composer, creates an everyone discussion on first send, and reopens its history', async ({
  mount,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const plus = component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]');
  await plus.click();
  await expect(component.getByRole('combobox', { name: 'Discussion recipients' })).toHaveCount(0);
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
  const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toEqual([
    {
      method: 'discussion.send',
      params: {
        workspaceId: 'people-tile-preview',
        messageId: expect.any(String),
        createConversation: true,
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

test('narrow everyone composer sends with the keyboard without selecting recipients', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const component = await mount(NewDiscussionPreview, { props: { narrow: true } });
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('A message for everyone');
  await composer.press('Enter');
  await expect(component.getByRole('log')).toContainText('A message for everyone');
  await expect(composer).toHaveValue('');
  await expect(composer).toBeFocused();
});

test('switching between two saved discussions preserves independent drafts and send targets', async ({
  mount,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const planning = '0199e991-0000-7000-8000-000000000001';
  const design = '0199e991-0000-7000-8000-000000000002';
  await component.locator(`[data-workspace-discussion-open="${planning}"]`).click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEditable();
  await composer.fill('Planning draft');
  await component.locator(`[data-workspace-discussion-open="${design}"]`).click();
  await expect(composer).toHaveValue('');
  await composer.fill('Design draft');
  await component.locator(`[data-workspace-discussion-open="${planning}"]`).click();
  await expect(composer).toHaveValue('Planning draft');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await component.locator(`[data-workspace-discussion-open="${design}"]`).click();
  await expect(composer).toHaveValue('Design draft');
  await expect(component.getByRole('log')).not.toContainText('Planning draft');
  const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
  expect(sends).toEqual([
    {
      method: 'discussion.send',
      params: {
        workspaceId: 'people-tile-preview',
        conversationId: planning,
        messageId: expect.any(String),
        body: 'Planning draft',
      },
    },
  ]);
  expect((await panel(component)).tabs).toHaveLength(2);
});

test('failed first send retries the same everyone discussion while retaining a newer draft', async ({
  mount,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { failSend: true } });
  await component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]').click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First message');
  await composer.press('Enter');
  await expect(component.getByRole('alert')).toBeVisible();
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
  expect(sends[1].params.createConversation).toBe(true);
  expect(sends[1].params).not.toHaveProperty('recipientPrincipalIds');
});

test('first-send completion promotes a closed composer before a fresh discussion starts', async ({
  mount,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { deferSend: true } });
  const plus = component.locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]');
  await plus.click();
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
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText(
    'New discussion',
  );
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
  test(`a ${rejection} first send preserves the draft and allows another submission`, async ({
    mount,
  }) => {
    const component = await mount(MultipleDiscussionHost, { props: { rejectSend: rejection } });
    await component
      .locator('[data-sidebar-card-tab="people"] [data-sidebar-action="plus"]')
      .click();
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep my message');
    await composer.press('Enter');
    await expect(component.getByRole('alert')).toBeVisible();
    await expect(composer).toHaveValue('Keep my message');
    await component.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer).toHaveValue('');
    await expect(component.getByRole('log')).toContainText('Keep my message');
    const sends = (await calls(component)).filter((call) => call.method === 'discussion.send');
    expect(sends).toHaveLength(2);
    expect(sends[1].params.createConversation).toBe(true);
    expect(sends[1].params).not.toHaveProperty('recipientPrincipalIds');
    expect(sends[1].params.messageId).not.toBe(sends[0].params.messageId);
  });
}

test('discussion panes use the shared switcher and keep New discussion and Refresh in panel actions', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const planning = '0199e991-0000-7000-8000-000000000001';
  const design = '0199e991-0000-7000-8000-000000000002';
  await component.locator(`[data-workspace-discussion-open="${planning}"]`).click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Planning draft');
  await component.locator(`[data-workspace-discussion-open="${design}"]`).click();
  const selector = component.getByTestId('pane-stack-selector-trigger');
  // Opening Design autofocuses its composer; let that land before pressing Enter on
  // the selector, or the composer can take focus between press()'s focus and keydown.
  await expect(selector).toContainText('Design');
  await expect(composer).toBeFocused();
  await selector.press('Enter');
  const menu = page.locator('[data-pane-stack-menu]');
  await expect(menu.getByRole('menuitem', { name: 'Design', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('menuitem', { name: 'New discussion', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Planning', exact: true }).press('Enter');
  await expect(menu).toBeHidden();
  await expect(selector).toContainText('Planning');
  await expect(composer).toHaveValue('Planning draft');
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
  await expect(composer).toHaveValue('');
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await expect(component.getByRole('combobox', { name: 'Discussion recipients' })).toHaveCount(0);
  await selector.click();
  await expect(menu.getByRole('menuitem', { name: 'New discussion', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Planning', exact: true }).click();
  await expect(selector).toContainText('Planning');
  await expect(composer).toHaveValue('Planning draft');
});

for (const role of ['owner', 'manager'] as const) {
  test(`${role} renames a discussion through the keyboard and navigation follows the saved name`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(MultipleDiscussionHost, { props: { role } });
    const conversationId = '0199e991-0000-7000-8000-000000000001';
    const row = component.locator(`[data-workspace-discussion-open="${conversationId}"]`);
    await row.click();
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Keep my draft while renaming');
    const actions = component.getByTestId('panel-actions-trigger').filter({ visible: true });
    await actions.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'Delete discussion', exact: true }),
    ).toHaveCount(role === 'owner' ? 1 : 0);
    await page.getByRole('menuitem', { name: 'Rename discussion', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Rename discussion', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Discussion name', exact: true });
    await expect(name).toBeFocused();
    await name.fill('');
    await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
    await name.fill('Release planning');
    await name.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Release planning');
    await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText(
      'Release planning',
    );
    await expect(composer).toHaveValue('Keep my draft while renaming');
    if (role === 'owner') {
      const screenshot = testInfo.outputPath('renamed-workspace-discussion.png');
      await component.locator('[data-multiple-discussion-host]').screenshot({ path: screenshot });
      await testInfo.attach('Renamed workspace discussion', {
        path: screenshot,
        contentType: 'image/png',
      });
    }
    expect((await calls(component)).filter((call) => call.method === 'discussion.rename')).toEqual([
      {
        method: 'discussion.rename',
        params: { workspaceId: 'people-tile-preview', conversationId, name: 'Release planning' },
      },
    ]);
  });
}

test('a collaborator can send but cannot rename or delete a discussion', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { role: 'collaborator' } });
  await component
    .locator('[data-workspace-discussion-open="0199e991-0000-7000-8000-000000000001"]')
    .click();
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('A collaborator update');
  await composer.press('Enter');
  await expect(component.getByRole('log')).toContainText('A collaborator update');
  await component.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Rename discussion', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('menuitem', { name: 'Delete discussion', exact: true })).toHaveCount(
    0,
  );
});

test('owner cancels rename and delete without requests, then deletes the selected discussion', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost);
  const conversationId = '0199e991-0000-7000-8000-000000000001';
  const row = component.locator(`[data-workspace-discussion-open="${conversationId}"]`);
  await component
    .locator('[data-workspace-discussion-open="0199e991-0000-7000-8000-000000000002"]')
    .click();
  await row.click();
  await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Planning');
  await component.getByRole('button', { name: 'Close active pane' }).click();
  await revealPeople(component);
  await row.click();
  const closedBeforeDelete = JSON.parse(
    (await component.locator('[data-discussion-closed]').textContent()) || '[]',
  ) as Array<{ tab: { data: { conversationId: string } } }>;
  expect(closedBeforeDelete.some((entry) => entry.tab.data.conversationId === conversationId)).toBe(
    true,
  );
  const actions = component.getByTestId('panel-actions-trigger').filter({ visible: true });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Rename discussion', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename discussion', exact: true });
  await rename.getByRole('textbox').fill('Discard this name');
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(actions).toBeFocused();
  expect((await calls(component)).filter((call) => call.method === 'discussion.rename')).toEqual(
    [],
  );
  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete discussion', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete discussion', exact: true });
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(row).toBeVisible();
  expect((await calls(component)).filter((call) => call.method === 'discussion.delete')).toEqual(
    [],
  );
  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete discussion', exact: true }).click();
  await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () =>
      (await panel(component)).tabs.some((tab) => tab.data.conversationId === conversationId),
    )
    .toBe(false);
  const closed = JSON.parse(
    (await component.locator('[data-discussion-closed]').textContent()) || '[]',
  ) as Array<{ tab: { data: { conversationId: string } } }>;
  expect(closed.some((entry) => entry.tab.data.conversationId === conversationId)).toBe(false);
  expect((await calls(component)).filter((call) => call.method === 'discussion.delete')).toEqual([
    { method: 'discussion.delete', params: { workspaceId: 'people-tile-preview', conversationId } },
  ]);
});

for (const operation of ['rename', 'delete'] as const) {
  test(`failed ${operation} keeps the discussion and draft available`, async ({ mount, page }) => {
    const component = await mount(MultipleDiscussionHost, {
      props: { failRename: operation === 'rename', failDelete: operation === 'delete' },
    });
    const conversationId = '0199e991-0000-7000-8000-000000000001';
    const row = component.locator(`[data-workspace-discussion-open="${conversationId}"]`);
    await row.click();
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Still working on this');
    await component.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
    const label = operation === 'rename' ? 'Rename' : 'Delete';
    await page.getByRole('menuitem', { name: `${label} discussion`, exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: `${label} discussion`,
      exact: true,
    });
    if (operation === 'rename') await dialog.getByRole('textbox').fill('Failed new name');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await expect
      .poll(
        async () =>
          (await calls(component)).filter((call) => call.method === `discussion.${operation}`)
            .length,
      )
      .toBe(1);
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Planning');
    await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText('Planning');
    await expect(composer).toHaveValue('Still working on this');
    await composer.press('Enter');
    await expect(component.getByRole('log')).toContainText('Still working on this');
  });
}

for (const conversationId of ['default', '0199e991-0000-7000-8000-000000000001']) {
  test(`deleting ${conversationId === 'default' ? 'the primary' : 'a named'} discussion ignores a late send acknowledgement`, async ({
    mount,
    page,
  }) => {
    const component = await mount(MultipleDiscussionHost, { props: { deferSend: true } });
    const row = component.locator(`[data-workspace-discussion-open="${conversationId}"]`);
    await component
      .locator('[data-workspace-discussion-open="0199e991-0000-7000-8000-000000000002"]')
      .click();
    await row.click();
    const composer = component.getByRole('textbox', { name: 'Message', exact: true });
    await expect(component.getByTestId('pane-stack-selector-trigger')).toContainText(
      conversationId === 'default' ? 'Workspace discussion' : 'Planning',
    );
    await expect(composer).toBeEditable();
    await composer.fill('A send whose acknowledgement arrives late');
    await expect(component.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await composer.press('Enter');
    await expect
      .poll(
        async () =>
          (await calls(component)).filter((call) => call.method === 'discussion.send').length,
      )
      .toBe(1);
    await component.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
    await page.getByRole('menuitem', { name: 'Delete discussion', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete discussion', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await component.getByRole('button', { name: 'Finish sending', exact: true }).click();
    // Refresh through another saved thread after the acknowledgement has been delivered.
    await component
      .locator('[data-workspace-discussion-open="0199e991-0000-7000-8000-000000000002"]')
      .click();
    const actions = component.getByTestId('panel-actions-trigger').filter({ visible: true });
    await actions.click();
    const before = (await calls(component)).filter(
      (call) => call.method === 'discussion.conversations',
    ).length;
    await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await calls(component)).filter((call) => call.method === 'discussion.conversations')
            .length,
      )
      .toBeGreaterThan(before);
    await expect(row).toHaveCount(0);
    expect(
      (await panel(component)).tabs.some((tab) => tab.data.conversationId === conversationId),
    ).toBe(false);
  });
}

test('an original participant can read legacy private history without sending or managing it', async ({
  mount,
  page,
}) => {
  const component = await mount(MultipleDiscussionHost, { props: { legacyHistory: true } });
  await component
    .locator('[data-workspace-discussion-open="0199e991-0000-7000-8000-000000000003"]')
    .click();
  await expect(component.getByRole('log')).toContainText('An earlier private exchange.');
  await expect(component.getByRole('textbox', { name: 'Message', exact: true })).not.toBeEditable();
  await component.getByTestId('panel-actions-trigger').filter({ visible: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Rename discussion', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('menuitem', { name: 'Delete discussion', exact: true })).toHaveCount(
    0,
  );
  expect(
    (await calls(component)).filter((call) =>
      ['discussion.send', 'discussion.rename', 'discussion.delete'].includes(call.method),
    ),
  ).toEqual([]);
});
