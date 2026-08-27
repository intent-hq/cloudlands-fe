import { expect, test } from '@playwright/experimental-ct-svelte';
import SuggestedPromptsGeometryHost from './SuggestedPromptsGeometryHost.svelte';

const scenarios = [
  { name: 'normal light', compact: false, theme: 'light' as const, width: 480, zoom: 1 },
  { name: 'compact dark at 200%', compact: true, theme: 'dark' as const, width: 480, zoom: 2 },
];

for (const scenario of scenarios) {
  test(`aligns arrows to the first prompt line in ${scenario.name}`, async ({ mount }) => {
    const component = await mount(SuggestedPromptsGeometryHost, { props: scenario });
    const rows = component.getByTestId('suggested-prompts-list').getByRole('button');
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
        const lineBoxes = Array.from(range.getClientRects());
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
          hintCenterDelta: Math.abs(
            hintBox.top + hintBox.height / 2 - (rowBox.top + rowBox.height / 2),
          ),
          lineCount: lineBoxes.length,
          contained: labelBox.right <= hintBox.left + 0.5 && hintBox.right <= rowBox.right + 0.5,
          fontSize: rowStyle.fontSize,
          lineHeight: rowStyle.lineHeight,
          fontWeight: labelStyle.fontWeight,
          labelColor: labelStyle.color,
          hintWeight: hintStyle.fontWeight,
          hintFontSize: hintStyle.fontSize,
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
    });
    expect(surfaceMarginTop).toBe('16px');
    expect(shortGeometry.lineCount).toBe(1);
    expect(wrappedGeometry.lineCount).toBeGreaterThan(1);
    expect(wrappedGeometry.labelColor).toBe(toolColor);
    expect(shortGeometry.firstLineCenterDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(wrappedGeometry.firstLineCenterDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(wrappedGeometry.hintCenterDelta).toBeLessThan(0.6 * scenario.zoom);
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
  });
}
