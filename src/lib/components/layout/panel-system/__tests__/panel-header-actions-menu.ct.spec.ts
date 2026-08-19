import { expect, test } from '@playwright/experimental-ct-svelte';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
import PanelHeaderActionsHost from './mocks/PanelHeaderActionsHost.svelte';

const panelTypes: PanelTabType[] = ['agent', 'note', 'browser', 'terminal', 'changes'];

for (const [index, panelType] of panelTypes.entries()) {
  test(`keeps the ${panelType} panel menu portalled and operable at narrow 200% zoom`, async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType, width: 240, zoom: 2 },
    });
    const trigger = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
    );
    const close = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-close-button"]',
    );
    const actions = component.locator('[data-panel-tabless-header] [data-panel-header-actions]');
    const key = index % 2 === 0 ? 'Enter' : 'Space';

    const actionGeometry = await actions.evaluate((node) => {
      const trigger = node.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!;
      const close = node.querySelector<HTMLElement>('[data-testid="panel-close-button"]')!;
      const closeGlyph = close.querySelector<SVGElement>('svg')!;
      return {
        gap: getComputedStyle(node).columnGap,
        trigger: [getComputedStyle(trigger).width, getComputedStyle(trigger).height],
        close: [getComputedStyle(close).width, getComputedStyle(close).height],
        closeGlyph: [getComputedStyle(closeGlyph).width, getComputedStyle(closeGlyph).height],
      };
    });
    expect(actionGeometry.gap).toBe('0px');
    expect(actionGeometry.trigger).toEqual(['28px', '28px']);
    expect(actionGeometry.close).toEqual(['28px', '28px']);
    expect(actionGeometry.closeGlyph).toEqual(['14px', '14px']);

    await trigger.focus();
    await page.keyboard.press(key);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCount(1);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      await menu.evaluate((node) =>
        document.querySelector('[data-testid="panel-actions-host"]')!.contains(node),
      ),
    ).toBe(false);

    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(
      await page.evaluate(() => innerHeight),
    );
    expect(menuBox!.x).toBeLessThan(triggerBox!.x + triggerBox!.width);

    await page.getByRole('menuitem', { name: 'Content display action' }).click();
    await expect(component).toHaveAttribute('data-display-count', '1');
    await expect(menu).toBeHidden();

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Content command action' }).click();
    await expect(component).toHaveAttribute('data-content-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: /Zoom Panel/i }).click();
    await expect(component).toHaveAttribute('data-zoom-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: /Split right/i }).click();
    await expect(component).toHaveAttribute('data-split-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    await expect(component).toHaveAttribute('data-move-left-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move right' }).click();
    await expect(component).toHaveAttribute('data-move-right-count', '1');

    await trigger.click();
    await expect(page.getByRole('menuitem', { name: /Split down/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.mouse.click(1100, 700);
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await close.click();
    await expect(component).toHaveAttribute('data-close-count', '1');
  });
}
