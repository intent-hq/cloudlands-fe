import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerSpecHarness from './DockComposerSpecHarness.svelte';

/** Owner-spec screens rendered by the production panel, composer, footer and tiles. */
const SUFFIX = process.env.DOCK_SPEC_SUFFIX ?? '';

async function capture(page: Page, name: string): Promise<void> {
  const box = await page.getByTestId('composer-spec').boundingBox();
  if (!box) throw new Error('Missing harness bounds');
  // Page clip so portaled tooltips and the tool popover are included.
  const info = test.info();
  const path = info.outputPath(`${name}${SUFFIX}.png`);
  await page.screenshot({ path, clip: box });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** Left/right edges of the first tile, the editor text and the footer's outer controls. */
async function readEdges(component: Locator) {
  return component.evaluate((root) => {
    const rect = (el: Element | null | undefined) => el?.getBoundingClientRect() ?? null;
    const tile = root.querySelector('[data-dock-media-attachments] .tile');
    const paragraph = root.querySelector('.tiptap-editor p');
    const picker = Array.from(
      root.querySelectorAll<HTMLElement>('[data-chat-input-primary-actions] button'),
    ).find((button) => button.getBoundingClientRect().width > 0);
    // The picker's leading glyph (provider icon); the hover surface layer is excluded.
    const glyph = picker?.querySelector(
      '[data-slot="button-content"] svg, [data-slot="button-content"] img',
    );
    const glyphLeft = rect(glyph)?.left ?? null;
    const send = root.querySelector('[data-testid="composer-submit-button"]');
    const card = root.querySelector('[data-testid="message-input"]');
    const cardStyle = card ? getComputedStyle(card) : null;
    const capture = root.querySelector('[data-dock-media-footer] .capture-button');
    const row = root.querySelector('[data-dock-media-attachments]');
    return {
      tileLeft: rect(tile)?.left ?? null,
      textLeft: rect(paragraph)?.left ?? null,
      pickerIconLeft: glyphLeft,
      textRight: rect(paragraph)?.right ?? null,
      rowRight: row ? rect(row)!.right - parseFloat(getComputedStyle(row).paddingRight) : null,
      // Gaps from the card's inner border edge to Send and to an icon button.
      sendRightGap:
        card && send
          ? rect(card)!.right - parseFloat(cardStyle!.borderRightWidth) - rect(send)!.right
          : null,
      sendBottomGap:
        card && send
          ? rect(card)!.bottom - parseFloat(cardStyle!.borderBottomWidth) - rect(send)!.bottom
          : null,
      iconBottomGap:
        card && capture
          ? rect(card)!.bottom - parseFloat(cardStyle!.borderBottomWidth) - rect(capture)!.bottom
          : null,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
});

test('tile, text and model icon share one left edge; Send hugs the card corner', async ({
  mount,
}) => {
  const component = await mount(ComposerSpecHarness, { props: { screen: 4 } });
  await expect(component.locator('[data-dock-media-attachments] .tile')).toBeVisible();
  await expect(component.locator('.screen-reference-chip').first()).toBeVisible();
  const edges = await readEdges(component);
  expect(edges.tileLeft).not.toBeNull();
  expect(edges.textLeft).not.toBeNull();
  expect(edges.pickerIconLeft).not.toBeNull();
  expect(Math.abs(edges.tileLeft! - edges.textLeft!)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.pickerIconLeft! - edges.textLeft!)).toBeLessThanOrEqual(1);
  // Tiles and text share the card's normal inner right edge; only Send sits in the corner.
  expect(Math.abs(edges.rowRight! - edges.textRight!)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.sendRightGap! - 6)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.sendBottomGap! - 6)).toBeLessThanOrEqual(1);
  // Footer controls center on Send, so the space under them stays small.
  expect(edges.iconBottomGap!).toBeLessThanOrEqual(7);
});

for (const screen of [1, 2, 3, 4, 5, 6] as const) {
  test(`owner spec screen ${screen} renders in the dock composer`, async ({ mount, page }) => {
    const component = await mount(ComposerSpecHarness, { props: { screen } });
    const footer = component.locator('[data-dock-media-footer]');
    await expect(footer).toBeVisible();
    const editor = component.locator('.tiptap-editor');
    // The composer is focused when the dock conversation opens; focus reveals the placeholder.
    if (screen <= 3) await editor.click();
    if (screen === 5) {
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ArrowRight');
      await component.getByRole('button', { name: 'Start interim speech' }).click();
      await expect(component.locator('[data-screen-interim]')).toBeVisible();
    }
    if (screen === 2) {
      await component.locator('[data-dock-media-attachments] .tile').first().hover();
      await expect(component.getByRole('button', { name: 'Mark up' })).toBeVisible();
    }
    if (screen === 3) {
      const annotate = component.getByRole('button', {
        name: /^Annotate the screen\. Current tool:/,
      });
      await annotate.hover();
      await expect(page.getByRole('toolbar', { name: 'Annotation tools' })).toBeVisible();
      // The caret is visible in the gap and points at the button that owns the popover.
      const caret = page.locator('.tool-caret span');
      await expect(caret).toBeVisible();
      const [tip, button] = await Promise.all([caret.boundingBox(), annotate.boundingBox()]);
      expect(tip && button).toBeTruthy();
      expect(
        Math.abs(tip!.x + tip!.width / 2 - (button!.x + button!.width / 2)),
      ).toBeLessThanOrEqual(1);
      expect(tip!.y + tip!.height).toBeLessThanOrEqual(button!.y);
    }
    if (screen === 5) await expect(component.locator('[data-dock-dictation-time]')).toBeVisible();
    if (screen === 6)
      await expect(component.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    // Let fonts and images settle before the artifact.
    await page.evaluate(() => document.fonts.ready);
    await capture(page, `dock-composer-spec-${screen}`);
    expect(JSON.parse((await component.getAttribute('data-actions')) ?? '[]')).toEqual([]);
  });
}

test('an empty draft explains why Send is unavailable on hover', async ({ mount, page }) => {
  const component = await mount(ComposerSpecHarness, { props: { screen: 1 } });
  const send = component.getByTestId('composer-submit-button');
  await expect(send).toBeDisabled();
  await send.hover({ force: true });
  await expect(page.getByRole('tooltip')).toContainText('Add a message or an attachment to send');
});
