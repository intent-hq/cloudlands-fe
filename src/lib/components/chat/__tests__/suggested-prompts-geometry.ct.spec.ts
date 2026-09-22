import { expect, test } from '../../../../test/ct-test';
import SuggestedPromptsGeometryHost from './SuggestedPromptsGeometryHost.svelte';

const scenarios = [
  { name: 'normal light', compact: false, theme: 'light' as const, width: 480, zoom: 1 },
  { name: 'compact dark at 200%', compact: true, theme: 'dark' as const, width: 480, zoom: 2 },
];

for (const scenario of scenarios) {
  test(`aligns arrows to the first prompt line in ${scenario.name}`, async ({ mount }) => {
    const component = await mount(SuggestedPromptsGeometryHost, { props: scenario });
    const rows = component
      .getByTestId('suggested-prompts-list')
      .locator('[data-suggested-prompt-row]');
    const shortRow = rows.nth(0);
    const wrappedRow = rows.nth(1);
    const label = wrappedRow.locator('[data-suggested-prompt-label]');
    const surface = component.getByTestId('suggested-prompts-surface');
    const promptSlot = wrappedRow.locator('[data-suggested-prompt-icon]');
    const promptGlyph = promptSlot.locator('svg');
    const toolSlot = component.locator('[data-tool-icon]').first();
    const toolGlyph = toolSlot.locator('svg');

    await expect(rows).toHaveCount(2);
    await expect(label).toBeVisible();
    await expect(toolGlyph).toBeVisible();
    const readRowGeometry = (row: typeof shortRow) =>
      row.evaluate((element) => {
        const labelElement = element.querySelector('[data-suggested-prompt-label]') as HTMLElement;
        const hintElement = element.querySelector('[data-suggested-prompt-hint]') as HTMLElement;
        const slotElement = element.querySelector('[data-suggested-prompt-icon]') as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(labelElement);
        // The label wraps inline children (send control, anchors), so the range reports
        // one rect per box; collapse them into distinct line boxes by vertical position.
        const lineBoxes = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .sort((a, b) => a.top - b.top)
          .filter((rect, i, rects) => i === 0 || Math.abs(rect.top - rects[i - 1].top) > 1);
        const firstLineBox = lineBoxes[0];
        const rowBox = element.getBoundingClientRect();
        const labelBox = labelElement.getBoundingClientRect();
        const hintBox = hintElement.getBoundingClientRect();
        const slotBox = slotElement.getBoundingClientRect();
        const rowStyle = getComputedStyle(element);
        const labelStyle = getComputedStyle(labelElement);
        const hintStyle = getComputedStyle(hintElement);
        return {
          firstLineCenterDelta: Math.abs(
            slotBox.top + slotBox.height / 2 - (firstLineBox.top + firstLineBox.height / 2),
          ),
          hintFirstLineCenterDelta: Math.abs(
            hintBox.top + hintBox.height / 2 - (firstLineBox.top + firstLineBox.height / 2),
          ),
          lineCount: lineBoxes.length,
          contained: labelBox.right <= hintBox.left + 0.5 && hintBox.right <= rowBox.right + 0.5,
          fontSize: rowStyle.fontSize,
          lineHeight: rowStyle.lineHeight,
          fontWeight: labelStyle.fontWeight,
          labelColor: labelStyle.color,
          hintWeight: hintStyle.fontWeight,
          hintFontSize: hintStyle.fontSize,
          hintBackground: hintStyle.backgroundColor,
          rowOpacity: rowStyle.opacity,
          hintOpacity: hintStyle.opacity,
        };
      });
    const [shortGeometry, wrappedGeometry, shortRowBox, wrappedRowBox] = await Promise.all([
      readRowGeometry(shortRow),
      readRowGeometry(wrappedRow),
      shortRow.boundingBox(),
      wrappedRow.boundingBox(),
    ]);
    const surfaceMarginTop = await surface.evaluate(
      (element) => getComputedStyle(element).marginTop,
    );
    const toolColor = await toolSlot.evaluate((element) => getComputedStyle(element).color);
    const [promptSlotBox, toolSlotBox, promptGlyphBox, toolGlyphBox] = await Promise.all([
      promptSlot.boundingBox(),
      toolSlot.boundingBox(),
      promptGlyph.boundingBox(),
      toolGlyph.boundingBox(),
    ]);

    expect(wrappedGeometry).toMatchObject({
      contained: true,
      fontSize: '15px',
      lineHeight: '22px',
      fontWeight: '400',
      hintWeight: '400',
      hintFontSize: '13px',
      hintBackground: 'rgba(0, 0, 0, 0)',
      rowOpacity: '1',
      hintOpacity: '1',
    });
    expect(surfaceMarginTop).toBe('0px');
    expect(shortGeometry.lineCount).toBe(1);
    expect(wrappedGeometry.lineCount).toBeGreaterThan(1);
    expect(wrappedGeometry.labelColor).toBe(toolColor);
    expect(shortGeometry.firstLineCenterDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(wrappedGeometry.firstLineCenterDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(wrappedGeometry.hintFirstLineCenterDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(wrappedRowBox!.y - (shortRowBox!.y + shortRowBox!.height)).toBeCloseTo(
      (scenario.compact ? 0 : 2) * scenario.zoom,
      1,
    );
    expect(promptSlotBox?.width).toBeCloseTo(toolSlotBox!.width, 1);
    expect(promptSlotBox?.height).toBeCloseTo(toolSlotBox!.height, 1);
    expect(promptGlyphBox?.width).toBeCloseTo(toolGlyphBox!.width, 1);
    expect(promptGlyphBox?.height).toBeCloseTo(toolGlyphBox!.height, 1);
    expect(promptSlotBox?.width).toBeCloseTo(20 * scenario.zoom, 1);
    expect(promptGlyphBox?.width).toBeCloseTo(16 * scenario.zoom, 1);
    await shortRow.locator('[data-suggested-prompt-text]').focus();
    await shortRow.locator('[data-suggested-prompt-text]').press('Enter');
    await expect(component.getByTestId('selected-prompt')).toHaveText('Review the change.');
  });

  test(`keeps edit actions aligned without reflow in ${scenario.name}`, async ({ mount, page }) => {
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
      expect(resting.centerDelta).toBeLessThan(0.6 * scenario.zoom);
      expect(resting.button.width).toBeCloseTo(28 * scenario.zoom, 1);
      expect(resting.button.height).toBeCloseTo(28 * scenario.zoom, 1);
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
