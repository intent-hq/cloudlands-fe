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

test('Mark up frames the still with its marks and docks the tools below it', async ({
  mount,
  page,
}) => {
  // The framed window is smaller than the display; its page is the window.
  await page.setViewportSize({ width: 820, height: 640 });
  await mount(Harness, { props: { fixture: 'still' } });
  const surface = page.getByTestId('dock-annotation-surface');
  await expectAnimationsToSettle(page.getByTestId('dock-annotation-overlay'));
  const frame = (await surface.boundingBox())!;
  const image = dockAnnotationStill.still!;
  // The whole still is visible at its own aspect ratio inside the window.
  expect(frame.width).toBeCloseTo(frame.height * (image.width / image.height), 0);
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.y).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(820);
  // The tool bar sits below the image, not over it, and offers only still tools.
  const toolbar = page.getByTestId('dock-annotation-toolbar');
  const bar = (await toolbar.boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(frame.y + frame.height);
  expect(bar.y + bar.height).toBeLessThanOrEqual(640);
  await expect(toolbar.getByRole('button', { name: 'Box' })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: /pick/i })).toHaveCount(0);
  // The authoritative mark is drawn where its image pixels are.
  const mark = dockAnnotationStill.marks[0].geometry;
  if (mark.kind !== 'rect') throw new Error('Expected rectangle fixture');
  const box = (await page.locator('[data-mark="1"] rect').boundingBox())!;
  expect(box.x).toBeCloseTo(frame.x + (mark.x / image.width) * frame.width, 0);
  expect(box.y).toBeCloseTo(frame.y + (mark.y / image.height) * frame.height, 0);
  expect(box.width).toBeCloseTo((mark.w / image.width) * frame.width, 0);
});

test('the on-screen toolbar stays reachable, switches tools and attaches the session marks', async ({
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
  // Wherever the dock is (here an edge rail), the bar starts at the bottom centre.
  const startArea = JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-work-area')) ?? 'null',
  ) as { x: number; y: number; width: number; height: number };
  await expect
    .poll(async () => {
      const box = await bounds();
      return {
        centred: Math.abs(box.x + box.width / 2 - (startArea.x + startArea.width / 2)) <= 1,
        bottom: Math.round(startArea.y + startArea.height - box.y - box.height) === 16,
      };
    })
    .toEqual({ centred: true, bottom: true });
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
  await testInfo.attach('side toolbar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // Notch feedback stays in the lower work area, away from hover expansion.
  const notch = { shape: 'notch', rect: { x: 440, y: 0, width: 400, height: 56 } } as const;
  await component.update({ props: { fixture: 'live-marked', pick: 'permission', dock: notch } });
  await expectAnimationsToSettle(bar, { subtree: false });
  const workArea = JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-work-area')) ?? 'null',
  ) as { x: number; y: number; width: number; height: number } | null;
  const dockBounds = await page.getByTestId('dock-stand-in').boundingBox();
  if (!workArea || !dockBounds) throw new Error('Missing dock or work-area bounds');
  await expect
    .poll(async () => {
      const box = await bounds();
      return {
        // Leave a toolbar-height of overshoot room before reaching the dock.
        clearOfDock: box.y - (dockBounds.y + dockBounds.height) >= box.height,
        contained:
          box.x >= workArea.x &&
          box.y >= workArea.y &&
          box.x + box.width <= workArea.x + workArea.width &&
          box.y + box.height <= workArea.y + workArea.height,
      };
    })
    .toEqual({ clearOfDock: true, contained: true });
  await testInfo.attach('notch toolbar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  // Mouse mode: the session stays, nothing is a gesture; a tool resumes annotating.
  await bar.getByRole('button', { name: 'Mouse' }).click();
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveCSS('cursor', 'default');

  await bar.getByRole('button', { name: 'Pen' }).click();
  await expect(page.getByTestId('dock-annotation-overlay')).toHaveAttribute('data-tool', 'pen');
  await expect(bar.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
  // Clicks on the bar are never marks.
  expect(await recorded(page, 'pointers')).toEqual([]);

  // Attach counts all four authoritative fixture marks, then continues in mouse mode.
  await expect(bar.locator('[data-attach-count]')).toHaveText('4');
  await bar.getByRole('button', { name: 'Attach' }).click();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Attach' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Done', exact: true }).click();
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
});

test('empty feedback offers Done and exits without an attachment', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness, {
    props: {
      fixture: 'live-empty',
      dock: { shape: 'notch', rect: { x: 440, y: 0, width: 400, height: 56 } },
      media: dockAnnotationMediaIdle,
    },
  });
  const bar = page.getByTestId('dock-annotation-toolbar');
  await expect(bar.getByRole('button', { name: 'Attach' })).toHaveCount(0);
  const done = bar.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeEnabled();
  await expectAnimationsToSettle(bar, { subtree: false });
  await testInfo.attach('empty feedback', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await done.focus();
  await done.press('Enter');
  await expect(bar).toHaveCount(0);
  const actions = JSON.parse(
    (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
  );
  expect(actions).toEqual([{ sessionId: 'fixture-live', action: 'end' }]);
  expect(await recorded(page, 'pointers')).toEqual([]);
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

  // Attach is the primary action and counts the 3 marks it will attach.
  await expect(bar.locator('[data-attach-count]')).toHaveText('3');
  const toolbarClip = async () => ({
    x: 290,
    y: Math.max(0, ((await bar.boundingBox())?.y ?? 0) - 48),
    width: 700,
    height: 150,
  });
  // Idle with marks: the first half of the artifact.
  const idleShot = await page.screenshot({ clip: await toolbarClip() });
  const shot = bar.getByRole('button', { name: 'Capture the screen · ⌘⇧S' });
  // Screenshot: one request; the session, tool and mode are unchanged; never a mark.
  await shot.click();
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'false');

  // Record: the composer's red pill with the stop square and a running timer.
  const idleWidth = await reportedWidth();
  await bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' }).click();
  const stop = bar.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toHaveAttribute('data-recording');
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(stop.locator('[data-record-time]')).toHaveText(/^1:0[5-9]$/);
  // The wider bar re-reports its rect, so main keeps all of it clickable.
  await expect.poll(reportedWidth).toBeGreaterThan(idleWidth);
  const recordingShot = await page.screenshot({
    clip: await toolbarClip(),
  });
  await stop.click();
  await expect(bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(await recorded(page, 'pointers')).toEqual([]);

  // At the limit Record is disabled; a click does nothing.
  const full = {
    ...dockAnnotationMediaIdle,
    record: { ...dockAnnotationMediaIdle.record, disabled: true },
  };
  await component.update({ props: { ...props, media: full } });
  const limited = bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' });
  await expect(limited).toHaveAttribute('aria-disabled', 'true');
  // Forced: a real click on the disabled control reaches it and is ignored.
  await limited.click({ force: true });

  // Missing Screen Recording: an alert dot appears; a click goes to the
  // dock, which opens System Settings (the composer's rule).
  const blocked = {
    capture: {
      ...dockAnnotationMediaIdle.capture,
      alert: true,
    },
    record: {
      ...dockAnnotationMediaIdle.record,
      alert: true,
    },
  };
  await component.update({ props: { ...props, media: blocked } });
  const alerted = bar.getByRole('button', { name: 'Capture the screen · ⌘⇧S' });
  await expect(alerted).toHaveAttribute('data-alert', '');
  await expect(alerted.locator('.alert-dot')).toBeVisible();
  const alertShot = await page.screenshot({ clip: await toolbarClip() });
  await alerted.click();

  // Clear: the marks go, nothing is attached, the tool stays; Clear hides at 0 marks.
  await component.update({ props: { ...props, media: dockAnnotationMediaIdle } });
  await bar.getByRole('button', { name: 'Clear annotations' }).click();
  await expect(bar.getByRole('button', { name: 'Clear annotations' })).toHaveCount(0);
  await expect(bar.locator('[data-attach-count]')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Mouse' })).toHaveAttribute('aria-pressed', 'false');

  const done = bar.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Attach' })).toHaveCount(0);
  await done.focus();
  await done.press('Enter');
  await expect(bar).toHaveCount(0);
  expect((await toolbar()).map((row) => row.action)).toEqual([
    'capture',
    'record',
    'record',
    'capture',
    'clear',
    'end',
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
  await page.screenshot({ path: testInfo.outputPath('dock-annotate-toolbar-v2.png') });
  await testInfo.attach('dock-annotate-toolbar-v2', {
    body: combined,
    contentType: 'image/png',
  });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`screenshot feedback follows accepted capture state with ${reducedMotion} motion`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const props = {
      fixture: 'live-empty' as const,
      dock: { shape: 'notch' as const, rect: { x: 440, y: 0, width: 400, height: 56 } },
      media: {
        ...dockAnnotationMediaIdle,
        capture: { ...dockAnnotationMediaIdle.capture, revision: 41 },
      },
    };
    const component = await mount(Harness, { props });
    const bar = page.getByTestId('dock-annotation-toolbar');
    const capture = bar.locator('[data-media="capture"]');
    const update = async (pending: boolean, revision: number) =>
      component.update({
        props: {
          ...props,
          media: { ...props.media, capture: { ...props.media.capture, pending, revision } },
        },
      });
    // Remounting with already accepted evidence is not a new capture.
    await expect(capture).toHaveAttribute('data-capture-state', 'idle');
    await capture.click();
    await expect(capture).toHaveAttribute('data-capture-state', 'idle');
    await update(true, 41);
    await expect(capture).toHaveAttribute('aria-busy', 'true');
    await expect(capture).toHaveAttribute('data-capture-state', 'pending');
    await expect(capture.getByRole('status', { name: 'Loading' })).toBeVisible();
    await testInfo.attach('screenshot pending', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await capture.click({ force: true });
    // A failed/refused capture settles without an accepted revision: no success.
    await update(false, 41);
    await expect(capture).toHaveAttribute('data-capture-state', 'idle');
    await capture.click();
    await update(true, 41);
    await update(false, 42);
    await expect(capture).toHaveAttribute('data-capture-state', 'complete');
    await expect(capture.locator('[data-dock-glyph="check"]')).toBeVisible();
    await testInfo.attach('screenshot accepted', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect(capture).toHaveAttribute('data-capture-state', 'idle');
    const actions = JSON.parse(
      (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar')) ?? '[]',
    );
    expect(actions.map((row: { action: string }) => row.action)).toEqual(['capture', 'capture']);
    expect(await recorded(page, 'pointers')).toEqual([]);
  });
}
