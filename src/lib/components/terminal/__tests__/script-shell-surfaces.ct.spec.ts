import { test, expect } from '../../../../test/ct-test';
import Host from './mocks/ScriptShellSurfacesHost.svelte';

test('large script inventory opens and retains output without a cleanup window', async ({
  mount,
  page,
}, testInfo) => {
  // The 1003-row inventory makes mount and each page-wide role query costly: on a
  // loaded CI runner the whole test took 23-35 s against the 30 s default
  // (merge_group run 40225842342), so scale the budget like other heavy CT specs.
  test.slow();
  await page.setViewportSize({ width: 1100, height: 850 });
  const component = await mount(Host);
  const sidebar = page.getByRole('region', { name: 'Workspace shell' });
  const firstScript = sidebar.locator('[data-sidebar-shell-script="synthetic-0"]');
  await expect(sidebar.locator('[data-sidebar-shell-script]')).toHaveCount(1003);
  await firstScript.getByRole('button', { name: 'Open in...' }).click();
  await page.getByRole('menuitem', { name: 'Show in bottom bar' }).click();
  await expect(page.getByText("printf 'synthetic check 0'", { exact: true })).toBeVisible();
  await expect(
    page.locator('.xterm-screen').filter({ hasText: 'Retained command output' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /History and cleanup/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await component.update({ props: { retireSelected: true } });
  await expect(page.locator('[data-selected-script]')).toHaveAttribute(
    'data-selected-script',
    'synthetic-0',
  );
  await expect(firstScript).toHaveCount(0);
  await expect(
    page.locator('.xterm-screen').filter({ hasText: 'Retained command output' }),
  ).toBeVisible();
  await expect(page.getByText('synthetic-0', { exact: true })).toBeVisible();
  await expect(page.getByText("printf 'synthetic check 0'", { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /History and cleanup/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('script-shell-surfaces.png') });
});
