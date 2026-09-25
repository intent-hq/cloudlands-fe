import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import ModelPickerGeometryHost from './ModelPickerGeometryHost.svelte';

async function expectReadableOptions(popup: Locator) {
  const geometry = await popup.getByRole('option').evaluateAll((options) =>
    options.map((option) => {
      const label = option.firstElementChild as HTMLElement;
      const indicator = option.querySelector('[data-slot="select-item-check"]')!;
      const text = document.createRange();
      text.selectNodeContents(label);
      const labelBox = label.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      const indicatorBox = indicator.getBoundingClientRect();
      return {
        label: label.textContent,
        overflow: label.scrollWidth - label.clientWidth,
        clippedText: textBox.right - labelBox.right,
        indicatorGap: indicatorBox.left - textBox.right,
        indicatorWidth: indicatorBox.width,
        indicatorOverflow: indicatorBox.right - option.getBoundingClientRect().right,
      };
    }),
  );
  expect(geometry.length).toBeGreaterThan(0);
  for (const option of geometry) {
    expect(option.overflow, `${option.label}: label fits`).toBeLessThanOrEqual(1);
    expect(option.clippedText, `${option.label}: glyphs fit`).toBeLessThanOrEqual(1);
    expect(option.indicatorGap, `${option.label}: indicator clearance`).toBeGreaterThanOrEqual(7);
    expect(option.indicatorWidth, `${option.label}: reserved indicator`).toBeGreaterThan(0);
    expect(option.indicatorOverflow, `${option.label}: indicator fits`).toBeLessThanOrEqual(0);
  }
  return geometry;
}

async function expectViewportGutter(popup: Locator, page: Page) {
  await expect(popup).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const bounds = (await popup.boundingBox())!;
      return Math.min(
        bounds.x,
        bounds.y,
        viewport.width - bounds.x - bounds.width,
        viewport.height - bounds.y - bounds.height,
      );
    })
    .toBeGreaterThanOrEqual(7.5);
}

for (const { name, width, height } of [
  { name: 'normal composer', width: 900, height: 800 },
  { name: 'narrow composer', width: 320, height: 480 },
]) {
  test(`${name}: effort options outgrow Auto without clipping or closing their parent`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ModelPickerGeometryHost, { props: { placement: 'composer' } });
    await page.evaluate(() => document.fonts.ready);
    const modelTrigger = page.getByTestId('model-picker-host').getByRole('button');
    await modelTrigger.press('Enter');
    await expect(page.getByRole('searchbox')).toBeFocused();
    const outer = page.locator('[data-slot="dropdown-content"]');
    const effortTrigger = page.getByTestId('effort-picker-trigger');
    await expect(effortTrigger).toHaveAccessibleName(/Auto/);
    const triggerBefore = (await effortTrigger.boundingBox())!;
    await effortTrigger.click();
    const popup = page.locator('[data-slot="select-content"]');
    await expectViewportGutter(popup, page);
    const popupBefore = (await popup.boundingBox())!;
    expect(popupBefore.width).toBeGreaterThan(triggerBefore.width);
    const auto = popup.getByRole('option', { name: 'Auto', exact: true });
    const extraHigh = popup.getByRole('option', { name: 'Extra high', exact: true });
    await expect(auto).toHaveAttribute('aria-selected', 'true');
    const optionGeometry = await expectReadableOptions(popup);
    await info.attach('auto-effort-options', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await extraHigh.click();
    await expect(page.getByTestId('selection')).toHaveText(
      JSON.stringify({ model: 'reasoning-model', effort: 'xhigh', changes: 1 }),
    );
    await expect(popup).toHaveCount(0);
    await expect(outer).toBeVisible();
    await expect(effortTrigger).toBeFocused();
    expect((await effortTrigger.boundingBox())!.width).toBe(triggerBefore.width);

    await page.keyboard.press('Enter');
    await expect(extraHigh).toHaveAttribute('aria-selected', 'true');
    await expectViewportGutter(popup, page);
    await expectReadableOptions(popup);
    await info.attach('selected-extra-high-options', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await info.attach('effort-width-geometry', {
      body: JSON.stringify({ triggerBefore, popupBefore, optionGeometry }),
      contentType: 'application/json',
    });

    // Auto still clears the explicit effort once through the production picker.
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('selection')).toHaveText(
      JSON.stringify({ model: 'reasoning-model', effort: null, changes: 2 }),
    );
    await expect(popup).toHaveCount(0);
    await expect(effortTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(auto).toHaveAttribute('aria-selected', 'true');

    // One Escape dismisses the nested select, not the model picker.
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(outer).toBeVisible();
    await expect(effortTrigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(outer).toHaveCount(0);
    await expect(modelTrigger).toBeFocused();
  });
}
