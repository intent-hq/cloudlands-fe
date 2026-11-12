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
  // Phase marks, from inside the page: request, image in the evidence, original placed (its
  // media source), editor OPEN invoked (main's own phases are outside this run).
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    const marks: Record<string, number> = { request: performance.now() };
    (window as any).__marks = marks;
    const tick = () => {
      const all: any[] = Object.values(h.store.state.dockConversation.evidence.map ?? {});
      const image = all.flatMap((x) => x?.images ?? [])[0];
      if (image && marks.imageInEvidence === undefined) marks.imageInEvidence = performance.now();
      if (image?.media?.source && marks.sourcePlaced === undefined)
        marks.sourcePlaced = performance.now();
      if (marks.sourcePlaced === undefined) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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
  const marks = await page.evaluate(() => (window as any).__marks as Record<string, number>);
  const round = (n: number | undefined) => (n === undefined ? null : Math.round(n));
  receipts.screenshot = { holdBeforeOpen: true, openCarriesHold: true, ended: false };
  receipts.startupPhasesMs = {
    requestToHold: round(shotHold.at - marks.request!),
    holdToImageInEvidence: round(marks.imageInEvidence! - shotHold.at),
    imageToSourcePlaced: round((marks.sourcePlaced ?? shotOpen.at) - marks.imageInEvidence!),
    sourcePlacedToOpen: round(shotOpen.at - (marks.sourcePlaced ?? shotOpen.at)),
    requestToOpenTotal: round(shotOpen.at - marks.request!),
    note: 'Synthetic capture and wire (draft flush ACK included in sourcePlacedToOpen); main editor creation/reveal not in this run.',
  };

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

  // 3. Recording (canonical source, as native placement provides it): the start takes the
  // hold; the user's Stop finishes it and the recording editor request carries that hold.
  await page.evaluate(() => (window as any).__dockComposerE2E.native.recordingOriginal(true));
  const recordingClip = async () =>
    page.evaluate(() => {
      const all: any[] = Object.values(
        (window as any).__dockComposerE2E.store.state.dockConversation.evidence.map ?? {},
      );
      return (all.flatMap((x) => x?.clips ?? []).find((c: any) => c.status === 'recording')?.id ??
        null) as string | null;
    });
  const startRecording = async () => {
    const before = (await ipc()).length;
    await page.evaluate(
      ({ workspaceId, agentId }) =>
        (window as any).__dockComposerE2E.store.dispatch({
          type: 'dockConversation/evidenceRecordToggleRequested',
          payload: [workspaceId, agentId],
        }),
      pair,
    );
    await expect.poll(recordingClip).not.toBeNull();
    await expect
      .poll(async () =>
        (await ipc()).slice(before).some((r) => r.ch === 'dock-capture-editor:hold-begin'),
      )
      .toBe(true);
    return {
      before,
      clipId: (await recordingClip())!,
      hold: (await ipc()).slice(before).find((r) => r.ch === 'dock-capture-editor:hold-begin')!,
    };
  };
  const recordingOpened = async (before: number) => {
    await expect
      .poll(
        async () =>
          (await ipc())
            .slice(before)
            .some((r) => r.ch === 'dock-capture-editor:open' && r.kind === 'recording'),
        { timeout: 20_000 },
      )
      .toBe(true);
    return (await ipc()).slice(before);
  };
  const stopped = await startRecording();
  await page.evaluate(
    ({ workspaceId, agentId, clipId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/evidenceRecordToggleRequested',
        payload: [workspaceId, agentId, clipId],
      }),
    { ...pair, clipId: stopped.clipId },
  );
  rows = await recordingOpened(stopped.before);
  const stopOpen = rows.find((r) => r.ch === 'dock-capture-editor:open' && r.kind === 'recording')!;
  expect(stopOpen.token).toBe(stopped.hold.token);
  expect(rows.some((r) => r.ch === 'dock-capture-editor:hold-end')).toBe(false);
  receipts.recordingStop = { holdAtStart: true, openCarriesHold: true, ended: false };

  // 3b. A recording that ends by itself (a native limit, nobody pressed Stop): the hold taken
  // at its start still travels to the recording editor; the dock never comes back first.
  const auto = await startRecording();
  await page.evaluate(
    (clipId) => (window as any).__dockComposerE2E.native.endClip(clipId),
    auto.clipId,
  );
  rows = await recordingOpened(auto.before);
  const autoOpen = rows.find((r) => r.ch === 'dock-capture-editor:open' && r.kind === 'recording')!;
  expect(autoOpen.token).toBe(auto.hold.token);
  expect(rows.some((r) => r.ch === 'dock-capture-editor:hold-end')).toBe(false);
  receipts.recordingAutoEnded = { holdAtStart: true, openCarriesHold: true, ended: false };

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
  receipts.attach = {
    staleIgnored: true,
    returnedTo: pair.workspaceId,
    composerFocused: true,
    emptyComposer: true,
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
