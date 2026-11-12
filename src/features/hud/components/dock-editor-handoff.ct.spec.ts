import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

type IpcRow = { ch: string; token: string | null; kind: string | null; at: number };

/**
 * Capture → editor handoff through the real dock sagas (synthetic native capture/recorder,
 * conversation wire). Main's window hold, editor window and attach decision are outside the
 * browser: their dock-side IPC is recorded and answered here, and main's ATTACHED event is
 * emitted as main sends it. Proves: the hold begins before the capture/stop and travels in
 * the editor request (adopted, not ended); a refused editor ends it; Attach returns to the
 * exact conversation with its prompt focused; a stale attach does nothing.
 */
test('editor handoff: held through capture/stop, attach returns to the prompt', async ({
  mount,
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  const pair = await page.evaluate(() => {
    const d = (window as any).__dockComposerE2E.store.state.dockConversation;
    return { workspaceId: d.workspaceId as string, agentId: d.agentId as string };
  });
  // A draft in the conversation (its prompt is in use, as when a person captures from it).
  await page.locator('.tiptap-editor').first().click();
  await page.keyboard.type('Draft before capture');
  // The editor preview (the only way a capture opens straight in the editor today).
  await page.evaluate(() => localStorage.setItem('intent.dock.captureEditorPreview', '1'));
  // Main's side of the handoff, recorded and answered.
  await page.evaluate(() => {
    const api = (window as any).electronAPI;
    const inner = api.invoke.bind(api);
    (window as any).__ipc = [];
    (window as any).__openOk = true;
    api.invoke = async (ch: string, payload: any) => {
      if (ch === 'dock-capture-editor:hold-begin' || ch === 'dock-capture-editor:hold-end') {
        (window as any).__ipc.push({
          ch,
          token: payload?.token ?? null,
          kind: null,
          at: performance.now(),
        });
        return true;
      }
      if (ch === 'dock-capture-editor:open') {
        (window as any).__ipc.push({
          ch,
          token: payload?.holdToken ?? null,
          kind: payload?.kind ?? null,
          at: performance.now(),
        });
        return (window as any).__openOk
          ? { ok: true, openId: crypto.randomUUID() }
          : { ok: false, error: 'unavailable' };
      }
      return inner(ch, payload);
    };
  });
  const ipc = () => page.evaluate(() => (window as any).__ipc as IpcRow[]);
  const open = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
    ) as Promise<string | null>;
  const closeRequests = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.hud.dockCloseRequest as number,
    );
  const receipts: Record<string, unknown> = { pair };

  // 1. Screenshot: hold → capture → editor request carrying that hold (adopted, not ended).
  const closesBefore = await closeRequests();
  await page.evaluate(
    ({ workspaceId, agentId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/evidenceCaptureRequested',
        payload: [workspaceId, agentId],
      }),
    pair,
  );
  // The editor opens after the draft is saved durably (its own bounded wait).
  await expect
    .poll(async () => (await ipc()).some((r) => r.ch === 'dock-capture-editor:open'), {
      timeout: 20_000,
    })
    .toBe(true);
  let rows = await ipc();
  const shotHold = rows.find((r) => r.ch === 'dock-capture-editor:hold-begin')!;
  const shotOpen = rows.find((r) => r.ch === 'dock-capture-editor:open')!;
  expect(shotHold.token).toBeTruthy();
  expect(shotOpen).toMatchObject({ kind: 'screenshot', token: shotHold.token });
  expect(shotHold.at).toBeLessThan(shotOpen.at);
  expect(rows.some((r) => r.ch === 'dock-capture-editor:hold-end')).toBe(false);
  // The opened editor collapses the dock behind it (main keeps it out of sight meanwhile).
  await expect.poll(closeRequests).toBeGreaterThan(closesBefore);
  receipts.screenshot = { holdBeforeOpen: true, openCarriesHold: true, ended: false };

  // 2. An editor that does not open ends exactly its capture's hold.
  await page.evaluate(() => ((window as any).__openOk = false));
  await page.evaluate(
    ({ workspaceId, agentId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/evidenceCaptureRequested',
        payload: [workspaceId, agentId],
      }),
    pair,
  );
  await expect
    .poll(async () => (await ipc()).filter((r) => r.ch === 'dock-capture-editor:hold-end').length)
    .toBe(1);
  rows = await ipc();
  const refusedHold = rows.filter((r) => r.ch === 'dock-capture-editor:hold-begin')[1]!;
  const ended = rows.find((r) => r.ch === 'dock-capture-editor:hold-end')!;
  expect(ended.token).toBe(refusedHold.token);
  expect(ended.token).not.toBe(shotHold.token);
  receipts.refused = { endedOwnHoldOnly: true };
  await page.evaluate(() => ((window as any).__openOk = true));

  // 3. Recording: the stop takes the hold; the finished clip's editor request carries it.
  await page.evaluate(
    ({ workspaceId, agentId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/evidenceRecordToggleRequested',
        payload: [workspaceId, agentId],
      }),
    pair,
  );
  const clipId = await expect
    .poll(() =>
      page.evaluate(({ workspaceId, agentId }) => {
        const all: any[] = Object.values(
          (window as any).__dockComposerE2E.store.state.dockConversation.evidence.map ?? {},
        );
        const e = all.find((x) => x?.clips?.length);
        void workspaceId;
        void agentId;
        return e?.clips.find((c: any) => c.status === 'recording')?.id ?? null;
      }, pair),
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(() => {
        const all: any[] = Object.values(
          (window as any).__dockComposerE2E.store.state.dockConversation.evidence.map ?? {},
        );
        return all.find((x) => x?.clips?.length)?.clips.find((c: any) => c.status === 'recording')
          ?.id as string;
      }),
    );
  const beforeStop = (await ipc()).length;
  await page.evaluate(
    ({ workspaceId, agentId, clipId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/evidenceRecordToggleRequested',
        payload: [workspaceId, agentId, clipId],
      }),
    { ...pair, clipId },
  );
  // The synthetic recorder places the clip without a canonical media source, so no editor
  // follows here: the stop's hold must end (the dock comes back). The editor-adopts path is
  // the screenshot's, above; a real recording's source comes from native placement.
  await expect
    .poll(
      async () =>
        (await ipc()).slice(beforeStop).filter((r) => r.ch.startsWith('dock-capture-editor:hold-'))
          .length,
    )
    .toBe(2);
  rows = (await ipc()).slice(beforeStop);
  const recHold = rows.find((r) => r.ch === 'dock-capture-editor:hold-begin')!;
  const recEnd = rows.find((r) => r.ch === 'dock-capture-editor:hold-end')!;
  expect(recEnd.token).toBe(recHold.token);
  expect(recHold.at).toBeLessThan(recEnd.at);
  expect(rows.some((r) => r.ch === 'dock-capture-editor:open')).toBe(false);
  receipts.recording = {
    holdAtStop: true,
    editorFollowed: false,
    holdEndedWithoutEditor: true,
    note: 'synthetic clip has no media source; adopted path proven by the screenshot',
  };

  // 4. Attach: main returns the dock to exactly that conversation; the prompt takes the keyboard.
  const source = await page.evaluate(() => {
    const all: any[] = Object.values(
      (window as any).__dockComposerE2E.store.state.dockConversation.evidence.map ?? {},
    );
    const image = all.flatMap((x) => x?.images ?? []).find((i: any) => i?.media?.source);
    return image
      ? {
          attachmentId: image.media.source.attachmentId,
          id: image.media.source.id,
          revision: image.media.source.revision,
        }
      : null;
  });
  expect(source).not.toBeNull();
  const attached = (revision: number) =>
    page.evaluate(
      ({ pair, source, revision }) =>
        (window as any).__dockComposerE2E.fixture.emit('dock-capture-editor:attached', {
          openId: crypto.randomUUID(),
          workspaceId: pair.workspaceId,
          agentId: pair.agentId,
          attachmentId: source!.attachmentId,
          sourceId: source!.id,
          sourceRevision: revision,
        }),
      { pair, source, revision },
    );
  // Stale (a different source revision): nothing moves.
  await page.evaluate(() => (window as any).__dockComposerE2E.close());
  await expect.poll(open).toBeNull();
  await attached(source!.revision + 99);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a stale attach must not open anything
  await page.waitForTimeout(800);
  expect(await open()).toBeNull();
  // Current: back to the conversation, prompt focused.
  await attached(source!.revision);
  await expect.poll(open).toBe(pair.workspaceId);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return (
          !!active?.closest('.tiptap-editor') || active?.getAttribute('contenteditable') === 'true'
        );
      }),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('17-editor-attach-returned.png') });
  await expect(page.locator('.tiptap-editor').first()).toContainText('Draft before capture');
  receipts.attach = {
    staleIgnored: true,
    returnedTo: pair.workspaceId,
    composerFocused: true,
    draftKept: true,
  };

  await writeFile(
    info.outputPath('editor-handoff-receipt.json'),
    JSON.stringify(
      {
        ...receipts,
        scope:
          "Dock sagas with synthetic native capture/recorder; main's hold/open/attach are recorded or emitted here. Main's window hide/reveal and the editor window are not exercised in the browser.",
      },
      null,
      2,
    ),
  );
});
