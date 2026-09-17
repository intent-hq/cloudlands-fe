import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import RemoteCursorTagHarness from './RemoteCursorTagHarness.svelte';

// A peer's caret tag carries the complete display name and stays clear of
// the text: never clipped by the note's scroll container, never covering the
// glyphs of the caret's own line, above the line by default and below it only
// when there is no room above (the first line of the document).
const LONG_NAME = 'Clement Pang-Winterbottom (personal account)';
const HOST_WIDTH = 720;
const FIRST = 'The first paragraph holds the opening line of the note.';
const SECOND = 'A second paragraph follows so a caret can sit below another line of text.';
// Doc positions: paragraph 1 opens at 0, paragraph 2 opens after its close.
const SECOND_START = FIRST.length + 3;
const SECOND_END = SECOND_START + SECOND.length;

interface Geometry {
  label: string;
  overflow: number;
  host: { left: number; right: number; top: number };
  tag: { left: number; right: number; top: number; bottom: number };
  /** The bar spans the caret line's glyph box (1.2em from its top). */
  bar: { left: number; right: number; top: number; bottom: number };
  /** Bottom of the glyph box of the last line above the caret's paragraph. */
  lineAboveBottom: number | null;
}

const geometry = (host: Locator): Promise<Geometry> =>
  host.evaluate((node) => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const tag = node.querySelector('.remote-cursor__tag')!;
    const name = node.querySelector('.remote-cursor__name')!;
    const bar = node.querySelector('.remote-cursor__bar')!;
    const paragraph = node.querySelector('.remote-cursor')!.closest('p')!;
    const previous = paragraph.previousElementSibling;
    let lineAboveBottom: number | null = null;
    if (previous) {
      const style = getComputedStyle(previous);
      const halfLeading = (parseFloat(style.lineHeight) - parseFloat(style.fontSize) * 1.2) / 2;
      lineAboveBottom = rect(previous).bottom - halfLeading;
    }
    const host = rect(node);
    const t = rect(tag);
    const b = rect(bar);
    return {
      label: name.textContent ?? '',
      overflow: tag.scrollWidth - tag.clientWidth,
      host: { left: host.left, right: host.right, top: host.top },
      tag: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
      bar: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      lineAboveBottom,
    };
  });

const afterTwoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

async function mountHarness(
  mount: Parameters<Parameters<typeof test>[1]>[0]['mount'],
  page: Page,
  head: number,
) {
  await page.setViewportSize({ width: HOST_WIDTH + 64, height: 600 });
  await mount(RemoteCursorTagHarness, {
    props: { label: LONG_NAME, head, hostWidth: HOST_WIDTH, paragraphs: [FIRST, SECOND] },
  });
  const host = page.getByTestId('note-host');
  await expect(host.locator('.remote-cursor__tag')).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  await afterTwoFrames(page);
  const g = await geometry(host);
  test.info().annotations.push({ type: 'geometry', description: JSON.stringify(g) });
  return g;
}

function expectFullNameClearOfCaretLine(g: Geometry) {
  expect(g.label).toBe(LONG_NAME);
  expect(g.overflow).toBeLessThanOrEqual(0);
  expect(g.tag.right - g.tag.left).toBeGreaterThan(150);
  expect(g.tag.left).toBeGreaterThanOrEqual(g.host.left);
  expect(g.tag.right).toBeLessThanOrEqual(g.host.right);
  expect(g.tag.top).toBeGreaterThanOrEqual(g.host.top);
  const clearOfGlyphs = g.tag.bottom <= g.bar.top + 0.5 || g.tag.top >= g.bar.bottom - 0.5;
  expect(clearOfGlyphs).toBe(true);
}

test('sits above the caret line, starting at the caret, in the middle of a line', async ({
  mount,
  page,
}) => {
  const g = await mountHarness(mount, page, SECOND_START + 12);
  expectFullNameClearOfCaretLine(g);
  expect(g.tag.bottom).toBeLessThanOrEqual(g.bar.top + 0.5);
  expect(Math.abs(g.tag.left - g.bar.left)).toBeLessThanOrEqual(1);
  expect(g.tag.top).toBeGreaterThanOrEqual(g.lineAboveBottom! - 0.5);
});

test('flips to the left of the caret when a long name would leave the editor', async ({
  mount,
  page,
}) => {
  const g = await mountHarness(mount, page, SECOND_END);
  expectFullNameClearOfCaretLine(g);
  expect(g.tag.bottom).toBeLessThanOrEqual(g.bar.top + 0.5);
  expect(Math.abs(g.tag.right - g.bar.right)).toBeLessThanOrEqual(1);
  expect(g.tag.top).toBeGreaterThanOrEqual(g.lineAboveBottom! - 0.5);
});

test('drops below the first line of the document instead of being clipped', async ({
  mount,
  page,
}) => {
  const g = await mountHarness(mount, page, 6);
  expectFullNameClearOfCaretLine(g);
  expect(g.tag.top).toBeGreaterThanOrEqual(g.bar.bottom - 0.5);
});
