import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import PanelDragRetainedNoteHarness from './mocks/PanelDragRetainedNoteHarness.svelte';

function measureNote(locator: Locator) {
  return locator.evaluate((note) => {
    const noteBox = note.getBoundingClientRect();
    const panel = note.closest<HTMLElement>('.panel-drag-preview-child, .panel-split-child')!;
    const panelBox = panel.getBoundingClientRect();
    const style = getComputedStyle(note);
    const leftInset = Number.parseFloat(style.paddingLeft);
    const rightInset = Number.parseFloat(style.paddingRight);
    return {
      panelWidth: panelBox.width,
      noteWidth: noteBox.width,
      leftInset,
      rightInset,
      contentLeft: noteBox.left - panelBox.left + leftInset,
      contentRight: panelBox.right - noteBox.right + rightInset,
    };
  });
}

for (const sourceSide of ['left', 'right'] as const) {
  test(`keeps the retained note gutter for a ${sourceSide}-source root preview`, async ({
    mount,
  }) => {
    const component = await mount(PanelDragRetainedNoteHarness, { props: { sourceSide } });
    const settledNote = component.locator(
      '[data-panel-id="retained-panel"] .positioning-relative-container',
    );
    await expect(settledNote).toBeVisible();
    const before = await measureNote(settledNote);

    await component.locator('[data-show-root-preview]').click();
    const preview = component.locator('[data-panel-layout-drag-preview]');
    await expect(preview).toHaveAttribute(
      'data-panel-layout-drag-preview',
      sourceSide === 'left' ? 'after' : 'before',
    );
    const previewNote = preview.locator(
      '[data-panel-layout-preview-panel="retained-panel"] .positioning-relative-container',
    );
    await expect(previewNote).toBeVisible();
    const during = await measureNote(previewNote);
    const split = preview.locator('[data-panel-layout-preview-split="horizontal"]');
    const widths = await split
      .locator(':scope > .panel-drag-preview-child')
      .evaluateAll((panels) => panels.map((panel) => panel.getBoundingClientRect().width));
    const splitWidth = await split.evaluate((element) => element.getBoundingClientRect().width);
    const gutterWidth = await split
      .locator('[data-panel-layout-preview-gutter="horizontal"]')
      .evaluate((element) => element.getBoundingClientRect().width);

    expect(before.leftInset).toBe(48);
    expect(before.rightInset).toBe(48);
    expect(during.leftInset).toBe(before.leftInset);
    expect(during.rightInset).toBe(before.rightInset);
    expect(during.contentLeft).toBeCloseTo(before.contentLeft, 1);
    expect(during.contentRight).toBeCloseTo(before.contentRight, 1);
    expect(during.panelWidth).toBeCloseTo(before.panelWidth, 1);
    expect(during.noteWidth).toBeCloseTo(before.noteWidth, 1);
    expect(gutterWidth).toBe(8);
    expect(widths[0] + gutterWidth + widths[1]).toBeCloseTo(splitWidth, 1);
  });
}
