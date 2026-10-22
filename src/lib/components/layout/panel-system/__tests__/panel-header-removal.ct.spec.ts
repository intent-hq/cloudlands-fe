import { expect, test } from '../../../../../test/ct-test';
import PanelWorkspaceColumnClipHarness from './mocks/PanelWorkspaceColumnClipHarness.svelte';

test('removing a hovered panel header leaves the remaining controls usable', async ({
  mount,
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const component = await mount(PanelWorkspaceColumnClipHarness, {
    props: { panelTypes: ['terminal', 'terminal'], sidebarWidth: 0, canvasWidth: 720 },
  });
  const first = component.locator('[data-panel-id="p1"]');
  const title = first.getByTestId('pane-stack-selector-trigger');
  await title.focus();
  await title.hover();
  // Keep the pointer on the outgoing header while the real reducer removes it.
  await component
    .getByTestId('close-first-panel')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(first).toHaveCount(0);
  const survivor = component.locator('[data-panel-id="p2"] [data-panel-tabless-header]');
  await survivor.getByTestId('panel-actions-trigger').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(survivor.getByTestId('panel-actions-trigger')).toBeFocused();
  expect(errors).toEqual([]);
  await survivor.screenshot({ path: testInfo.outputPath('surviving-panel-header.png') });
});
