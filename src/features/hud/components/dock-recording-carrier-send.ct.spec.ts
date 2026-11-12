import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

/**
 * The screenshot a recording's markup was drawn on only anchors that markup; the
 * composer does not show it. When the recording carries those marks itself, Send
 * must not bring it back. Production composer, controller, sagas and send path;
 * only the daemon wire and the native helper (including its export) are synthetic.
 */
type H = {
  calls: { method: string; params: Record<string, unknown> }[];
  native: {
    gesture: (tool: string, geometry: unknown, element: unknown) => void;
    log: { exports: string[] };
  };
  store: {
    state: Record<string, any>;
    dispatch: (action: { type: string; payload: unknown[] }) => void;
  };
};

async function recordWithMark(page: Page, component: { getByRole: Function }, nativeEnd = false) {
  await (component.getByRole('button', { name: /^Record the screen/ }) as any).click();
  await expect(component.getByRole('button', { name: 'Stop recording' }) as any).toBeVisible();
  await page.evaluate(() => {
    const { store } = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'dockConversation/evidenceToolSelectRequested',
      payload: [workspaceId, agentId, 'box'],
    });
  });
  // The live session took the box tool (native heard it), so the next gesture draws a mark.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __dockComposerE2E: { native: { log: { tools: { tool: string }[] } } };
          }
        ).__dockComposerE2E.native.log.tools.some((entry) => entry.tool === 'box'),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.native.gesture(
      'box',
      { kind: 'rect', x: 200, y: 200, w: 300, h: 160 },
      null,
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
            .dockConversation.evidence.map
            ? (
                Object.values(
                  (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
                    .dockConversation.evidence.map,
                )[0] as any
              )?.marks?.length
            : 0) ?? 0,
      ),
    )
    .toBe(1);
  if (nativeEnd) {
    // The full shell collapses during recording; use the existing native-ended seam.
    await page.evaluate(() => {
      const h = (window as any).__dockComposerE2E;
      const evidence = Object.values(h.store.state.dockConversation.evidence.map)[0] as any;
      return h.native.endClip(evidence.clips[0].id);
    });
  } else {
    await (component.getByRole('button', { name: 'Stop recording' }) as any).click();
  }
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
          .dockConversation;
        return (Object.values(d.evidence.map)[0] as any)?.clips?.[0]?.status ?? null;
      }),
    )
    .toBe('ready');
}

/** The recording gets a saved edit (one included mark): Send exports it. */
async function editRecording(page: Page) {
  return page.evaluate(() => {
    const harness = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const d = harness.store.state.dockConversation;
    const clip = (Object.values(d.evidence.map)[0] as any).clips[0];
    const find = (node: any, depth = 0): any => {
      if (!node || typeof node !== 'object' || depth > 8) return undefined;
      if (node.id === clip.contextItemId && 'attachmentId' in node) return node;
      for (const value of Object.values(node)) {
        const hit = find(value, depth + 1);
        if (hit) return hit;
      }
      return undefined;
    };
    const item = find(harness.store.state.transientUi ?? harness.store.state);
    const source = {
      id: `${clip.id}:edit`,
      revision: 0,
      kind: 'recording',
      attachmentId: item.attachmentId,
      path: item.path,
      durationMs: 4000,
      width: 1440,
      height: 900,
      audio: 'available',
      visuals: 'clean',
      batches: [{ id: 'batch-0', atMs: 0, clearAtMs: null }],
    };
    const saved = {
      version: 1,
      kind: 'recording',
      sourceId: source.id,
      sourceRevision: 0,
      revision: 1,
      trim: { startMs: 0, endMs: 4000 },
      cuts: [],
      blurRegions: [],
      blurStrokes: [],
      crop: null,
      video: 'full',
      voice: 'audio',
      wordEdits: {},
      marks: [
        {
          id: 'edit-mark-1',
          atMs: 1000,
          batchId: 'batch-0',
          source: 'editor',
          kind: 'box',
          included: true,
          geometry: { kind: 'rect', x: 200, y: 200, w: 300, h: 160 },
          label: '',
          note: '',
          context: { selector: null, text: null, url: null },
        },
      ],
    };
    harness.store.dispatch({
      type: 'dockConversation/evidenceMediaChanged',
      payload: [d.workspaceId, d.agentId, clip.id, null, { source, saved, transcript: null }],
    });
    const after = (Object.values(harness.store.state.dockConversation.evidence.map)[0] as any)
      .clips[0];
    return after.media?.source?.visuals === 'clean';
  });
}

async function evidenceImages(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
      .dockConversation;
    const evidence = Object.values(d.evidence.map)[0] as any;
    const archived = new Set(
      evidence.clips.flatMap((clip: any) =>
        (clip.captureHistory ?? []).map((entry: any) => entry.image.id),
      ),
    );
    return evidence.images.map((image: any) => ({
      id: image.id,
      source: image.source,
      carrier: archived.has(image.id),
    }));
  });
}

async function sendAndRead(page: Page, component: { getByRole: Function }) {
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.calls.filter(
            (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
          ).length,
      ),
    )
    .toBe(1);
  return page.evaluate(() => {
    const harness = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const send = harness.calls.find(
      (call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage',
    )!;
    const meta = (send.params.messageMetadata ?? {}) as any;
    return {
      imageBlocks: ((send.params.imageBlocks ?? []) as any[]).map(
        (block) => block.attachmentId ?? (block.data ? 'inline' : null),
      ),
      fileBlocks: ((send.params.fileBlocks ?? []) as any[]).length,
      fileBlockIds: ((send.params.fileBlocks ?? []) as any[]).map((block) => block.attachmentId),
      metadataAttachmentIds: (meta.images ?? []).map((image: any) => image.attachment_id),
      editedOutputs: (meta.edited_captures ?? []).map((entry: any) => ({
        video: entry.video_attachment_id,
        frames: (entry.frames ?? []).map((frame: any) => frame.attachment_id),
      })),
      screenshotUploads: harness.calls
        .map((call) => call.params?.fileName)
        .filter(
          (name): name is string => typeof name === 'string' && name.startsWith('screenshot-'),
        ),
      metadataImageIds: (meta.images ?? []).map((image: any) => image.id),
      metadataMarks: (meta.images ?? []).flatMap((image: any) =>
        image.marks.map((mark: any) => mark.n),
      ),
      editedCaptures: (meta.edited_captures ?? []).map((entry: any) => ({
        kind: entry.kind,
        frames: entry.frames?.length ?? 0,
      })),
      // The agent-readable evidence leads the message body.
      context: String(send.params.content ?? send.params.message ?? send.params.text ?? ''),
      exports: harness.native.log.exports.length,
      jobEvents: (harness.native.log as any).jobEvents,
    };
  });
}

test('an exported recording does not resend its markup screenshot; an explicit capture still goes', async ({
  mount,
  page,
}, info) => {
  const timings: Record<string, any>[] = [];
  page.on('console', async (message) => {
    // Read the actual formatted first argument; ConsoleMessage.text also appends the object argument.
    const text = await message.args()[0]?.jsonValue();
    if (typeof text !== 'string') return;
    if (text.includes('[DockSendTiming]') && text.includes('Dock send timing')) {
      const start = text.indexOf('{');
      if (start >= 0) timings.push(JSON.parse(text.slice(start)));
    }
  });
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component);
  await (component.getByRole('button', { name: /^Capture the screen/ }) as any).click();
  await expect.poll(async () => (await evidenceImages(page)).length).toBe(2);
  const images = await evidenceImages(page);
  const carrier = images.find((image: any) => image.carrier)!;
  const explicit = images.find((image: any) => !image.carrier)!;
  expect(carrier).toMatchObject({ source: 'annotate' });
  expect(explicit).toMatchObject({ source: 'capture' });
  expect(await editRecording(page)).toBe(true);
  const sent = await sendAndRead(page, component);
  expect(sent.exports).toBe(1);
  // One explicit screenshot composite, then the exported frame; the video rides as a file.
  expect(sent.metadataImageIds).toEqual([explicit.id]);
  expect(sent.imageBlocks).toHaveLength(2);
  expect(sent.fileBlocks).toBe(1);
  expect(sent.editedCaptures).toEqual([{ kind: 'recording', frames: 1 }]);
  expect(sent.context).toContain('[Screen evidence');
  expect(sent.context).not.toContain(carrier.id);
  // Exact wire references: the explicit composite, then the exported frame; the video as a file.
  expect(sent.imageBlocks).toEqual([
    sent.metadataAttachmentIds[0],
    sent.editedOutputs[0].frames[0],
  ]);
  expect(sent.fileBlockIds).toEqual([sent.editedOutputs[0].video]);
  // The markup screenshot is never even uploaded.
  expect(
    sent.screenshotUploads.some((name: string) =>
      name.startsWith(`screenshot-${explicit.id.slice(0, 8)}`),
    ),
  ).toBe(true);
  expect(
    sent.screenshotUploads.some((name: string) =>
      name.startsWith(`screenshot-${carrier.id.slice(0, 8)}`),
    ),
  ).toBe(false);
  await expect.poll(() => timings.some((row) => row.stage === 'local-admission')).toBe(true);
  // This wire deliberately holds its reply. Admission must not masquerade as an ACK.
  expect(timings.some((row) => row.stage === 'daemon-result')).toBe(false);
  await page.evaluate(() => (window as any).__dockComposerE2E.fixture.settle());
  await expect.poll(() => timings.some((row) => row.stage === 'daemon-result')).toBe(true);
  expect(timings.map((row) => row.stage)).toEqual([
    'export-start',
    'local-admission',
    'daemon-result',
  ]);
  expect(new Set(timings.map((row) => row.attemptToken)).size).toBe(1);
  const admission = timings[1],
    result = timings[2];
  expect(result.outcome).toBe('accepted');
  expect(result.clickToResultMs).toBeGreaterThanOrEqual(admission.clickToAdmissionMs);
  for (const stage of ['barrier', 'target', 'overlay-render', 'export', 'placement', 'release'])
    expect(admission.durationsMs[stage]).toBeGreaterThanOrEqual(0);
  const allowed = new Set([
    'attemptToken',
    'exportToken',
    'stage',
    'outcome',
    'durationsMs',
    'clickToAdmissionMs',
    'clickToResultMs',
    'admissionToResultMs',
  ]);
  for (const row of timings) {
    expect(Object.keys(row).every((key) => allowed.has(key))).toBe(true);
    expect(row.attemptToken).toMatch(/^[0-9a-f-]{36}$/);
    for (const value of [
      ...Object.values(row.durationsMs ?? {}),
      ...Object.entries(row)
        .filter(([key]) => key.endsWith('Ms') && key !== 'durationsMs')
        .map(([, value]) => value),
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
  await writeFile(info.outputPath('send-timing-receipt.json'), JSON.stringify(timings, null, 2));
  await writeFile(
    info.outputPath('carrier-exported-receipt.json'),
    JSON.stringify({ images, sent: { ...sent, context: undefined } }, null, 2),
  );
});

test('a recording without an export keeps its markup screenshot, the only picture of those marks', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component);
  const images = await evidenceImages(page);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({ source: 'annotate', carrier: true });
  const sent = await sendAndRead(page, component);
  expect(sent.exports).toBe(0);
  expect(sent.metadataImageIds).toEqual([images[0].id]);
  expect(sent.imageBlocks).toEqual([sent.metadataAttachmentIds[0]]);
  expect(
    sent.screenshotUploads.some((name: string) =>
      name.startsWith(`screenshot-${images[0].id.slice(0, 8)}`),
    ),
  ).toBe(true);
  await writeFile(
    info.outputPath('carrier-fallback-receipt.json'),
    JSON.stringify({ images, sent: { ...sent, context: undefined } }, null, 2),
  );
});

test('mark numbers on the wire stay the composer numbers when an exported recording drops its marks', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component); // mark 1, carried by the recording
  await (component.getByRole('button', { name: /^Capture the screen/ }) as any).click();
  await expect.poll(async () => (await evidenceImages(page)).length).toBe(2);
  await page.evaluate(() => {
    const { store } = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'dockConversation/evidenceToolSelectRequested',
      payload: [workspaceId, agentId, 'box'],
    });
  });
  await expect(component.getByText('Annotating', { exact: true }) as any).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.native.gesture(
      'box',
      { kind: 'rect', x: 600, y: 300, w: 200, h: 120 },
      null,
    ),
  );
  const composer = await page.evaluate(() => {
    const d = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
      .dockConversation;
    const evidence = Object.values(d.evidence.map)[0] as any;
    return evidence.marks.map((mark: any, index: number) => ({
      n: index + 1,
      id: mark.id,
      clip: !!mark.clipId,
    }));
  });
  await expect.poll(async () => composer.length).toBe(2);
  expect(composer.map((row: any) => row.clip)).toEqual([true, false]);
  expect(await editRecording(page)).toBe(true);
  const sent = await sendAndRead(page, component);
  // The standalone mark is 2 in the composer, in its burned pixels and on the wire.
  expect(sent.metadataMarks).toEqual([2]);
  // The agent-readable screen evidence (not the export's own outputs) says 2 as well.
  const block = /\[Screen evidence[^\n]*\n```json\n(.*?)\n```/s.exec(sent.context);
  expect(block).not.toBeNull();
  const screen = JSON.parse(block![1]) as { images: { marks: { n: number }[] }[] };
  expect(screen.images.flatMap((image) => image.marks.map((mark) => mark.n))).toEqual([2]);
  await writeFile(
    info.outputPath('carrier-numbering-receipt.json'),
    JSON.stringify({ composer, sent: { ...sent, context: undefined } }, null, 2),
  );
});

test('dock prepares one owner-local recording before Send without early placement', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness, { props: { warmMedia: true } });
  await recordWithMark(page, component);
  expect(await editRecording(page)).toBe(true);
  await page.evaluate(() => (window as any).__dockComposerE2E.native.endNatively());
  const editor = component.locator('[contenteditable="true"]').first();
  await editor.fill('Review the prepared recording');
  const read = () =>
    page.evaluate(() => {
      const h = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
      return {
        exports: h.native.log.exports.length,
        calls: h.calls.map((c) => ({ method: c.method, params: c.params })),
      };
    });
  await expect.poll(async () => (await read()).exports).toBe(1);
  const before = await read();
  expect(
    before.calls.filter(
      (c) => c.method === 'agent.sendMessage' || c.method === 'agent.queueMessage',
    ),
  ).toEqual([]);
  expect(
    before.calls.filter(
      (c) =>
        c.method === 'file.placeAttachment' &&
        String(c.params.sourcePath ?? '').startsWith('/synthetic/exports/'),
    ),
  ).toEqual([]);
  const sent = await sendAndRead(page, component);
  await info.attach('warm-send-attempt', {
    body: JSON.stringify(sent),
    contentType: 'application/json',
  });
  expect(sent.exports).toBe(1);
  expect(sent.fileBlocks).toBe(1);
  expect(sent.editedCaptures).toEqual([{ kind: 'recording', frames: 1 }]);
  await info.attach('dock-warm-preparation-receipt', {
    body: JSON.stringify({ before, sent: { ...sent, context: undefined } }, null, 2),
    contentType: 'application/json',
  });
});

test('owned recording editor review prepares the committed default before Attach and typing', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness, {
    props: { warmMedia: true, shell: dockRailPreview.states.notch.props },
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({ type: 'hud/dockActivated' }),
  );
  await recordWithMark(page, component, true);
  expect(await editRecording(page)).toBe(true);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E,
      d = h.store.state.dockConversation;
    const clip = (Object.values(d.evidence.map)[0] as any).clips[0];
    const media = {
      ...clip.media,
      source: { ...clip.media.source, audio: 'none', capturedMarks: clip.media.saved.marks },
      saved: null,
    };
    const review = document.createElement('button');
    review.textContent = 'Synthetic native editor';
    document.body.append(review);
    review.focus();
    h.store.dispatch({
      type: 'dockConversation/evidenceMediaChanged',
      payload: [d.workspaceId, d.agentId, clip.id, null, media],
    });
    h.native.endNatively();
    localStorage.setItem('intent.dock.captureEditorPreview', '1');
    const api = (window as any).electronAPI,
      prior = api.invoke.bind(api);
    (window as any).__warmReview = {};
    api.invoke = async (ch: string, payload: any) => {
      if (ch === 'dock-capture-editor:open') {
        const openId = crypto.randomUUID();
        (window as any).__warmReview = { openId, request: payload };
        return { ok: true, openId };
      }
      if (ch === 'dock-capture-editor:attach-return') {
        (window as any).__warmReview.accepted = payload.accept;
        h.fixture.emit('dock-capture-editor:changed', { endedOpenId: payload.openId });
        return payload.accept === true;
      }
      return prior(ch, payload);
    };
    h.store.dispatch({
      type: 'dockConversation/mediaEditorOpenRequested',
      payload: [d.workspaceId, d.agentId, clip.id],
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__dockComposerE2E.native.log.exports.length))
    .toBe(1);
  const before = await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    return {
      opened: !!(window as any).__warmReview.openId,
      focusedInComposer: !!document.activeElement?.closest('[data-dock-conversation]'),
      calls: h.calls,
    };
  });
  expect(before.opened).toBe(true);
  expect(before.focusedInComposer).toBe(false);
  expect(
    before.calls.filter(
      (c: any) =>
        c.method === 'agent.sendMessage' ||
        c.method === 'agent.queueMessage' ||
        (c.method === 'file.placeAttachment' &&
          String(c.params.sourcePath ?? '').startsWith('/synthetic/exports/')),
    ),
  ).toEqual([]);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E,
      { openId, request } = (window as any).__warmReview;
    h.fixture.emit('dock-capture-editor:attached', {
      openId,
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      attachmentId: request.attachmentId,
      sourceId: request.source.id,
      sourceRevision: request.source.revision,
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__warmReview.accepted)).toBe(true);
  const editor = component.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();
  await editor.fill('Current text after recording review');
  const sent = await sendAndRead(page, component);
  await info.attach('warm-send-attempt', {
    body: JSON.stringify(sent),
    contentType: 'application/json',
  });
  expect(sent.exports).toBe(1);
  expect(sent.fileBlocks).toBe(1);
  expect(sent.context).toContain('Current text after recording review');
  expect(sent.editedCaptures).toEqual([{ kind: 'recording', frames: 1 }]);
  await info.attach('owned-editor-preparation-receipt', {
    body: JSON.stringify({ before, sent: { ...sent, context: undefined } }, null, 2),
    contentType: 'application/json',
  });
});
