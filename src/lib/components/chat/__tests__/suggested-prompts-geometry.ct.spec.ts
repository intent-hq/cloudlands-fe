import { expect, test } from '@playwright/experimental-ct-svelte';
import SuggestedPromptsGeometryHost from './SuggestedPromptsGeometryHost.svelte';

const scenarios = [
  { name: 'normal light', compact: false, theme: 'light' as const, width: 480, zoom: 1 },
  { name: 'normal dark narrow', compact: false, theme: 'dark' as const, width: 280, zoom: 1 },
  { name: 'compact light at 200%', compact: true, theme: 'light' as const, width: 280, zoom: 2 },
  { name: 'compact dark at 200%', compact: true, theme: 'dark' as const, width: 480, zoom: 2 },
];

for (const scenario of scenarios) {
  test(`matches operational typography and icon geometry in ${scenario.name}`, async ({
    mount,
  }) => {
    const component = await mount(SuggestedPromptsGeometryHost, { props: scenario });
    const row = component.getByRole('button', {
      name: 'Review the implementation and verify the focused behavior.',
    });
    const label = row.locator('[data-suggested-prompt-label]');
    const surface = component.getByTestId('suggested-prompts-surface');
    const promptSlot = row.locator('[data-suggested-prompt-icon]');
    const promptGlyph = promptSlot.locator('svg');
    const toolSlot = component.locator('[data-tool-icon]').first();
    const toolGlyph = toolSlot.locator('svg');

    await expect(label).toBeVisible();
    await expect(toolGlyph).toBeVisible();
    const geometry = await row.evaluate((element) => {
      const labelElement = element.querySelector('[data-suggested-prompt-label]') as HTMLElement;
      const hintElement = element.querySelector('[data-suggested-prompt-hint]') as HTMLElement;
      const slotElement = element.querySelector('[data-suggested-prompt-icon]') as HTMLElement;
      const rowBox = element.getBoundingClientRect();
      const labelBox = labelElement.getBoundingClientRect();
      const slotBox = slotElement.getBoundingClientRect();
      const rowStyle = getComputedStyle(element);
      const labelStyle = getComputedStyle(labelElement);
      const hintStyle = getComputedStyle(hintElement);
      return {
        centerDelta: Math.abs(
          slotBox.top + slotBox.height / 2 - (labelBox.top + labelBox.height / 2),
        ),
        contained: labelBox.right <= rowBox.right + 0.5,
        fontSize: rowStyle.fontSize,
        lineHeight: rowStyle.lineHeight,
        fontWeight: labelStyle.fontWeight,
        labelColor: labelStyle.color,
        hintWeight: hintStyle.fontWeight,
        hintFontSize: hintStyle.fontSize,
      };
    });
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

    expect(geometry).toMatchObject({
      contained: true,
      fontSize: '15px',
      lineHeight: '22px',
      fontWeight: '400',
      hintWeight: '400',
      hintFontSize: '13px',
    });
    expect(surfaceMarginTop).toBe('16px');
    expect(geometry.labelColor).toBe(toolColor);
    expect(geometry.centerDelta).toBeLessThan(0.6 * scenario.zoom);
    expect(promptSlotBox?.width).toBeCloseTo(toolSlotBox!.width, 1);
    expect(promptSlotBox?.height).toBeCloseTo(toolSlotBox!.height, 1);
    expect(promptGlyphBox?.width).toBeCloseTo(toolGlyphBox!.width, 1);
    expect(promptGlyphBox?.height).toBeCloseTo(toolGlyphBox!.height, 1);
    expect(promptSlotBox?.width).toBeCloseTo(20 * scenario.zoom, 1);
    expect(promptGlyphBox?.width).toBeCloseTo(16 * scenario.zoom, 1);
  });
}
