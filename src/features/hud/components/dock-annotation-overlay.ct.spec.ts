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

test('the on-screen tool bar sits next to the dock and follows it, switches tools, ends the session and never starts a mark', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Harness, { props: { fixture: 'live-marked', pick: 'permission' } });
  const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(bar).toBeVisible();
  const bounds = async () => {
    const box = await bar.boundingBox();
    if (!box) throw new Error('Missing tool bar bounds');
    return box;
  };
  // The tool bar stays clear of the live dock region.
  await expect
    .poll(async () => {
      const box = await bounds();
      return box.x + box.width <= 1000;
    })
    .toBe(true);
  const side = await bounds();
  // Main learns where the bar is, so it stays clickable and never starts a gesture.
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar-rect')) ??
          'null',
      ),
    )
    .toMatchObject({ action: 'rect', rect: { width: Math.round(side.width) } });
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
  // A missing Accessibility grant marks pick; the other tools are unaffected.
  await expect(bar.getByRole('button', { name: 'Pick an element' })).toHaveAttribute(
    'data-alert',
    '',
  );
  await bar.getByRole('button', { name: 'Pen' }).hover();
  await expect(bar.getByRole('tooltip').filter({ hasText: 'Pen' })).toHaveCSS('opacity', '1');
  const sideShot = await page.screenshot();

  // The tool bar follows the dock without overlapping its new location.
  const notch = { shape: 'notch', rect: { x: 440, y: 0, width: 400, height: 56 } } as const;
  await component.update({ props: { fixture: 'live-marked', pick: 'permission', dock: notch } });
  await expect.poll(async () => (await bounds()).y >= notch.rect.y + notch.rect.height).toBe(true);
  const below = await bounds();
  // Under the notch there is no room above: tooltips open below the bar and stay
  // inside the work area (the long permission line included).
  await expect(bar).toHaveAttribute('data-tips', 'below');
  await bar.getByRole('button', { name: 'Pick an element' }).hover();
  const tip = bar.getByRole('tooltip').filter({ hasText: 'Allow Accessibility' });
  await expect(tip).toHaveCSS('opacity', '1');
  const tipBox = (await tip.boundingBox())!;
  expect(tipBox.y).toBeGreaterThan(below.y + below.height);
  expect(tipBox.y).toBeGreaterThanOrEqual(25);
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(1280);
  const notchShot = await page.screenshot();

  // Mouse mode: the session stays, nothing is a gesture; a tool resumes annotating.
  await bar.getByRole('button', { name: 'Mouse' }).click();
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(260, 650, { steps: 3 });
  await page.mouse.up();
  expect(await recorded(page, 'pointers')).toEqual([]);
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveCSS('cursor', 'default');

  await bar.getByRole('button', { name: 'Pen' }).click();
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'pen');
  await expect(bar.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
  // Clicks on the bar are never marks.
  expect(await recorded(page, 'pointers')).toEqual([]);

  // The bar is tied to the dock: dragging it does nothing (no move, no tool change).
  const arrow = bar.getByRole('button', { name: 'Arrow' });
  const from = await arrow.boundingBox();
  if (!from) throw new Error('Missing arrow bounds');
  await page.mouse.move(from.x + 15, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 15 - 300, from.y + 15 + 200, { steps: 6 });
  await page.mouse.up();
  const after = await bounds();
  expect(Math.round(after.x)).toBe(Math.round(below.x));
  expect(Math.round(after.y)).toBe(Math.round(below.y));
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'pen');
  expect(await recorded(page, 'pointers')).toEqual([]);

  // Attach is the primary action and counts the 3 marks it will attach.
  await expect(bar.locator('[data-attach-count]')).toHaveText('3');
  // Idle with marks: the first half of the artifact.
  const idleShot = await page.screenshot({ clip: { x: 290, y: 0, width: 700, height: 150 } });
  const shot = bar.getByRole('button', { name: 'Capture the screen · ⌘⇧S' });
  await shot.hover();
  await expect(bar.getByRole('tooltip').filter({ hasText: 'Capture the screen' })).toHaveCSS(
    'opacity',
    '1',
  );

  // Screenshot: one request; the session, tool and mode are unchanged; never a mark.
  await shot.click();
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'false');

  // Record: the composer's red pill with the stop square and a running timer.
  const idleWidth = await reportedWidth();
  const idleX = (await bar.boundingBox())!.x;
  await bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' }).click();
  // No jump: while the pill widens the bar keeps its left edge and grows to the right.
  for (let frame = 0; frame < 12; frame++) {
    expect(Math.round((await bar.boundingBox())!.x)).toBe(Math.round(idleX));
    await page.waitForTimeout(25);
  }
  const stop = bar.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toHaveAttribute('data-recording');
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(stop.locator('[data-record-time]')).toHaveText(/^1:0[5-9]$/);
  // The wider bar re-reports its rect, so main keeps all of it clickable.
  await expect.poll(reportedWidth).toBeGreaterThan(idleWidth);
  // A fixed pill: timer ticks never change its width (or the bar's).
  await expectAnimationsToSettle(bar);
  const settled = (await bar.boundingBox())!;
  await page.waitForTimeout(1_100);
  const ticked = (await bar.boundingBox())!;
  expect([ticked.x, ticked.width]).toEqual([settled.x, settled.width]);
  expect(Math.round(settled.x)).toBe(Math.round(idleX));
  const recordingShot = await page.screenshot({
    clip: { x: 290, y: 0, width: 700, height: 150 },
  });
  await stop.click();
  await expect(bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(await recorded(page, 'pointers')).toEqual([]);

  // At the limit Record is disabled with the composer's tooltip; a click does nothing.
  const full = {
    ...dockAnnotationMediaIdle,
    record: { ...dockAnnotationMediaIdle.record, disabled: true, tooltip: 'Up to 5 recordings' },
  };
  await component.update({ props: { ...props, media: full } });
  const limited = bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' });
  await expect(limited).toHaveAttribute('aria-disabled', 'true');
  await limited.hover();
  const limitTip = bar.getByRole('tooltip').filter({ hasText: 'Up to 5 recordings' });
  await expect(limitTip).toHaveCSS('opacity', '1');
  const limitBox = (await limitTip.boundingBox())!;
  expect(limitBox.x).toBeGreaterThanOrEqual(0);
  expect(limitBox.x + limitBox.width).toBeLessThanOrEqual(1280);
  // Forced: a real click on the disabled control reaches it and is ignored.
  await limited.click({ force: true });

  // Missing Screen Recording: alert dot and the permission line; a click goes to the
  // dock, which opens System Settings (the composer's rule).
  const blocked = {
    capture: {
      ...dockAnnotationMediaIdle.capture,
      alert: true,
      tooltip: 'Allow screen recording in System Settings',
    },
    record: {
      ...dockAnnotationMediaIdle.record,
      alert: true,
      tooltip: 'Allow screen recording in System Settings',
    },
  };
  await component.update({ props: { ...props, media: blocked } });
  const alerted = bar.getByRole('button', { name: 'Capture the screen · ⌘⇧S' });
  await expect(alerted).toHaveAttribute('data-alert', '');
  await expect(alerted.locator('.alert-dot')).toBeVisible();
  await alerted.hover();
  await expect(
    bar.getByRole('tooltip').filter({ hasText: 'Allow screen recording' }).first(),
  ).toHaveCSS('opacity', '1');
  const alertShot = await page.screenshot({ clip: { x: 290, y: 0, width: 700, height: 150 } });
  await alerted.click();

  // Clear: the marks go, nothing is attached, the tool stays; Clear hides at 0 marks.
  await component.update({ props: { ...props, media: dockAnnotationMediaIdle } });
  await bar.getByRole('button', { name: 'Clear annotations' }).click();
  await expect(bar.getByRole('button', { name: 'Clear annotations' })).toHaveCount(0);
  await expect(bar.locator('[data-attach-count]')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'false');

  expect((await toolbar()).map((row) => row.action)).toEqual([
    'capture',
    'record',
    'record',
    'capture',
    'clear',
  ]);
  expect(await recorded(page, 'pointers')).toEqual([]);

  // Artifact: idle with 3 marks, recording, and the permission alert (top to bottom).
  await page.setViewportSize({ width: 700, height: 450 });
  await page.setContent(
    `<body style="margin:0;background:#000">${[idleShot, recordingShot, alertShot]
      .map(
        (image) =>
          `<img style="display:block;width:700px;height:150px" src="data:image/png;base64,${image.toString('base64')}">`,
      )
      .join('')}</body>`,
  );
  const combined = await page.screenshot();
  if (process.env.DOCK_ARTIFACT_DIR)
    await page.screenshot({
      path: `${process.env.DOCK_ARTIFACT_DIR}/dock-annotate-toolbar-v2.png`,
    });
  await testInfo.attach('dock-annotate-toolbar-v2', {
    body: combined,
    contentType: 'image/png',
  });
});
