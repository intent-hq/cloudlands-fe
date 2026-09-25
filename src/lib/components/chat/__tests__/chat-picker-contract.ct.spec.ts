import { expect, test } from '../../../../test/ct-test';
import BrowserTabsPreview from '$lib/component-catalog/browser-tabs-menu.preview.svelte';
import BrowserTabsMenu from '../BrowserTabsMenu.svelte';
import BrowserTabsConfirmationHarness from './mocks/BrowserTabsConfirmationHarness.svelte';
import SimpleRichInputQueueHost from '../input/SimpleRichInputQueueHost.svelte';
import MentionResultsPreview from '../input/mention-results.preview.svelte';

test('browser navigation and close are separate keyboard targets and Escape restores the trigger', async ({
  mount,
  page,
}) => {
  await mount(BrowserTabsPreview, { props: { count: 3, width: 600 } });
  const trigger = page.getByTestId('browser-tabs-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  const chooser = page.getByRole('dialog', { name: '3 browser tabs' });
  await expect(chooser).toBeVisible();
  const rows = chooser.getByTestId('browser-tabs-menu-item');
  await expect(rows.first()).toBeFocused();
  await rows.first().press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await rows.nth(1).press('ArrowRight');
  const close = chooser.getByRole('button', { name: 'Close tab Dashboard' });
  await expect(close).toBeFocused();
  expect(await close.evaluate((node) => node.parentElement?.closest('button'))).toBeNull();
  await close.press('ArrowLeft');
  await expect(rows.nth(1)).toBeFocused();
  await rows.nth(1).press('End');
  await expect(rows.last()).toBeFocused();
  await rows.last().press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('many browser tabs remain bounded and the last reveal, close, and bulk close are keyboard reachable', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 320 });
  await mount(BrowserTabsMenu, {
    props: {
      workspaceId: 'browser-tabs-overflow',
      agentId: 'preview-agent',
      entries: Array.from({ length: 40 }, (_, index) => ({
        tab: {
          id: `overflow-${index}`,
          type: 'browser' as const,
          title: `Tab ${index + 1}`,
          closable: true,
        },
        hidden: true,
        active: false,
      })),
    },
  });
  const trigger = page.getByTestId('browser-tabs-trigger');
  await trigger.click();
  const chooser = page.getByRole('dialog');
  const bounds = await chooser.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  expect(await chooser.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await chooser.getByTestId('browser-tabs-menu-item').first().press('End');
  const last = chooser.getByTestId('browser-tabs-menu-item').last();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await last.press('ArrowRight');
  const close = chooser.getByRole('button', { name: 'Close tab Tab 40' });
  await expect(close).toBeFocused();
  await expect(close).toBeInViewport();
  await close.press('Tab');
  const bulkClose = chooser.getByTestId('browser-tabs-close-hidden');
  await expect(bulkClose).toBeFocused();
  await expect(bulkClose).toBeInViewport();
  await bulkClose.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const dismissal of ['cancel', 'escape', 'confirm'] as const) {
  test(`browser close confirmation restores the chooser trigger after ${dismissal}`, async ({
    mount,
    page,
  }) => {
    await mount(BrowserTabsConfirmationHarness);
    const trigger = page.getByTestId('browser-tabs-trigger');
    await trigger.focus();
    await trigger.press('Enter');
    const chooser = page.getByRole('dialog', { name: '2 browser tabs' });
    const row = chooser.getByTestId('browser-tabs-menu-item').first();
    await expect(row).toBeFocused();
    await row.press('ArrowRight');
    const close = chooser.getByRole('button', { name: 'Close tab first', exact: true });
    await expect(close).toBeFocused();
    await close.press('Enter');
    await expect(chooser).toHaveCount(0);

    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Close tab', exact: true });
    await expect(confirm).toBeFocused();
    if (dismissal === 'escape') await confirm.press('Escape');
    else if (dismissal === 'confirm') await confirm.press('Enter');
    else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(page.getByTestId('browser-tabs-menu-item')).toHaveCount(
      dismissal === 'confirm' ? 1 : 2,
    );
  });
}

test('composer context command keeps its parent menu and Escape returns through each layer', async ({
  mount,
  page,
}) => {
  await mount(SimpleRichInputQueueHost, { props: { queueCount: 0, width: 440 } });
  const trigger = page.getByTestId('prompt-actions-trigger');
  await trigger.click();
  const command = page.getByRole('menuitem', { name: /Add Context/ });
  await command.focus();
  await command.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  const picker = page.getByRole('dialog', { name: /Select context panels/i });
  await expect(picker).toBeVisible();
  await expect(command).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(command).toHaveAttribute('aria-expanded', 'true');
  await expect(picker.getByRole('combobox')).toBeFocused();
  await picker.getByRole('combobox').press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(command).toBeFocused();
  await expect(command).toHaveAttribute('aria-expanded', 'false');
  await command.press('ArrowRight');
  await expect(picker.getByRole('combobox')).toBeFocused();
  await picker.getByRole('combobox').press('Escape');
  await expect(command).toBeFocused();
  await command.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('mention keyboard selection stays editor-owned with a mounted active descendant', async ({
  mount,
  page,
}) => {
  await mount(MentionResultsPreview, { props: { state: 'composer' } });
  const editor = page.getByRole('textbox', { name: 'Mention composer' });
  await editor.fill('@developer');
  const results = page.getByRole('listbox', { name: 'Mention suggestions' });
  await expect(results).toBeVisible();
  await expect(editor).toBeFocused();
  await editor.press('ArrowDown');
  await expect
    .poll(async () => {
      const id = await editor.getAttribute('aria-activedescendant');
      return id ? page.locator(`[id="${id}"]`).getAttribute('aria-selected') : null;
    })
    .toBe('true');
  await editor.press('Enter');
  await expect(results).toHaveCount(0);
  await expect(editor.locator('[data-mention="true"]')).toHaveCount(1);
  await expect(editor).toBeFocused();
});
