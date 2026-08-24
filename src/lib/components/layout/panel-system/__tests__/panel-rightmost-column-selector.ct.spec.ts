import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import PanelRightmostColumnSelectorHarness from './mocks/PanelRightmostColumnSelectorHarness.svelte';

async function panelIds(component: Locator) {
  const value = await component.getByTestId('panel-layout-state').getAttribute('data-panel-ids');
  return value?.split(',').filter(Boolean) ?? [];
}

async function selectorOwner(component: Locator) {
  const selector = component.locator('[data-panel-column-count-trigger]');
  await expect(selector).toHaveCount(1);
  return selector.evaluate((element) =>
    element.closest('[data-panel-id]')?.getAttribute('data-panel-id'),
  );
}

async function expectGlyph(component: Locator, count: 1 | 2 | 3 | 4) {
  const icon = component.locator(`[data-panel-column-icon="${count}"]`);
  await expect(icon).toHaveCount(1);
  await expect(icon.locator('[data-panel-column-icon-outline]')).toHaveCount(1);
  await expect(icon.locator('[data-panel-column-divider][data-active="true"] line')).toHaveCount(
    count - 1,
  );
}

async function chooseCount(component: Locator, page: Page, count: 1 | 2 | 3 | 4) {
  await component.locator('[data-panel-column-count-trigger]').click();
  await page
    .getByRole('button', { name: count === 1 ? '1 column' : `${count} columns`, exact: true })
    .click();
  await expect(component.getByTestId('panel-layout-state')).toHaveAttribute(
    'data-column-count',
    String(count),
  );
}

test('keeps one real selector on the empty rightmost panel as columns grow', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelRightmostColumnSelectorHarness);
  const selector = component.locator('[data-panel-column-count-trigger]');

  await expect(selector).toHaveAccessibleName('Panel columns: 1');
  await expectGlyph(component, 1);
  expect(await selectorOwner(component)).toBe('initial-panel');

  await chooseCount(component, page, 2);
  await expect(selector).toHaveAccessibleName('Panel columns: 2');
  await expectGlyph(component, 2);
  const idsAtTwo = await panelIds(component);
  expect(idsAtTwo).toHaveLength(2);
  const ownerAtTwo = await selectorOwner(component);
  expect(ownerAtTwo).toBe(idsAtTwo.at(-1));
  expect(ownerAtTwo).not.toBe('initial-panel');
  const emptyAtTwo = component.locator(`[data-panel-id="${ownerAtTwo}"]`);
  await expect(emptyAtTwo).toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(emptyAtTwo.locator('[data-empty-panel-header]')).toHaveCount(1);

  await chooseCount(component, page, 3);
  await expect(selector).toHaveAccessibleName('Panel columns: 3');
  await expectGlyph(component, 3);
  const idsAtThree = await panelIds(component);
  expect(idsAtThree).toHaveLength(3);
  const ownerAtThree = await selectorOwner(component);
  expect(ownerAtThree).toBe(idsAtThree.at(-1));
  expect(ownerAtThree).not.toBe(ownerAtTwo);
  const rightmost = component.locator(`[data-panel-id="${ownerAtThree}"]`);
  await expect(rightmost).toHaveAttribute('data-empty-panel-surface', 'true');
  const emptyHeader = rightmost.locator('[data-empty-panel-header]');
  await expect(emptyHeader).toHaveCount(1);

  await chooseCount(component, page, 4);
  await expect(selector).toHaveAccessibleName('Panel columns: 4');
  await expectGlyph(component, 4);
  const idsAtFour = await panelIds(component);
  expect(idsAtFour).toHaveLength(4);
  const ownerAtFour = await selectorOwner(component);
  expect(ownerAtFour).toBe(idsAtFour.at(-1));
  const rightmostAtFour = component.locator(`[data-panel-id="${ownerAtFour}"]`);
  await expect(rightmostAtFour).toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(rightmostAtFour.locator('[data-empty-panel-header]')).toHaveCount(1);

  await component
    .getByTestId('populate-rightmost-panel')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(rightmostAtFour).not.toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(rightmostAtFour.locator('[data-empty-panel-header]')).toHaveCount(0);
  await expect(rightmostAtFour.locator('[data-panel-content-header]')).toHaveCount(1);
  await expect(component.locator('[data-panel-column-count-trigger]')).toHaveCount(1);
  await expectGlyph(component, 4);
});
