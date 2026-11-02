import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';
import { SYNTHETIC_ELEMENTS } from './dock-composer-e2e-geometry';

/**
 * End-to-end walkthrough of the dock composer with synthetic content only:
 * capture → annotate (box, pick) → dictate with click chips → delete a chip
 * (renumber) → record start/stop → send. Production conversation, controller,
 * sagas, editor and send; the daemon wire and the native helper are scripted
 * (no screen capture, microphone, recording or real message).
 *
 * Artifacts are saved per test and attached to the Playwright report:
 * dock-composer-e2e-{1..6}.png, dock-composer-e2e.webm, dock-composer-e2e-payload.json.
 */
const VIEW = { width: 452, height: 680 };

test.use({ viewport: VIEW, video: { mode: 'on', size: VIEW } });
test.describe.configure({ timeout: 120_000 });

type Harness = {
  native: {
    gesture: (tool: string, geometry: unknown, element: unknown) => void;
    say: (text: string) => void;
    log: unknown;
    holdCaptures: (value: boolean) => void;
  };
  close: () => void;
  reopen: () => void;
  holdPlacements: (value: boolean) => void;
  calls: { method: string; params: Record<string, unknown> }[];
  fixture: { settle: (accepted?: boolean) => void };
  setCaption: (text: string) => void;
};

async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.setCaption(value),
    text,
  );
}

async function gesture(
  page: Page,
  tool: 'box' | 'pick',
  rect: { x: number; y: number; w: number; h: number },
  element: { role: string; name: string; path: string | null; source: string | null } | null,
): Promise<void> {
  await page.evaluate(
    ([t, r, e]) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.gesture(
        t,
        { kind: 'rect', ...r },
        e,
      ),
    [tool, rect, element] as const,
  );
}

async function say(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.say(value),
    text,
  );
}

async function screen(page: Page, n: number): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const box = await page.getByTestId('composer-e2e').boundingBox();
  if (!box) throw new Error('Missing harness bounds');
  const info = test.info();
  const path = info.outputPath(`dock-composer-e2e-${n}.png`);
  await page.screenshot({ path, clip: box });
  await info.attach(`dock-composer-e2e-${n}`, { path, contentType: 'image/png' });
}

const beat = (page: Page, ms = 700) => page.waitForTimeout(ms);

test('dock composer walkthrough: capture, annotate, dictate, renumber, record, send', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const component = await mount(ComposerE2EHarness);
  const footer = component.locator('[data-dock-media-footer]');
  await expect(footer).toBeVisible();
  const annotate = component.getByRole('button', { name: /^Annotate the screen\. Current tool:/ });
  // Annotate and record enable only once the native capabilities were installed.
  await expect(annotate).toBeEnabled();
  const editor = component.locator('.tiptap-editor');
  const tiles = component.locator('[data-dock-media-attachments] .tile');
  const chips = editor.locator('.screen-reference-chip');

  // 1 Idle
  await caption(page, '1 · Idle: model, capture, record, annotate, mic, Send');
  await editor.click();
  await beat(page);
  await screen(page, 1);

  // 2 Captured
  await caption(page, '2 · Capture: one tap attaches the (synthetic) screen');
  await component.getByRole('button', { name: /^Capture the screen/ }).click();
  await expect(tiles).toHaveCount(1);
  await tiles.first().hover();
  await expect(component.getByRole('button', { name: 'Mark up' })).toBeVisible();
  await beat(page);
  await screen(page, 2);

  // 3 Annotate hovered
  await caption(page, '3 · Hover annotate: tool popover');
  await annotate.hover();
  const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
  await expect(tools).toBeVisible();
  await beat(page);
  await screen(page, 3);

  // 4 Annotating: box, two shapes
  await caption(page, '4 · Annotate with Box: two shapes on the screen');
  await tools.getByRole('button', { name: 'Box' }).click();
  await expect(component.getByText('Annotating', { exact: true })).toBeVisible();
  const { card, save, cancel } = SYNTHETIC_ELEMENTS;
  await gesture(page, 'box', { x: card.x + 30, y: card.y + 90, w: card.w - 60, h: 100 }, null);
  // The session image either reuses the unmarked capture or adds one; the mark lands either way.
  await expect(
    component.getByRole('button', { name: 'Screenshot with 1 marks. Open' }),
  ).toBeVisible();
  await beat(page, 400);
  await gesture(page, 'box', { x: cancel.x - 10, y: cancel.y - 10, w: cancel.w + 20, h: 72 }, null);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 2 marks. Open' }),
  ).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);
  await beat(page);
  await screen(page, 4);

  // Pick: switch tool in the open session, then pick an element.
  await caption(page, 'Annotate with Pick: element metadata recorded');
  await annotate.hover();
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Pick an element' }).click();
  const saveElement = {
    role: 'button',
    name: 'Save',
    path: 'main > form.settings > div.actions > button.save',
    source: null,
  };
  await gesture(page, 'pick', { x: save.x, y: save.y, w: save.w, h: save.h }, saveElement);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 3 marks. Open' }),
  ).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);
  await beat(page);

  // 5 Dictating with click chips
  await caption(page, '5 · Dictate: each click while talking becomes a numbered chip');
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await say(page, 'Closer, but this');
  await beat(page, 400);
  await gesture(
    page,
    'pick',
    { x: card.x, y: card.y, w: card.w, h: card.h },
    { role: 'dialog', name: 'Workspace name', path: 'main > form.settings', source: null },
  );
  await say(page, ' still has the old shadow, and this one');
  await beat(page, 400);
  await gesture(page, 'pick', { x: save.x, y: save.y, w: save.w, h: save.h }, saveElement);
  await say(page, ' drops its hover');
  await expect(component.locator('[data-screen-interim]')).toBeVisible();
  await expect(component.locator('[data-dock-dictation-time]')).toBeVisible();
  await beat(page, 900);
  await screen(page, 5);

  // Stop: finals commit in place with their chips.
  await caption(page, 'Stop dictating: transcript and chips stay');
  await component.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveAccessibleName(/^Reference 4:/);
  await expect(chips.nth(1)).toHaveAccessibleName(/^Reference 5:/);
  await beat(page);

  // Delete chip 4 → its mark goes; chip 5 renumbers to 4 in text and image.
  await caption(page, 'Delete chip 4: its mark is removed, later marks renumber');
  const first = (await chips.nth(0).boundingBox())!;
  await page.mouse.click(first.x + first.width + 1, first.y + first.height / 2);
  await page.keyboard.press('Backspace');
  await expect(chips).toHaveCount(1);
  await expect(chips.nth(0)).toHaveAccessibleName(/^Reference 4:/);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 4 marks. Open' }),
  ).toBeVisible();
  await beat(page);

  // 6 Recording (scripted recorder; nothing is recorded)
  await caption(page, '6 · Record: pill with elapsed time, clip tile');
  await component.getByRole('button', { name: /^Record the screen/ }).click();
  const stopRecording = component.getByRole('button', { name: 'Stop recording' });
  await expect(stopRecording).toBeVisible();
  await expect(component.getByText('Recording', { exact: true })).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);
  await beat(page, 1600);
  await screen(page, 6);
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.holdPlacements(true),
  );
  await stopRecording.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.filter(
            (call) => call.method === 'file.placeAttachment' && 'sourcePath' in call.params,
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.holdPlacements(false),
  );
  await expect(component.getByRole('button', { name: /^Clip, \d+:\d\d\. Play$/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.some(
          (call) => call.method === 'file.placeAttachment' && 'sourcePath' in call.params,
        ),
      ),
    )
    .toBe(true);
  await beat(page);

  // Send
  await caption(page, 'Send: chips become [[mark:n]] tokens; images burned; clip attached');
  const submit = component.getByTestId('composer-submit-button');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.some(
          (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
        ),
      ),
    )
    .toBe(true);
  const captured = await page.evaluate(() => {
    const h = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
    return {
      calls: JSON.parse(JSON.stringify(h.calls)) as Harness['calls'],
      native: JSON.parse(JSON.stringify(h.native.log)) as unknown,
    };
  });
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.fixture.settle(),
  );
  await expect(tiles).toHaveCount(0);
  await expect(chips).toHaveCount(0);
  await caption(page, 'Sent (synthetic daemon). Composer cleared.');
  await beat(page, 1200);

  const send = captured.calls.find(
    (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
  )!;
  const placements = captured.calls
    .filter((call) => call.method === 'file.placeAttachment')
    .map(({ params }) => {
      const { data, ...rest } = params;
      return typeof data === 'string'
        ? {
            ...rest,
            data: {
              base64Length: data.length,
              sha256: createHash('sha256').update(data).digest('hex'),
            },
          }
        : rest;
    });
  await writeFile(
    test.info().outputPath('dock-composer-e2e-payload.json'),
    `${JSON.stringify(
      {
        provenance: {
          synthetic: true,
          note: 'Production dock composer, controller, sagas, editor and send; scripted daemon wire and native helper. No screen capture, microphone, recording or real message.',
        },
        send,
        placements,
        native: captured.native,
      },
      null,
      2,
    )}\n`,
  );

  await test.info().attach('dock-composer-e2e-payload', {
    path: test.info().outputPath('dock-composer-e2e-payload.json'),
    contentType: 'application/json',
  });

  const params = send.params as {
    message?: string;
    content?: string;
    messageMetadata?: {
      type?: string;
      images?: { marks?: { n: number; tool: string; element?: unknown }[] }[];
      clip?: unknown;
    };
  };
  const text = String(params.message ?? params.content ?? '');
  expect(text).toContain('[[mark:4]]');
  expect(text).not.toContain('[[mark:5]]');
  expect(params.messageMetadata?.type).toBe('dock_screen_evidence');
  const marks = (params.messageMetadata?.images ?? []).flatMap((image) => image.marks ?? []);
  expect(marks.map((mark) => mark.n)).toEqual([1, 2, 3, 4]);
  expect(marks.filter((mark) => mark.tool === 'pick').every((mark) => mark.element)).toBe(true);
  expect(placements.filter((row) => 'sourcePath' in row)).toHaveLength(1);

  const video = page.video();
  await page.close();
  if (video) {
    const path = test.info().outputPath('dock-composer-e2e.webm');
    await video.saveAs(path);
    await test.info().attach('dock-composer-e2e', { path, contentType: 'video/webm' });
  }
});

test('closing retires transient media and preserves words and completed captures', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ComposerE2EHarness);
  const capture = component.getByRole('button', { name: /^Capture the screen/ });
  const record = component.getByRole('button', { name: /^Record the screen/ });
  await expect(record).toBeEnabled();
  await capture.click();
  const tiles = component.locator('[data-dock-media-attachments] .tile');
  await expect(tiles).toHaveCount(1);
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await say(page, 'Keep these known words');
  await expect(component.locator('[data-screen-interim]')).toContainText('Keep these known words');
  await record.click();
  await expect(component.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.evaluate(() => {
    const h = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
    h.native.holdCaptures(true);
  });
  await capture.click();
  await expect(capture).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.close(),
  );
  await expect(record).toBeHidden();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.reopen(),
  );
  await expect(record).toBeEnabled();
  await expect(component.locator('.tiptap-editor')).toContainText('Keep these known words');
  await expect(tiles).toHaveCount(1);
  await expect(capture).toBeEnabled();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.holdCaptures(
      false,
    ),
  );
  await expect(tiles).toHaveCount(1);
  await capture.click();
  await expect(capture).toBeEnabled();
  await expect(component.getByTestId('composer-submit-button')).toBeEnabled();
  await testInfo.attach('retired-draft-restored', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('retired-draft-native-log', {
    body: JSON.stringify(
      await page.evaluate(
        () => (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.log,
      ),
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
