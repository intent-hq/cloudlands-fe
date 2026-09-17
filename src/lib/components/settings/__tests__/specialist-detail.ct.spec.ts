import { expect, test } from '@playwright/experimental-ct-svelte';
import SpecialistDetailPreview from '../specialist-detail.preview.svelte';
import { measureText } from './specialist-detail.assertions';

for (const theme of ['light', 'dark'] as const) {
  test(`specialist status and secondary actions meet WCAG text contrast in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(SpecialistDetailPreview);
    const advanced = component.getByRole('button', { name: 'Advanced', exact: true });
    const targets = [
      component.getByText('Modified', { exact: true }),
      component.getByText('Open', { exact: true }),
      advanced,
    ];
    for (const target of targets) {
      const color = await target.evaluate(measureText);
      expect(color.background[3]).toBe(1);
      expect(color.contrast, JSON.stringify(color)).toBeGreaterThanOrEqual(4.5);
    }
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    for (const target of [advanced, component.getByRole('button', { name: 'Add model option' })]) {
      const color = await target.evaluate(measureText);
      expect(color.contrast, JSON.stringify(color)).toBeGreaterThanOrEqual(4.5);
    }
    const model = await component.getByText('Model', { exact: true }).evaluate(measureText);
    const muted = await advanced.evaluate(measureText);
    expect(muted.color).not.toBe(model.color);
    expect(Number(muted.weight)).toBeLessThan(Number(model.weight));
  });
}

for (const width of [420, 1440]) {
  test(`specialist detail text and split controls align at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(SpecialistDetailPreview);
    await page.evaluate(() => document.fonts.ready);
    const group = component.locator('[data-open-combo-control]');
    const buttons = group.getByRole('button');
    await expect(buttons).toHaveCount(2);
    const [primary, caret, bounds] = await Promise.all([
      buttons.nth(0).boundingBox(),
      buttons.nth(1).boundingBox(),
      group.boundingBox(),
    ]);
    expect(primary!.height).toBeGreaterThanOrEqual(28);
    expect(caret!.width).toBeGreaterThanOrEqual(28);
    expect(Math.abs(primary!.height - caret!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(primary!.y - caret!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(primary!.x + primary!.width - caret!.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(primary!.x - bounds!.x - 1)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(caret!.x + caret!.width - bounds!.x - bounds!.width + 1)).toBeLessThanOrEqual(
      0.5,
    );
    const divider = await buttons.nth(1).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: parseFloat(style.borderLeftWidth),
        style: style.borderLeftStyle,
        innerRadius: parseFloat(style.borderTopLeftRadius),
      };
    });
    expect(divider.width).toBe(1);
    expect(divider.style).toBe('solid');
    expect(divider.innerRadius).toBe(0);
    const details = component.getByTestId('specialist-details-column');
    const advanced = details.getByRole('button', { name: 'Advanced', exact: true });
    await advanced.click();
    const add = details.getByRole('button', { name: 'Add model option' });
    await expect(add).toBeVisible();
    const leftEdges = await Promise.all([
      details.locator('p').first().evaluate(measureText),
      details.getByText('Model', { exact: true }).evaluate(measureText),
      advanced.evaluate(measureText),
      add.evaluate(measureText),
      details.locator('#specialist-model-options-label').evaluate(measureText),
      details.locator('#specialist-model-options-description').evaluate(measureText),
    ]);
    const xs = leftEdges.map((edge) => edge.x!);
    expect(Math.max(...xs) - Math.min(...xs), JSON.stringify(leftEdges)).toBeLessThanOrEqual(1);
    await add.click();
    await expect(details.getByRole('textbox')).toHaveCount(1);
    const overflow = await details.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const hint = (await details.getByRole('textbox').boundingBox())!;
    const column = (await details.boundingBox())!;
    expect(hint.width).toBeGreaterThanOrEqual(100);
    expect(hint.x + hint.width).toBeLessThanOrEqual(column.x + column.width + 1);
  });
}

test('keyboard activates separate launch, menu and advanced model-option controls safely', async ({
  mount,
  page,
}) => {
  const component = await mount(SpecialistDetailPreview);
  const buttons = component.locator('[data-open-combo-control]').getByRole('button');
  await buttons.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => JSON.parse(await component.getByTestId('editor-launches').innerText()))
    .toEqual([
      {
        channel: 'vscode:open',
        args: [
          {
            folder: '/tmp/intent-demo/specialists',
            file: '/tmp/intent-demo/specialists/review-helper.md',
          },
        ],
      },
    ]);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(buttons.nth(1)).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const advanced = component.getByRole('button', { name: 'Advanced', exact: true });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await expect(advanced).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  const add = component.getByRole('button', { name: 'Add model option' });
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  const details = component.getByTestId('specialist-details-column');
  await expect(details.getByRole('textbox')).toHaveCount(1);
  await details.getByRole('button', { name: 'Remove model option' }).focus();
  await page.keyboard.press('Enter');
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await advanced.focus();
  await page.keyboard.press('Space');
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(add).toBeHidden();
});
