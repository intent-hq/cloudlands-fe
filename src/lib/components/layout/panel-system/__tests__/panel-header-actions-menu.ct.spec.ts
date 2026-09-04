import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { SHORTCUTS, formatShortcut } from '$lib/utils/shortcuts';
import PanelHeaderActionsHost from './mocks/PanelHeaderActionsHost.svelte';

const panelTypes: PanelTabType[] = ['agent', 'note', 'browser', 'terminal', 'changes'];
const stackCounts = [1, 2, 3, 4, 5] as const;

async function waitForMenuFocusReady(menu: Locator) {
  await menu.evaluate(async (element) => {
    await Promise.allSettled(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

for (const [index, panelType] of panelTypes.entries()) {
  test(`keeps the ${panelType} panel menu portalled and operable at narrow 200% zoom`, async ({
    mount,
    page,
  }) => {
    const stackCount = stackCounts[index % 3];
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType, width: 240, zoom: 2, stackCount },
    });
    const trigger = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
    );
    const close = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-close-button"]',
    );
    const header = component.locator('[data-panel-tabless-header]');
    const contentActions = header.locator('[data-panel-header-content-actions]');
    const panelControls = header.locator('[data-panel-header-actions]');
    const key = index % 2 === 0 ? 'Enter' : 'Space';

    const actionGeometry = await header.evaluate((node) => {
      const trigger = node.querySelector<HTMLElement>('[data-testid="panel-actions-trigger"]')!;
      const close = node.querySelector<HTMLElement>('[data-testid="panel-close-button"]')!;
      const closeGlyph = close.querySelector<SVGElement>('svg')!;
      return {
        borderBottomWidth: getComputedStyle(node).borderBottomWidth,
        trigger: [getComputedStyle(trigger).width, getComputedStyle(trigger).height],
        close: [getComputedStyle(close).width, getComputedStyle(close).height],
        closeGlyph: [getComputedStyle(closeGlyph).width, getComputedStyle(closeGlyph).height],
      };
    });
    expect(actionGeometry.borderBottomWidth).toBe('0px');
    expect(actionGeometry.trigger).toEqual(['28px', '28px']);
    expect(actionGeometry.close).toEqual(['28px', '28px']);
    expect(actionGeometry.closeGlyph).toEqual(['14px', '14px']);
    await expect(contentActions.locator('[data-panel-content-actions-divider]')).toHaveCount(0);
    await expect(panelControls.locator('[data-panel-controls-divider]')).toHaveCount(1);
    expect(
      await contentActions
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
    ).toEqual(['Content navigation']);
    expect(
      await panelControls
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid'))),
    ).toEqual([
      null,
      'panel-actions-trigger',
      ...(stackCount > 1 && panelType !== 'agent' ? ['pane-stack-selector-trigger'] : []),
      null,
      'panel-close-button',
    ]);
    await expect(header.locator('[data-panel-column-count-trigger]')).toHaveCount(0);
    if (panelType === 'agent') {
      const agentAvatar = header.locator('[data-panel-agent-header-identity] [data-agent-avatar]');
      await expect(agentAvatar).toHaveCount(1);
      await expect(agentAvatar).toHaveAttribute('data-avatar-variant', 'emphasized');
    }

    const identity = header.locator(
      panelType === 'agent' ? '[data-panel-agent-header-identity]' : '[data-panel-header-identity]',
    );
    const identityBox = await identity.boundingBox();
    const panelControlsBox = await panelControls.boundingBox();
    expect(identityBox).not.toBeNull();
    expect(panelControlsBox).not.toBeNull();
    expect(identityBox!.x + identityBox!.width).toBeLessThanOrEqual(panelControlsBox!.x + 0.5);
    if (panelType === 'agent') {
      await expect(header.locator('[data-pane-stack]')).toHaveCount(0);
      await expect(component.locator('[data-pane-stack-layer]')).toHaveCount(0);
      await expect(component.locator('[data-pane-stack-position]')).toHaveCount(0);
      await expect(component.locator('[data-pane-stack-overflow-trigger]')).toHaveCount(0);
    }

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

    await contentActions.getByRole('button', { name: 'Content navigation' }).click();
    await expect(component).toHaveAttribute('data-navigation-count', '1');

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

    await header.evaluate((node) =>
      node.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 20 }),
      ),
    );
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-panel-actions-section="display"]')).toHaveCount(1);
    await expect(menu.locator('[data-panel-actions-section="actions"]')).toHaveCount(1);
    await expect(menu.locator('[data-panel-actions-section="open-in"]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await trigger.click();
    await page.mouse.click(1100, 700);
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await close.click();
    await expect(component).toHaveAttribute('data-close-count', '1');
  });
}

for (const scenario of [
  { theme: 'light' as const, viewportWidth: 1000, hostWidth: 560, zoom: 1 },
  { theme: 'dark' as const, viewportWidth: 1000, hostWidth: 560, zoom: 1 },
  { theme: 'light' as const, viewportWidth: 320, hostWidth: 150, zoom: 2 },
  { theme: 'dark' as const, viewportWidth: 320, hostWidth: 150, zoom: 2 },
]) {
  test(`fits content in ${scenario.theme} at ${scenario.viewportWidth}px and ${scenario.zoom * 100}% zoom`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: scenario.viewportWidth, height: 800 });
    const component = await mount(PanelHeaderActionsHost, {
      props: {
        panelType: 'note',
        width: scenario.hostWidth,
        zoom: scenario.zoom,
        theme: scenario.theme,
        longMenuContent: true,
      },
    });
    const trigger = component.locator(
      '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
    );
    await trigger.click();
    const menu = page.getByRole('menu');
    const longItem = menu.getByRole('menuitem', {
      name: 'Content display action with a deliberately long label',
    });
    await expect(menu).toBeVisible();

    const geometry = await menu.evaluate((node) => {
      const item = node.querySelector<HTMLElement>('[data-slot="menu-command-item"]')!;
      const label = item.querySelector<HTMLElement>(':scope > span')!;
      const shortcut = item.querySelector<HTMLElement>('kbd')!;
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width,
        labelClientWidth: label.clientWidth,
        labelScrollWidth: label.scrollWidth,
        labelColor: getComputedStyle(label).color,
        shortcutColor: getComputedStyle(shortcut).color,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(8 - 0.5);
    expect(geometry.right).toBeLessThanOrEqual(scenario.viewportWidth - 8 + 0.5);
    expect(geometry.shortcutColor).not.toBe(geometry.labelColor);
    expect(geometry.width).toBeGreaterThanOrEqual(224);
    expect(geometry.labelScrollWidth).toBeGreaterThan(geometry.labelClientWidth);

    if (scenario.viewportWidth === 1000) {
      expect(geometry.width).toBeLessThanOrEqual(320);
    } else {
      expect(geometry.width).toBeLessThanOrEqual(scenario.viewportWidth - 16 + 0.5);
    }

    await longItem.click();
    await expect(component).toHaveAttribute('data-display-count', '1');
  });
}

test('keeps the agent actions menu compact at desktop width', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const component = await mount(PanelHeaderActionsHost, {
    props: { panelType: 'agent', width: 560, zoom: 1 },
  });
  const trigger = component.locator(
    '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
  );

  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Open in/ })).toBeVisible();

  const geometry = await menu.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      width: box.width,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(224);
  expect(geometry.width).toBeLessThanOrEqual(320);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

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
    const stack = header;
    const active = header.locator('[data-pane-stack-active]');
    const listTrigger = header.locator('[data-pane-stack-selector-trigger]');
    const contentActions = header.locator('[data-panel-header-content-actions]');
    const panelControls = header.locator('[data-panel-header-actions]');
    const navigation = contentActions.getByRole('button', { name: 'Content navigation' });
    const moreTrigger = panelControls.getByTestId('panel-actions-trigger');

    await expect(active).toBeVisible();
    await expect(active).toContainText('note panel 1');
    if (stackCount === 1) {
      await expect(listTrigger).toHaveCount(0);
      await expect(panelControls.locator('[data-panel-controls-divider]')).toHaveCount(1);
      const addColumn = panelControls.getByRole('button', { name: 'Add column' });
      await navigation.focus();
      await page.keyboard.press('Tab');
      await expect(moreTrigger).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(addColumn).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(panelControls.getByTestId('panel-close-button')).toBeFocused();
      return;
    }
    await expect(listTrigger).toBeVisible();
    await expect(listTrigger).toHaveText('');
    await expect(stack.locator('[data-pane-stack-layer]')).toHaveCount(0);
    await expect(listTrigger.locator('[data-pane-stack-selector-chevron]')).toHaveCount(0);
    await expect(listTrigger.locator('[data-pane-stack-line]')).toHaveCount(stackCount);
    const selectorStyle = await listTrigger.evaluate((node) => {
      const style = getComputedStyle(node);
      const glyphStyle = getComputedStyle(node.querySelector('[data-pane-stack-glyph]')!);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        glyphWidth: glyphStyle.width,
        glyphHeight: glyphStyle.height,
      };
    });
    expect(selectorStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(selectorStyle.borderWidth).toBe('0px');
    expect([selectorStyle.glyphWidth, selectorStyle.glyphHeight]).toEqual(['14px', '14px']);

    const boxes = await Promise.all(
      [host, header, active, navigation, moreTrigger, listTrigger, panelControls].map((locator) =>
        locator.boundingBox(),
      ),
    );
    const [hostBox, headerBox, activeBox, navigationBox, moreBox, listBox, panelControlsBox] =
      boxes;
    expect(boxes.every(Boolean)).toBe(true);
    expect(headerBox!.x).toBeGreaterThanOrEqual(hostBox!.x);
    expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width + 0.5);
    expect(activeBox!.x + activeBox!.width).toBeLessThanOrEqual(panelControlsBox!.x + 0.5);
    expect(navigationBox!.x + navigationBox!.width).toBeLessThanOrEqual(moreBox!.x + 0.5);
    expect(listBox!.x).toBeGreaterThanOrEqual(panelControlsBox!.x - 0.5);

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
      const item = menu.locator(`[data-pane-stack-item="note-tab-${index}"]`);
      if (index % 2 === 0) {
        await waitForMenuFocusReady(menu);
        const initialKeyboardItem = menu.locator(
          index === 2 ? '[data-pane-stack-open-below]' : '[data-pane-stack-open-above]',
        );
        await expect(initialKeyboardItem).toBeFocused();
        await page.keyboard.press('End');
        await expect(menu.locator(`[data-pane-stack-item="note-tab-${stackCount}"]`)).toBeFocused();
        for (let step = stackCount - 1; step >= index; step -= 1) {
          await page.keyboard.press('ArrowUp');
          await expect(menu.locator(`[data-pane-stack-item="note-tab-${step}"]`)).toBeFocused();
        }
        await expect(item).toBeFocused();
        await page.keyboard.press('Enter');
      } else {
        await item.click();
      }
      await expect(component).toHaveAttribute('data-active-tab', `note-tab-${index}`);
      await expect(active).toContainText(`note panel ${index}`);
      await expect(listTrigger).toBeFocused();
    }
  });
}

test('keeps the header flat and the complete selector operable at wide width', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelHeaderActionsHost, {
    props: { panelType: 'note', width: 560, zoom: 1, stackCount: 5 },
  });
  const stack = component.locator('[data-pane-stack]');
  const trigger = stack.locator('[data-pane-stack-selector-trigger]');
  await expect(stack.locator('[data-pane-stack-layer]')).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panes in this stack' });
  const above = menu.getByRole('menuitem', { name: 'Open panel above' });
  const below = menu.getByRole('menuitem', { name: 'Open panel below' });
  await expect(above).toHaveAttribute('aria-disabled', 'true');
  await expect(below).not.toHaveAttribute('aria-disabled', 'true');
  await expect(above).toContainText(formatShortcut(SHORTCUTS.PREVIOUS_PANE.key));
  await expect(below).toContainText(formatShortcut(SHORTCUTS.NEXT_PANE.key));
  await expect(
    menu.getByText('Use Up or Down to move, Enter to select, and Escape to close.'),
  ).toHaveCount(0);
  await below.click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-2');
  await trigger.click();
  await expect(menu.getByRole('menuitem', { name: 'Open panel above' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await menu.getByRole('menuitem', { name: 'Open panel above' }).click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-1');
  await trigger.click();
  await expect(menu.locator('[data-pane-stack-item]')).toHaveCount(5);
  await menu.locator('[data-pane-stack-item="note-tab-5"]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-5');
  await expect(stack.locator('[data-pane-stack-active]')).toContainText('note panel 5');
});
