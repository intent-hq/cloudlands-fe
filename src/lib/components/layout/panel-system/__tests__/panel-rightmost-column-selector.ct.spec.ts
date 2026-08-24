import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import { formatShortcut } from '$lib/utils/shortcuts';
import PanelRightmostColumnSelectorHarness from './mocks/PanelRightmostColumnSelectorHarness.svelte';

async function panelIds(component: Locator) {
  const value = await component.getByTestId('panel-layout-state').getAttribute('data-panel-ids');
  return value?.split(',').filter(Boolean) ?? [];
}

async function addButtonOwner(component: Locator) {
  const button = component.locator('[data-add-panel-column]');
  await expect(button).toHaveCount(1);
  return button.evaluate((element) =>
    element.closest('[data-panel-id]')?.getAttribute('data-panel-id'),
  );
}

test('keeps Add column on the rightmost panel and removes the count picker', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelRightmostColumnSelectorHarness);
  const addButton = component.locator('[data-add-panel-column]');
  const layoutState = component.getByTestId('panel-layout-state');

  await expect(component.locator('[data-panel-column-count-trigger]')).toHaveCount(0);
  await expect(component.locator('[data-panel-column-count-popover]')).toHaveCount(0);
  await expect(addButton).toHaveAccessibleName('Add column');
  await addButton.focus();
  await expect(page.getByRole('tooltip')).toContainText(
    `Add an empty column on the right. ${formatShortcut('mod')}+click a link to open in a new column.`,
  );
  expect(await addButtonOwner(component)).toBe('initial-panel');
  const singlePanel = component.locator('[data-panel-id="initial-panel"]');
  await expect(singlePanel).toHaveAttribute('data-focus-border-visible', 'false');
  const singlePanelStyle = await singlePanel.evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.borderTopColor, width: style.borderTopWidth };
  });
  expect(singlePanelStyle).toEqual({ color: 'rgba(0, 0, 0, 0)', width: '1px' });

  await addButton.click();
  await expect(layoutState).toHaveAttribute('data-column-count', '2');
  const idsAtTwo = await panelIds(component);
  expect(idsAtTwo).toHaveLength(2);
  const ownerAtTwo = await addButtonOwner(component);
  expect(ownerAtTwo).toBe(idsAtTwo.at(-1));
  expect(ownerAtTwo).not.toBe('initial-panel');
  const emptyAtTwo = component.locator(`[data-panel-id="${ownerAtTwo}"]`);
  await expect(emptyAtTwo).toHaveAttribute('data-empty-panel-surface', 'true');
  await expect(emptyAtTwo.locator('[data-empty-panel-header]')).toHaveCount(1);

  await addButton.click();
  await expect(layoutState).toHaveAttribute('data-column-count', '3');
  const idsAtThree = await panelIds(component);
  expect(idsAtThree).toHaveLength(3);
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
    expect({ width: geometryAfterFocus?.width, height: geometryAfterFocus?.height }).toEqual({
      width: geometryBeforeFocus?.width,
      height: geometryBeforeFocus?.height,
    });
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
  const ownerAtThree = await addButtonOwner(component);
  expect(ownerAtThree).toBe(idsAtThree.at(-1));
  expect(ownerAtThree).not.toBe(ownerAtTwo);
  const rightmost = component.locator(`[data-panel-id="${ownerAtThree}"]`);
  await expect(rightmost).toHaveAttribute('data-empty-panel-surface', 'true');
  const emptyHeader = rightmost.locator('[data-empty-panel-header]');
  await expect(emptyHeader).toHaveCount(1);

  await addButton.click();
  await expect(layoutState).toHaveAttribute('data-column-count', '4');
  const idsAtFour = await panelIds(component);
  expect(idsAtFour).toHaveLength(4);
  const ownerAtFour = await addButtonOwner(component);
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
  await expect(component.locator('[data-panel-column-count-trigger]')).toHaveCount(0);
  await expect(addButton).toHaveCount(1);
  await expect(addButton).toHaveAttribute('aria-disabled', 'true');
});

test('adds and focuses empty rightmost columns until the four-column limit', async ({
  mount,
  page,
}) => {
  const component = await mount(PanelRightmostColumnSelectorHarness);
  const addButton = component.locator('[data-add-panel-column]');
  const layoutState = component.getByTestId('panel-layout-state');

  await expect(addButton).toHaveAccessibleName('Add column');
  for (const count of [2, 3, 4]) {
    await addButton.click();
    await expect(layoutState).toHaveAttribute('data-column-count', String(count));
    const ids = await panelIds(component);
    const rightmostPanelId = ids.at(-1)!;
    await expect(layoutState).toHaveAttribute('data-focused-panel-id', rightmostPanelId);
    expect(await addButtonOwner(component)).toBe(rightmostPanelId);
    await expect(component.locator(`[data-panel-id="${rightmostPanelId}"]`)).toHaveAttribute(
      'data-empty-panel-surface',
      'true',
    );
  }

  await expect(addButton).toHaveAttribute('aria-disabled', 'true');
  await expect(addButton).toHaveAccessibleName('Add column unavailable: maximum of 4 columns');
  await addButton.focus();
  await expect(page.getByRole('tooltip')).toContainText(
    'Column limit reached. You can use up to 4 columns.',
  );
  await addButton.evaluate((button: HTMLButtonElement) => button.click());
  await expect(layoutState).toHaveAttribute('data-column-count', '4');
  expect(await panelIds(component)).toHaveLength(4);
});
