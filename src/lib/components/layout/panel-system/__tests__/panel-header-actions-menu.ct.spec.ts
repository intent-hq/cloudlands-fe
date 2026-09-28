import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import type { PanelTabType } from '$store/renderer/slices/panel-layout/panel-layout-types';
import PanelHeaderActionsHost from './mocks/PanelHeaderActionsHost.svelte';
import PanelHeaderPreview from '../panel-header-actions.preview.svelte';

test('changes the font and runs a core action with keyboard focus restored', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderPreview, { props: { kind: 'agent', stacked: true } });
  const trigger = component.getByTestId('panel-actions-trigger').filter({ visible: true });
  await trigger.press('Enter');
  const menu = page.locator('[data-slot="menu-content"]');
  await waitForMenuFocusReady(menu);
  const mono = menu.getByRole('menuitemradio', { name: 'Mono', exact: true });
  await mono.focus();
  await mono.press('Enter');
  await expect(mono).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: 'Sans-serif' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await testInfo.attach('panel-core-actions', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await waitForMenuFocusReady(menu);
  await expect(menu.getByRole('menuitemradio', { name: 'Mono', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitem', { name: 'Copy conversation', exact: true }).press('Enter');
  await expect(component).toHaveAttribute('data-last-action', 'copy');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

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

async function openAgentPanelMenu(component: Locator, page: Page) {
  const trigger = component.locator(
    '[data-panel-tabless-header] [data-testid="panel-actions-trigger"]',
  );
  await trigger.click();
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu).toBeVisible();
  await waitForMenuFocusReady(menu);
  const command = menu.getByRole('menuitem', { name: 'Content command action' });
  await expect(command).toBeVisible();
  return { trigger, menu, command };
}

async function menuPresentation(menu: Locator) {
  return menu.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      surface: {
        radius: style.borderRadius,
        background: style.backgroundColor,
        border: style.borderColor,
        shadow: style.boxShadow,
        padding: style.padding,
      },
      rows: Array.from(element.querySelectorAll<HTMLElement>('[role^="menuitem"]')).map((row) => ({
        label: row.textContent?.replace(/\s+/g, ' ').trim(),
        role: row.getAttribute('role'),
        checked: row.getAttribute('aria-checked'),
        disabled: row.getAttribute('aria-disabled'),
        radius: getComputedStyle(row).borderRadius,
        height: row.getBoundingClientRect().height,
      })),
    };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`note appearance preserves rounded surfaces and keyboard behavior through both entry points in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'note', width: 560, zoom: 1, noteAppearance: true, theme },
    });
    const header = component.locator('[data-panel-tabless-header]');
    const trigger = header.getByTestId('panel-actions-trigger');
    const root = page.locator('[data-slot="menu-content"]');
    const fontTrigger = root.getByRole('menuitem', { name: /Font style/i });
    const fontMenu = page.getByRole('menu', { name: 'Font Style', exact: true });
    const snapshots = [];

    for (const entry of ['overflow', 'right-click'] as const) {
      if (entry === 'overflow') {
        await trigger.focus();
        await page.keyboard.press('Enter');
      } else {
        await header.dispatchEvent('contextmenu', { clientX: 40, clientY: 20 });
      }
      await expect(root).toBeVisible();
      await waitForMenuFocusReady(root);
      const rootPresentation = await menuPresentation(root);
      expect(parseFloat(rootPresentation.surface.radius)).toBeGreaterThan(0);
      await fontTrigger.focus();
      await page.keyboard.press('ArrowRight');
      await expect(fontMenu).toBeVisible();
      await waitForMenuFocusReady(fontMenu);
      const nestedPresentation = await menuPresentation(fontMenu);
      expect(nestedPresentation.surface.radius).toBe(rootPresentation.surface.radius);
      await expect(fontMenu.locator('[role="menuitemradio"]:focus')).toHaveCount(1);
      snapshots.push({ root: rootPresentation, nested: nestedPresentation });
      await testInfo.attach(`note-${entry}-${theme}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      await page.keyboard.press('ArrowLeft');
      await expect(fontMenu).toBeHidden();
      await expect(root).toBeVisible();
      await expect(fontTrigger).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(root).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    expect(snapshots[1]).toEqual(snapshots[0]);
    await testInfo.attach(`note-entry-parity-${theme}`, {
      body: JSON.stringify(snapshots),
      contentType: 'application/json',
    });

    await trigger.click();
    await waitForMenuFocusReady(root);
    const viewTrigger = root.getByRole('menuitem', { name: /Note view/i });
    await viewTrigger.focus();
    await page.keyboard.press('ArrowRight');
    const viewMenu = page.getByRole('menu', { name: 'Note view', exact: true });
    await expect(viewMenu).toBeVisible();
    await waitForMenuFocusReady(viewMenu);
    const preview = viewMenu.getByRole('menuitemradio', { name: 'Rendered preview' });
    await preview.focus();
    await page.keyboard.press('Enter');
    await expect(preview).toHaveAttribute('aria-checked', 'true');
    await expect(viewMenu).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(viewTrigger).toBeFocused();
    await expect(root.getByRole('menuitemcheckbox', { name: 'Spellcheck' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('traditional tab context menu supports keyboard focus and stays inside the viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 420 });
  const component = await mount(PanelHeaderActionsHost, {
    props: { panelType: 'terminal', width: 560, zoom: 1, showTabStrip: true },
  });
  const target = component.locator('[data-tab-id="terminal-tab-2"]');
  const menu = page.getByRole('menu', { name: 'Actions', exact: true });
  await target.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await waitForMenuFocusReady(menu);
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Close panel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(target).toBeFocused();
  await expect(component).toHaveAttribute('data-active-tab', 'terminal-tab-1');

  await target.dispatchEvent('contextmenu', { clientX: 596, clientY: 416 });
  await expect(menu).toBeVisible();
  await waitForMenuFocusReady(menu);
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(600);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(420);
  await menu.getByRole('menuitem', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(component).toHaveAttribute('data-close-count', '1');
  await expect(target).toBeFocused();
});

test.describe('Panel file commands in the web renderer', () => {
  test('keeps core actions keyboard accessible without native editor commands', async ({
    mount,
    page,
  }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'agent', width: 560, zoom: 1 },
    });
    const { menu, command } = await openAgentPanelMenu(component, page);
    await expect(menu.getByRole('menuitem', { name: /Open in/ })).toHaveCount(0);
    await command.focus();
    await command.press('Enter');
    await expect(component).toHaveAttribute('data-content-count', '1');
    await expect(menu).toBeHidden();
  });

  test('supports keyboard navigation to the last available command', async ({ mount, page }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'agent', width: 560, zoom: 1 },
    });
    const { menu, trigger } = await openAgentPanelMenu(component, page);
    await menu.getByRole('menuitem').first().focus();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: /Zoom Panel/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(component).toHaveAttribute('data-zoom-count', '1');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('restores focus to the panel actions trigger after dismissal', async ({ mount, page }) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'agent', width: 560, zoom: 1 },
    });
    const { trigger, menu, command } = await openAgentPanelMenu(component, page);
    await command.focus();
    await page.keyboard.press('Escape');

    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

for (const [index, panelType] of panelTypes.entries()) {
  test(`keeps the ${panelType} panel menu portalled and operable at narrow 200% zoom`, async ({
    mount,
    page,
  }, testInfo) => {
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
    const key = index % 2 === 0 ? 'Enter' : 'Space';

    const layout = await header.evaluate((node) => {
      const header = node.getBoundingClientRect();
      const identity = node
        .querySelector('[data-panel-agent-header-identity], [data-panel-header-identity]')!
        .getBoundingClientRect();
      const controls = node.querySelector('[data-panel-header-actions]')!.getBoundingClientRect();
      return {
        header: header.toJSON(),
        identity: identity.toJSON(),
        controls: controls.toJSON(),
        // Agent actions may occupy a second row at the editing-width minimum.
        noCollision:
          identity.right <= controls.left ||
          controls.right <= identity.left ||
          identity.bottom <= controls.top ||
          controls.bottom <= identity.top,
        contained: [identity, controls].every(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= header.left &&
            rect.right <= header.right &&
            rect.top >= header.top &&
            rect.bottom <= header.bottom,
        ),
      };
    });
    await testInfo.attach('narrow-header-geometry', {
      body: JSON.stringify(layout),
      contentType: 'application/json',
    });
    await testInfo.attach('narrow-header', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(layout).toMatchObject({ noCollision: true, contained: true });
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

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Content navigation' }).click();
    await expect(component).toHaveAttribute('data-navigation-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: /Zoom Panel/i }).click();
    await expect(component).toHaveAttribute('data-zoom-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move panel left' }).press('Enter');
    await expect(component).toHaveAttribute('data-move-left-count', '1');

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Move panel right' }).press('Enter');
    await expect(component).toHaveAttribute('data-move-right-count', '1');

    await trigger.click();
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
    if (panelType !== 'browser') {
      await expect(menu.getByRole('menuitem', { name: 'Open in...' })).toHaveCount(0);
    }
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
      const item = node.querySelector<HTMLElement>(
        '[data-panel-actions-section="display"] [data-slot="menu-command-item"]',
      )!;
      const label = item.querySelector<HTMLElement>('span.truncate')!;
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
  await expect(menu.getByRole('menuitem', { name: 'Copy Absolute Path' })).toBeVisible();

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

for (const stackCount of [1, 5] as const) {
  test(`switches among ${stackCount} panes and restores selector focus at narrow zoom`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelHeaderActionsHost, {
      props: { panelType: 'note', width: 240, zoom: 2, stackCount },
    });
    const trigger = component.getByTestId('pane-stack-selector-trigger');
    for (let index = 1; index <= stackCount; index += 1) {
      await trigger.press('Enter');
      const menu = page.getByRole('menu', { name: 'Panes in this stack' });
      const item = menu.locator(`[data-pane-stack-item="note-tab-${index}"]`);
      await item.focus();
      await page.keyboard.press('Enter');
      await expect(component).toHaveAttribute('data-active-tab', `note-tab-${index}`);
      await expect(trigger).toContainText(`note panel ${index}`);
      await expect(trigger).toBeFocused();
    }
    await trigger.press('Tab');
    await expect(
      component.locator('[data-panel-tabless-header]').getByTestId('panel-actions-trigger'),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      component.locator('[data-panel-tabless-header]').getByTestId('panel-close-button'),
    ).toBeFocused();
    await testInfo.attach('pane-selector', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('selects panes directly and restores focus at wide width', async ({ mount, page }) => {
  const component = await mount(PanelHeaderActionsHost, {
    props: { panelType: 'note', width: 560, zoom: 1, stackCount: 5 },
  });
  const stack = component.locator('[data-pane-stack]');
  const trigger = stack.locator('[data-pane-stack-selector-trigger]');
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panes in this stack' });
  await menu.locator('[data-pane-stack-item="note-tab-2"]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-2');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.locator('[data-pane-stack-item="note-tab-1"]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-1');
  await trigger.click();
  await expect(menu.locator('[data-pane-stack-item]')).toHaveCount(5);
  await menu.locator('[data-pane-stack-item="note-tab-5"]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-tab-5');
  await expect(stack.getByTestId('pane-stack-selector-trigger')).toContainText('note panel 5');
});
