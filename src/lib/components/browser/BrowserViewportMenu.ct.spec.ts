import { expect, test } from '../../../test/ct-test';
import BrowserViewportHost from './__tests__/mocks/BrowserViewportHost.svelte';

for (const collapsed of [false, true]) {
  test(`${collapsed ? 'collapsed toolbar' : 'standalone viewport'} transfers keyboard focus to custom form and back`, async ({
    mount,
    page,
  }) => {
    const host = await mount(BrowserViewportHost, { props: { collapsed } });
    const trigger = host.getByTestId(
      collapsed ? 'browser-overflow-trigger' : 'browser-viewport-trigger',
    );
    async function openCustom() {
      await trigger.focus();
      await trigger.press('Enter');
      if (collapsed) {
        const viewport = page.getByRole('menuitem', { name: /Viewport mode/ });
        await viewport.focus();
        await viewport.press('ArrowRight');
      }
      const custom = page.getByRole('menuitem', { name: 'Custom…' });
      await custom.focus();
      await custom.press('Enter');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('spinbutton', { name: 'Width' })).toBeFocused();
    }
    await openCustom();
    await page.getByRole('spinbutton', { name: 'Width' }).fill('1000');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(host).toHaveAttribute('data-changes', '0');
    await openCustom();
    const width = page.getByRole('spinbutton', { name: 'Width' });
    await expect(width).toHaveValue('1280');
    await width.fill('1024');
    await page.getByRole('spinbutton', { name: 'Height' }).fill('768');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(host).toHaveAttribute('data-changes', '1');
    await expect(host).toHaveAttribute(
      'data-viewport',
      JSON.stringify({ mode: 'custom', width: 1024, height: 768 }),
    );
  });
}
