import { test, expect } from '../../../test/ct-test';
import { expectUnpaintedEditControl } from '../../../../playwright/inline-edit-assertions';
import WorkspaceHost from '../workspace/sidebar/__tests__/mocks/WorkspaceProgressCardEditGeometryHost.svelte';
import FileTreeHost from '../file-explorer/__tests__/mocks/VirtualizedFileTreeEditGeometryHost.svelte';
import TerminalHost from '../terminal/__tests__/mocks/TerminalSidebarEditGeometryHost.svelte';
import AgentsHost from '../workspace/__tests__/mocks/WorkspaceAgentsListGeometryHarness.svelte';

test.use({ viewport: { width: 560, height: 640 }, deviceScaleFactor: 2 });

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
    });

    for (const field of ['title', 'status'] as const) {
      test(`workspace ${field} has only one editing surface`, async ({ mount }, testInfo) => {
        const component = await mount(WorkspaceHost);
        const trigger = component.getByRole('button', {
          name: field === 'title' ? 'Geometry workspace' : 'Edit workspace status',
          exact: true,
        });
        await trigger.focus();
        await trigger.press('Enter');
        const control = component.getByRole('textbox');
        await expectUnpaintedEditControl(control);
        const boundary = component.locator(`[data-workspace-${field}-edit-decoration]`);
        await expect(boundary).toHaveCSS('border-top-width', '1px');
        await expect(boundary).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
        await control.press('ArrowRight');
        await component.screenshot({
          path: testInfo.outputPath(`workspace-${field}-${theme}.png`),
        });
        await control.fill('Unsaved change');
        await control.press('Escape');
        await expect(control).toHaveCount(0);
        await expect(trigger).toBeVisible();
      });
    }

    test('file rename has only one editing surface', async ({ mount }, testInfo) => {
      const component = await mount(FileTreeHost, { props: { theme } });
      const row = component.locator('[data-file-path="/project/README.md"]');
      await row.dispatchEvent('dblclick');
      const control = row.getByRole('textbox');
      await expectUnpaintedEditControl(control);
      const boundary = row.locator(':scope > span[aria-hidden="true"]');
      await expect(boundary).toHaveCSS('border-top-width', '1px');
      await expect(boundary).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await control.press('ArrowRight');
      await component.screenshot({ path: testInfo.outputPath(`file-rename-${theme}.png`) });
      await control.fill('unsaved.md');
      await control.press('Escape');
      await expect(control).toHaveCount(0);
      await expect(row).toBeVisible();
    });

    test('script rename has only one editing surface', async ({ mount }, testInfo) => {
      const component = await mount(TerminalHost);
      const row = component.locator('[data-script-id="script-geometry"]');
      await row.locator('[data-slot="list-item"]').dblclick();
      const control = component.locator('[data-edit-script="script-geometry"]');
      await control.click();
      await expectUnpaintedEditControl(control);
      const boundary = component.locator('[data-script-rename-decoration="script-geometry"]');
      await expect(boundary).toHaveCSS('border-top-width', '1px');
      await expect(boundary).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await control.press('ArrowRight');
      await component.screenshot({ path: testInfo.outputPath(`script-rename-${theme}.png`) });
      await control.fill('Unsaved script');
      await control.press('Escape');
      await expect(control).toHaveCount(0);
      await expect(row).toContainText('build geometry');
    });

    test('agent rename stays transparent on hover', async ({ mount, page }, testInfo) => {
      const component = await mount(AgentsHost, { props: { width: 420, zoom: 1 } });
      const row = component.locator('[data-agent-panel-row="coordinator"]');
      await row.click({ button: 'right' });
      await page.getByText('Rename', { exact: true }).click();
      const control = row.getByRole('textbox', { name: 'Rename' });
      await control.click();
      await expectUnpaintedEditControl(control);
      const boundary = control.locator('..').locator(':scope > span[aria-hidden="true"]');
      await expect(boundary).toHaveCSS('border-top-width', '1px');
      await expect(boundary).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
      await control.press('Home');
      await row.screenshot({ path: testInfo.outputPath(`agent-rename-hover-${theme}.png`) });
      await control.fill('Unsaved agent name');
      await control.press('Escape');
      await expect(control).toHaveCount(0);
      await expect(row.getByTestId('agent-card-name')).toHaveText('Coordinator');
    });
  });
}
