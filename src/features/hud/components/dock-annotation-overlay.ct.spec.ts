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

test('draws authoritative numbered marks from Retina image pixels at overlay scale', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { fixture: 'live-marked' } });
  const marks = page.locator('[data-mark]');
  await expect(marks).toHaveCount(4);
  await expect(marks.locator('text')).toHaveText(['1', '2', '3', '4']);
  // Pick image coordinates at 2× map into the overlay coordinate system.
  const pick = page.locator('[data-mark="1"]');
  expect(await numbers(pick, 'rect', ['x', 'y', 'width', 'height'])).toEqual([120, 150, 224, 72]);
  const box = page.locator('[data-mark="2"]');
  expect(await numbers(box, 'rect', ['x', 'y', 'width', 'height'])).toEqual([600, 100, 200, 120]);
});

test('a box gesture sends its pointerdown origin and shape; dock origins and blur never commit', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { fixture: 'live-empty' } });
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'box');

  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(200, 180, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => recorded(page, 'gestures'))
    .toEqual([
      {
        sessionId: 'fixture-live',
        sequence: 1,
        tool: 'box',
        origin: { x: 100, y: 100 },
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 180 },
        ],
      },
    ]);

  // The fixture's dock column (x ≥ 1000) is never a gesture origin.
  await page.mouse.move(1100, 100);
  await page.mouse.down();
  await page.mouse.move(1150, 160, { steps: 2 });
  await page.mouse.up();

  // A held gesture fenced by window blur is cancelled, not committed.
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(360, 340, { steps: 2 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();

  await expect
    .poll(() => recorded(page, 'pointers'))
    .toEqual([
      { sessionId: 'fixture-live', sequence: 1, phase: 'down', x: 100, y: 100, tool: 'box' },
      { sessionId: 'fixture-live', sequence: 2, phase: 'down', x: 300, y: 300, tool: 'box' },
      { sessionId: 'fixture-live', sequence: 2, phase: 'cancel', x: 300, y: 300, tool: 'box' },
    ]);
  expect(await recorded(page, 'gestures')).toHaveLength(1);
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

/** The bar's bottom centre: what it keeps while a recording starts or ends. */
async function place(bar: Locator) {
  const box = (await bar.boundingBox())!;
  return { cx: Math.round(box.x + box.width / 2), bottom: Math.round(box.y + box.height) };
}
const actions = async (page: Page) =>
  JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
  ) as { action: string; tool?: string }[];

for (const scheme of ['light', 'dark'] as const) {
  test(`annotating uses the same dark bar: tools, Clear, Close and Attach, no capture or record (${scheme} system)`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mount(Harness, { props: { fixture: 'live-marked', media: dockAnnotationMediaIdle } });
    const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-mode', 'annotate');
    // The recording bar's family: pointer, the four tools, Clear; no Screenshot/Record.
    for (const tool of ['pointer', 'pick', 'box', 'pen', 'arrow'])
      await expect(bar.locator(`[data-tool="${tool}"]`)).toBeVisible();
    await expect(
      bar.getByRole('button', { name: /Capture the screen|Record the screen/ }),
    ).toHaveCount(0);
    await expect(bar.locator('[data-testid="recording-chip"]')).toHaveCount(0);
    await expect(bar.locator('[data-clear]')).toBeVisible();
    // Dark whatever the system appearance.
    expect(await bar.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
      'rgb(38, 38, 38)',
    );
    await page.screenshot({ path: testInfo.outputPath(`annotation-bar-${scheme}.png`) });

    // Tools switch on the bar; clicks on it are never marks.
    await bar.locator('[data-tool="pen"]').click();
    await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'pen');
    expect(await recorded(page, 'pointers')).toEqual([]);
    // The grip moves it; a button never does.
    const start = await place(bar);
    const grip = (await bar.locator('.grip').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 150, grip.y + grip.height / 2 - 100, {
      steps: 4,
    });
    await page.mouse.up();
    const moved = await place(bar);
    expect(Math.abs(moved.cx - (start.cx - 150))).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.bottom - (start.bottom - 100))).toBeLessThanOrEqual(1);
    await bar.locator('[data-tool="arrow"]').click();
    expect(await place(bar)).toEqual(moved);

    // Attach counts the marks on screen and commits them; Close ends the session.
    await expect(bar.locator('[data-attach-count]')).toHaveText('4');
    await bar.locator('[data-done]').click();
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

test('a recording starting or ending keeps the bar, its tools, the current tool and its place', async ({
  mount,
  page,
}, testInfo) => {
  const props = { fixture: 'live-empty', media: dockAnnotationMediaIdle } as const;
  const component = await mount(Harness, { props });
  const bar = page.getByTestId('dock-recording-toolbar');
  await expect(bar).toHaveAttribute('data-mode', 'annotate');
  await bar.locator('[data-tool="box"]').click();
  const grip = (await bar.locator('.grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 200, grip.y + grip.height / 2 - 120, {
    steps: 4,
  });
  await page.mouse.up();
  const annotating = await place(bar);

  // The composer starts a recording (its own control): only the right side changes.
  await component.update({
    props: {
      ...props,
      media: {
        ...dockAnnotationMediaIdle,
        record: {
          ...dockAnnotationMediaIdle.record,
          recording: true,
          startedAt: Date.now() - 5000,
          label: 'Stop recording',
          tooltip: 'Stop recording',
        },
      },
    },
  });
  await expect(bar).toHaveAttribute('data-mode', 'recording');
  await expect(bar.getByTestId('recording-chip')).toBeVisible();
  await expect(bar.locator('[data-tool="box"]')).toHaveAttribute('aria-checked', 'true');
  const recordingPlace = await place(bar);
  expect(Math.abs(recordingPlace.cx - annotating.cx)).toBeLessThanOrEqual(1);
  expect(Math.abs(recordingPlace.bottom - annotating.bottom)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('bar-recording.png') });
  // Picking a tool mid-recording keeps the recording UI.
  await bar.locator('[data-tool="pen"]').click();
  await expect(bar.getByTestId('recording-chip')).toBeVisible();

  // The recording ends: back to annotating, in the same place.
  await component.update({ props });
  await expect(bar).toHaveAttribute('data-mode', 'annotate');
  const after = await place(bar);
  expect(Math.abs(after.cx - annotating.cx)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.bottom - annotating.bottom)).toBeLessThanOrEqual(1);
});
