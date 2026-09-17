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
    height: '28px',
    radius: '8px',
    paddingLeft: '8px',
    paddingRight: '8px',
    fontSize: '13px',
  });
}

// bits-ui parks floating content at translate(0, -200%) until floating-ui has
// positioned it, so a lone boundingBox() sample can catch that frame. Read every
// box in one browser round trip and report whether the wrapper is positioned yet.
async function sampleBoxes([first, ...rest]: Locator[]) {
  const others = await Promise.all(rest.map((locator) => locator.elementHandle()));
  return first.evaluate((element, others) => {
    const wrapper = element.closest<HTMLElement>('[data-bits-floating-content-wrapper]');
    const positioned = !wrapper || !wrapper.style.transform.includes('-200%');
    const boxes = [element, ...others].map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    return { positioned, boxes };
  }, others);
}

async function expectInset(container: Locator, row: Locator) {
  const inset = await container.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderLeft: Number.parseFloat(style.borderLeftWidth),
      borderRight: Number.parseFloat(style.borderRightWidth),
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    };
  });
  expect(inset.paddingLeft).toBe('4px');
  expect(inset.paddingRight).toBe('4px');
  await expect(async () => {
    const {
      positioned,
      boxes: [containerBox, rowBox],
    } = await sampleBoxes([container, row]);
    expect(positioned).toBe(true);
    expect(rowBox.x - containerBox.x).toBe(inset.borderLeft + 4);
    expect(containerBox.x + containerBox.width - rowBox.x - rowBox.width).toBe(
      inset.borderRight + 4,
    );
  }).toPass();
}

async function expectHighlight(row: Locator, highlight: Locator) {
  await expect(highlight).toBeVisible();
  await expect(async () => {
    const {
      positioned,
      boxes: [rowBox, highlightBox],
    } = await sampleBoxes([row, highlight]);
    expect(positioned).toBe(true);
    expect(highlightBox).toEqual(rowBox);
  }).toPass();
}

async function firstTextStart(locator: Locator) {
  return locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.trim()) node = walker.nextNode();
    if (!node) throw new Error('Expected a non-empty text node');
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().left;
  });
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
      // A keyboard open settles with the first enabled item focused; wait for
      // that before navigating so the End key is handled by the menu.
      await expect(page.getByRole('menuitem', { name: 'Apple' })).toBeFocused();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowUp');
      const row = page.getByRole('menuitemradio', { name: 'Comfortable' });
      await expect(row).toBeFocused();
      await expectRow(row);
      await expectInset(menu, row);
      await expectHighlight(row, menu.locator('.bg-selected'));
      expect(await row.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('400');
      for (const item of await menu.locator('[data-menu-item]').all()) {
        const start = await firstTextStart(item);
        const hasIcon = await item.locator('[data-slot="menu-item-leading"]').count();
        expect(start - (await item.boundingBox())!.x).toBeCloseTo(hasIcon ? 32 : 8, 0);
      }
      const indicator = row.locator('[data-slot="menu-item-indicator"]');
      expect(
        (await row.boundingBox())!.x +
          (await row.boundingBox())!.width -
          (await indicator.boundingBox())!.x,
      ).toBe(24);
      // Batch 18-E: the moving highlight is the menu's keyboard-focus indicator.
      await expect(row).toBeFocused();
      await expect(row).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('ArrowUp');
      const previousRow = page.getByRole('menuitemradio', { name: 'Compact' });
      await expect(previousRow).toBeFocused();
      await expectHighlight(previousRow, menu.locator('.bg-hover'));
      await page.keyboard.press('ArrowDown');
      await expect(row).toBeFocused();
      await expectHighlight(row, menu.locator('.bg-selected'));
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
      const trigger = component.getByRole('combobox', { name: 'Choose fruit' });
      await trigger.press('Enter');
      const listbox = page.getByRole('listbox');
      const viewport = page.locator('[data-select-viewport]');
      const row = page.getByRole('option', { name: 'Apple' });
      await expectRow(row);
      await expectInset(viewport, row);
      await expectHighlight(row, listbox.locator('.bg-selected'));
      expect(await row.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('400');
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
      const otherRadioRow = radio.getByRole('radio', { name: 'Two' });
      await otherRadioRow.hover();
      await expect(radioRow).toBeFocused();
      await expect(otherRadioRow).toHaveAttribute('aria-checked', 'false');
      await expect(otherRadioRow).toHaveCSS('font-weight', '400');
      await expect(radioRow).toHaveAttribute('aria-checked', 'true');
      await expect(radioRow).toHaveCSS('font-weight', '500');
      await expect(radio.getByTestId('value')).toHaveText('one');
      await radioRow.press('ArrowDown');
      await expect(otherRadioRow).toBeFocused();
      await expect(otherRadioRow).toHaveAttribute('aria-checked', 'true');
      await expect(otherRadioRow).toHaveCSS('font-weight', '500');
      await expect(radioRow).toHaveAttribute('aria-checked', 'false');
      await expect(radioRow).toHaveCSS('font-weight', '400');
      await expect(radio.getByTestId('value')).toHaveText('two');
      await expectFocusTuple(otherRadioRow);
      await otherRadioRow.press('Space');
      await expect(otherRadioRow).toHaveAttribute('aria-checked', 'true');
      await expect(radio.getByTestId('value')).toHaveText('two');
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
