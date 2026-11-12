import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

type IpcRow = {
  ch: string;
  token: string | null;
  kind: string | null;
  at: number;
  hide?: boolean | null;
  openId?: string;
  currentRegions?: boolean;
};

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
  await mount(Harness, {
    props: { shell: dockRailPreview.states.notch.props, nativePlacementFixture: true },
    hooksConfig: {
      mockIpc: {
        'window:get-dock-placement': null,
        'window:update-dock-placement': null,
        'window:set-dock-pointer-region': { success: true, supported: true, version: 0 },
        'window:dock-renderer-ready': { shown: true },
      },
    },
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockActivated' }),
  );
  // 0. A conversation opened while main refuses the native session (as for a hidden dock):
  // no timer retries it; each time main shows the dock it probes again, until admitted.
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__syntheticNativeRefusals = 2;
    g.__syntheticNativeProbes = 0;
    const store = g.__dockComposerE2E.store;
    const workspaceId = store.state.dockConversation.workspaceId;
    store.dispatch({ type: 'dockConversation/close', payload: [] });
    store.dispatch({ type: 'dockConversation/open', payload: [workspaceId] });
  });
  const probes = () => page.evaluate(() => (globalThis as any).__syntheticNativeProbes as number);
  const caps = () =>
    page.evaluate(
      () => !!(window as any).__dockComposerE2E.store.state.dockConversation.nativeCapabilities,
    );
  await expect.poll(probes).toBe(1);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: a refused probe must not retry on a timer
  await page.waitForTimeout(2500);
  expect(await probes()).toBe(1);
  expect(await caps()).toBe(false);
  const shown = () =>
    page.evaluate(() => (window as any).__dockComposerE2E.fixture.emit('window:dock-shown'));
  await shown();
  await expect.poll(probes).toBe(2);
  expect(await caps()).toBe(false);
  await shown();
  await expect.poll(caps).toBe(true);
  const retried = { probes: await probes(), ms: 1 };
  const refusedProbeRetried = { probes: retried.probes, timerRetries: 0, admittedOnShow: 2 };
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__dockComposerE2E.store.state.dockConversation;
        return !d.loading && !!d.agentId;
      }),
    )
    .toBe(true);
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
      if (
        ch === 'dock-capture-editor:hold-begin' ||
        ch === 'dock-capture-editor:hold-end' ||
        ch === 'dock-capture-editor:hold-show'
      ) {
        (window as any).__ipc.push({
          ch,
          token: payload?.token ?? null,
          hide: payload?.hide ?? null,
          kind: null,
          at: performance.now(),
        });
        return true;
      }
      if (ch === 'dock-capture-editor:open') {
        const openId = crypto.randomUUID();
        (window as any).__ipc.push({
          ch,
          token: payload?.holdToken ?? null,
          kind: payload?.kind ?? null,
          at: performance.now(),
          openId,
          attachmentId: payload?.attachmentId ?? null,
          sourceId: payload?.source?.id ?? null,
          sourceRevision: payload?.source?.revision ?? null,
        });
        if ((window as any).__closeDuringOpen) {
          (window as any).__closeDuringOpen = false;
          (window as any).__dockComposerE2E.fixture.emit('dock-capture-editor:changed', {
            endedOpenId: openId,
          });
        }
        return (window as any).__openOk
          ? { ok: true, openId }
          : { ok: false, error: 'unavailable' };
      }
      if (ch === 'window:set-dock-pointer-region') {
        (window as any).__pointerVersion = ((window as any).__pointerVersion ?? 0) + 1;
        return { success: true, supported: true, version: (window as any).__pointerVersion };
      }
      if (ch === 'window:update-dock-placement' && payload?.editorCompact) {
        const surface = document.querySelector('[data-dock-surface]');
        (window as any).__ipc.push({
          ch,
          token: payload.editorCompact.openId,
          kind: surface?.getAttribute('data-expanded'),
          at: performance.now(),
          currentRegions: payload.editorCompact.pointerVersion === (window as any).__pointerVersion,
          focused: document.hasFocus(),
        });
      }
      if (ch === 'dock-capture-editor:attach-return') {
        (window as any).__ipc.push({
          ch,
          token: payload?.openId ?? null,
          kind: String(payload?.accept),
          at: performance.now(),
        });
        return payload?.accept === true;
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
  const receipts: Record<string, unknown> = { pair, refusedProbeRetried };

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
  // A screenshot hides the dock at the press; its editor shell shows once the image is
  // taken, before the durable save and OPEN.
  const shotShow = rows.find((r) => r.ch === 'dock-capture-editor:hold-show')!;
  expect(shotHold.hide).toBe(true);
  expect(shotShow.token).toBe(shotHold.token);
  expect(shotShow.at).toBeLessThan(shotOpen.at);
  expect(rows.some((r) => r.ch === 'dock-capture-editor:hold-end')).toBe(false);
  // Keep a bounded failure receipt with state, never prompt text or attachment bytes.
  const compactState = () =>
    page.evaluate(() => {
      const hud = (window as any).__dockComposerE2E.store.state.hud;
      const surface = document.querySelector('[data-dock-surface]');
      return {
        request: hud.dockEditorCompactRequest,
        active: hud.active,
        surfaceExpanded: surface?.getAttribute('data-expanded'),
        pointerVersion: (window as any).__pointerVersion,
        dock: {
          workspaceId: (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
          agentId: (window as any).__dockComposerE2E.store.state.dockConversation.agentId,
        },
        pointer: document
          .querySelector('[data-preview-pointer]')
          ?.getAttribute('data-preview-pointer'),
        recording: Object.values(
          (window as any).__dockComposerE2E.store.state.dockConversation.evidence.map ?? {},
        ).flatMap((e: any) => e?.clips?.map((c: any) => ({ id: c.id, status: c.status })) ?? []),
        acknowledgements: (window as any).__ipc.filter(
          (r: any) => r.ch === 'window:update-dock-placement',
        ),
      };
    });
  // The opened editor collapses the dock behind it (main keeps it out of sight meanwhile).
  await expect
    .poll(
      async () =>
        (await ipc()).filter(
          (r) => r.ch === 'window:update-dock-placement' && r.token === shotOpen.openId,
        ).length,
    )
    .toBe(1)
    .catch(async (error) => {
      await writeFile(
        info.outputPath('compact-failure.json'),
        JSON.stringify(await compactState(), null, 2),
      );
      throw error;
    });
  const compact = (await ipc()).find(
    (r) => r.ch === 'window:update-dock-placement' && r.token === shotOpen.openId,
  ) as any;
  expect(compact.kind).toBe('false');
  expect(compact.currentRegions).toBe(true);
  expect(await closeRequests()).toBe(closesBefore); // editor collapse is not the shortcut toggle
  receipts.compact = compact;

  const marks = await page.evaluate(() => (window as any).__marks as Record<string, number>);
  const round = (n: number | undefined) => (n === undefined ? null : Math.round(n));
  receipts.screenshot = { holdBeforeOpen: true, openCarriesHold: true, ended: false };
  receipts.startupPhasesMs = {
    requestToHold: round(shotHold.at - marks.request!),
    holdToImageInEvidence: round(marks.imageInEvidence! - shotHold.at),
    imageToSourcePlaced: round((marks.sourcePlaced ?? shotOpen.at) - marks.imageInEvidence!),
    sourcePlacedToOpen: round(shotOpen.at - (marks.sourcePlaced ?? shotOpen.at)),
    requestToOpenTotal: round(shotOpen.at - marks.request!),
    requestToShellShown: round(shotShow.at - marks.request!),
    shellShownToOpen: round(shotOpen.at - shotShow.at),
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
  expect((await ipc()).filter((r) => r.ch === 'window:update-dock-placement')).toHaveLength(1);
  receipts.refused = { endedOwnHoldOnly: true, noCompactAcknowledgement: true };
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

  const compactFor = async (row: IpcRow) => {
    await expect
      .poll(async () =>
        (await ipc()).find(
          (r) => r.ch === 'window:update-dock-placement' && r.token === row.openId,
        ),
      )
      .toMatchObject({ kind: 'false', currentRegions: true })
      .catch(async (error) => {
        await writeFile(
          info.outputPath('compact-failure.json'),
          JSON.stringify({ expectedOpenId: row.openId, ...(await compactState()) }, null, 2),
        );
        throw error;
      });
    expect(await open()).toBe(pair.workspaceId);
    expect(
      await page.evaluate(
        () => (window as any).__dockComposerE2E.store.state.dockConversation.agentId,
      ),
    ).toBe(pair.agentId);
  };
  await compactFor(stopOpen);
  // A pill opened from an expanded, pinned conversation must collapse too. Reopening
  // while already compact is idempotent: it must never take the shortcut toggle path.
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockFocusRequested' }),
  );
  await expect(page.getByTestId('dock-surface')).toHaveAttribute('data-expanded', 'true');
  for (const mode of ['expanded-pill', 'already-compact-pill']) {
    const before = (await ipc()).length;
    await page.evaluate(
      ({ workspaceId, agentId, clipId }) =>
        (window as any).__dockComposerE2E.store.dispatch({
          type: 'dockConversation/mediaEditorOpenRequested',
          payload: [workspaceId, agentId, clipId],
        }),
      { ...pair, clipId: stopped.clipId },
    );
    const pillRows = await recordingOpened(before);
    const pill = pillRows.find((r) => r.ch === 'dock-capture-editor:open')!;
    await compactFor(pill);
    receipts[mode] = { compact: true, sameOwner: true, shortcutToggled: false };
  }
  expect(await closeRequests()).toBe(closesBefore);
  await page.screenshot({ path: info.outputPath('16-editor-owner-compact.png') });

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
  // Automatic clip completion leaves its annotation session live in this fixture.
  // The existing live-input barrier must refuse collapse until that session ends.
  expect(
    await page.evaluate(() => (window as any).__dockComposerE2E.native.sessionId),
  ).toBeTruthy();
  expect(
    (await ipc()).some(
      (r) => r.ch === 'window:update-dock-placement' && r.token === autoOpen.openId,
    ),
  ).toBe(false);
  await page.evaluate(() => (window as any).__dockComposerE2E.native.endNatively());
  await compactFor(autoOpen);
  receipts.liveInputBarrier = {
    annotationBlockedCompact: true,
    automaticallyCompactedAfterInputEnded: true,
  };

  // A pending presentation request cannot survive A -> B -> A, even though the editor
  // still owns its source and may later Attach back to A.
  const navigated = await startRecording();
  await page.evaluate(
    (clipId) => (window as any).__dockComposerE2E.native.endClip(clipId),
    navigated.clipId,
  );
  const navigationOpen = (await recordingOpened(navigated.before)).find(
    (r) => r.ch === 'dock-capture-editor:open',
  )!;
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest?.openId,
      ),
    )
    .toBe(navigationOpen.openId);
  const originalGeneration = await page.evaluate(
    () => (window as any).__dockComposerE2E.store.state.dockConversation.generation,
  );
  await page.evaluate((agentId) => {
    const store = (window as any).__dockComposerE2E.store;
    store.dispatch({ type: 'dockConversation/selectAgent', payload: ['wire-sub'] });
    store.dispatch({ type: 'dockConversation/selectAgent', payload: [agentId] });
  }, pair.agentId);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dock = (window as any).__dockComposerE2E.store.state.dockConversation;
        return { agentId: dock.agentId, loading: dock.loading, generation: dock.generation };
      }),
    )
    .toEqual({ agentId: pair.agentId, loading: false, generation: originalGeneration + 2 });
  await page.evaluate(async () => {
    (window as any).__dockComposerE2E.native.endNatively();
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockFocusRequested' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(page.getByTestId('dock-surface')).toHaveAttribute('data-expanded', 'true');
  expect(
    (await ipc()).some(
      (r) => r.ch === 'window:update-dock-placement' && r.token === navigationOpen.openId,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () =>
        (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest
          ?.conversationGeneration,
    ),
  ).toBe(originalGeneration);
  receipts.retiredConversationLifetime = {
    samePairReopened: true,
    generationAdvanced: true,
    noLateAcknowledgement: true,
    conversationStillOpen: true,
  };

  // A closed editor must not leave a deferred collapse behind. Keep this pair and draft.
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockFocusRequested' }),
  );
  const cancelled = await startRecording();
  await page.evaluate(
    (clipId) => (window as any).__dockComposerE2E.native.endClip(clipId),
    cancelled.clipId,
  );
  const closedOpen = (await recordingOpened(cancelled.before)).find(
    (r) => r.ch === 'dock-capture-editor:open',
  )!;
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest?.openId,
      ),
    )
    .toBe(closedOpen.openId);
  await page.evaluate(
    (openId) =>
      (window as any).__dockComposerE2E.fixture.emit('dock-capture-editor:changed', {
        endedOpenId: openId,
      }),
    closedOpen.openId,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest,
      ),
    )
    .toBeNull();
  await page.evaluate(() => {
    (window as any).__dockComposerE2E.native.endNatively();
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockFocusRequested' });
  });
  await expect(page.getByTestId('dock-surface')).toHaveAttribute('data-expanded', 'true');
  expect(
    (await ipc()).some(
      (r) => r.ch === 'window:update-dock-placement' && r.token === closedOpen.openId,
    ),
  ).toBe(false);
  receipts.closedWhileBlocked = {
    pendingCancelled: true,
    noLateAcknowledgement: true,
    conversationStillOpen: true,
  };
  // Main can close the admitted editor before the OPEN response reaches its owner.
  const earlyCloseAt = (await ipc()).length;
  await page.evaluate(
    ({ workspaceId, agentId, clipId }) => {
      (window as any).__closeDuringOpen = true;
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/mediaEditorOpenRequested',
        payload: [workspaceId, agentId, clipId],
      });
    },
    { ...pair, clipId: cancelled.clipId },
  );
  const earlyClosed = (await recordingOpened(earlyCloseAt)).find(
    (r) => r.ch === 'dock-capture-editor:open',
  )!;
  expect(
    await page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest,
    ),
  ).toBeNull();
  expect(
    (await ipc()).some(
      (r) => r.ch === 'window:update-dock-placement' && r.token === earlyClosed.openId,
    ),
  ).toBe(false);
  receipts.closedBeforeOpenReply = { noResurrectedIntent: true };
  // Reopen explicitly only for a new Attach case; the cancelled editor is already gone.
  const reopenAt = (await ipc()).length;
  await page.evaluate(
    ({ workspaceId, agentId, clipId }) =>
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/mediaEditorOpenRequested',
        payload: [workspaceId, agentId, clipId],
      }),
    { ...pair, clipId: cancelled.clipId },
  );
  const reopened = (await recordingOpened(reopenAt)).find(
    (r) => r.ch === 'dock-capture-editor:open',
  )!;
  await compactFor(reopened);

  // 4. Attach: main asks the owner to validate while the dock is still held; only a valid,
  // current session's Attach is accepted, then the dock returns to that exact conversation
  // and its (empty) prompt takes the keyboard.
  const opens = (await ipc()).filter((r: any) => r.ch === 'dock-capture-editor:open') as any[];
  const latest = opens[opens.length - 1];
  const older = opens[0];
  const attached = (row: any, revision: number) =>
    page.evaluate(
      ({ pair, row, revision }) =>
        (window as any).__dockComposerE2E.fixture.emit('dock-capture-editor:attached', {
          openId: row.openId,
          workspaceId: pair.workspaceId,
          agentId: pair.agentId,
          attachmentId: row.attachmentId,
          sourceId: row.sourceId,
          sourceRevision: revision,
        }),
      { pair, row, revision },
    );
  const answers = async () =>
    (await ipc()).filter((r) => r.ch === 'dock-capture-editor:attach-return');
  await page.evaluate(() => (window as any).__dockComposerE2E.close());
  await expect.poll(open).toBeNull();
  // An older session (a newer editor opened since): refused, nothing moves.
  await attached(older, older.sourceRevision);
  await expect.poll(async () => (await answers()).length).toBe(1);
  expect((await answers())[0]).toMatchObject({ token: older.openId, kind: 'false' });
  // The current session with a different source revision (stale): refused.
  await attached(latest, latest.sourceRevision + 99);
  await expect.poll(async () => (await answers()).length).toBe(2);
  expect((await answers())[1]).toMatchObject({ token: latest.openId, kind: 'false' });
  expect(await open()).toBeNull();
  await page.evaluate(() => {
    const original = HTMLElement.prototype.focus;
    (window as any).__focusLog = [];
    HTMLElement.prototype.focus = function (options) {
      original.call(this, options);
      (window as any).__focusLog.push({
        tag: this.tagName,
        back: this.hasAttribute('data-dock-conversation-back'),
        composer: this.hasAttribute('data-dock-conversation-composer'),
        editable: this.getAttribute('contenteditable'),
        active: document.activeElement === this,
        stack: new Error().stack?.split('\n').slice(1, 5),
      });
    };
  });
  // The current session, current source: accepted, then the exact conversation and prompt.
  await attached(latest, latest.sourceRevision);
  await expect.poll(async () => (await answers()).length).toBe(3);
  expect((await answers())[2]).toMatchObject({ token: latest.openId, kind: 'true' });
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
    .toBe(true)
    .catch(async (error) => {
      const focus = await page.evaluate(() => ({
        log: (window as any).__focusLog,
        request: (window as any).__dockComposerE2E.store.state.hud.dockFocusRequest,
        compact: (window as any).__dockComposerE2E.store.state.hud.dockEditorCompactRequest,
        composer: [...document.querySelectorAll('[data-dock-conversation-composer]')].map((e) => ({
          tag: e.tagName,
          disabled: e.hasAttribute('disabled'),
          editable: e.getAttribute('contenteditable'),
        })),
      }));
      await writeFile(info.outputPath('focus-failure.json'), JSON.stringify(focus, null, 2));
      throw error;
    });
  await page.screenshot({ path: info.outputPath('17-editor-attach-returned.png') });
  receipts.attach = {
    olderSessionRefused: true,
    staleSourceRefused: true,
    validatedBeforeReturn: true,
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

for (const endedDuringUndo of [false, true]) {
  test(`discard hides recording controls before native replies; Undo and cleanup stay owned (${endedDuringUndo ? 'natural end' : 'delayed stop'})`, async ({
    mount,
    page,
  }, info) => {
    await mount(Harness, {
      props: { shell: dockRailPreview.states.notch.props, nativePlacementFixture: true },
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const h = (window as any).__dockComposerE2E;
          return !!h?.store.state.dockConversation.nativeCapabilities?.record;
        }),
      )
      .toBe(true);
    const state = () =>
      page.evaluate(() => {
        const h = (window as any).__dockComposerE2E;
        const d = h.store.state.dockConversation;
        const evidence = Object.values(d.evidence.map ?? {}).find(
          (e: any) => e.id === JSON.stringify([d.workspaceId, d.agentId]),
        ) as any;
        return {
          clips: evidence?.clips ?? [],
          marks: evidence?.marks ?? [],
          started: h.native.log.clips.started,
          stopped: h.native.log.clips.stopped,
          draft: h.draftSnapshot(),
        };
      });
    const toggle = () =>
      page.evaluate(() => {
        const h = (window as any).__dockComposerE2E;
        const d = h.store.state.dockConversation;
        h.store.dispatch({
          type: 'dockConversation/evidenceRecordToggleRequested',
          payload: [d.workspaceId, d.agentId],
        });
      });
    const action = (action: string) =>
      page.evaluate((action) => {
        const h = (window as any).__dockComposerE2E;
        h.native.emitEvidence({
          type: 'annotation-media',
          sessionId: h.native.sessionId,
          action,
          inputRevision: 1,
        });
      }, action);
    await page.evaluate(() => {
      const h = (window as any).__dockComposerE2E;
      const d = h.store.state.dockConversation;
      h.store.dispatch({
        type: 'dockConversation/draftChanged',
        payload: [d.workspaceId, d.agentId, 'Keep this unsent prompt'],
      });
    });
    await toggle();
    await expect.poll(async () => (await state()).started.length).toBe(1);
    await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(1);
    const clipId = (await state()).started[0];
    await page.evaluate(() => {
      const h = (window as any).__dockComposerE2E;
      h.native.gesture('box', { kind: 'rect', x: 100, y: 100, w: 200, h: 100 }, null);
      h.native.holdClipPauses(true);
    });
    await expect.poll(async () => (await state()).marks.length).toBe(1);
    const marks = (await state()).marks;
    await action('discard');
    await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
    await expect.poll(async () => (await state()).clips[0]?.discarding).toBe('undo');
    // Native pause is still held. The hidden clip remains the lease owner.
    await toggle();
    expect((await state()).started).toEqual([clipId]);
    expect((await state()).stopped).toEqual([]);
    await page.evaluate(() => (window as any).__dockComposerE2E.native.holdClipPauses(false));
    await expect.poll(async () => !!(await state()).clips[0]?.pausedAt).toBe(true);
    if (endedDuringUndo) {
      await page.evaluate((id) => (window as any).__dockComposerE2E.native.endClip(id), clipId);
      expect((await state()).clips[0].status).toBe('recording');
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
    }
    await action('discard-undo');
    await expect.poll(async () => (await state()).clips[0]?.discarding ?? null).toBeNull();
    expect((await state()).marks).toEqual(marks);
    if (endedDuringUndo) {
      await expect.poll(async () => (await state()).clips[0]?.status).toBe('ready');
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(1);
      await action('discard');
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
      await page.evaluate(() => (window as any).__dockComposerE2E.native.holdClipStops(true));
      await action('discard-confirm');
      await expect.poll(async () => (await state()).stopped.length).toBe(1);
      expect((await state()).clips[0]).toMatchObject({
        id: clipId,
        status: 'recording',
        discarding: 'stopping',
      });
      await toggle();
      expect((await state()).started).toEqual([clipId]);
      await page.evaluate(() => (window as any).__dockComposerE2E.native.holdClipStops(false));
      await expect.poll(async () => (await state()).clips.length).toBe(0);
      await toggle();
      await expect.poll(async () => (await state()).started.length).toBe(2);
      const successor = (await state()).started[1];
      await page.evaluate((clipId) => {
        (window as any).__dockComposerE2E.native.emitEvidence({
          type: 'clip-ended',
          clipId,
          result: { ok: false, error: 'failed', detail: 'cancelled' },
        });
      }, clipId);
      expect((await state()).clips.map((clip: any) => clip.id)).toEqual([successor]);
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(1);
      // Stop the synthetic successor without placing any output.
      await action('discard');
      await action('discard-confirm');
      await expect.poll(async () => (await state()).clips.length).toBe(0);
    }
    expect((await state()).draft.draft.text).toContain('Keep this unsent prompt');
    await writeFile(
      info.outputPath('cancel-ownership-receipt.json'),
      JSON.stringify(
        { endedDuringUndo, final: await state(), native: 'synthetic; no capture or OS inputs' },
        null,
        2,
      ),
    );
    await page.screenshot({ path: info.outputPath('cancelled-recording.png') });
  });
}

for (const recovery of ['failed pause', 'ended overlay'] as const) {
  test(`discard recovery keeps cleanup usable after ${recovery}`, async ({ mount, page }, info) => {
    await mount(Harness, {
      props: { shell: dockRailPreview.states.notch.props, nativePlacementFixture: true },
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!(window as any).__dockComposerE2E?.store.state.dockConversation.nativeCapabilities
              ?.record,
        ),
      )
      .toBe(true);
    const snapshot = () =>
      page.evaluate(() => {
        const h = (window as any).__dockComposerE2E;
        const d = h.store.state.dockConversation;
        const evidence = Object.values(d.evidence.map ?? {}).find(
          (e: any) => e.id === JSON.stringify([d.workspaceId, d.agentId]),
        ) as any;
        return {
          clips: evidence?.clips ?? [],
          stopped: h.native.log.clips.stopped,
          sessionId: h.native.sessionId,
        };
      });
    await page.evaluate(() => {
      const h = (window as any).__dockComposerE2E;
      const d = h.store.state.dockConversation;
      h.store.dispatch({
        type: 'dockConversation/evidenceRecordToggleRequested',
        payload: [d.workspaceId, d.agentId],
      });
    });
    await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(1);
    const id = (await snapshot()).clips[0].id;
    await page.evaluate((recovery) => {
      const h = (window as any).__dockComposerE2E;
      if (recovery === 'failed pause') h.native.failNextClipPause();
      h.native.emitEvidence({
        type: 'annotation-media',
        sessionId: h.native.sessionId,
        action: 'discard',
        inputRevision: 1,
      });
    }, recovery);
    await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
    if (recovery === 'failed pause') {
      await page.evaluate(() => {
        const h = (window as any).__dockComposerE2E;
        h.native.emitEvidence({
          type: 'annotation-media',
          sessionId: h.native.sessionId,
          action: 'discard-undo',
          inputRevision: 1,
        });
      });
      await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
      await page.evaluate(() => {
        const h = (window as any).__dockComposerE2E;
        h.native.emitEvidence({
          type: 'annotation-media',
          sessionId: h.native.sessionId,
          action: 'done',
        });
      });
      await expect.poll(async () => (await snapshot()).clips[0]?.status).toBe('ready');
    } else {
      await expect.poll(async () => !!(await snapshot()).clips[0]?.pausedAt).toBe(true);
      await page.evaluate(() => (window as any).__dockComposerE2E.native.endNatively());
      await expect.poll(async () => (await snapshot()).clips.length).toBe(0);
    }
    expect((await snapshot()).stopped).toEqual([id]);
    await expect(page.locator('[data-dock-recording-indicator]')).toHaveCount(0);
    await writeFile(
      info.outputPath('cancel-recovery-receipt.json'),
      JSON.stringify({ recovery, final: await snapshot(), native: 'synthetic' }, null, 2),
    );
  });
}
