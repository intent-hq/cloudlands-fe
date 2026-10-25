import { expect, test } from '../../../../../test/ct-test';
import PanelHeaderIdentityHost from './mocks/PanelHeaderIdentityHost.svelte';

for (const identityType of ['agent', 'note', 'file', 'terminal', 'browser', 'settings'] as const) {
  test(`keeps the ${identityType} selector reachable without overlapping actions at narrow zoom`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelHeaderIdentityHost, {
      props: { identityType, width: 240, height: 320, zoom: 2 },
    });
    const header = component.locator('[data-panel-content-header]');
    const geometry = await header.evaluate((node) => {
      const header = node.getBoundingClientRect();
      const selector = node
        .querySelector('[data-pane-stack-selector-trigger]')!
        .getBoundingClientRect();
      const actions = node.querySelector('[data-panel-header-actions]')!.getBoundingClientRect();
      return {
        contained: selector.left >= header.left && actions.right <= header.right,
        noOverlap: selector.right <= actions.left,
        usable: selector.width > 0 && selector.height > 0,
      };
    });
    expect(geometry).toEqual({ contained: true, noOverlap: true, usable: true });
    const selector = header.getByTestId('pane-stack-selector-trigger');
    await selector.press('Enter');
    const menu = page.getByRole('menu', { name: 'Panes in this stack' });
    await expect(menu.locator('[data-pane-stack-item]')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(selector).toBeFocused();
    await testInfo.attach('header-identity', {
      body: await header.screenshot(),
      contentType: 'image/png',
    });
  });
}
