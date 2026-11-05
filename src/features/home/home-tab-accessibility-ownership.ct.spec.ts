import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';
import LifecycleHarness from './home-ownership-lifecycle-harness.svelte';

test('Home departure hides its tabs and reentry restores keyboard navigation', async ({
  mount,
}) => {
  const component = await mount(LifecycleHarness);
  const toggle = component.getByRole('button', { name: 'Toggle Home', exact: true });
  const tabs = component.locator('.home-tabs');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await toggle.click();
  await expect(tabs.getByRole('tab')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(toggle).toBeFocused();
  await tabs.getByRole('tab', { name: 'Pull requests', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Pull requests', exact: true })).toBeFocused();
  await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(1);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`Home exposes one active tab set when switching destinations (${reducedMotion})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const component = await mount(Preview);
    const tabs = component.locator('.home-tabs');
    const assertTabs = async (name: string) => {
      await expect(tabs.getByRole('tab')).toHaveCount(3);
      for (const title of ['Workspaces', 'Pull requests', 'Linear issues']) {
        await expect(tabs.getByRole('tab', { name: new RegExp(`^${title}`) })).toHaveCount(1);
      }
      await expect(tabs.getByRole('tab', { selected: true })).toHaveCount(1);
      const selected = tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(selected).toHaveAttribute('tabindex', '0');
      expect(
        await tabs
          .getByRole('tab')
          .evaluateAll(
            (nodes) => nodes.filter((node) => node.getAttribute('tabindex') === '0').length,
          ),
      ).toBe(1);
    };

    for (const [name, view] of [
      ['Pull requests', 'prs'],
      ['Workspaces', 'workspaces'],
      ['Pull requests', 'prs'],
      ['Linear issues', 'linear'],
      ['Workspaces', 'workspaces'],
    ]) {
      await tabs.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
      await expect(component.locator(`[data-home-view="${view}"]`)).toBeVisible();
      await assertTabs(name);
      await expect(tabs.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeFocused();
    }
    await page.keyboard.press('ArrowRight');
    await assertTabs('Pull requests');
    await expect(tabs.getByRole('tab', { name: /^Pull requests/ })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await assertTabs('Workspaces');
    await expect(tabs.getByRole('tab', { name: /^Workspaces/ })).toBeFocused();

    const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
    const assistant = sidebar.getByRole('tab', { name: 'Assistant', exact: true });
    const workspaces = sidebar.getByRole('tab', { name: 'Workspaces', exact: true });
    await assistant.click();
    await expect(component.locator('[data-home-destination="assistant"]')).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(0);
    await expect(assistant).toBeFocused();
    await workspaces.click();
    await expect(component.locator('[data-home-destination="assistant"]')).toBeHidden();
    await assertTabs('Workspaces');
    await expect(workspaces).toBeFocused();
    await testInfo.attach('home-ownership-settled', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
