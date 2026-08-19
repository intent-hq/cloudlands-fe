import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelIdentityHistoryHost from './mocks/PanelIdentityHistoryHost.svelte';

test('opens by click, focus, and hover and activates the stable ordered history', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { width: 260, zoom: 2, historyCount: 10 },
  });
  const trigger = component.locator('[data-panel-identity-history-trigger]');

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(10);
  await expect(menu.locator('[data-panel-identity-current]')).toHaveCount(0);
  await expect(menu.locator('[data-panel-identity-history-title]')).toHaveCount(0);
  await expect(menu.getByRole('separator')).toHaveCount(0);
  await expect(menu.locator('[aria-current="page"]')).toHaveAttribute(
    'data-panel-identity-item',
    'note-history',
  );
  const initialSearch = menu.getByRole('searchbox');
  await expect(initialSearch).toBeVisible();
  await expect(initialSearch).toHaveAttribute('aria-label', /.+/);
  await expect(initialSearch).toHaveAttribute('placeholder', /.+/);
  await page.keyboard.press('Escape');
  await component.locator('[data-panel-identity-back]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'agent-history');

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

test('shows the quiet search and current row for a single-entry history', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, { props: { historyCount: 1 } });

  await component.locator('[data-panel-identity-history-trigger]').click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  const search = menu.getByRole('searchbox');
  await expect(search).toBeVisible();
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(1);
  await expect(menu.locator('[data-panel-identity-item="agent-history"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.locator('[data-panel-identity-current-check]')).toHaveCount(1);

  for (const focused of [false, true]) {
    if (focused) await search.focus();
    const style = await search.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        background: computed.backgroundColor,
        border: computed.borderTopWidth,
        hasVisibleBoxShadow: (computed.boxShadow.match(/-?\d+(?:\.\d+)?px/g) ?? []).some(
          (value) => Number.parseFloat(value) !== 0,
        ),
        outline: computed.outlineStyle,
        caret: computed.caretColor,
        color: computed.color,
      };
    });
    expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.border).toBe('0px');
    expect(style.hasVisibleBoxShadow).toBe(false);
    expect(style.outline).toBe('none');
    expect(style.caret).toBe(style.color);
  }
});

test('keeps agent and Spec identities in the list with one current check', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { historyCount: 10, initialActiveTabId: 'agent-history' },
  });

  await component.locator('[data-panel-identity-history-trigger]').click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  const agent = menu.locator('[data-panel-identity-item="agent-history"]');
  await expect(agent.locator('[data-agent-avatar-with-state]')).toBeVisible();
  await expect(agent.locator('[data-panel-identity-current-check]')).toHaveCount(1);
  await expect(menu.locator('[data-panel-identity-current-check]')).toHaveCount(1);

  await menu.locator('[data-panel-identity-item="spec-history"]').click();
  await expect(component).toHaveAttribute('data-active-tab', 'spec-history');
  await component.locator('[data-panel-identity-history-trigger]').click();
  const spec = menu.locator('[data-panel-identity-item="spec-history"]');
  await expect(spec).toContainText('Spec');
  await expect(spec.locator('[data-resource-kind="note"]')).toBeVisible();
  await expect(spec.locator('[data-panel-identity-current-check]')).toHaveCount(1);
  await expect(menu.locator('[data-panel-identity-current-check]')).toHaveCount(1);
});

test('filters to one list and shows the consistent empty result', async ({ mount, page }) => {
  const component = await mount(PanelIdentityHistoryHost, { props: { historyCount: 10 } });
  await component.locator('[data-panel-identity-history-trigger]').click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  const search = menu.getByRole('searchbox');

  await search.fill('preview browser');
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(1);
  await expect(menu.locator('[data-panel-identity-item="browser-history"]')).toBeVisible();
  await expect(menu.locator('[data-panel-identity-list]')).toHaveCount(1);

  await search.fill('no matching panel');
  await expect(menu.locator('[data-panel-identity-item]')).toHaveCount(0);
  await expect(menu.locator('[data-panel-identity-empty]')).toBeVisible();
  await expect(menu.locator('[data-panel-identity-empty]')).not.toBeEmpty();
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
  const navigation = component.locator('[data-panel-identity-navigation]');
  const actions = navigation.locator('..');
  await expect(navigation).toBeVisible();
  expect(
    await actions.evaluate((node) =>
      Array.from(node.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ),
  ).toEqual(['More', 'Panel history', 'Go back', 'Go forward', 'Close panel']);
  const divider = actions.locator('[data-panel-history-divider]');
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveAttribute('aria-hidden', 'true');
  await expect(actions.getByRole('separator')).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Panel history' });
  await expect(menu.locator('[data-panel-identity-navigation]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await back.focus();
  await expect(back).toBeFocused();
  await expect(back).toHaveClass(/focus-visible:ring-2/);
});

test('keeps one hidden divider and the exact order when Close is unavailable', async ({
  mount,
}) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { historyCount: 3, closeAvailable: false },
  });
  const actions = component.locator('[data-panel-tabless-header] [data-panel-header-actions]');
  expect(
    await actions.evaluate((node) =>
      Array.from(node.querySelectorAll('button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ),
  ).toEqual(['More', 'Panel history', 'Go back', 'Go forward']);
  await expect(actions.locator('[data-panel-history-divider]')).toHaveCount(1);
  await expect(actions.locator('[data-testid="panel-close-button"]')).toHaveCount(0);
});

test('maps left to the sole previous entry and right to the next entry', async ({ mount }) => {
  const component = await mount(PanelIdentityHistoryHost, {
    props: { historyCount: 5, initialActiveTabId: 'note-history' },
  });
  const back = component.locator('[data-panel-identity-back]');
  const forward = component.locator('[data-panel-identity-forward]');

  await back.click();
  await expect(component).toHaveAttribute('data-active-tab', 'agent-history');
  await expect(back).toBeDisabled();
  await forward.click();
  await expect(component).toHaveAttribute('data-active-tab', 'note-history');
  await forward.click();
  await expect(component).toHaveAttribute('data-active-tab', 'file-history');
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
      await expect(menu.getByRole('searchbox')).toBeVisible();
      expect(await menu.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
      await page.keyboard.press('Escape');
    }
  }
});
