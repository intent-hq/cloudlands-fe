import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';

/**
 * A legacy recording (marks already in its frames) sent unchanged as Full video with
 * its audio goes out as its own placed attachment, through the production composer,
 * send saga and admission. Only the daemon wire and the native helper are synthetic;
 * nothing is delivered. A clip whose raw attachment does not match fails closed.
 */
type H = {
  calls: { method: string; params: Record<string, unknown> }[];
  native: { log: Record<string, unknown> };
  store: {
    state: Record<string, any>;
    dispatch: (action: { type: string; payload: unknown[] }) => void;
  };
};

async function recordClip(page: Page, component: { getByRole: Function }) {
  await (component.getByRole('button', { name: /^Record the screen/ }) as any).click();
  await expect(component.getByRole('button', { name: 'Stop recording' }) as any).toBeVisible();
  await (component.getByRole('button', { name: 'Stop recording' }) as any).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
        const d = h.store.state.dockConversation;
        const e = Object.values(d.evidence.map ?? {})[0] as any;
        return e?.clips?.[0]?.status ?? null;
      }),
    )
    .toBe('ready');
}

/** Make the recorded clip a legacy baked-marks source, Full + Audio, unchanged. */
async function makeLegacy(page: Page, mismatch: boolean) {
  return page.evaluate((mismatch) => {
    const h = (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E;
    const d = h.store.state.dockConversation;
    const e = Object.values(d.evidence.map ?? {})[0] as any;
    const clip = e.clips[0];
    const find = (node: any, depth = 0): any => {
      if (!node || typeof node !== 'object' || depth > 8) return undefined;
      if (node.id === clip.contextItemId && 'attachmentId' in node) return node;
      for (const v of Object.values(node)) {
        const hit = find(v, depth + 1);
        if (hit) return hit;
      }
      return undefined;
    };
    const item = find(h.store.state.transientUi ?? h.store.state);
    const source = {
      id: `${clip.id}:legacy`,
      revision: 0,
      kind: 'recording',
      attachmentId: mismatch ? 'another-attachment' : item.attachmentId,
      path: item.path,
      durationMs: 23000,
      width: 1728,
      height: 1117,
      audio: 'available',
      visuals: 'baked-marks',
      batches: [{ id: 'batch-0', atMs: 0, clearAtMs: null }],
      bakedMarks: [],
    };
    const saved = {
      version: 1,
      kind: 'recording',
      sourceId: source.id,
      sourceRevision: 0,
      revision: 1,
      trim: { startMs: 0, endMs: 23000 },
      cuts: [],
      marks: [],
      blurRegions: [],
      blurStrokes: [],
      crop: null,
      video: 'full',
      voice: 'audio',
      wordEdits: {},
    };
    h.store.dispatch({
      type: 'dockConversation/evidenceMediaChanged',
      payload: [d.workspaceId, d.agentId, clip.id, null, { source, saved, transcript: null }],
    });
    const after = (Object.values(h.store.state.dockConversation.evidence.map)[0] as any).clips[0];
    return {
      attachmentId: item.attachmentId,
      applied: after.media?.source?.visuals === 'baked-marks',
    };
  }, mismatch);
}

const sends = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.calls.filter(
      (c) => c.method === 'agent.sendMessage' || c.method === 'agent.queueMessage',
    ),
  );

test('an unchanged legacy recording is sent as its own original attachment', async ({
  mount,
  page,
}, info) => {
  const component = await mount(ComposerE2EHarness);
  await recordClip(page, component);
  const legacy = await makeLegacy(page, false);
  expect(legacy.applied).toBe(true);
  await component.getByRole('button', { name: /^Send/ }).click();
  await expect.poll(async () => (await sends(page)).length).toBe(1);
  const [send] = await sends(page);
  // The clip's own placed attachment rides as a canonical FILE block (not only metadata).
  const fileBlocks = (send.params.fileBlocks ?? []) as { type?: string; attachmentId?: string }[];
  const fileBlock = fileBlocks.find((block) => block.attachmentId === legacy.attachmentId);
  expect(fileBlock).toBeTruthy();
  expect(fileBlock!.type ?? 'file').toBe('file');
  const exported = await page.evaluate(() =>
    JSON.stringify((window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.native.log),
  );
  expect(exported).not.toContain('exportMedia');
  await writeFile(
    info.outputPath('legacy-original-receipt.json'),
    JSON.stringify(
      {
        fileBlock: { type: fileBlock!.type ?? 'file', attachmentIdMatches: true },
        fileBlocks: fileBlocks.length,
        sends: 1,
        exportCalled: exported.includes('exportMedia'),
      },
      null,
      2,
    ),
  );
});

test('a legacy recording whose raw attachment does not match is not sent and the draft stays', async ({
  mount,
  page,
}, info) => {
  const logged: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Dock reply send failed')) logged.push(message.text());
  });
  const component = await mount(ComposerE2EHarness);
  await recordClip(page, component);
  const legacy = await makeLegacy(page, true);
  expect(legacy.applied).toBe(true);
  await component.getByRole('button', { name: /^Send/ }).click();
  // Settled on the observed failure (logged stage/code and the send error), not a timer.
  await expect.poll(() => logged.join('\n')).toContain('legacy-original-unavailable');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state
            .dockConversation.sendError,
      ),
    )
    .toBe(true);
  expect(await sends(page)).toHaveLength(0);
  await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(1);
  const sendError = await page.evaluate(
    () =>
      (window as unknown as { __dockComposerE2E: H }).__dockComposerE2E.store.state.dockConversation
        .sendError,
  );
  expect(sendError).toBeTruthy();
  await writeFile(
    info.outputPath('legacy-mismatch-receipt.json'),
    JSON.stringify({ sends: 0, tileKept: true, sendErrorShown: !!sendError, logged }, null, 2),
  );
});
