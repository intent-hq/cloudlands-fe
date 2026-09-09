import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import ComboboxHarness from '../combobox/combobox.test-harness.svelte';
import MenuHarness from '../menu/MenuTestHarness.svelte';
import RadioHarness from '../radio-group/RadioGroupHarness.svelte';
import SelectHarness from '../select/select.test-harness.svelte';
import SidebarHarness from './SidebarRowContractHarness.svelte';

async function reduceMotion(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function expectRow(row: Locator) {
  const style = await row.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      height: computed.height,
      radius: computed.borderRadius,
      paddingLeft: computed.paddingLeft,
      paddingRight: computed.paddingRight,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
    };
  });
  expect(style).toMatchObject({
    height: '36px',
    radius: '8px',
    paddingLeft: '8px',
    paddingRight: '8px',
    fontSize: '13px',
  });
}

async function expectInset(container: Locator, row: Locator) {
  const [containerBox, rowBox] = await Promise.all([container.boundingBox(), row.boundingBox()]);
  const inset = await container.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderLeft: Number.parseFloat(style.borderLeftWidth),
      borderRight: Number.parseFloat(style.borderRightWidth),
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    };
  });
  expect(containerBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(inset.paddingLeft).toBe('4px');
  expect(inset.paddingRight).toBe('4px');
  expect(rowBox!.x - containerBox!.x).toBe(inset.borderLeft + 4);
  expect(containerBox!.x + containerBox!.width - rowBox!.x - rowBox!.width).toBe(
    inset.borderRight + 4,
  );
}

async function expectHighlight(row: Locator, highlight: Locator) {
  await expect(highlight).toBeVisible();
  const [rowBox, highlightBox] = await Promise.all([row.boundingBox(), highlight.boundingBox()]);
  expect(highlightBox).toEqual(rowBox);
}

async function expectFocusTuple(row: Locator) {
  await row.focus();
  const tuple = await row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.outlineWidth,
      style: style.outlineStyle,
      offset: style.outlineOffset,
      shadow: style.boxShadow,
    };
  });
  expect(tuple.width).toBe('1px');
  expect(tuple.style).toBe('solid');
  expect(tuple.offset).not.toBe('0px');
  expect(tuple.shadow.replaceAll('rgba(0, 0, 0, 0)', '')).not.toMatch(/rgba?\(/);
}

async function measureColors(foreground: Locator, background: Locator, surface: Locator) {
  return {
    foreground: await foreground.evaluate((node) => getComputedStyle(node).color),
    background: await background.evaluate((node) => getComputedStyle(node).backgroundColor),
    surface: await surface.evaluate((node) => getComputedStyle(node).backgroundColor),
  };
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.evaluate((activeTheme) => {
        document.documentElement.classList.toggle('dark', activeTheme === 'dark');
      }, theme);
    });

    test('menu rows use the shared geometry, inset, overlay, and end slot', async ({
      mount,
      page,
    }) => {
      await reduceMotion(page);
      const component = await mount(MenuHarness);
      await expect(page.locator('#splash')).toHaveCount(0);
      const trigger = component.getByRole('button', { name: 'Actions' });
      await trigger.focus();
      await trigger.press('ArrowDown');
      const menu = page.getByRole('menu');
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowUp');
      const row = page.getByRole('menuitemradio', { name: 'Comfortable' });
      await expect(row).toBeFocused();
      await expectRow(row);
      await expectInset(menu, row);
      await expectHighlight(row, menu.locator('.bg-selected'));
      expect(await row.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('500');
      const indicator = row.locator('[data-slot="menu-item-indicator"]');
      expect(
        (await row.boundingBox())!.x +
          (await row.boundingBox())!.width -
          (await indicator.boundingBox())!.x,
      ).toBe(24);
      await expectFocusTuple(row);
      if (process.env.CAPTURE_OPTION_ROWS === '1') {
        console.log(
          `[option-row-colors] menu-${theme} ${JSON.stringify(await measureColors(row, menu.locator('.bg-selected'), menu))}`,
        );
        await page.screenshot({
          path: `../../.demo-artifacts/polish-sweep/batch7d/menu-${theme}.png`,
        });
      }
    });

    test('select rows and long portal placement retain the recipe and focus restoration', async ({
      mount,
      page,
    }) => {
      await reduceMotion(page);
      const component = await mount(SelectHarness, { props: { portal: true } });
      await expect(page.locator('#splash')).toHaveCount(0);
      const trigger = component.getByRole('button', { name: 'Choose fruit' });
      await trigger.press('Enter');
      const listbox = page.getByRole('listbox');
      const viewport = page.locator('[data-select-viewport]');
      const row = page.getByRole('option', { name: 'Apple' });
      await expectRow(row);
      await expectInset(viewport, row);
      await expectHighlight(row, listbox.locator('.bg-selected'));
      expect(await row.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('500');
      const box = await listbox.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('combobox rows use the shared recipe in a scrollable portal', async ({ mount, page }) => {
      await reduceMotion(page);
      const options = Array.from({ length: 30 }, (_, index) => ({
        value: `option-${index}`,
        label: `Option ${index}`,
      }));
      const component = await mount(ComboboxHarness, {
        props: { value: 'option-0', portal: true, options },
      });
      await expect(page.locator('#splash')).toHaveCount(0);
      const input = component.getByRole('combobox', { name: 'Search people' });
      await input.focus();
      const listbox = page.getByRole('listbox');
      const viewport = page.locator('[data-combobox-viewport]');
      const row = page.getByRole('option', { name: 'Option 0' });
      await expectRow(row);
      await expectInset(viewport, row);
      await expectHighlight(row, listbox.locator('.bg-selected'));
      expect(await viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await input.press('End');
      await input.press('Enter');
      await expect(input).toHaveValue('Option 29');
      await expect(input).toBeFocused();
    });

    test('radio and sidebar rows share inset geometry and focus tuples', async ({
      mount,
      page,
    }) => {
      await reduceMotion(page);
      const radio = await mount(RadioHarness, { props: { oneLine: true } });
      await expect(page.locator('#splash')).toHaveCount(0);
      const group = radio.getByRole('radiogroup');
      const radioRow = radio.getByRole('radio', { name: 'One' });
      await expectRow(radioRow);
      await expectInset(group, radioRow);
      await radioRow.focus();
      await expectHighlight(radioRow, group.locator('.bg-active'));
      expect(await radioRow.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('500');
      await expectFocusTuple(radioRow);
      await radio.unmount();

      const sidebar = await mount(SidebarHarness);
      const menu = sidebar.locator('[data-sidebar="menu"]');
      const sidebarRow = sidebar.getByRole('button', { name: 'Overview' });
      await expectRow(sidebarRow);
      await expectInset(menu, sidebarRow);
      await expectHighlight(sidebarRow, menu.locator('[data-sidebar="menu-active-highlight"]'));
      await expectFocusTuple(sidebarRow);
      if (process.env.CAPTURE_OPTION_ROWS === '1') {
        console.log(
          `[option-row-colors] sidebar-${theme} ${JSON.stringify(await measureColors(sidebarRow, menu.locator('[data-sidebar="menu-active-highlight"]'), menu))}`,
        );
        await page.screenshot({
          path: `../../.demo-artifacts/polish-sweep/batch7d/sidebar-${theme}.png`,
        });
      }
    });
  });
}
