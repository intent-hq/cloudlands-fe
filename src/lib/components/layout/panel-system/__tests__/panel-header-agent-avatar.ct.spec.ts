import { expect, test } from '../../../../../test/ct-test';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

test('updates the selector avatar and current pane when switching agents', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(PanelHeaderAvatarHost, {
    props: { activeAgent: 'a', width: 220, zoom: 2, longTitle: true },
  });
  const header = component.locator('[data-panel-header-case="agent"]');
  const selector = header.getByTestId('pane-stack-selector-trigger');
  const avatar = selector.locator('svg[data-agent-avatar]');
  const initialDesign = await avatar.getAttribute('data-avatar-design');
  await component.update({ props: { activeAgent: 'b', width: 220, zoom: 2, longTitle: true } });
  await expect(selector).toContainText('Agent with a deliberately long panel header title B');
  await expect(avatar).not.toHaveAttribute('data-avatar-design', initialDesign!);
  await selector.press('Enter');
  const menu = page.getByRole('menu', { name: 'Panes in this stack' });
  await expect(menu.locator('[data-pane-stack-item="tab-b"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('Escape');
  await expect(selector).toBeFocused();
  await testInfo.attach('active-agent-selector', {
    body: await header.screenshot(),
    contentType: 'image/png',
  });
});
