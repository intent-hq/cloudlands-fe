import { expect, test } from '@playwright/experimental-ct-svelte';
import SidebarPrDropdownPreview from './sidebar-pr-dropdown.preview.svelte';

test('keeps long-title PR identity and status on one row inside the live menu', async ({
  mount,
  page,
}) => {
  const component = await mount(SidebarPrDropdownPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'sidebar-pr-dropdown', state: 'live-long' } },
  });
  await component.locator('[data-sidebar-pr-trigger]').click();
  const row = page.locator('[role="menu"] [data-sidebar-pr-link]');
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  const geometry = await row.evaluate((node) => {
    const rowRect = node.getBoundingClientRect();
    const icon = node.querySelector('svg')!.getBoundingClientRect();
    const state = node.querySelector('[data-sidebar-pr-state]')!.getBoundingClientRect();
    const number = node.lastElementChild!.getBoundingClientRect();
    return {
      centers: [icon, state, number].map((rect) => rect.y + rect.height / 2),
      numberRight: number.right,
      rowRight: rowRect.right,
      overflow: node.scrollWidth - node.clientWidth,
    };
  });
  expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThanOrEqual(1);
  expect(geometry.numberRight).toBeLessThanOrEqual(geometry.rowRight);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-sidebar-pr-trigger]')).toBeFocused();
});

test('scrolls many PRs and opens the keyboard-selected identity through the link handler', async ({
  mount,
  page,
}) => {
  const opened: unknown[] = [];
  const component = await mount(SidebarPrDropdownPreview, {
    hooksConfig: { geometrySnapshot: { scene: 'sidebar-pr-dropdown', state: 'live-many' } },
  });
  await component.update({ props: { onOpenExternal: (payload: unknown) => opened.push(payload) } });
  const trigger = component.locator('[data-sidebar-pr-trigger]');
  await trigger.focus();
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-sidebar-pr-link]')).toHaveCount(12);
  await page.keyboard.press('End');
  const last = menu.locator('[data-sidebar-pr-link]').last();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  // Closed PRs follow open/merged rows; the oldest numbered closed PR is last.
  await expect
    .poll(() => opened)
    .toEqual([{ url: 'https://github.com/intent-hq/cloudlands-fe/pull/203' }]);
  await expect(trigger).toBeFocused();
});
