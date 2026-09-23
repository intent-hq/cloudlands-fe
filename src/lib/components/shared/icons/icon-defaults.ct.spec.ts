import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import Preview from './icon-defaults.preview.svelte';
import { expectDestructiveMenuInk, expectMenuFirstLine } from '../../../../test/menu-geometry';

async function expectLeftAlignedCopy(rows: Locator) {
  const labels = await rows.locator('span[title]').evaluateAll((elements) =>
    elements.map((label) => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        align: getComputedStyle(label).textAlign,
        weight: getComputedStyle(label).fontWeight,
        textInset: range.getBoundingClientRect().left - label.getBoundingClientRect().left,
      };
    }),
  );
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.align).toBe('left');
    expect(label.weight).toBe('400');
    expect(Math.abs(label.textInset)).toBeLessThan(1);
  }
}

test('workspace list actions left-align copy, use regular glyphs, and preserve targets', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        versions: { electron: 'icon-preview-only' },
        invoke: async () => {
          throw new Error('Native actions are disabled in icon preview');
        },
      },
    });
  });
  await mount(Preview, { props: { layout: 'list' } });
  const trigger = page.getByRole('button', { name: 'Workspace actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu.getByRole('button', { name: 'Open in Finder' })).toBeVisible();
  const commands = menu.getByRole('button', { name: /^(Copy |Transfer |Archive |Delete )/ });
  await expectLeftAlignedCopy(menu.getByRole('button'));
  const glyphs = await commands.locator('svg[data-icon]').evaluateAll((icons) =>
    icons.map((svg) => {
      const rect = svg.getBoundingClientRect();
      const target = svg.closest('button')!.getBoundingClientRect();
      return {
        weight: svg.getAttribute('data-weight'),
        width: rect.width,
        height: rect.height,
        transform: getComputedStyle(svg).transform,
        targetHeight: target.height,
      };
    }),
  );
  expect(glyphs).toHaveLength(5);
  for (const glyph of glyphs) {
    expect(glyph).toEqual({
      weight: 'regular',
      width: 16,
      height: 16,
      transform: 'none',
      targetHeight: 28,
    });
  }
  await menu.getByRole('button', { name: 'Transfer to host' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('icon-defaults-preview')).toHaveAttribute(
    'data-last-action',
    'transfer',
  );
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('workspace menu keeps a viewport gutter and left-aligned copy with keyboard selection', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview);
  const trigger = page.getByRole('button', { name: 'Workspace actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  const transfer = menu.getByRole('menuitem', { name: 'Transfer to host' });
  await expect(transfer).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return Math.min(box.x, box.y, 360 - box.x - box.width, 600 - box.y - box.height);
    })
    .toBeGreaterThanOrEqual(8);
  await expectLeftAlignedCopy(menu.getByRole('menuitem'));
  await expect(transfer.locator('kbd')).toHaveCount(1);
  await expectMenuFirstLine(transfer, transfer);
  await expectDestructiveMenuInk(menu.getByRole('menuitem', { name: /^Delete Workspace/ }));
  await page.screenshot({ path: testInfo.outputPath('workspace-menu-inset.png') });
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('t');
  await expect(transfer).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('icon-defaults-preview')).toHaveAttribute(
    'data-last-action',
    'transfer',
  );
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
