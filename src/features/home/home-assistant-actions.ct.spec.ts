import { activateHoverAction, expect, expectMotionToSettle, test } from '../../test/ct-test';
import Harness from './home-assistant-actions-harness.svelte';

type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];

async function openAssistant(mount: (component: typeof Harness) => Promise<any>) {
  const component = await mount(Harness);
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const list = sidebar.getByRole('listbox', { name: 'Assistant thread', exact: true });
  await expect(list.getByRole('option')).toHaveCount(4);
  return { component, sidebar, list };
}

function wireCalls(page: CtPage, method?: string) {
  return page.evaluate(
    (name) => window.__homeAssistantActions!.calls.filter((call) => !name || call.method === name),
    method,
  );
}

test('right-click menu pins, archives, restores and deletes one Assistant chat', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { sidebar, list } = await openAssistant(mount);
  const options = list.getByRole('option');
  await expect(options.nth(3)).toHaveAccessibleName('Assistant conversation 4');

  await options.nth(3).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Pin to top', 'Archive', 'Delete']);
  await testInfo.attach('assistant-chat-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('menu.png') }),
    contentType: 'image/png',
  });
  await menu.getByRole('menuitem', { name: 'Pin to top', exact: true }).click();
  await expect(options.first()).toHaveAccessibleName('Assistant conversation 4');
  expect(await wireCalls(page, 'agent.update')).toEqual([
    {
      method: 'agent.update',
      params: {
        agentId: 'home-assistant-3',
        workspaceId: '__chief__',
        changes: { pinned: true },
      },
    },
  ]);

  await options.first().click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toHaveText('Unpin');
  await page.keyboard.press('Escape');

  const archived = sidebar.getByRole('button', { name: /archived chat/ });
  await expect(archived).toHaveAccessibleName('1 archived chat');
  await options.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect(options).toHaveCount(3);
  await expect(archived).toHaveAccessibleName('2 archived chats');
  expect(await wireCalls(page, 'agent.retire')).toHaveLength(1);

  await archived.click();
  await expect(archived).toHaveAttribute('aria-expanded', 'true');
  const archivedList = sidebar.getByRole('listbox', { name: 'Archived chats', exact: true });
  await expect(archivedList.getByRole('option')).toHaveCount(2);
  await testInfo.attach('assistant-archived-group', {
    body: await page.screenshot({ path: testInfo.outputPath('archived.png') }),
    contentType: 'image/png',
  });
  await archivedList.getByRole('option').first().click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Unarchive', 'Delete']);
  await page.getByRole('menuitem', { name: 'Unarchive', exact: true }).click();
  await expect(options).toHaveCount(4);
  await expect(archivedList.getByRole('option')).toHaveCount(1);
  expect(await wireCalls(page, 'agent.restore')).toHaveLength(1);

  await archivedList.getByRole('option').first().click();
  const header = page.locator('[data-chief-header-row]');
  await expect(header).toContainText('Assistant conversation 5');
  await expect(header.getByRole('button', { name: /^Rename thread/ })).toHaveCount(0);

  await archivedList.getByRole('option').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(archived).toHaveCount(0);
  await expect(page.getByText('Deleted Assistant conversation 5', { exact: true })).toBeVisible();
});

test('hover delete removes a chat with one undo toast', async ({ mount, page }, testInfo) => {
  const { list } = await openAssistant(mount);
  const row = list.getByRole('option', { name: 'Review open pull requests', exact: true });
  const remove = row.getByRole('button', {
    name: 'Delete thread Review open pull requests',
    exact: true,
  });
  await row.hover();
  await expect(remove).toBeVisible();
  await expectMotionToSettle(row);
  await testInfo.attach('assistant-hover-delete', {
    body: await page.screenshot({ path: testInfo.outputPath('hover.png') }),
    contentType: 'image/png',
  });
  await activateHoverAction(remove, list, { requireChange: false });
  await expect(list.getByRole('option')).toHaveCount(3);
  await expect(page.getByText('Deleted Review open pull requests', { exact: true })).toBeVisible();
  expect(await wireCalls(page, 'agent.delete')).toEqual([
    {
      method: 'agent.delete',
      params: { agentId: 'home-assistant-1', workspaceId: '__chief__', undoDelayMs: 15_000 },
    },
  ]);
});

test('Cmd/Ctrl-click keeps the open chat in the selection', async ({ mount }) => {
  const { sidebar, list } = await openAssistant(mount);
  const options = list.getByRole('option');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await options.nth(2).click({ modifiers: ['ControlOrMeta'] });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.getByRole('toolbar', { name: '2 selected', exact: true })).toBeVisible();

  await options.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(sidebar.getByRole('toolbar', { name: '1 selected', exact: true })).toBeVisible();
});

test('Cmd/Ctrl-click on the open chat unselects it', async ({ mount, page }) => {
  const { sidebar, list } = await openAssistant(mount);
  const options = list.getByRole('option');
  await options.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(sidebar.getByRole('toolbar')).toHaveCount(0);

  await options.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.getByRole('toolbar', { name: '1 selected', exact: true })).toBeVisible();

  await options.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(sidebar.getByRole('toolbar')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('Cmd/Ctrl-click leaves an open archived chat out of the selection', async ({ mount }) => {
  const { sidebar, list } = await openAssistant(mount);
  const archived = sidebar.getByRole('button', { name: '1 archived chat', exact: true });
  await archived.click();
  const archivedList = sidebar.getByRole('listbox', { name: 'Archived chats', exact: true });
  await archivedList.getByRole('option').first().click();
  await expect(archivedList.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

  await list.getByRole('option').nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(sidebar.getByRole('toolbar', { name: '1 selected', exact: true })).toBeVisible();
  await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(archivedList.getByRole('option').first()).toHaveAttribute('aria-selected', 'false');
});

test('Cmd/Ctrl-click selects several chats to archive or delete together', async ({
  mount,
  page,
}, testInfo) => {
  const { sidebar, list } = await openAssistant(mount);
  const options = list.getByRole('option');
  await expect(list).toHaveAttribute('aria-multiselectable', 'true');
  await options.nth(1).click();
  await options.nth(2).click({ modifiers: ['ControlOrMeta'] });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
  const toolbar = sidebar.getByRole('toolbar', { name: '2 selected', exact: true });
  await expect(toolbar).toBeVisible();
  await testInfo.attach('assistant-multi-select', {
    body: await page.screenshot({ path: testInfo.outputPath('selected.png') }),
    contentType: 'image/png',
  });

  await options.nth(2).click({ button: 'right' });
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Archive 2 chats',
    'Delete 2 chats',
  ]);
  await page.getByRole('menuitem', { name: 'Delete 2 chats', exact: true }).click();
  await expect(options).toHaveCount(2);
  await expect(toolbar).toHaveCount(0);
  const toast = page.getByText('Deleted 2 chats', { exact: true });
  await expect(toast).toBeVisible();
  await expect(page.getByText(/^Deleted (Review|Find)/)).toHaveCount(0);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(options).toHaveCount(4);
  expect(await wireCalls(page, 'agent.cancelDelete')).toHaveLength(2);

  await options.nth(0).click();
  await options.nth(3).click({ modifiers: ['ControlOrMeta'] });
  await expect(toolbar).toBeVisible();
  await options.nth(3).click({ modifiers: ['ControlOrMeta'] });
  await expect(sidebar.getByRole('toolbar', { name: '1 selected', exact: true })).toBeVisible();
  await options.nth(3).click({ modifiers: ['ControlOrMeta'] });
  await toolbar.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(options).toHaveCount(2);
  await expect(sidebar.getByRole('button', { name: '3 archived chats' })).toBeVisible();
  expect(await wireCalls(page, 'agent.retire')).toHaveLength(2);

  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await options.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(toolbar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar).toHaveCount(0);
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'false');
  await options.nth(1).click();
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(sidebar.getByRole('toolbar')).toHaveCount(0);

  await options.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await toolbar.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: '5 archived chats' })).toBeVisible();
  expect(await wireCalls(page, 'agent.retire')).toHaveLength(4);
});
