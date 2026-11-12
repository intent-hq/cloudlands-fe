import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';

/**
 * A message whose images exceed the daemon's prompt image budget (8 MiB as base64) is
 * refused by the daemon before the model, after it was delivered ("Couldn't complete
 * this response"). Send must catch that locally: nothing is admitted and the draft stays.
 * Frames that fit go out as before. Production composer and send path; the daemon wire
 * and native helper (with its export, at measured real frame sizes) are synthetic.
 */
type H = {
  calls: { method: string; params: Record<string, unknown> }[];
  native: {
    gesture: (tool: string, geometry: unknown, element: unknown) => void;
    log: { exports: string[]; tools: { tool: string }[] };
  };
  store: {
    state: Record<string, any>;
    dispatch: (action: { type: string; payload: unknown[] }) => void;
  };
};

async function recordWithMark(page: Page, component: { getByRole: Function }) {
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
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.native.log.tools.some(
          (entry) => entry.tool === 'box',
        ),
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
  await (component.getByRole('button', { name: 'Stop recording' }) as any).click();
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

/** The recording gets a saved edit with `count` included marks: Send exports one frame each. */
async function editRecording(page: Page, count: number) {
  return page.evaluate((count) => {
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
      durationMs: 60000,
      width: 3456,
      height: 2234,
      audio: 'available',
      visuals: 'clean',
      batches: [{ id: 'batch-0', atMs: 0, clearAtMs: null }],
    };
    const marks = Array.from({ length: count }, (_, index) => ({
      id: `edit-mark-${index + 1}`,
      atMs: 1000 + index * 2500,
      batchId: 'batch-0',
      source: 'editor',
      kind: 'box',
      included: true,
      geometry: { kind: 'rect', x: 200 + index * 20, y: 200, w: 300, h: 160 },
      label: '',
      note: '',
      context: { selector: null, text: null, url: null },
    }));
    const saved = {
      version: 1,
      kind: 'recording',
      sourceId: source.id,
      sourceRevision: 0,
      revision: 1,
      trim: { startMs: 0, endMs: 60000 },
      cuts: [],
      blurRegions: [],
      blurStrokes: [],
      crop: null,
      video: 'full',
      voice: 'audio',
      wordEdits: {},
      marks,
    };
    harness.store.dispatch({
      type: 'dockConversation/evidenceMediaChanged',
      payload: [d.workspaceId, d.agentId, clip.id, null, { source, saved, transcript: null }],
    });
    const after = (Object.values(harness.store.state.dockConversation.evidence.map)[0] as any)
      .clips[0];
    return after.media?.saved?.marks?.length === count;
  }, count);
}

const sends = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.calls
      .filter((call) => call.method === 'agent.sendMessage' || call.method === 'agent.queueMessage')
      .map((call) => ({ images: ((call.params.imageBlocks ?? []) as unknown[]).length })),
  );

test('fitted recording frames whose exact bytes exceed the prompt image budget are refused locally; the draft stays', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component);
  // 19 fitted JPEG frames (<= 3 MiB each, so the daemon sends them unchanged) totalling
  // more than 8 MiB as base64: a known, exact overflow.
  await page.evaluate(
    () => ((globalThis as { __syntheticFrameBytes?: number }).__syntheticFrameBytes = 600_000),
  );
  expect(await editRecording(page, 19)).toBe(true);
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
            .dockConversation.sendError,
      ),
    )
    .toBe(true);
  expect(await sends(page)).toEqual([]);
  // The recording stays in the draft.
  await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(1);
  const state = await page.evaluate(() => {
    const harness = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    return {
      exports: harness.native.log.exports.length,
      sending: !!harness.store.state.dockConversation.sending,
    };
  });
  expect(state.sending).toBe(false);
  await writeFile(
    info.outputPath('image-budget-refused-receipt.json'),
    JSON.stringify(
      { frames: 19, frameBytes: 600_000, mime: 'image/jpeg', sends: 0, ...state },
      null,
      2,
    ),
  );
});

test('19 frames that fit the prompt image budget still send, all of them', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component);
  // A budget-fitted frame (JPEG, bounded edge) is a few hundred KB.
  await page.evaluate(
    () => ((globalThis as { __syntheticFrameBytes?: number }).__syntheticFrameBytes = 230_000),
  );
  expect(await editRecording(page, 19)).toBe(true);
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  const [sent] = await sends(page);
  expect(sent.images).toBe(19);
  await writeFile(
    info.outputPath('image-budget-fits-receipt.json'),
    JSON.stringify({ frames: 19, frameBytes: 230_000, sent }, null, 2),
  );
});

test('a single large pasted image the daemon will prepare smaller is not refused', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  const editor = component.locator('.tiptap-editor');
  await editor.click();
  await page.keyboard.type('One big screenshot');
  // A placed 6 MB PNG: the daemon re-encodes it under its per-image cap, so it fits.
  await page.evaluate(() => {
    const { store } = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'transientUi/setComposerContextItems',
      payload: [
        workspaceId,
        agentId,
        [
          {
            id: 'paste-big',
            type: 'file',
            label: 'big.png',
            imageMimeType: 'image/png',
            attachmentId: '6b1d0000-0000-4000-8000-000000000001',
            attachmentSize: 6_000_000,
            placementStatus: 'placed',
          },
        ],
      ],
    });
  });
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  const [sent] = await sends(page);
  expect(sent.images).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
          .dockConversation.sendError ?? null,
    ),
  ).toBeNull();
  await writeFile(
    info.outputPath('image-budget-single-large-receipt.json'),
    JSON.stringify({ pastedBytes: 6_000_000, sent }, null, 2),
  );
});

test('three referenced images of unknown size are not refused locally', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  const editor = component.locator('.tiptap-editor');
  await editor.click();
  await page.keyboard.type('Three restored screenshots');
  // Restored references keep no size: the daemon prepares them, so only it can tell.
  await page.evaluate(() => {
    const { store } = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'transientUi/setComposerContextItems',
      payload: [
        workspaceId,
        agentId,
        [1, 2, 3].map((n) => ({
          id: `restored-${n}`,
          type: 'file',
          label: `restored-${n}.png`,
          imageMimeType: 'image/png',
          attachmentId: `6b1d0000-0000-4000-8000-00000000000${n}`,
          placementStatus: 'placed',
        })),
      ],
    });
  });
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  const [sent] = await sends(page);
  expect(sent.images).toBe(3);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
          .dockConversation.sendError ?? null,
    ),
  ).toBeNull();
  await writeFile(
    info.outputPath('image-budget-unknown-refs-receipt.json'),
    JSON.stringify({ refs: 3, sizes: 'unknown', sent }, null, 2),
  );
});

test('frames without an exact-size certificate are unknown and not refused locally', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordWithMark(page, component);
  // Same bytes as the refused case, but the export did not certify them (older or unfitted).
  await page.evaluate(() => {
    (globalThis as { __syntheticFrameBytes?: number }).__syntheticFrameBytes = 600_000;
    (globalThis as { __syntheticFrameUncertified?: boolean }).__syntheticFrameUncertified = true;
  });
  expect(await editRecording(page, 19)).toBe(true);
  await (component.getByRole('button', { name: /^Send/ }) as any).click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  const [sent] = await sends(page);
  expect(sent.images).toBe(19);
  await writeFile(
    info.outputPath('image-budget-uncertified-receipt.json'),
    JSON.stringify({ frames: 19, frameBytes: 600_000, certified: false, sent }, null, 2),
  );
});
