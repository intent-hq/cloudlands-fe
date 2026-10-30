import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockAnnotationOverlayHarness.svelte';
import { dockAnnotationMediaIdle } from './dock-annotation-overlay.fixtures';

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
  // Pick (240,300,448,144) image px at 2× → overlay (120,150,224,72); badge at its top-right.
  const pick = page.locator('[data-mark="1"]');
  expect(await numbers(pick, 'rect', ['x', 'y', 'width', 'height'])).toEqual([120, 150, 224, 72]);
  expect(await numbers(pick, 'circle', ['cx', 'cy'])).toEqual([344, 150]);
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
  // 1600×1200 contained in 1280×800 → scale 2/3, centred with x offset 106.67.
  const still = page.locator('img');
  await expect(still).toHaveCount(1);
  // Measure once its entrance transition has settled.
  await expect.poll(async () => (await still.boundingBox())?.width ?? 0).toBeCloseTo(1066.67, 0);
  const frame = await still.boundingBox();
  expect(frame?.x).toBeCloseTo(106.67, 1);
  expect(frame?.y).toBeCloseTo(0, 1);
  expect(frame?.width).toBeCloseTo(1066.67, 1);
  expect(frame?.height).toBeCloseTo(800, 1);
  const [x, y, width, height] = await numbers(page.locator('[data-mark="1"]'), 'rect', [
    'x',
    'y',
    'width',
    'height',
  ]);
  expect(x).toBeCloseTo(240, 1);
  expect(y).toBeCloseTo(133.33, 1);
  expect(width).toBeCloseTo(266.67, 1);
  expect(height).toBeCloseTo(200, 1);
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
  // Edge rail on the right (x 1000-1280): beside it on the inner side, 8 DIP away,
  // vertically centred on the rail.
  // Polled: the bar measures itself once rendered and then settles next to the dock.
  await expect
    .poll(async () => {
      const box = await bounds();
      return [Math.round(box.x + box.width), Math.abs(box.y + box.height / 2 - 400) <= 1];
    })
    .toEqual([1000 - 8, true]);
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

  // The dock moves to the notch: the bar follows, 8 DIP below it and centred on it.
  const notch = { shape: 'notch', rect: { x: 440, y: 0, width: 400, height: 56 } } as const;
  await component.update({ props: { fixture: 'live-marked', pick: 'permission', dock: notch } });
  await expect
    .poll(async () => {
      const box = await bounds();
      return [Math.round(box.y), Math.abs(box.x + box.width / 2 - 640) <= 1];
    })
    .toEqual([56 + 8, true]);
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

  // Order: Mouse and the drawing tools | Attach, X.
  expect(
    await bar
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual([
    'Mouse',
    'Pick an element',
    'Box',
    'Pen',
    'Arrow',
    'Attach',
    'Clear annotations',
    'End annotating',
  ]);
  // Attach counts the marks it will attach (the fixture has 4).
  await expect(bar.locator('[data-attach-count]')).toHaveText('4');
  // Attach keeps the marks as an image and carries on in mouse mode: the bar stays.
  await bar.getByRole('button', { name: 'Attach' }).click();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'true');
  // X ends the session: the bar goes away.
  await bar.getByRole('button', { name: 'End annotating' }).click();
  await expect(bar).toHaveCount(0);
  const actions = JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
  );
  expect(actions).toEqual([
    { sessionId: 'fixture-live', action: 'mouse' },
    { sessionId: 'fixture-live', action: 'tool', tool: 'pen' },
    { sessionId: 'fixture-live', action: 'commit' },
    { sessionId: 'fixture-live', action: 'end' },
  ]);

  // One artifact with both placements, side rail (left) and notch (right).
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.setContent(
    `<body style="margin:0;display:flex;gap:0;background:#000">${[sideShot, notchShot]
      .map(
        (shot) =>
          `<img style="width:640px;height:400px" src="data:image/png;base64,${shot.toString('base64')}">`,
      )
      .join('')}</body>`,
  );
  const combined = await page.screenshot();
  if (process.env.DOCK_ARTIFACT_DIR)
    await page.screenshot({ path: `${process.env.DOCK_ARTIFACT_DIR}/dock-annotate-toolbar.png` });
  await testInfo.attach('dock-annotate-toolbar', { body: combined, contentType: 'image/png' });
});

test('Screenshot and Record on the tool bar run the composer actions with its look, limit and alerts', async ({
  mount,
  page,
}, testInfo) => {
  const notch = { shape: 'notch', rect: { x: 440, y: 0, width: 400, height: 56 } } as const;
  const props = {
    fixture: 'live-marked',
    dock: notch,
    media: dockAnnotationMediaIdle,
    markCount: 3,
  } as const;
  const component = await mount(Harness, { props });
  const bar = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(bar).toBeVisible();
  const toolbar = async () =>
    JSON.parse(
      (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
    ) as { action: string }[];
  const reportedWidth = async () =>
    (
      JSON.parse(
        (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar-rect')) ??
          'null',
      ) as { rect: { width: number } } | null
    )?.rect.width ?? 0;

  // Order: Mouse and the drawing tools (one group) | Screenshot, Record | Attach, X.
  expect(
    await bar
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
  ).toEqual([
    'Mouse',
    'Pick an element',
    'Box',
    'Pen',
    'Arrow',
    'Capture the screen · ⌘⇧S',
    'Record the screen · ⌘⇧R',
    'Attach',
    'Clear annotations',
    'End annotating',
  ]);
  // The tools share one group; the selected one is tinted, not filled.
  expect(
    await bar
      .getByRole('group')
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-tool'))),
  ).toEqual(['mouse', 'pick', 'box', 'pen', 'arrow']);
  // Attach is the primary action and counts the 3 marks it will attach.
  await expect(bar.locator('[data-attach-count]')).toHaveText('3');
  // Idle with marks: the first half of the artifact.
  const idleShot = await page.screenshot({ clip: { x: 290, y: 0, width: 700, height: 150 } });
  expect(
    // Buttons and dividers in document order (the shared Button may wrap its element).
    await bar.evaluate((node) =>
      [...node.querySelectorAll('button, .divider')].map((child) =>
        child.classList.contains('divider')
          ? '|'
          : (child.getAttribute('data-tool') ??
            child.getAttribute('data-media') ??
            (child.hasAttribute('data-commit')
              ? 'done'
              : child.hasAttribute('data-clear')
                ? 'clear'
                : 'end')),
      ),
    ),
  ).toEqual([
    'mouse',
    'pick',
    'box',
    'pen',
    'arrow',
    '|',
    'capture',
    'record',
    '|',
    'done',
    'clear',
    'end',
  ]);
  // Attach and Clear share one pill: Clear is flush against Attach.
  const attachBox = (await bar.getByRole('button', { name: 'Attach' }).boundingBox())!;
  const clearBox = (await bar.getByRole('button', { name: 'Clear annotations' }).boundingBox())!;
  expect(Math.round(clearBox.x)).toBe(Math.round(attachBox.x + attachBox.width));
  // Bigger, airier buttons: 38 px, the same as the tools.
  const shot = bar.getByRole('button', { name: 'Capture the screen · ⌘⇧S' });
  const shotBox = (await shot.boundingBox())!;
  expect([Math.round(shotBox.width), Math.round(shotBox.height)]).toEqual([38, 38]);
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
  const red = await stop.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(red).not.toBe('rgba(0, 0, 0, 0)');
  // The wider bar re-reports its rect, so main keeps all of it clickable.
  await expect.poll(reportedWidth).toBeGreaterThan(idleWidth);
  // A fixed pill: timer ticks never change its width (or the bar's).
  await expect.poll(async () => Math.round((await stop.boundingBox())!.width)).toBe(80);
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
