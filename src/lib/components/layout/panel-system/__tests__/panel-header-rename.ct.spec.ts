import { expect, test } from '../../../../../test/ct-test';
import PanelHeaderRenameHost from './mocks/PanelHeaderRenameHost.svelte';

for (const kind of ['note', 'agent', 'file'] as const) {
  test(`${kind} rename saves and cancels with keyboard focus retained`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelHeaderRenameHost, { props: { kind } });
    const trigger = component
      .locator('[data-panel-tabless-header]')
      .getByTestId('panel-actions-trigger');
    const selector = component.getByTestId('pane-stack-selector-trigger');
    const editor = component.getByRole('textbox');
    const menu = page.locator('[data-slot="menu-content"]');

    await trigger.press('Enter');
    const rename = menu.getByRole('menuitem', { name: 'Rename', exact: true });
    await expect(rename).toBeVisible();
    await rename.focus();
    await rename.press('Enter');
    await expect(menu).toBeHidden();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Original title');
    expect(
      await editor.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual([0, 14]);
    await editor.fill('  Updated title  ');
    await editor.press('Enter');
    await expect(component).toHaveAttribute('data-renamed', 'active:Updated title');
    await expect(component).toHaveAttribute('data-rename-count', '1');
    await expect(selector).toBeFocused();
    await expect(selector).toContainText('Updated title');

    await trigger.click();
    await rename.click();
    await expect(editor).toBeFocused();
    await editor.fill('Discard this');
    await editor.press('Escape');
    await expect(selector).toBeFocused();
    await expect(selector).toContainText('Updated title');
    await expect(component).toHaveAttribute('data-rename-count', '1');

    await trigger.click();
    await rename.click();
    await editor.fill('   ');
    await editor.press('Enter');
    await expect(selector).toBeFocused();
    await expect(component).toHaveAttribute('data-rename-count', '1');
    await expect(component).toHaveAttribute('data-selection-count', '0');
    await expect(component).toHaveAttribute('data-zoom-count', '0');
    await testInfo.attach(`${kind}-rename-complete`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

for (const props of [
  { kind: 'spec' },
  { kind: 'browser' },
  { kind: 'note', canRename: false },
] as const) {
  test(`rename unavailable for ${props.kind} with callback ${!('canRename' in props)}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelHeaderRenameHost, { props });
    await component
      .locator('[data-panel-tabless-header]')
      .getByTestId('panel-actions-trigger')
      .click();
    await expect(page.locator('[data-slot="menu-content"]')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(0);
  });
}
