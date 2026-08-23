import { expect, test } from '@playwright/experimental-ct-svelte';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
import PanelHeaderActionsHost from './mocks/PanelHeaderActionsHost.svelte';

const panelTypes: PanelTabType[] = ['agent', 'note', 'browser', 'terminal', 'changes'];
const stackCounts = [2, 4, 5] as const;

for (const [index, panelType] of panelTypes.entries()) {
  test(`keeps the ${panelType} panel menu portalled and operable at narrow 200% zoom`, async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType, width: 240, zoom: 2, stackCount: stackCounts[index % 3] },
    });
    const trigger = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
    );
    const close = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-close-button"]',
    );
    const actions = component.locator('[data-panel-tabless-header] [data-panel-header-actions]');
    const stack = component.locator('[data-panel-tabless-header] [data-pane-stack]');
    const key = index % 2 === 0 ? 'Enter' : 'Space';

    const actionGeometry = await actions.evaluate((node) => {
      const trigger = node.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!;
      const close = node.querySelector<HTMLElement>('[data-testid="panel-close-button"]')!;
      const closeGlyph = close.querySelector<SVGElement>('svg')!;
      return {
        borderBottomWidth: getComputedStyle(node.closest('[data-panel-tabless-header]')!)
          .borderBottomWidth,
        gap: getComputedStyle(node).columnGap,
        trigger: [getComputedStyle(trigger).width, getComputedStyle(trigger).height],
        close: [getComputedStyle(close).width, getComputedStyle(close).height],
        closeGlyph: [getComputedStyle(closeGlyph).width, getComputedStyle(closeGlyph).height],
      };
    });
    expect(actionGeometry.borderBottomWidth).toBe('0px');
    expect(actionGeometry.gap).toBe('0px');
    expect(actionGeometry.trigger).toEqual(['28px', '28px']);
    expect(actionGeometry.close).toEqual(['28px', '28px']);
    expect(actionGeometry.closeGlyph).toEqual(['14px', '14px']);

    const stackBox = await stack.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(stackBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(stackBox!.x + stackBox!.width).toBeLessThanOrEqual(actionsBox!.x + 0.5);

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
    await page.getByRole('menuitem', { name: /Create column to right/i }).click();
    await expect(component).toHaveAttribute('data-split-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move left' }).click();
    await expect(component).toHaveAttribute('data-move-left-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move right' }).click();
    await expect(component).toHaveAttribute('data-move-right-count', '1');

    await trigger.click();
    await expect(page.getByRole('menuitem', { name: /Split down/i })).toHaveCount(0);
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

for (const stackCount of stackCounts) {
  test(`preserves required controls for ${stackCount} panes at narrow 200% zoom`, async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'note', width: 240, zoom: 2, stackCount },
    });
    const host = component;
    const header = component.locator('[data-panel-tabless-header]');
    const stack = header.locator('[data-pane-stack]');
    const active = stack.locator('[data-pane-stack-active]');
    const position = active.locator('[data-pane-stack-position]');
    const listTrigger = stack.locator('[data-pane-stack-overflow-trigger]');
    const actions = header.locator('[data-panel-header-actions]');

    await expect(active).toBeVisible();
    await expect(active).toContainText('note panel 1');
    await expect(position).toHaveText(`1/${stackCount}`);
    await expect(listTrigger).toBeVisible();
    await expect(listTrigger).toContainText(`+${stackCount}`);
    await expect(stack.locator('[data-pane-stack-layer]')).toHaveCount(0);

    const boxes = await Promise.all(
      [host, header, stack, active, position, listTrigger, actions].map((locator) =>
        locator.boundingBox(),
      ),
    );
    const [hostBox, headerBox, stackBox, activeBox, positionBox, listBox, actionsBox] = boxes;
    expect(boxes.every(Boolean)).toBe(true);
    expect(headerBox!.x).toBeGreaterThanOrEqual(hostBox!.x);
    expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width + 0.5);
    expect(stackBox!.x + stackBox!.width).toBeLessThanOrEqual(actionsBox!.x + 0.5);
    expect(listBox!.x).toBeGreaterThanOrEqual(stackBox!.x - 0.5);
    expect(activeBox!.x + activeBox!.width).toBeLessThanOrEqual(
      stackBox!.x + stackBox!.width + 0.5,
    );
    expect(positionBox!.x + positionBox!.width).toBeLessThanOrEqual(
      activeBox!.x + activeBox!.width + 0.5,
    );

    for (let index = 1; index <= stackCount; index += 1) {
      if (index % 2 === 0) {
        await listTrigger.focus();
        await page.keyboard.press('Enter');
      } else {
        await listTrigger.click();
      }
      const menu = page.getByRole('menu', { name: 'Panes in this stack' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-pane-stack-item]')).toHaveCount(stackCount);
      await menu.locator(`[data-pane-stack-item="note-tab-${index}"]`).click();
      await expect(component).toHaveAttribute('data-active-tab', `note-tab-${index}`);
      await expect(position).toHaveText(`${index}/${stackCount}`);
    }
  });
}

test('keeps two direct rear previews operable when width permits', async ({ mount }) => {
  const component = await mount(PanelHeaderActionsHost, {
    props: { panelType: 'note', width: 560, zoom: 1, stackCount: 5 },
  });
  const stack = component.locator('[data-pane-stack]');
  const layers = stack.locator('[data-pane-stack-layer]');
  await expect(layers).toHaveCount(2);

  const firstLayer = layers.first();
  const firstId = await firstLayer.getAttribute('data-pane-stack-layer');
  expect(firstId).not.toBeNull();
  await firstLayer.click();
  await expect(component).toHaveAttribute('data-active-tab', firstId!);

  await expect(stack.locator('[data-pane-stack-overflow-trigger]')).toBeVisible();
  await expect(stack.locator('[data-pane-stack-active]')).toContainText('note panel');
});
