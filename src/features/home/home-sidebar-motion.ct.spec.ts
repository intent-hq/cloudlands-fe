import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Sidebar keeps filters, drafts, and toggle alignment when switching destinations', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const tabs = sidebar.getByRole('tablist');
  const workspaces = tabs.getByRole('tab', { name: 'Workspaces', exact: true });
  const assistant = tabs.getByRole('tab', { name: 'Assistant', exact: true });
  await sidebar.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await component.getByRole('searchbox').fill('sidebar');
  await assistant.click();
  await expect(sidebar.getByRole('listbox')).toBeVisible();
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await expect
    .poll(async () => {
      const selected = await assistant.boundingBox();
      const indicator = await tabs.locator('[data-tabs-indicator]').boundingBox();
      return Math.abs(indicator!.x - selected!.x);
    })
    .toBeLessThan(1);
  await expect
    .poll(() => page.evaluate(() => window.__homeIntegrationBrowser?.calls ?? []))
    .toContainEqual({
      method: 'drafts.get',
      params: { workspaceId: '__chief__', agentId: 'home-assistant-0' },
    });
  const draft = component.locator('.home-surface [contenteditable="true"]').first();
  await draft.fill('Keep this draft through the animation');
  await workspaces.click();
  await expect(sidebar.getByRole('button', { name: /^All repos/ })).toBeVisible();
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await expect(component.getByRole('searchbox')).toHaveValue('sidebar');
  await expect(component.locator('.workspace-list').getByRole('option')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__homeIntegrationBrowser?.calls ?? []))
    .toContainEqual({
      method: 'drafts.set',
      params: {
        workspaceId: '__chief__',
        agentId: 'home-assistant-0',
        text: 'Keep this draft through the animation',
      },
    });
  await assistant.click();
  await expect(draft).toHaveText('Keep this draft through the animation');
  await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
  await testInfo.attach('sidebar-draft-wire', {
    body: JSON.stringify(
      await page.evaluate(() =>
        (window.__homeIntegrationBrowser?.calls ?? []).filter(({ method }) =>
          method.startsWith('drafts.'),
        ),
      ),
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('sidebar-motion-after', {
    body: await sidebar.screenshot({ path: testInfo.outputPath('sidebar-motion-after.png') }),
    contentType: 'image/png',
  });
});

for (const preference of ['OS', 'battery saver'] as const) {
  test(`Sidebar keeps empty threads usable with ${preference} reduced motion`, async ({
    mount,
    page,
  }, testInfo) => {
    if (preference === 'OS') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
    const component = await mount(Preview, { props: { scenario: 'empty' } });
    const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
    const tabs = sidebar.getByRole('tablist');
    await tabs.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await expect(sidebar.getByRole('status')).toContainText('No Assistant threads');
    await tabs.getByRole('tab', { name: 'Workspaces', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: /^All repos/ })).toBeVisible();
    await expect(sidebar.locator('[data-home-sidebar-exiting]')).toHaveCount(0);
    await testInfo.attach('sidebar-reduced-motion', {
      body: await sidebar.screenshot({ path: testInfo.outputPath('sidebar-reduced-motion.png') }),
      contentType: 'image/png',
    });
  });
}
