import { expect, test } from '../../../../../test/ct-test';
import Preview from '../agent-header-icons.preview.svelte';
import { probeHeaderIcons } from './agent-header-icon-probe';

for (const { width, theme } of [
  { width: 620, theme: 'light' },
  { width: 320, theme: 'dark' },
]) {
  test(`keeps panel actions reachable by keyboard at ${width}px in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 650 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await mount(Preview);
    const fixture = page.getByTestId('agent-header-icons-preview');
    const header = fixture.locator('[data-panel-tabless-header]');
    const actions = header.locator('[data-panel-header-actions]');
    const geometry = await actions.evaluate(probeHeaderIcons);
    expect(geometry.map((icon) => icon.id)).toEqual([
      'panel-actions-trigger',
      'panel-close-button',
    ]);
    const bounds = (await header.boundingBox())!;
    for (const icon of geometry) {
      // WCAG 2.2 minimum target size, independent of the chosen visual density.
      expect(icon.target.width).toBeGreaterThanOrEqual(24);
      expect(icon.target.height).toBeGreaterThanOrEqual(24);
      expect(icon.target.x).toBeGreaterThanOrEqual(bounds.x);
      expect(icon.target.x + icon.target.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(icon.target.y).toBeGreaterThanOrEqual(bounds.y);
      expect(icon.target.y + icon.target.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    expect(geometry[0].target.x + geometry[0].target.width).toBeLessThanOrEqual(
      geometry[1].target.x,
    );
    await testInfo.attach('panel-header-targets', {
      body: await header.screenshot(),
      contentType: 'image/png',
    });
    await actions.getByTestId('panel-actions-trigger').focus();
    await expect(actions.getByTestId('panel-actions-trigger')).toBeFocused();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Zoom Panel' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(actions.getByTestId('panel-actions-trigger')).toBeFocused();
    await actions.getByTestId('panel-close-button').focus();
    await page.keyboard.press('Space');
    await expect(fixture).toHaveAttribute('data-close-count', '1');
  });

  test(`panel menu ink matches header with keyboard actions at ${width}px in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await mount(Preview, { props: { menuIcons: true } });
    const fixture = page.getByTestId('agent-header-icons-preview');
    const header = fixture.locator('[data-panel-tabless-header]');
    const trigger = header.getByTestId('panel-actions-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('[data-slot="menu-content"]');
    await expect(menu).toBeVisible();
    const font = menu.getByRole('menuitemradio', { name: 'Mono' });
    await font.click();
    await expect(font).toHaveAttribute('aria-checked', 'true');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Move panel up', exact: true })).toBeDisabled();
    await expect(
      menu.getByRole('menuitem', { name: 'Move panel down', exact: true }),
    ).toBeDisabled();
    await testInfo.attach('panel-menu', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    for (const [name, action] of [
      ['Copy conversation', 'copy'],
      ['Zoom Panel', 'zoom'],
      ['Delete agent', 'delete'],
    ]) {
      await trigger.click();
      await menu.getByRole('menuitem', { name, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(fixture).toHaveAttribute('data-menu-action', action);
      await expect(menu).toBeHidden();
    }
  });
}
