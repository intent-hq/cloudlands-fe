import { expect, test } from '../../../../../test/ct-test';
import { expectMenuFirstLine } from '../../../../../test/menu-geometry';
import Preview from '../agent-header-icons.preview.svelte';
import { probeHeaderIcons } from './agent-header-icon-probe';
import { isPanelMenuSettled, probePanelMenuIcons } from './panel-menu-icon-probe';

for (const { width, theme } of [
  { width: 620, theme: 'light' },
  { width: 320, theme: 'dark' },
]) {
  test(`panel header ink and keyboard targets at ${width}px in ${theme}`, async ({
    mount,
    page,
  }) => {
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
      'add-panel-column',
      'panel-close-button',
    ]);
    const bounds = (await header.boundingBox())!;
    for (const icon of geometry) {
      expect(icon.target.width).toBe(28);
      expect(icon.target.height).toBe(28);
      expect(icon.target.y).toBe(geometry[0].target.y);
      expect(icon.target.x).toBeGreaterThanOrEqual(bounds.x);
      expect(icon.target.x + icon.target.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(icon.svg).toEqual({ width: 16, height: 16, transform: 'none' });
      expect(Math.abs(icon.painted.dx)).toBeLessThan(0.1);
      expect(Math.abs(icon.painted.dy)).toBeLessThanOrEqual(1.01);
      expect(Math.max(icon.painted.width, icon.painted.height)).toBeGreaterThanOrEqual(10);
      expect(Math.max(icon.painted.width, icon.painted.height)).toBeLessThan(13.1);
      // The product kebab intentionally keeps three filled 3px dots, not an outline stroke.
      expect(icon.strokeWidth).toBeCloseTo(icon.id === 'panel-actions-trigger' ? 3 : 1, 1);
    }
    await actions.getByTestId('panel-actions-trigger').focus();
    await expect(actions.getByTestId('panel-actions-trigger')).toBeFocused();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Zoom Panel' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(actions.getByTestId('panel-actions-trigger')).toBeFocused();
    await actions.locator('[data-add-panel-column]').focus();
    await page.keyboard.press('Enter');
    await expect(fixture).toHaveAttribute('data-column-count', '2');
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
    const headerInk = await header
      .locator('[data-panel-header-actions]')
      .evaluate(probeHeaderIcons);
    const trigger = header.getByTestId('panel-actions-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('[data-slot="menu-content"]');
    await expect(menu).toBeVisible();
    const fontTrigger = menu.getByRole('menuitem', { name: /^Font Style/ });
    await expect(fontTrigger).toBeVisible();
    // Workspace actions load lazily; placement alone does not prove their icons are ready.
    await expect(
      menu.getByRole('menuitem', { name: 'Copy Absolute Path', exact: true }),
    ).toBeVisible();
    // Bits keeps the floating wrapper at translate(0, -200%) until floating-ui has placed
    // it, and autoUpdate may move it again while layout settles (intent-hq/intent#5279).
    // Wait for placement and a still rect, then sample the menu and its children in the
    // same browser turn.
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect.poll(() => menu.evaluate(isPanelMenuSettled)).toBe(true);
    const geometry = await menu.evaluate(probePanelMenuIcons);
    const { icons: ink, bounds: menuBounds } = geometry;
    await testInfo.attach('panel-menu-ink-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await testInfo.attach('panel-menu-ink', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(ink.map((icon) => icon.id).sort()).toEqual([
      'arrow-left',
      'arrow-left',
      'arrow-right',
      'arrow-right',
      'circle-info',
      'copy',
      'copy',
      'expand',
      'font',
      'table-columns',
      'trash',
    ]);
    for (const icon of ink) {
      expect(icon.svg).toEqual({ width: 16, height: 16, transform: 'none' });
      expect(icon.strokeWidth).toBeCloseTo(1, 1);
      expect(icon.strokeWidth).toBeCloseTo(
        headerInk.find((entry) => entry.id === 'add-panel-column')!.strokeWidth!,
        1,
      );
      // Disabled explanations can wrap; preserve the minimum target size.
      expect(icon.target.height).toBeGreaterThanOrEqual(28);
      expect(icon.target.x).toBeGreaterThanOrEqual(menuBounds.x);
      expect(icon.target.x + icon.target.width).toBeLessThanOrEqual(
        menuBounds.x + menuBounds.width,
      );
      expect(icon.menuTransform).toBe('none');
    }
    for (const row of await menu.locator('[data-menu-item]').all()) {
      await expectMenuFirstLine(row, row);
    }
    expect(ink.filter((icon) => icon.disabled)).toHaveLength(3);
    await fontTrigger.focus();
    await page.keyboard.press('ArrowRight');
    const fontMenu = page.getByRole('menu', { name: 'Font Style', exact: true });
    await expect(fontMenu).toBeVisible();
    const font = fontMenu.getByRole('menuitemradio', { name: 'Mono' });
    await font.click();
    await expect(font).toHaveAttribute('aria-checked', 'true');
    await expect(fontMenu).toBeVisible();
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(fontMenu).toBeHidden();
    await expect(fontTrigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    for (const [name, action] of [
      ['Copy conversation', 'copy'],
      ['Zoom Panel', 'zoom'],
      ['Move tab left', 'move-left'],
      ['Create column to right', 'split'],
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
