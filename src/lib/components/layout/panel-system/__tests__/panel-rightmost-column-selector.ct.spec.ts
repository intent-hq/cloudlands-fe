import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import { formatShortcut } from '$lib/utils/shortcuts';
import PanelRightmostColumnSelectorHarness from './mocks/PanelRightmostColumnSelectorHarness.svelte';

async function panelIds(component: Locator) {
  const value = await component.getByTestId('panel-layout-state').getAttribute('data-panel-ids');
  return value?.split(',').filter(Boolean) ?? [];
}

async function addButtonOwners(component: Locator) {
  return component
    .locator('[data-add-panel-column]')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.closest('[data-panel-id]')?.getAttribute('data-panel-id')),
    );
}

test('keeps Add column in every populated and empty panel header', async ({ mount, page }) => {
  const component = await mount(PanelRightmostColumnSelectorHarness);
  const addButtons = component.locator('[data-add-panel-column]');
  const layoutState = component.getByTestId('panel-layout-state');

  await expect(component.locator('[data-panel-column-count-trigger]')).toHaveCount(0);
  await expect(component.locator('[data-panel-column-count-popover]')).toHaveCount(0);
  await expect(addButtons).toHaveCount(1);
  await expect(addButtons.first()).toHaveAccessibleName('Add column');
  await addButtons.last().hover();
  await expect(page.getByRole('tooltip')).toContainText(
    `Add an empty column on the right. ${formatShortcut('mod')}+click a link to open in a new column.`,
  );
  expect(await addButtonOwners(component)).toEqual(['initial-panel']);
  const singlePanel = component.locator('[data-panel-id="initial-panel"]');
  await expect(singlePanel).toHaveAttribute('data-focus-border-visible', 'false');
  const singlePanelStyle = await singlePanel.evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.borderTopColor, width: style.borderTopWidth };
  });
  expect(singlePanelStyle).toEqual({ color: 'rgba(0, 0, 0, 0)', width: '1px' });

  await addButtons.first().click();
  await expect(layoutState).toHaveAttribute('data-column-count', '2');
  const idsAtTwo = await panelIds(component);
  expect(idsAtTwo).toHaveLength(2);
  await expect(addButtons).toHaveCount(2);
  expect(await addButtonOwners(component)).toEqual(idsAtTwo);
  const emptyAtTwo = component.locator(`[data-panel-id="${idsAtTwo.at(-1)}"]`);
  await expect(emptyAtTwo).toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(emptyAtTwo.locator('[data-empty-panel-header]')).toHaveCount(1);

  await addButtons.first().click();
  await expect(layoutState).toHaveAttribute('data-column-count', '3');
  const idsAtThree = await panelIds(component);
  expect(idsAtThree).toHaveLength(3);
  await expect(addButtons).toHaveCount(3);
  expect(await addButtonOwners(component)).toEqual(idsAtThree);
  for (const panelId of idsAtThree) {
    const panel = component.locator(`[data-panel-id="${panelId}"]`);
    const geometryBeforeFocus = await panel.boundingBox();
    await panel.click({ position: { x: 12, y: 90 } });
    await expect(layoutState).toHaveAttribute('data-focused-panel-id', panelId);
    await expect(panel).toHaveAttribute('data-focused', 'true');
    const focusedHeader = panel.locator('[data-panel-tabless-header]');
    await expect(focusedHeader).toHaveAttribute('data-column-focused', '');
    const focusedStyle = await panel.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderTopColor: style.borderTopColor,
        borderTopWidth: style.borderTopWidth,
      };
    });
    expect(focusedStyle.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(focusedStyle.borderTopWidth).toBe('1px');
    const geometryAfterFocus = await panel.boundingBox();
    expect(geometryAfterFocus!.width).toBeCloseTo(geometryBeforeFocus!.width, 0);
    expect(geometryAfterFocus!.height).toBeCloseTo(geometryBeforeFocus!.height, 0);
    await expect
      .poll(() => focusedHeader.evaluate((node) => getComputedStyle(node).boxShadow))
      .toBe('none');
    const panelBorders = await component.locator('[data-panel-id]').evaluateAll((panels) =>
      panels.map((node) => ({
        color: getComputedStyle(node).borderTopColor,
        focused: node.getAttribute('data-focused'),
        width: getComputedStyle(node).borderTopWidth,
      })),
    );
    expect(panelBorders.every(({ width }) => width === '1px')).toBe(true);
    expect(
      panelBorders
        .filter(({ focused }) => focused === 'false')
        .every(({ color }) => color === 'rgba(0, 0, 0, 0)'),
    ).toBe(true);
    await expect(component.locator('[data-column-focused]')).toHaveCount(1);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedColorStyle = await component.locator('[data-focused="true"]').evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'Highlight';
    node.append(probe);
    const highlightColor = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(node);
    return {
      borderTopColor: style.borderTopColor,
      borderTopStyle: style.borderTopStyle,
      borderTopWidth: style.borderTopWidth,
      highlightColor,
    };
  });
  expect(forcedColorStyle).toEqual({
    borderTopColor: forcedColorStyle.highlightColor,
    borderTopStyle: 'solid',
    borderTopWidth: '1px',
    highlightColor: forcedColorStyle.highlightColor,
  });
  await page.emulateMedia({ forcedColors: 'none' });
  const rightmost = component.locator(`[data-panel-id="${idsAtThree.at(-1)}"]`);
  await expect(rightmost).toHaveAttribute('data-empty-panel-surface', 'true');
  const emptyHeader = rightmost.locator('[data-empty-panel-header]');
  await expect(emptyHeader).toHaveCount(1);

  await addButtons.first().click();
  await expect(layoutState).toHaveAttribute('data-column-count', '4');
  const idsAtFour = await panelIds(component);
  expect(idsAtFour).toHaveLength(4);
  await expect(addButtons).toHaveCount(4);
  expect(await addButtonOwners(component)).toEqual(idsAtFour);
  const rightmostAtFour = component.locator(`[data-panel-id="${idsAtFour.at(-1)}"]`);
  await expect(rightmostAtFour).toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(rightmostAtFour.locator('[data-empty-panel-header]')).toHaveCount(1);

  await component
    .getByTestId('populate-rightmost-panel')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(rightmostAtFour).not.toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(rightmostAtFour.locator('[data-empty-panel-header]')).toHaveCount(0);
  await expect(rightmostAtFour.locator('[data-panel-content-header]')).toHaveCount(1);
  await expect(component.locator('[data-panel-column-count-trigger]')).toHaveCount(0);
  await expect(addButtons).toHaveCount(4);
  for (const button of await addButtons.all()) {
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAccessibleName('Add column unavailable: maximum of 4 columns');
  }
});

test('adds and focuses empty rightmost columns until the four-column limit', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelRightmostColumnSelectorHarness);
  const addButtons = component.locator('[data-add-panel-column]');
  const layoutState = component.getByTestId('panel-layout-state');

  await expect(addButtons.first()).toHaveAccessibleName('Add column');
  for (const count of [2, 3, 4]) {
    await addButtons.first().click();
    await expect(layoutState).toHaveAttribute('data-column-count', String(count));
    const ids = await panelIds(component);
    const rightmostPanelId = ids.at(-1)!;
    await expect(layoutState).toHaveAttribute('data-focused-panel-id', rightmostPanelId);
    await expect(addButtons).toHaveCount(count);
    expect(await addButtonOwners(component)).toEqual(ids);
    await expect(component.locator(`[data-panel-id="${rightmostPanelId}"]`)).toHaveAttribute(
      'data-empty-panel-surface',
      'true',
    );
  }

  await expect(addButtons).toHaveCount(4);
  await expect(addButtons.first()).toHaveAttribute('aria-disabled', 'true');
  await expect(addButtons.first()).toHaveAccessibleName(
    'Add column unavailable: maximum of 4 columns',
  );
  await addButtons.last().hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Column limit reached. You can use up to 4 columns.',
  );
  await addButtons.first().evaluate((button: HTMLButtonElement) => button.click());
  await expect(layoutState).toHaveAttribute('data-column-count', '4');
  expect(await panelIds(component)).toHaveLength(4);
});
