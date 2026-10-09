import { test, expect } from '../../../../test/ct-test';
import Preview from '../script-deletion.preview.svelte';

for (const surface of ['header', 'panel'] as const) {
  test(`${surface} deletion supports keyboard confirmation and cancellation`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 850 });
    await mount(Preview);
    const trigger =
      surface === 'header'
        ? page.getByRole('button', { name: 'Delete script', exact: true })
        : page.getByRole('button', { name: 'Script panel actions' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    if (surface === 'panel') {
      await page.getByRole('menuitem', { name: 'Delete script' }).focus();
      await page.keyboard.press('Enter');
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Project check');
    await page.screenshot({ path: testInfo.outputPath(`${surface}-confirmation.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Delete requests: 0')).toBeVisible();
    if (surface === 'header') await expect(trigger).toBeFocused();
    await trigger.click();
    if (surface === 'panel') await page.getByRole('menuitem', { name: 'Delete script' }).click();
    await dialog.getByRole('button', { name: 'Delete script', exact: true }).click();
    await expect(page.getByText('Delete requests: 1')).toBeVisible();
    await expect(page.getByText('Selected script: none')).toBeVisible();
    await expect(page.getByText('Open script tabs: 0')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${surface}-deleted.png`) });
  });
}

test('dialog rechecks a script started while confirmation was open', async ({ mount, page }) => {
  const component = await mount(Preview);
  await page.getByRole('button', { name: 'Delete script', exact: true }).click();
  await component.update({ props: { status: 'running' } });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete script' }).click();
  await expect(page.getByText('Delete requests: 0')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete script', exact: true })).toBeDisabled();
});

test('delete errors remain visible and preserve selected content', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Preview, { props: { failDeletion: true } });
  await page.getByRole('button', { name: 'Delete script', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete script' }).click();
  await expect(page.getByText('Preview deletion failed')).toBeVisible();
  await expect(page.getByText('Selected script: preview-check')).toBeVisible();
  await expect(page.getByText('Open script tabs: 1')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('deletion-error.png') });
});

test('a deferred rename disables deletion in both surfaces until the write settles', async ({
  mount,
  page,
}) => {
  const component = await mount(Preview, { props: { deferEdits: true } });
  await page.getByTitle('Click to rename script', { exact: true }).click();
  const input = page.locator('[data-edit-script-header-name]');
  await input.fill('Renamed check');
  await input.press('Tab');
  await expect(page.getByRole('button', { name: 'Delete script', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Script panel actions' }).click();
  await expect(page.getByRole('menuitem', { name: /Delete script/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await component.update({ props: { deferEdits: false } });
  await expect(page.getByRole('menuitem', { name: /Delete script/ })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.getByRole('menuitem', { name: 'Delete script', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete script', exact: true })
    .click();
  await expect(page.getByText('Delete requests: 1')).toBeVisible();
  await expect(page.getByText('Selected script: none')).toBeVisible();
});
