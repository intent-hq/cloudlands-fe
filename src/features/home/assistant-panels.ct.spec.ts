import { expect, test } from '../../test/ct-test';
import Preview from './assistant-panels.preview.svelte';

test('Assistant links replace content, retain history and keep the chat draft', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const draft = component.getByRole('textbox', { name: 'Message the Assistant' });
  await draft.fill('Keep this draft');
  await testInfo.attach('assistant-before', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open the second plan', exact: true }).click();
  await expect(panel).toContainText('Second plan');
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await page.getByRole('menuitem', { name: /Repository plan/ }).click();
  await expect(panel).toContainText('Plan for the repository');
  await expect(draft).toHaveValue('Keep this draft');
  await testInfo.attach('assistant-after', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await panel.getByRole('button', { name: 'Close active pane' }).click();
  await expect(panel).toContainText('Second plan');
  await panel.getByRole('button', { name: 'Close active pane' }).click();
  await expect(panel).toHaveCount(0);
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect(panel).toContainText('Plan for the repository');
  await expect(draft).toHaveValue('Keep this draft');
});

test('Automatic Assistant opens reuse a panel and handle missing notes and narrow screens', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview);
  await component.getByRole('button', { name: 'Assistant shows a plan' }).click();
  const panel = component.locator('[data-assistant-content-panel]');
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await expect(page.getByRole('menuitem', { name: /Repository plan/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await component.getByRole('link', { name: 'Open workspace plan' }).click();
  await expect(panel).toContainText('A separate plan from another workspace.');
  await component.getByRole('link', { name: 'Open the plan', exact: true }).click();
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open missing note' }).click();
  await expect(panel).toContainText('Plan for the repository');
  await component.getByRole('link', { name: 'Open repository', exact: true }).click();
  await expect(panel.locator('[data-tab-id] webview')).toHaveAttribute(
    'src',
    /github.com\/acme\/studio/,
  );
  await panel.getByTestId('pane-stack-selector-trigger').click();
  await page.getByRole('menuitem', { name: /Repository plan/ }).click();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(component.getByRole('textbox', { name: 'Message the Assistant' })).toBeVisible();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach('assistant-narrow', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
