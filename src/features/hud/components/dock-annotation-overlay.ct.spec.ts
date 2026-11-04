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

test('the on-screen tool bar starts at the bottom of the screen, drags by its grip, switches tools, ends the session and never starts a mark', async ({
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
  const below = await bounds();
  await testInfo.attach('notch toolbar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

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

  // Dragging from a tool button does nothing (no move, no tool change).
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

  // The grip moves the bar: it follows the pointer, stays inside the work area,
  // reports its new rect (so it stays clickable) and never draws a mark.
  const reportedRect = async () =>
    JSON.parse(
      (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar-rect')) ??
        'null',
    )?.rect as { x: number; y: number } | undefined;
  const gesturesBeforeDrag = (await recorded(page, 'gestures')).length;
  const grip = (await bar.locator('.toolbar-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // Mid-drag, main already knows where the bar is.
  await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + grip.height / 2 - 75, {
    steps: 4,
  });
  const midway = await bounds();
  expect(Math.round(midway.x)).toBe(Math.round(below.x) - 100);
  await expect
    .poll(reportedRect)
    .toMatchObject({ x: Math.round(midway.x), y: Math.round(midway.y) });
  await page.mouse.move(grip.x + grip.width / 2 - 200, grip.y + grip.height / 2 - 150, {
    steps: 4,
  });
  await page.mouse.up();
  const moved = await bounds();
  expect(Math.round(moved.x)).toBe(Math.round(below.x) - 200);
  expect(Math.round(moved.y)).toBe(Math.round(below.y) - 150);
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.getByTestId('dock-annotation-harness').getAttribute('data-toolbar-rect')) ??
          'null',
      ),
    )
    .toMatchObject({ action: 'rect', rect: { x: Math.round(moved.x), y: Math.round(moved.y) } });
  // Dragged far past the edge, it stops at the work area.
  const regrip = (await bar.locator('.toolbar-grip').boundingBox())!;
  await page.mouse.move(regrip.x + regrip.width / 2, regrip.y + regrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 8 });
  await page.mouse.up();
  const clamped = await bounds();
  expect(Math.round(clamped.x)).toBe(Math.round(workArea.x));
  expect(Math.round(clamped.y)).toBe(Math.round(workArea.y));
  // A cancelled or lost pointer ends the drag: later moves with the button still
  // held do not move the bar.
  for (const type of ['pointercancel', 'lostpointercapture']) {
    const handle = (await bar.locator('.toolbar-grip').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 30, {
      steps: 3,
    });
    const before = await bounds();
    await bar.evaluate((node, eventType) => {
      node.dispatchEvent(new PointerEvent(eventType, { pointerId: 1, bubbles: true }));
    }, type);
    await page.mouse.move(handle.x + handle.width / 2 + 160, handle.y + handle.height / 2 + 120, {
      steps: 4,
    });
    const after = await bounds();
    expect(Math.round(after.x), type).toBe(Math.round(before.x));
    expect(Math.round(after.y), type).toBe(Math.round(before.y));
    await page.mouse.up();
  }
  expect(await recorded(page, 'pointers')).toEqual([]);
  expect(await recorded(page, 'gestures')).toHaveLength(gesturesBeforeDrag);

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

  // Record: while the recording is live, the recording tool bar replaces this one
  // (its own spec: dock-recording-toolbar.ct.spec.ts), with the composer's timer.
  const idleWidth = await reportedWidth();
  await bar.getByRole('button', { name: 'Record the screen · ⌘⇧R' }).click();
  const recordingBar = page.getByRole('toolbar', { name: 'Recording tools' });
  await expect(recordingBar).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(
    recordingBar.getByTestId('recording-chip').locator('[data-recording-time]'),
  ).toHaveText(/^1:0[5-9]$/);
  // The recording bar reports its own rect, so main keeps it clickable.
  await expect.poll(reportedWidth).not.toBe(idleWidth);
  const recordingBox = (await recordingBar.boundingBox())!;
  const recordingShot = await page.screenshot({
    clip: { x: 290, y: Math.max(0, recordingBox.y - 48), width: 700, height: 150 },
  });
  // Done stops the recording; the annotate bar comes back.
  await recordingBar.locator('[data-done]').click();
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
    'done',
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
    if (reducedMotion === 'reduce') {
      await expect
        .poll(() =>
          capture.evaluate((node) =>
            node.getAnimations().some((animation) => animation.playState === 'running'),
          ),
        )
        .toBe(false);
    }
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

for (const scheme of ['light', 'dark'] as const) {
  test(`the bar stays dark, drags by its grip and keeps its place from annotate to record and back (${scheme} system)`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mount(Harness, { props: { fixture: 'live-empty', media: dockAnnotationMediaIdle } });
    const annotateBar = page.getByTestId('dock-annotation-toolbar');
    const recordingBar = page.getByTestId('dock-recording-toolbar');
    await expect(annotateBar).toBeVisible();
    await expectAnimationsToSettle(annotateBar);
    /** The bar's bottom centre: what both bars keep through a swap. */
    const anchor = async (bar: Locator) => {
      const box = (await bar.boundingBox())!;
      return { cx: Math.round(box.x + box.width / 2), bottom: Math.round(box.y + box.height) };
    };
    /** Same place, within the 1 px of rounding a bar of another width centres with. */
    const expectSamePlace = (actual: { cx: number; bottom: number }, place: typeof actual) => {
      expect(Math.abs(actual.cx - place.cx)).toBeLessThanOrEqual(1);
      expect(Math.abs(actual.bottom - place.bottom)).toBeLessThanOrEqual(1);
    };
    const background = (bar: Locator) =>
      bar.evaluate((node) => getComputedStyle(node).backgroundColor);
    const dragGrip = async (grip: Locator, dx: number, dy: number) => {
      const box = (await grip.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx / 2, box.y + box.height / 2 + dy / 2);
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      await page.mouse.up();
    };

    // The annotate bar moves by its grip.
    const start = await anchor(annotateBar);
    await dragGrip(annotateBar.locator('.toolbar-grip'), -220, -160);
    const moved = await anchor(annotateBar);
    expect(moved.cx).toBeCloseTo(start.cx - 220, -1);
    expect(moved.bottom).toBeCloseTo(start.bottom - 160, -1);
    // A button click is a click, never a drag.
    await annotateBar.getByRole('button', { name: 'Box' }).click();
    expect(await anchor(annotateBar)).toEqual(moved);
    const dark = await background(annotateBar);

    // Record: the recording bar appears exactly where the annotate bar was, just as dark.
    await annotateBar.getByRole('button', { name: 'Record the screen · ⌘⇧R' }).click();
    await expect(recordingBar).toBeVisible();
    await expect(annotateBar).toHaveCount(0);
    expectSamePlace(await anchor(recordingBar), moved);
    expect(await background(recordingBar)).toBe(dark);
    await expect(recordingBar.locator('.grip')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`recording-bar-${scheme}.png`) });

    // Dragged far past the screen edge, it stays fully on screen.
    await dragGrip(recordingBar.locator('.grip'), -2000, -2000);
    const area = JSON.parse(
      (await page.getByTestId('dock-annotation-harness').getAttribute('data-work-area'))!,
    ) as { x: number; y: number };
    const clamped = (await recordingBar.boundingBox())!;
    expect(Math.round(clamped.x)).toBeGreaterThanOrEqual(area.x);
    expect(Math.round(clamped.y)).toBeGreaterThanOrEqual(area.y);
    const corner = await anchor(recordingBar);
    // Its buttons stay buttons: pausing does not move it.
    await recordingBar.getByTestId('recording-chip').click();
    expect(await anchor(recordingBar)).toEqual(corner);

    // Done: the annotate bar comes back where the recording bar was.
    await recordingBar.locator('[data-done]').click();
    await expect(annotateBar).toBeVisible();
    expectSamePlace(await anchor(annotateBar), corner);
  });
}
