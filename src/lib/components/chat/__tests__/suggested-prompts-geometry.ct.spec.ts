import { expect, test } from '../../../../test/ct-test';
import SuggestedPromptsGeometryHost from './SuggestedPromptsGeometryHost.svelte';

const scenarios = [
  { name: 'normal light', compact: false, theme: 'light' as const, width: 480, zoom: 1 },
  { name: 'compact dark at 200%', compact: true, theme: 'dark' as const, width: 480, zoom: 2 },
];

for (const scenario of scenarios) {
  test(`keeps wrapped prompts contained and keyboard selectable in ${scenario.name}`, async ({
    mount,
  }) => {
    const component = await mount(SuggestedPromptsGeometryHost, { props: scenario });
    const rows = component
      .getByTestId('suggested-prompts-list')
      .locator('[data-suggested-prompt-row]');
    const shortRow = rows.nth(0);
    const wrappedRow = rows.nth(1);
    const label = wrappedRow.locator('[data-suggested-prompt-label]');
    const toolSlot = component.locator('[data-tool-icon]').first();
    const toolGlyph = toolSlot.locator('svg');

    await expect(rows).toHaveCount(2);
    await expect(label).toBeVisible();
    await expect(toolGlyph).toBeVisible();
    const readRowGeometry = (row: typeof shortRow) =>
      row.evaluate((element) => {
        const label = element.querySelector('[data-suggested-prompt-label]')!;
        const hint = element.querySelector('[data-suggested-prompt-hint]')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const lineBoxes = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .sort((a, b) => a.top - b.top)
          .filter((rect, i, rects) => i === 0 || Math.abs(rect.top - rects[i - 1].top) > 1);
        const labelBox = label.getBoundingClientRect();
        const hintBox = hint.getBoundingClientRect();
        const rowBox = element.getBoundingClientRect();
        return {
          lineCount: lineBoxes.length,
          contained: labelBox.right <= hintBox.left + 0.5 && hintBox.right <= rowBox.right + 0.5,
        };
      });
    const shortGeometry = await readRowGeometry(shortRow);
    const wrappedGeometry = await readRowGeometry(wrappedRow);
    expect(wrappedGeometry.contained).toBe(true);
    expect(shortGeometry.lineCount).toBe(1);
    expect(wrappedGeometry.lineCount).toBeGreaterThan(1);
    await shortRow.locator('[data-suggested-prompt-text]').focus();
    await shortRow.locator('[data-suggested-prompt-text]').press('Enter');
    await expect(component.getByTestId('selected-prompt')).toHaveText('Review the change.');
  });

  test(`keeps edit actions usable without reflow in ${scenario.name}`, async ({ mount, page }) => {
    const component = await mount(SuggestedPromptsGeometryHost, { props: scenario });
    const rows = component.locator('[data-suggested-prompt-row]');
    await expect(rows).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);

    for (let index = 0; index < 2; index += 1) {
      const row = rows.nth(index);
      const edit = row.getByRole('button', { name: 'Edit in input' });
      const send = row.locator('[data-suggested-prompt-text]');
      const prompt = await send.textContent();
      const readGeometry = () =>
        row.evaluate((element) => {
          const box = (target: Element) => {
            const { x, y, width, height } = target.getBoundingClientRect();

            return { x, y, width, height };
          };
          const arrow = box(element.querySelector('[data-suggested-prompt-icon] svg')!);
          const button = element.querySelector('button')!;
          const pencil = box(button.querySelector('svg')!);
          return {
            row: box(element),
            label: box(element.querySelector('[data-suggested-prompt-label]')!),
            hint: box(element.querySelector('[data-suggested-prompt-hint]')!),
            button: box(button),
            centerDelta: Math.abs(pencil.y + pencil.height / 2 - (arrow.y + arrow.height / 2)),
          };
        });

      await page.mouse.move(0, 0);
      await expect(edit).toHaveCSS('opacity', '0');
      const resting = await readGeometry();
      expect(resting.hint.x + resting.hint.width).toBeLessThanOrEqual(resting.button.x);

      await row.hover();
      await expect(edit).toHaveCSS('opacity', '1');
      expect(await readGeometry()).toEqual(resting);
      await edit.hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await edit.click();
      await expect(component.getByTestId('edited-prompt')).toHaveText(prompt!);
      await expect(component.getByTestId('edit-count')).toHaveText(String(index * 2 + 1));
      await expect(component.getByTestId('selection-count')).toHaveText(String(index));

      await page.mouse.move(0, 0);
      await send.focus();
      await send.press('Tab');
      await expect(edit).toBeFocused();
      await expect(edit).toHaveCSS('opacity', '1');
      expect(await readGeometry()).toEqual(resting);
      await edit.press('Space');
      await expect(component.getByTestId('edit-count')).toHaveText(String(index * 2 + 2));
      await expect(component.getByTestId('selection-count')).toHaveText(String(index));
      await send.focus();
      await send.press('Enter');
      await expect(component.getByTestId('selected-prompt')).toHaveText(prompt!);
      await expect(component.getByTestId('selection-count')).toHaveText(String(index + 1));
      await expect(component.getByTestId('edit-count')).toHaveText(String(index * 2 + 2));
    }
  });
}

for (const scenario of scenarios) {
  // Regression: an unfocused chat gains focus on pointerdown (Panel capture handler and
  // focusin on the prompt's send control), so the hints appear mid-click. Inserting them
  // reflowed rows between mousedown and mouseup and the click could miss its prompt.
  test(`keeps prompt rows still when shortcut hints appear in ${scenario.name}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(SuggestedPromptsGeometryHost, {
      props: { ...scenario, showShortcutHints: false, reserveShortcutHintSpace: true },
    });
    const rows = component.locator('[data-suggested-prompt-row]');
    const hints = component.locator('[data-suggested-prompt-hint]');
    await expect(rows).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);

    const readGeometry = () =>
      component.getByTestId('suggested-prompts-list').evaluate((list) => {
        const box = (target: Element) => {
          const { x, y, width, height } = target.getBoundingClientRect();

          return { x, y, width, height };
        };
        return Array.from(list.querySelectorAll('[data-suggested-prompt-row]')).map((row) => ({
          row: box(row),
          label: box(row.querySelector('[data-suggested-prompt-label]')!),
        }));
      });

    const unfocused = await readGeometry();
    await component.update({ props: { showShortcutHints: true } });
    await expect(hints).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(hints.nth(index)).toBeVisible();
      await expect(hints.nth(index)).not.toHaveAttribute('aria-hidden', 'true');
    }
    // The label shares the row with the hint, so any reflow shows up in its box.
    expect(await readGeometry()).toEqual(unfocused);

    await component.update({ props: { showShortcutHints: false } });
    await expect(hints).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(hints.nth(index)).toBeHidden();
      await expect(hints.nth(index)).toHaveAttribute('aria-hidden', 'true');
    }
    expect(await readGeometry()).toEqual(unfocused);
  });
}
