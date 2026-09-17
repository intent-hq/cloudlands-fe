import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import MenuHarness from './MenuTestHarness.svelte';
import Dropdown from '../dropdown/Dropdown.svelte';

async function sample(row: Locator) {
  return row.evaluate((element) => {
    const container = element.closest('[data-list-overlay]')!;
    const rect = element.getBoundingClientRect();
    const rgba = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const blend = (base: number[], layer: number[]) =>
      base.map((channel, i) => channel * (1 - (layer[3] ?? 1)) + layer[i] * (layer[3] ?? 1));
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ancestors: Element[] = [];
    for (let node: Element | null = container; node; node = node.parentElement)
      ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors)
      background = blend(background, rgba(getComputedStyle(node).backgroundColor));
    const layers = [
      ...container.querySelectorAll('[data-slot="menu-list-highlight"] > div > div'),
    ].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.top <= rect.top + rect.height / 2 && box.bottom >= rect.top + rect.height / 2;
    });
    for (const layer of layers)
      background = blend(background, rgba(getComputedStyle(layer).backgroundColor));
    const style = getComputedStyle(element);
    background = blend(background, rgba(style.backgroundColor));
    const bg = luminance(background);
    const contrast = (paint: string) => {
      const fg = luminance(blend(background, rgba(paint)));
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    };
    const contrasts: number[] = [];
    const graphics: number[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement!;
      // The radio selection glyph is a graphic, not body text. Still measure it.
      const indicator = parent.closest('[data-slot="menu-item-indicator"][aria-hidden="true"]');
      (indicator ? graphics : contrasts).push(contrast(getComputedStyle(parent).color));
    }
    // Dropdown selection checkmarks are SVG graphics rather than text glyphs.
    for (const path of element.querySelectorAll('svg path')) {
      const { fill, stroke } = getComputedStyle(path);
      for (const paint of [fill, stroke]) {
        if (paint !== 'none' && (rgba(paint)[3] ?? 1) > 0) graphics.push(contrast(paint));
      }
    }
    return {
      luminance: bg,
      contrast: Math.min(...contrasts),
      textCount: contrasts.length,
      graphics,
      inset: layers.some((node) => getComputedStyle(node).boxShadow.includes('inset')),
      layers: layers.length,
    };
  });
}

function expectReadable(colors: Awaited<ReturnType<typeof sample>>, selected = false) {
  expect(colors.textCount).toBeGreaterThan(0);
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  if (selected) expect(colors.graphics.length).toBeGreaterThan(0);
  for (const contrast of colors.graphics) expect(contrast).toBeGreaterThanOrEqual(3);
}

for (const theme of ['light', 'dark'] as const) {
  for (const kind of ['menu', 'dropdown'] as const) {
    test(`${kind} ${theme} keeps selection subtle, preview separate and press transient`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      const component =
        kind === 'menu'
          ? await mount(MenuHarness)
          : await mount(Dropdown, {
              props: {
                value: 'selected',
                searchable: false,
                portal: false,
                animate: false,
                options: [
                  { value: 'selected', label: 'Selected option', description: 'Supporting detail' },
                  { value: 'other', label: 'Other option', description: 'Supporting detail' },
                ],
              },
            });
      const trigger = component.getByRole('button').first();
      await trigger.click();
      const selected =
        kind === 'menu'
          ? page.getByRole('menuitemradio', { name: 'Comfortable' })
          : page.getByRole('option', { name: 'Selected option' });
      const other =
        kind === 'menu'
          ? page.getByRole('menuitemradio', { name: 'Compact', exact: true })
          : page.getByRole('option', { name: 'Other option' });
      const selectedAttribute = kind === 'menu' ? 'aria-checked' : 'aria-selected';
      await other.hover();
      await expect.poll(async () => (await sample(other)).layers).toBe(1);
      await expect.poll(async () => (await sample(selected)).layers).toBe(1);
      const idle = await sample(selected);
      const hover = await sample(other);
      await expect(selected).toHaveAttribute(selectedAttribute, 'true');
      await expect(other).toHaveAttribute(selectedAttribute, 'false');
      expectReadable(idle, true);
      expectReadable(hover);
      await page.mouse.down();
      await expect.poll(async () => (await sample(other)).luminance).not.toBe(hover.luminance);
      expectReadable(await sample(other));
      await other.dispatchEvent('pointercancel');
      await expect.poll(async () => (await sample(other)).luminance).toBe(hover.luminance);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      if (theme === 'light') {
        // Pale fills stay close to the white popover, without making hover selection.
        expect(idle.luminance).toBeGreaterThan(0.85);
        expect(idle.luminance).toBeLessThan(hover.luminance);
        expect(hover.luminance).toBeGreaterThan(0.9);
      } else {
        expect(idle.luminance).toBeGreaterThan(hover.luminance);
        expect(idle.luminance).toBeLessThan(0.15);
      }
      await selected.hover();
      await expect.poll(async () => (await sample(selected)).layers).toBe(2);
      const preview = await sample(selected);
      expect(preview.luminance).not.toBe(idle.luminance);
      expectReadable(preview, true);
      await page.mouse.down();
      await expect.poll(async () => (await sample(selected)).inset).toBe(true);
      const pressed = await sample(selected);
      // Do not compound overlays on selection: secondary text must retain contrast.
      expectReadable(pressed, true);
      expect(pressed.luminance).toBe(preview.luminance);
      await selected.dispatchEvent('pointercancel');
      await expect.poll(async () => (await sample(selected)).inset).toBe(false);
      await expect.poll(async () => (await sample(selected)).luminance).toBe(preview.luminance);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await other.focus();
      await other.press(kind === 'menu' ? 'ArrowDown' : 'ArrowUp');
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute(selectedAttribute, 'true');
      await expect.poll(async () => (await sample(selected)).layers).toBe(2);
      await expect.poll(async () => (await sample(selected)).luminance).toBe(preview.luminance);
      expectReadable(await sample(selected), true);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });
  }
}
