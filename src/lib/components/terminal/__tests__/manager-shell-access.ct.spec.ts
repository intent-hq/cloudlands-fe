import { test, expect } from '../../../../test/ct-test';
import ManagerShellAccess from '../manager-shell-access.preview.svelte';

test('Manager sees saved scripts and read-only output, with run and stop but no host controls', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await mount(ManagerShellAccess, { props: { initializeStore: true, inspectHeader: true } });
  const shell = page.getByRole('region', { name: 'Workspace shell' });
  await expect(shell.locator('[data-sidebar-shell-script]')).toHaveCount(2);
  await expect(shell.getByText('Private one-off command')).toHaveCount(0);
  await expect(shell.locator('[data-sidebar-shell-terminal]')).toHaveCount(0);
  await expect(shell.getByText('Terminals', { exact: true })).toHaveCount(0);
  await expect(page.locator('.xterm-screen')).toContainText('Watching for file changes');
  await expect(page.locator('.xterm-helper-textarea')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('textbox')).not.toBeEditable();
  await page.getByRole('button', { name: 'Inspect panel actions' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const service = shell.locator('[data-sidebar-shell-script="manager-saved-service"]');
  await service.getByRole('button', { name: 'Open in...' }).click();
  await expect(page.getByRole('menuitem', { name: 'Show in a panel' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Show in bottom bar' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /edit|delete|add|new terminal/i })).toHaveCount(0);
  await service.locator('[data-script-action="stop"]').click();
  await expect(page.getByTestId('manager-shell-access')).toHaveAttribute(
    'data-operations',
    /"manager-saved-service":\{"action":"stop","pending":true/,
  );
  await shell
    .locator('[data-sidebar-shell-script="manager-saved-command"] [data-script-action="start"]')
    .click();
  await expect(page.getByTestId('manager-shell-access')).toHaveAttribute(
    'data-operations',
    /"manager-saved-command":\{"action":"start","pending":true/,
  );
});

test('idle saved command runs through the actual output panel', async ({ mount, page }) => {
  await mount(ManagerShellAccess, { props: { initializeStore: true, target: 'command' } });
  const output = page.getByRole('region', { name: 'Script output' });
  await expect(output.getByText('pnpm check', { exact: true })).toBeVisible();
  await output.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('manager-shell-access')).toHaveAttribute(
    'data-operations',
    /"manager-saved-command":\{"action":"start","pending":true/,
  );
});

test('downgrading Manager to Participant removes existing output and operation controls', async ({
  mount,
  page,
}) => {
  const component = await mount(ManagerShellAccess, { props: { initializeStore: true } });
  await expect(page.locator('.xterm-screen')).toContainText('Watching for file changes');
  await component.update({ props: { role: 'collaborator' } });
  await expect(page.locator('.xterm-screen')).toHaveCount(0);
  await expect(page.locator('[data-script-action]')).toHaveCount(0);
  await expect(page.locator('[data-sidebar-shell-terminal]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
});

for (const target of ['oneOff', 'terminal'] as const) {
  test(`Manager cannot open retained ${target} output directly`, async ({ mount, page }) => {
    await mount(ManagerShellAccess, { props: { initializeStore: true, target } });
    await expect(page.locator('[data-sidebar-shell-script]')).toHaveCount(2);
    await expect(page.locator('.xterm-screen')).toHaveCount(0);
    await expect(page.getByText('PRIVATE_ONE_OFF_OUTPUT')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Script output' }).getByRole('button'),
    ).toHaveCount(0);
  });
}
