import { readFile } from 'node:fs/promises';
import { test, expect } from '../../test/ct-test';
import TokensByHourCard from './TokensByHourCard.svelte';
import ExportHarness from './TokensByHourCardExportHarness.svelte';

test('working-hours controls do not obscure or wrap the range at card width', async ({
  mount,
  page,
}) => {
  const mounted = await mount(ExportHarness);
  const card = mounted.locator('[data-stats-card]');
  await page.evaluate(() => document.fonts.ready);
  const bounds = await card.locator('.wh-bound').evaluateAll((nodes) =>
    nodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node.firstChild!);
      return range.getBoundingClientRect().toJSON();
    }),
  );
  expect(bounds[0].top).toBe(bounds[1].top);
  const buttons = card.getByRole('button');
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    for (const bound of bounds) {
      const overlap =
        Math.min(box!.x + box!.width, bound.right) > Math.max(box!.x, bound.left) &&
        Math.min(box!.y + box!.height, bound.bottom) > Math.max(box!.y, bound.top);
      expect(overlap, 'stepper must not cover the hour text').toBe(false);
    }
  }
  const boxes = await buttons.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (const other of boxes.slice(i + 1)) {
      const box = boxes[i];
      expect(
        Math.min(box.right, other.right) > Math.max(box.left, other.left) &&
          Math.min(box.bottom, other.bottom) > Math.max(box.top, other.top),
      ).toBe(false);
    }
  }
  const content = await card
    .locator('.stat-value')
    .first()
    .evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const rects = [];
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.textContent?.trim() || text.parentElement?.closest('button')) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        rects.push(...Array.from(range.getClientRects(), (rect) => rect.toJSON()));
      }
      return rects;
    });
  expect(
    new Set(content.map((rect) => rect.top)).size,
    'range and percentage stay on one line',
  ).toBe(1);
  const row = card.locator('.stat-grid');
  expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('working-hours controls are keyboard reachable without hovering', async ({ mount, page }) => {
  const card = await mount(TokensByHourCard, {
    props: { data: null, mode: 'month', label: 'SEP 2026' },
  });
  await page.mouse.move(700, 700);
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: 'Increase working hours start' })).toBeFocused();
  const focus = await card
    .getByRole('button', { name: 'Increase working hours start' })
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        visible: style.visibility,
        opacity: style.opacity,
        outline: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });
  expect(focus.visible).toBe('visible');
  expect(Number(focus.opacity)).toBeGreaterThan(0);
  expect(focus.outline).not.toBe('none');
  expect(focus.width).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(card.locator('.wh-bound').first()).toContainText('10');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(card.locator('.wh-bound').first()).toContainText('09');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(card.locator('.wh-bound').last()).toContainText('19');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(card.locator('.wh-bound').last()).toContainText('18');
  await card.getByRole('button', { name: 'Increase working hours start' }).click();
  await expect(card.locator('.wh-bound').first()).toContainText('10');
  await card.getByRole('button', { name: 'Decrease working hours end' }).click();
  await expect(card.locator('.wh-bound').last()).toContainText('17');
});

test('PNG export removes hovered and keyboard-focused controls without changing the card', async ({
  mount,
  page,
}, testInfo) => {
  const mounted = await mount(ExportHarness);
  const card = mounted.locator('[data-stats-card]');
  await page.evaluate(() => document.fonts.ready);
  const screenshot = testInfo.outputPath('stepper.png');
  await card.screenshot({ path: screenshot });
  await testInfo.attach('working-hours stepper', { path: screenshot, contentType: 'image/png' });

  async function capture(name: string) {
    const downloaded = page.waitForEvent('download');
    // Dispatch without moving the pointer or focus off the stepper.
    await mounted.getByRole('button', { name: 'Export test card' }).dispatchEvent('click');
    const download = await downloaded;
    const path = testInfo.outputPath(`${name}.png`);
    await download.saveAs(path);
    await testInfo.attach(name, { path, contentType: 'image/png' });
    return readFile(path);
  }

  const controls = card.getByRole('button');
  await page.mouse.move(700, 700);
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  const focused = await capture('focused-export');
  await controls.last().hover();
  const hovered = await capture('hovered-export');
  // Independent oracle: export the same card with the controls removed entirely.
  // Unlike hiding via CSS, removal cannot accidentally serialize interactive chrome.
  await controls.evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const withoutControls = await capture('control-free-export');
  expect(focused.equals(withoutControls)).toBe(true);
  expect(hovered.equals(withoutControls)).toBe(true);
  expect(withoutControls.readUInt32BE(16)).toBe(1080);
  expect(withoutControls.readUInt32BE(20)).toBe(1920);
});
