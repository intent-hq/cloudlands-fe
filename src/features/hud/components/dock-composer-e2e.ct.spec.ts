import type { DockScreenEvidenceMetadata } from '$shared/dock-evidence';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness, { type ComposerDraftSnapshot } from './DockComposerE2EHarness.svelte';
import { SYNTHETIC_ELEMENTS } from './dock-composer-e2e-geometry.fixtures';

/**
 * End-to-end walkthrough of the dock composer with synthetic content only:
 * capture → annotate (box, arrow) → dictate with click chips → delete a chip
 * (renumber) → record start/stop → send. Production conversation, controller,
 * sagas, editor and send; the daemon wire and the native helper are scripted
 * (no screen capture, microphone, recording or real message).
 *
 * Artifacts are saved per test and attached to the Playwright report:
 * dock-composer-e2e-{1..6}.png and dock-composer-e2e-payload.json.
 */
const VIEW = { width: 452, height: 680 };

test.use({ viewport: VIEW });
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
  draftSnapshot: () => ComposerDraftSnapshot;
  store: {
    state: {
      dockConversation: { workspaceId: string | null; agentId: string | null; loading: boolean };
    };
    dispatch: (action: { type: string; payload: unknown[] }) => void;
  };
};

const draftSnapshot = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.draftSnapshot(),
  );

async function assertAdmitted(
  page: Page,
  before: ComposerDraftSnapshot,
  send: Harness['calls'][number],
) {
  const admitted = await draftSnapshot(page);
  const delivery = admitted.draft?.delivery;
  expect(delivery).toBeDefined();
  expect(delivery?.settled).not.toBe(true);
  expect(admitted.scope).toEqual(delivery?.reference.scope);
  expect(admitted.scope).toMatchObject({
    workspaceId: before.workspaceId,
    agentId: before.agentId,
  });
  expect(admitted.submission?.id).toBe(delivery?.reference.id);
  expect(admitted.submission?.status).toBe('sending');
  expect(admitted.submission?.content).toBe(before.draft?.text.trim());
  expect(admitted.submission?.messageMetadata).toEqual(send.params.messageMetadata);
  expect(admitted.submission?.imageBlocks).toEqual(send.params.imageBlocks);
  expect(admitted.submission?.fileBlocks).toEqual(send.params.fileBlocks);
  expect(delivery?.recovery?.text).toBe(before.draft?.text);
  expect(delivery?.recovery?.evidence?.marks).toEqual(before.evidence?.marks);
  expect(delivery?.recovery?.evidence?.images).toEqual(before.evidence?.images);
  expect(admitted.recoveryItems).toEqual(before.contextItems);
  expect(admitted.draft?.text).toBe('');
  expect(admitted.contextItems).toEqual([]);
  expect(admitted.evidence?.marks ?? []).toEqual([]);
  return admitted;
}

async function settleAdmission(page: Page, admitted: ComposerDraftSnapshot) {
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.fixture.settle(),
  );
  await expect.poll(async () => (await draftSnapshot(page)).draft?.delivery?.settled).toBe(true);
  const settled = await draftSnapshot(page);
  expect(settled.draft?.delivery?.reference).toEqual(admitted.draft?.delivery?.reference);
  expect(settled.draft?.text).toBe('');
  expect(settled.contextItems).toEqual([]);
  expect(settled.evidence?.marks ?? []).toEqual([]);
  expect(
    settled.submission?.status === 'accepted' ||
      (!!settled.tombstone && settled.tombstone.reason !== 'rejected'),
  ).toBe(true);
  return settled;
}

/**
 * Choose an annotate tool, as the recording tool bar or a tool key does: the
 * composer itself has no annotate button (capture, record and dictate only).
 */
async function chooseTool(page: Page, tool: 'box' | 'arrow'): Promise<void> {
  await page.evaluate((value) => {
    const { store } = (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'dockConversation/evidenceToolSelectRequested',
      payload: [workspaceId, agentId, value],
    });
  }, tool);
}

async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (value) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.setCaption(value),
    text,
  );
}

async function gesture(
  page: Page,
  tool: 'box' | 'arrow',
  rect: { x: number; y: number; w: number; h: number },
  element: { role: string; name: string; path: string | null; source: string | null } | null,
): Promise<void> {
  await page.evaluate(
    ([t, r, e]) =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.native.gesture(
        t,
        t === 'arrow'
          ? { kind: 'arrow', from: { x: r.x, y: r.y }, to: { x: r.x + r.w, y: r.y + r.h } }
          : { kind: 'rect', ...r },
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

test('dock composer walkthrough: capture, annotate, dictate, renumber, record, send', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const component = await mount(ComposerE2EHarness);
  const footer = component.locator('[data-dock-media-footer]');
  await expect(footer).toBeVisible();
  // Capture, record and dictate only; record enables once native capabilities are installed.
  await expect(footer.locator('.controls button')).toHaveCount(3);
  await expect(component.getByRole('button', { name: /^Record the screen/ })).toBeEnabled();
  const editor = component.locator('.tiptap-editor');
  const tiles = component.locator('[data-dock-media-attachments] .tile');
  const chips = editor.locator('.screen-reference-chip');

  // 1 Idle
  await caption(page, '1 · Idle: model, capture, record, mic, Send');
  await editor.click();
  await screen(page, 1);

  // 2 Captured
  await component.getByRole('button', { name: /^Capture the screen/ }).click();
  await expect(tiles).toHaveCount(1);
  await tiles.first().getByRole('button').first().focus();
  await expect(component.getByRole('button', { name: 'Mark up' })).toBeVisible();
  await screen(page, 2);

  // 4 Annotating: box, two shapes
  await caption(page, '4 · Annotate with Box: two shapes on the screen');
  await chooseTool(page, 'box');
  await expect(component.getByText('Annotating', { exact: true })).toBeVisible();
  const { card, save, cancel } = SYNTHETIC_ELEMENTS;
  await gesture(page, 'box', { x: card.x + 30, y: card.y + 90, w: card.w - 60, h: 100 }, null);
  // The session image either reuses the unmarked capture or adds one; the mark lands either way.
  await expect(
    component.getByRole('button', { name: 'Screenshot with 1 marks. Open' }),
  ).toBeVisible();
  await gesture(page, 'box', { x: cancel.x - 10, y: cancel.y - 10, w: cancel.w + 20, h: 72 }, null);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 2 marks. Open' }),
  ).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);
  await screen(page, 4);

  // Arrow: switch to a supported tool in the open session.
  await caption(page, 'Annotate with Arrow');
  await chooseTool(page, 'arrow');
  await gesture(page, 'arrow', { x: save.x, y: save.y, w: save.w, h: save.h }, null);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 3 marks. Open' }),
  ).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);

  // 5 Dictating with shape reference chips
  await chooseTool(page, 'box');
  await component.getByRole('button', { name: /^Dictate/ }).click();
  await expect(component.getByText('Listening', { exact: true })).toBeVisible();
  await say(page, 'Closer, but this');
  await gesture(page, 'box', { x: card.x, y: card.y, w: card.w, h: card.h }, null);
  await say(page, ' still has the old shadow, and this one');
  await gesture(page, 'box', { x: save.x, y: save.y, w: save.w, h: save.h }, null);
  await say(page, ' drops its hover');
  await expect(component.locator('[data-screen-interim]')).toBeVisible();
  await expect(component.locator('[data-dock-dictation-time]')).toBeVisible();
  await screen(page, 5);

  // Stop: finals commit in place with their chips.
  await component.getByRole('button', { name: 'Stop dictating' }).click();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveAccessibleName(/^Reference 4:/);
  await expect(chips.nth(1)).toHaveAccessibleName(/^Reference 5:/);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 5 marks. Open' }),
  ).toBeVisible();

  // Delete chip 4 → its mark goes; chip 5 renumbers to 4 in text and image.
  const first = (await chips.nth(0).boundingBox())!;
  await page.mouse.click(first.x + first.width + 1, first.y + first.height / 2);
  await page.keyboard.press('Backspace');
  await expect(chips).toHaveCount(1);
  await expect(chips.nth(0)).toHaveAccessibleName(/^Reference 4:/);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 4 marks. Open' }),
  ).toBeVisible();

  // 6 Recording (scripted recorder; nothing is recorded)
  await component.getByRole('button', { name: /^Record the screen/ }).click();
  const stopRecording = component.getByRole('button', { name: 'Stop recording' });
  await expect(stopRecording).toBeVisible();
  await expect(component.getByText('Recording', { exact: true })).toBeVisible();
  await page.mouse.move(5, VIEW.height - 5);
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

  // Send
  const submit = component.getByTestId('composer-submit-button');
  await expect(submit).toBeEnabled();
  const owner = await page.evaluate(() => {
    const { workspaceId, agentId } = (window as unknown as { __dockComposerE2E: Harness })
      .__dockComposerE2E.store.state.dockConversation;
    return { workspaceId, agentId };
  });
  await expect(tiles).not.toHaveCount(0);
  await expect(chips).toHaveCount(1);
  const beforeSend = await draftSnapshot(page);
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
  const sends = captured.calls.filter(
    (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
  );
  expect(sends).toHaveLength(1);
  const [send] = sends;
  const admitted = await assertAdmitted(page, beforeSend, send);
  await expect(tiles).toHaveCount(0);
  await expect(chips).toHaveCount(0);
  const settled = await settleAdmission(page, admitted);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.filter(
          (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
        ).length,
    ),
  ).toBe(1);
  await expect(tiles).toHaveCount(0);
  await expect(chips).toHaveCount(0);

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
        admissionId: admitted.submission?.id,
        settled: settled.draft?.delivery?.settled,
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
  expect(marks.map((mark) => mark.tool)).toEqual(['box', 'box', 'arrow', 'box']);
  expect(send.params).toMatchObject(owner);
  expect(placements.filter((row) => 'sourcePath' in row)).toHaveLength(1);
});

test('restored legacy Pick marks retain metadata through reference deletion and send', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness, { props: { legacyPickDraft: true } });
  await expect
    .poll(async () => {
      const state = await draftSnapshot(page);
      return (
        state.restore?.status === 'restored' &&
        state.restore.workspaceId === state.workspaceId &&
        state.restore.agentId === state.agentId &&
        !!state.restore.requestId &&
        state.draft?.restored === true
      );
    })
    .toBe(true);
  const restored = await draftSnapshot(page);
  expect(restored.restore?.draft?.text).toBe('Review [[mark:1]] and [[mark:2]]');
  expect(restored.restore?.draft?.attachments).toHaveLength(1);
  const seeded = {
    workspaceId: restored.workspaceId,
    agentId: restored.agentId,
    marks: restored.evidence?.marks ?? [],
  };
  expect(seeded.marks.map(({ id, tool, element }) => ({ id, tool, element }))).toEqual([
    {
      id: 'legacy-pick-1',
      tool: 'pick',
      element: {
        role: 'button',
        name: 'Cancel',
        path: 'main > button.cancel',
        source: 'https://example.test/settings',
      },
    },
    {
      id: 'legacy-pick-2',
      tool: 'pick',
      element: {
        role: 'button',
        name: 'Save',
        path: 'main > button.save',
        source: 'https://example.test/settings',
      },
    },
  ]);
  const editor = component.locator('.tiptap-editor');
  const chips = editor.locator('.screen-reference-chip');
  const tiles = component.locator('[data-dock-media-attachments] .tile');
  await expect(chips).toHaveCount(2);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 2 marks. Open' }),
  ).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' with the updated explanation');
  const first = (await chips.first().boundingBox())!;
  await page.mouse.click(first.x + first.width + 1, first.y + first.height / 2);
  await page.keyboard.press('Backspace');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveAccessibleName(/^Reference 1:/);
  await expect(
    component.getByRole('button', { name: 'Screenshot with 1 marks. Open' }),
  ).toBeVisible();
  const beforeSend = await draftSnapshot(page);
  await component.getByTestId('composer-submit-button').click();
  const sends = () =>
    page.evaluate(() =>
      (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.filter(
        (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
      ),
    );
  await expect.poll(async () => (await sends()).length).toBe(1);
  const [send] = await sends();
  expect(send.params).toMatchObject({ workspaceId: seeded.workspaceId, agentId: seeded.agentId });
  const placements = await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: Harness }).__dockComposerE2E.calls.filter(
      (call) => call.method === 'file.placeAttachment',
    ),
  );
  // This wire does not advertise raw retention: one restored screenshot places one composite.
  expect(placements).toHaveLength(1);
  expect(placements[0].params).toMatchObject({
    workspaceId: seeded.workspaceId,
    mimeType: 'image/png',
  });
  expect(placements[0].params).not.toHaveProperty('sourcePath');
  const metadata = send.params.messageMetadata as DockScreenEvidenceMetadata;
  expect(metadata.type).toBe('dock_screen_evidence');
  expect(metadata.images.flatMap((image) => image.marks)).toEqual([
    expect.objectContaining({
      n: 1,
      id: 'legacy-pick-2',
      tool: 'pick',
      element: seeded.marks[1].element,
    }),
  ]);
  const text = String(send.params.message ?? send.params.content ?? '');
  expect(text).toContain('with the updated explanation');
  expect(text).toContain('[[mark:1]]');
  expect(text).not.toContain('[[mark:2]]');
  const admitted = await assertAdmitted(page, beforeSend, send);
  await expect(chips).toHaveCount(0);
  await expect(tiles).toHaveCount(0);
  const settled = await settleAdmission(page, admitted);
  await expect(chips).toHaveCount(0);
  await expect(tiles).toHaveCount(0);
  expect(await sends()).toHaveLength(1);
  await expect(editor).toHaveText('');
  await info.attach('legacy-pick-send-receipt', {
    body: JSON.stringify(
      {
        synthetic: true,
        seeded,
        send,
        admissionId: admitted.submission?.id,
        settled: settled.draft?.delivery?.settled,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
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

test('Record from the composer opens the recording tool bar in mouse mode, and Stop closes it', async ({
  mount,
  page,
}) => {
  const component = await mount(ComposerE2EHarness);
  const footer = component.locator('[data-dock-media-footer]');
  await expect(footer.locator('.controls button')).toHaveCount(3);
  const native = () =>
    page.evaluate(() => {
      const { native } = (
        window as unknown as {
          __dockComposerE2E: {
            native: {
              sessionId: string | null;
              log: {
                annotations: { id: string; mode: string }[];
                mouse: string[];
                ended: string[];
                clips: { started: string[]; stopped: string[] };
              };
            };
          };
        }
      ).__dockComposerE2E;
      return { sessionId: native.sessionId, ...structuredClone(native.log) };
    });

  await component.getByRole('button', { name: /^Record the screen/ }).click();
  await expect(component.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  // One live session opened for the bar, switched to mouse mode, then the clip started.
  await expect.poll(async () => (await native()).clips.started.length).toBe(1);
  const opened = await native();
  expect(opened.annotations).toHaveLength(1);
  expect(opened.annotations[0]).toMatchObject({ mode: 'live' });
  expect(opened.sessionId).toBe(opened.annotations[0]!.id);
  expect(opened.mouse).toEqual([opened.annotations[0]!.id]);

  // Stop from the composer: the clip is kept and the bar's session closes with it.
  await component.getByRole('button', { name: 'Stop recording' }).click();
  await expect.poll(async () => (await native()).sessionId).toBeNull();
  const stopped = await native();
  expect(stopped.clips.stopped).toHaveLength(1);
  expect(stopped.ended).toContain(opened.annotations[0]!.id);
  await expect(
    component.locator('[data-dock-media-attachments] .tile[data-kind="clip"]'),
  ).toHaveCount(1);
});
