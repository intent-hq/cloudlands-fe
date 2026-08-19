import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelIdentityHistoryHost from './mocks/PanelIdentityHistoryHost.svelte';

test('opens by click, focus, and hover and activates the stable ordered history', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { width: 260, zoom: 2, historyCount: 8 },
  });
  const trigger = component.locator('[data-panel-identity-history-trigger]');

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(8);
  await expect(menu.locator('[data-panel-identity-history-section]')).toBeVisible();
  await expect(menu.locator('[data-panel-identity-history-title]')).toHaveText('Panel history');
  await expect(menu.locator('[data-panel-identity-history-title]')).toHaveCSS('font-size', '16px');
  await expect(menu.locator('[aria-current="page"]')).toHaveAttribute(
    'data-panel-identity-item',
    'note-history',
  );
  await expect(menu.getByRole('searchbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await component.locator('[data-panel-identity-back]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'file-history');

  await trigger.click();
  const search = menu.getByRole('searchbox');
  await search.fill('preview browser');
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(1);
  // ArrowDown can be consumed while the filtered list is still settling, so
  // retry until the keyboard highlight lands on the item before pressing
  // Enter — otherwise Enter can activate a stale highlight.
  await expect
    .poll(async () => {
      await search.press('ArrowDown');
      const highlighted = menu.locator('[data-panel-identity-item][data-highlighted]');
      if ((await highlighted.count()) === 0) return null;
      return highlighted.first().getAttribute('data-panel-identity-item');
    })
    .toBe('browser-history');
  // Enter routes through the menu's highlight controller, which can lag the
  // DOM attribute under load — retry while the menu is still open.
  await expect
    .poll(async () => {
      if (await menu.isVisible()) await page.keyboard.press('Enter');
      return component.getAttribute('data-active-tab');
    })
    .toBe('browser-history');

  await trigger.click();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await component.getByTestId('outside-control').focus();
  await trigger.focus();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await component.getByTestId('outside-control').focus();
  await trigger.evaluate((element) => {
    const triggerElement = element as HTMLElement & {
      identityOpenStates?: Array<string | null>;
      identityOpenObserver?: MutationObserver;
    };
    triggerElement.identityOpenStates = [triggerElement.getAttribute('aria-expanded')];
    triggerElement.identityOpenObserver = new MutationObserver(() => {
      triggerElement.identityOpenStates?.push(triggerElement.getAttribute('aria-expanded'));
    });
    triggerElement.identityOpenObserver.observe(triggerElement, {
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
  });
  await trigger.hover();
  await expect(menu).toBeVisible({ timeout: 1_000 });
  await page.waitForTimeout(750);
  const hoverOpenStates = await trigger.evaluate((element) => {
    const triggerElement = element as HTMLElement & {
      identityOpenStates?: Array<string | null>;
      identityOpenObserver?: MutationObserver;
    };
    triggerElement.identityOpenObserver?.disconnect();
    return triggerElement.identityOpenStates ?? [];
  });
  expect(hoverOpenStates.slice(hoverOpenStates.indexOf('true'))).toEqual(['true']);
});

test('shows recently closed history and closes its hover menu after pointer exit', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: {
      historyCount: 1,
      closedHistoryCount: 2,
      initialActiveTabId: 'agent-history',
    },
  });
  const trigger = component.locator('[data-panel-identity-history-trigger]');
  const menu = page.getByRole('menu', { name: 'Panel history' });

  await trigger.hover();
  await expect(menu).toBeVisible({ timeout: 1_000 });
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(3);
  await expect(menu.locator('[data-panel-identity-item="note-history"]')).toBeVisible();
  await component.locator('[data-panel-identity-back]').focus();
  await page.mouse.move(0, 0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 200 });
  await expect(menu).toBeHidden({ timeout: 500 });

  await trigger.click();
  await menu.locator('[data-panel-identity-item="note-history"]').click();
  await trigger.click();
  await expect(menu.locator('[data-panel-identity-item="note-history"]')).toHaveCount(0);
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(2);
});

test('suppresses a redundant single-entry history section', async ({ mount, page }) => {
  const component = await mount(PanelIdentityHistoryHost, { props: { historyCount: 1 } });

  await component.locator('[data-panel-identity-history-trigger]').click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  await expect(menu.locator('[data-panel-identity-current]')).toBeVisible();
  await expect(menu.locator('[data-panel-identity-history-section]')).toHaveCount(0);
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(0);
});

test('shows one clear identity and omits duplicate current metadata', async ({ mount, page }) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { historyCount: 9, initialActiveTabId: 'agents-file-history' },
  });

  await component.locator('[data-panel-identity-history-trigger]').click();
  const current = page
    .getByRole('menu', { name: 'Panel history' })
    .locator('[data-panel-identity-current]');
  await expect(current.locator('[data-panel-identity-title]')).toHaveText('AGENTS.md');
  await expect(current.locator('[data-panel-identity-context]')).toHaveCount(0);
  await expect(current).not.toContainText('Files');
});

test('keeps agent metadata out of the inline header and in current details', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { historyCount: 3, initialActiveTabId: 'agent-history' },
  });
  const header = component.locator('[data-panel-tabless-header]');
  await expect(header.locator('[data-panel-header-title]')).toHaveText('Build agent');
  await expect(header).not.toContainText('Implementor');
  await expect(header).not.toContainText('Delegated by Coordinator');

  await component.locator('[data-panel-identity-history-trigger]').click();
  const current = page
    .getByRole('menu', { name: 'Panel history' })
    .locator('[data-panel-identity-current]');
  await expect(current).toHaveCSS('align-items', 'flex-start');
  await expect(current.locator('[data-panel-identity-agent-state]')).toHaveText('Idle');
  await expect(current.locator('[data-panel-identity-specialist]')).toHaveText('Implementor agent');
  await expect(current.locator('[data-panel-identity-specialist-description]')).toHaveText(
    'Builds focused implementation changes.',
  );
  await expect(current.locator('[data-panel-identity-delegated-by]')).toHaveText(
    'Delegated by Coordinator',
  );
});

test('keeps history navigation in the header with visible keyboard focus', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, { props: { historyCount: 3 } });
  const trigger = component.locator('[data-panel-identity-history-trigger]');
  const back = component.locator('[data-panel-identity-back]');
  const forward = component.locator('[data-panel-identity-forward]');

  await expect(back).toBeVisible();
  await expect(forward).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  await expect(menu.locator('[data-panel-identity-navigation]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await back.focus();
  await expect(back).toBeFocused();
  await expect(back).toHaveClass(/focus-visible:ring-2/);
});

test('keeps the portalled menu inside narrow light/dark viewports at 100% and 200% zoom', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelIdentityHistoryHost);
  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, width: 240, height: 320, zoom, historyCount: 5 } });
      const trigger = component.locator('[data-panel-identity-history-trigger]');
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Panel history' });
      const [headerBox, triggerBox, menuBox] = await Promise.all([
        component.locator('[data-panel-tabless-header]').boundingBox(),
        trigger.boundingBox(),
        menu.boundingBox(),
      ]);
      expect(headerBox!.height / zoom).toBeCloseTo(32, 1);
      expect(triggerBox!.width / zoom).toBeCloseTo(24, 1);
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(
        await page.evaluate(() => innerWidth),
      );
      await expect(menu.getByRole('searchbox')).toHaveCount(0);
      expect(await menu.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      await page.keyboard.press('Escape');
    }
  }
});
