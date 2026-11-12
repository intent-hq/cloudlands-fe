import type { Locator, Page } from '@playwright/test';
import { expect, test, expectAnimationsToSettle } from '../../../test/ct-test';
import Harness from './__tests__/DockAnnotationOverlayHarness.svelte';
import { dockAnnotationMediaIdle, dockAnnotationStill } from './dock-annotation-overlay.fixtures';

async function recorded(page: Page, name: 'pointers' | 'gestures'): Promise<unknown[]> {
  const host = page.getByTestId('dock-annotation-harness');
  return JSON.parse((await host.getAttribute(`data-${name}`)) ?? '[]') as unknown[];
}

async function numbers(mark: Locator, selector: string, names: string[]): Promise<number[]> {
  const node = mark.locator(selector).first();
  return Promise.all(names.map(async (name) => Number(await node.getAttribute(name))));
}

test.beforeEach(async ({ page }) => {
  // The fixture display is 1280×800 DIP; the overlay covers the viewport like the native window.
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('draws authoritative marks from Retina image pixels at overlay scale', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { fixture: 'live-marked' } });
  const marks = page.locator('[data-mark]');
  await expect(marks).toHaveCount(4);
  for (let index = 0; index < 4; index++)
    await expect(marks.nth(index)).toHaveAttribute('data-mark', String(index + 1));
  // Pick image coordinates at 2× map into the overlay coordinate system.
  const pick = page.locator('[data-mark="1"]');
  expect(await numbers(pick, 'rect', ['x', 'y', 'width', 'height'])).toEqual([120, 150, 224, 72]);
  const box = page.locator('[data-mark="2"]');
  expect(await numbers(box, 'rect', ['x', 'y', 'width', 'height'])).toEqual([600, 100, 200, 120]);
});

test('still markup letterboxes the frozen image and maps its marks into the same frame', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { fixture: 'still' } });
  const still = page.locator('img');
  await expect(still).toHaveCount(1);
  await expectAnimationsToSettle(still);
  const frame = (await still.boundingBox())!;
  // The mark must track its authoritative image coordinates within the live image,
  // independently of the viewport's chosen letterbox spacing.
  const mark = dockAnnotationStill.marks[0].geometry;
  if (mark.kind !== 'rect') throw new Error('Expected rectangle fixture');
  const image = dockAnnotationStill.image!;
  // Letterboxing preserves the captured image's aspect ratio and keeps it on screen.
  expect(frame.width).toBeCloseTo(frame.height * (image.width / image.height), 1);
  const viewport = (await page.getByTestId('dock-annotation-overlay').boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(viewport.x - 1);
  expect(frame.y).toBeGreaterThanOrEqual(viewport.y - 1);
  expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
  expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
  const [x, y, width, height] = await numbers(page.locator('[data-mark="1"]'), 'rect', [
    'x',
    'y',
    'width',
    'height',
  ]);
  expect(x).toBeCloseTo(frame.x + (mark.x / image.width) * frame.width, 1);
  expect(y).toBeCloseTo(frame.y + (mark.y / image.height) * frame.height, 1);
  expect(width).toBeCloseTo((mark.w / image.width) * frame.width, 1);
  expect(height).toBeCloseTo((mark.h / image.height) * frame.height, 1);
});

const actions = async (page: Page) =>
  JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
  ) as { action: string; tool?: string }[];

for (const scheme of ['light', 'dark'] as const) {
  test(`annotating exposes tools, Clear, Record, Close and Attach (${scheme} system)`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mount(Harness, { props: { fixture: 'live-marked', media: dockAnnotationMediaIdle } });
    const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-mode', 'annotate');
    // The shared bar exposes the supported tools and an idle recording action.
    for (const tool of ['pointer', 'box', 'pen', 'arrow'])
      await expect(bar.locator(`[data-tool="${tool}"]`)).toBeVisible();
    await expect(bar.getByRole('button', { name: /Capture the screen/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
    await expect(bar.locator('[data-clear]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`annotation-bar-${scheme}.png`) });

    // Tools switch on the bar; clicks on it are never marks.
    await bar.locator('[data-tool="pen"]').click();
    await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'pen');
    expect(await recorded(page, 'pointers')).toEqual([]);
    await bar.locator('[data-tool="arrow"]').click();

    // Attach commits the marks on screen; Close ends the session.
    const attach = bar.getByRole('button', { name: 'Attach', exact: true });
    await expect(attach).toBeEnabled();
    await attach.click();
    await bar.locator('[data-close]').click();
    expect((await actions(page)).filter((row) => row.action !== 'rect')).toEqual([
      { sessionId: 'fixture-live', action: 'tool', tool: 'pen' },
      { sessionId: 'fixture-live', action: 'tool', tool: 'arrow' },
      { sessionId: 'fixture-live', action: 'commit' },
      { sessionId: 'fixture-live', action: 'end' },
    ]);
  });
}

test('with nothing marked, Done ends the session without an attachment', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { fixture: 'live-empty', media: dockAnnotationMediaIdle } });
  const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(bar.locator('[data-attach-count]')).toHaveCount(0);
  await bar.locator('[data-done]').click();
  await expect(bar).toHaveCount(0);
  expect((await actions(page)).filter((row) => row.action !== 'rect')).toEqual([
    { sessionId: 'fixture-live', action: 'end' },
  ]);
});
