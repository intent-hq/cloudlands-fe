import { expect, test } from '../../../../test/ct-test';
import type { ComponentFixtures } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import { failOnConsoleErrors } from '../../../../test/ct-console-errors';
import LineAttributionGutterHarness from './LineAttributionGutterHarness.svelte';

// Label placement contract (intent-hq/intent#5575): the hover label of an
// attributed span stays fully inside the clipping note panel, follows the
// pointer vertically within the span, and at ordinary widths never crosses
// the editor text's left edge. The prose column is 60rem wide, so 1200px
// (a 1440px window minus the sidebar) leaves room for the label left of the
// gutter while 1000px leaves only 20px — the clipped case from the issue.
const ORDINARY_HOST = 1200;
const NARROW_HOST = 1000;

failOnConsoleErrors(test);

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

const MARKDOWN = [
  '# Attributed spec',
  '',
  'Intro paragraph that the daemon has no attribution for.',
  '',
  Array.from({ length: 14 }, (_, i) => `Edited sentence number ${i + 1} of the section.`).join(' '),
  '',
  'Closing paragraph without attribution.',
].join('\n');

// Line 5 is the long edited paragraph; the other lines stay unattributed so
// exactly one span renders.
const hooksConfig = {
  mockBackend: {
    'note.lineAttribution.load': {
      noteId: 'note-1',
      workspaceId: 'ws-1',
      computedAt: '2026-09-22T00:00:00.000Z',
      attributions: {
        '5': {
          timestamp: Date.now() - 3 * 60_000,
          author: { id: 'agent-1', name: 'Coordinator', type: 'agent' },
        },
      },
    },
  },
};

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type CtLocator = ReturnType<Awaited<ReturnType<ComponentFixtures['mount']>>['locator']>;

const box = (locator: CtLocator): Promise<Box> =>
  locator.evaluate((node) => {
    const { left, right, top, bottom } = node.getBoundingClientRect();
    return { left, right, top, bottom };
  });

async function mountHarness(mount: ComponentFixtures['mount'], page: Page, hostWidth: number) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: hostWidth + 64, height: 800 });
  const component = await mount(LineAttributionGutterHarness, {
    props: { hostWidth, markdown: MARKDOWN },
    hooksConfig,
  });
  const span = component.locator('[data-attribution-span]');
  const label = component.locator('[data-attribution-label]');
  await expect(span).toHaveCount(1);
  // The span is re-measured (debounced) after the web font swaps in and the
  // paragraph reflows; wait until it covers the attributed paragraph exactly.
  await page.evaluate(() => document.fonts.ready);
  const paragraph = component.locator('.tiptap-editor > p').nth(1);
  await expect
    .poll(async () => {
      const [spanBox, paragraphBox] = await Promise.all([box(span), box(paragraph)]);
      return (
        Math.abs(spanBox.top - paragraphBox.top) + Math.abs(spanBox.bottom - paragraphBox.bottom)
      );
    })
    .toBeLessThan(1);
  return {
    span,
    label,
    panel: component.getByTestId('editor-content'),
    text: component.locator('.tiptap-editor'),
  };
}

// Hovers the span's bar at `fraction` of its height and returns the pointer y.
async function hoverSpan(page: Page, span: CtLocator, fraction: number) {
  const rect = await box(span);
  const pointerY = rect.top + (rect.bottom - rect.top) * fraction;
  await page.mouse.move(rect.right - 2, pointerY, { steps: 3 });
  return pointerY;
}

for (const [name, hostWidth] of [
  ['ordinary', ORDINARY_HOST],
  ['narrow', NARROW_HOST],
] as const) {
  test(`${name} panel: the hovered label stays inside the panel and within the span`, async ({
    mount,
    page,
  }) => {
    const { span, label, panel } = await mountHarness(mount, page, hostWidth);
    const hitTargetBefore = await box(span);

    const pointerY = await hoverSpan(page, span, 0.75);
    await expect(label).toHaveCSS('opacity', '1');

    const [labelBox, panelBox, hitTargetAfter] = await Promise.all([
      box(label),
      box(panel),
      box(span),
    ]);
    expect(labelBox.left).toBeGreaterThanOrEqual(panelBox.left);
    expect(labelBox.right).toBeLessThanOrEqual(panelBox.right);
    expect(labelBox.top).toBeGreaterThanOrEqual(panelBox.top);
    expect(labelBox.bottom).toBeLessThanOrEqual(panelBox.bottom);

    expect(labelBox.top).toBeGreaterThanOrEqual(hitTargetBefore.top - 0.5);
    expect(labelBox.bottom).toBeLessThanOrEqual(hitTargetBefore.bottom + 0.5);
    expect(Math.abs((labelBox.top + labelBox.bottom) / 2 - pointerY)).toBeLessThanOrEqual(24);

    expect(hitTargetAfter).toEqual(hitTargetBefore);
  });
}

test('ordinary panel: the label does not cover the editor text', async ({ mount, page }) => {
  const { span, label, text } = await mountHarness(mount, page, ORDINARY_HOST);
  await hoverSpan(page, span, 0.5);
  await expect(label).toHaveCSS('opacity', '1');

  const [labelBox, textBox] = await Promise.all([box(label), box(text)]);
  expect(labelBox.right).toBeLessThanOrEqual(textBox.left);
});

test('the label follows the pointer down the span and resets on leave', async ({ mount, page }) => {
  const { span, label } = await mountHarness(mount, page, ORDINARY_HOST);
  const spanBox = await box(span);

  const highY = await hoverSpan(page, span, 0.2);
  await expect(label).toHaveCSS('opacity', '1');
  const high = await box(label);
  expect(Math.abs((high.top + high.bottom) / 2 - highY)).toBeLessThanOrEqual(24);

  const lowY = await hoverSpan(page, span, 0.95);
  const low = await box(label);
  expect(low.top).toBeGreaterThan(high.top);
  expect(low.bottom).toBeLessThanOrEqual(spanBox.bottom + 0.5);
  expect(Math.abs((low.top + low.bottom) / 2 - lowY)).toBeLessThanOrEqual(24);

  await page.mouse.move(spanBox.right + 200, spanBox.bottom + 100);
  await expect(label).toHaveCSS('opacity', '0');
  const reset = await box(label);
  expect(reset.top).toBeCloseTo(spanBox.top, 0);
});
