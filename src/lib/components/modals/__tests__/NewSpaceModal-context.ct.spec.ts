import { expect, test } from '../../../../test/ct-test';
import SelectedHarness from '../NewSpaceSelectedAuditHarness.svelte';

test('Add context opens a usable search panel in the full New Workspace form', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(SelectedHarness, {
    hooksConfig: {
      mockBackend: { 'drafts.get': null, 'drafts.set': null },
      mockIpc: {
        'system:check-git': { success: true, data: { available: true, version: '2.50.0' } },
        'providers:get-availability': {
          success: true,
          data: {
            hasAnyProvider: true,
            providers: { codex: { available: true, authenticated: true } },
          },
        },
      },
    },
  });
  const dialog = page.getByRole('dialog', { name: 'New Workspace', exact: true });
  const addContext = dialog.getByRole('button', { name: /^Add context/ });
  const search = dialog.getByPlaceholder(/Search/);
  await expect(search).toHaveCount(0);
  await addContext.click();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect
    .poll(() =>
      search.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(hit && element.contains(hit));
      }),
    )
    .toBe(true);
  await search.fill('workspace context');
  await expect(search).toHaveValue('workspace context');
  await dialog.getByRole('button', { name: 'GH PRs', exact: true }).click();
  await search.click();
  await expect(search).toBeFocused();
  await testInfo.attach('new-workspace-add-context-open', {
    body: await page.screenshot({ path: testInfo.outputPath('add-context.png') }),
    contentType: 'image/png',
  });
  await addContext.click();
  await expect(search).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await addContext.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
});
