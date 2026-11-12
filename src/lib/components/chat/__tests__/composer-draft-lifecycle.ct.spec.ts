import SharedDraftEditorsHarness from './SharedDraftEditorsHarness.svelte';
import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import type { ComposerDraftRequest } from './mocks/composer-draft-transport';

const scope = { workspaceId: 'chat-panel-composer-geometry', agentId: 'regular-composer-agent' };

/**
 * Replace the restored draft through the editor's own select-all. The composer
 * refocuses itself when the restore gate releases, and ProseMirror re-syncs the
 * DOM selection shortly after a focus; a raw DOM range (what `fill()` uses) made
 * inside that window can collapse before the text lands (intent-hq/intent#7479).
 */
async function replaceComposerText(editor: Locator, text: string) {
  await editor.press('ControlOrMeta+a');
  await editor.page().keyboard.insertText(text);
}

test('locks the composer until draft restoration settles, then persists edits', async ({
  mount,
}) => {
  const requests: ComposerDraftRequest[] = [];
  const props = {
    restoredDraft: 'Saved before reopening',
    holdDraftRestore: true,
    onDraftRequest: (request: ComposerDraftRequest) => requests.push(request),
  };
  const component = await mount(ChatPanelComposerGeometryHost, { props });
  const editor = component.getByTestId('message-input').locator('.tiptap-editor');
  await expect.poll(() => requests).toEqual([{ method: 'drafts.get', params: scope }]);
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  expect(await editor.evaluate((node) => (node as HTMLElement).isContentEditable)).toBe(false);
  await expect(editor).toHaveText('');
  await component.update({ props: { ...props, holdDraftRestore: false } });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toHaveText('Saved before reopening');
  await replaceComposerText(editor, 'Edited after restoration');
  await expect
    .poll(() => requests)
    .toContainEqual({
      method: 'drafts.set',
      params: { ...scope, text: 'Edited after restoration' },
    });
});

test('cancels a pending restoration when the fixture unmounts', async ({ mount }) => {
  const oldRequests: ComposerDraftRequest[] = [];
  const first = await mount(ChatPanelComposerGeometryHost, {
    props: {
      restoredDraft: 'Stale draft from the disposed fixture',
      holdDraftRestore: true,
      onDraftRequest: (request: ComposerDraftRequest) => oldRequests.push(request),
    },
  });
  await expect.poll(() => oldRequests).toEqual([{ method: 'drafts.get', params: scope }]);
  await first.unmount();
  const requests: ComposerDraftRequest[] = [];
  const second = await mount(ChatPanelComposerGeometryHost, {
    props: {
      restoredDraft: 'Draft from the new fixture',
      onDraftRequest: (request: ComposerDraftRequest) => requests.push(request),
    },
  });
  const editor = second.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toHaveText('Draft from the new fixture');
  await replaceComposerText(editor, 'Only the new fixture saves');
  await expect
    .poll(() => requests)
    .toContainEqual({
      method: 'drafts.set',
      params: { ...scope, text: 'Only the new fixture saves' },
    });
  expect(oldRequests).toEqual([{ method: 'drafts.get', params: scope }]);
});

test('preserves a new fixture draft after a completed restore in the previous mount', async ({
  mount,
}) => {
  const first = await mount(ChatPanelComposerGeometryHost, {
    props: { restoredDraft: 'Saved first fixture draft' },
  });
  await expect(first.getByTestId('message-input').locator('.tiptap-editor')).toHaveText(
    'Saved first fixture draft',
  );
  await first.unmount();
  const requests: ComposerDraftRequest[] = [];
  const second = await mount(ChatPanelComposerGeometryHost, {
    props: {
      draft: 'Distinct second fixture draft',
      onDraftRequest: (request: ComposerDraftRequest) => requests.push(request),
    },
  });
  const editor = second.getByTestId('message-input').locator('.tiptap-editor');
  await expect.poll(() => requests).toContainEqual({ method: 'drafts.get', params: scope });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toHaveText('Distinct second fixture draft');
});

test('shares the live app and notch draft through pending-write handoff and close/reopen', async ({
  mount,
  page,
}) => {
  const component = await mount(SharedDraftEditorsHarness);
  const main = component.getByTestId('shared-main').locator('.tiptap-editor');
  const dock = component.getByTestId('shared-dock').locator('.tiptap-editor');
  await expect(main).toHaveAttribute('contenteditable', 'true');
  await expect(dock).toHaveAttribute('contenteditable', 'true');
  await page.evaluate(() => window.__sharedDraftFixture?.holdPersistence());
  await main.fill('Written in the app');
  await expect(dock).toHaveText('Written in the app');
  await replaceComposerText(dock, 'Continued in the notch');
  await component.locator('[data-dock-open-full]').click();
  await expect(page.getByTestId('shared-editors')).toHaveAttribute('data-handoff', 'true');
  expect(await page.evaluate(() => window.__sharedDraftFixture?.beforeHandoff())).toBe('');
  await expect(main).toHaveText('Continued in the notch');
  await expect
    .poll(() => page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.text))
    .toBe('Continued in the notch');
  await component.getByRole('button', { name: 'Close notch draft', exact: true }).click();
  await replaceComposerText(main, 'New app text while notch closed');
  await component.getByRole('button', { name: 'Open notch draft', exact: true }).click();
  await expect(dock).toHaveText('New app text while notch closed');
  await component.getByRole('button', { name: 'Clear main draft', exact: true }).click();
  await expect(dock).toHaveText('');
  await main.fill('New typing after clear');
  await expect(dock).toHaveText('New typing after clear');
  await expect
    .poll(() => page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.text))
    .toBe('New typing after clear');
  await page.screenshot({ path: test.info().outputPath('shared-draft-two-editors.png') });
});

test('preserves screenshot evidence and staged files through app saves, pruning removed sources', async ({
  mount,
  page,
}) => {
  const component = await mount(SharedDraftEditorsHarness);
  const main = component.getByTestId('shared-main').locator('.tiptap-editor');
  await expect(main).toHaveAttribute('contenteditable', 'true');
  await component.getByRole('button', { name: 'Seed screenshot draft', exact: true }).click();
  await expect(main).toContainText('Review [[mark:1]]');
  await main.press('ControlOrMeta+End');
  await page.keyboard.insertText(' with more detail');
  await component.getByRole('button', { name: 'Stage main file', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.attachments),
    )
    .toEqual([
      expect.objectContaining({
        id: 'shared-image',
        screen: expect.objectContaining({
          kind: 'image',
          marks: [expect.objectContaining({ mark: expect.objectContaining({ id: 'mark-one' }) })],
        }),
      }),
      expect.objectContaining({
        id: 'staged-file',
        sourcePath: '/synthetic/pending.txt',
        placementStatus: 'failed',
      }),
    ]);
  const items = JSON.parse(
    (await component.getByTestId('shared-main').getAttribute('data-items')) ?? '[]',
  );
  expect(items.every((item: Record<string, unknown>) => !('screen' in item))).toBe(true);
  await component.getByRole('button', { name: 'Replace screenshot source', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.attachments?.[0]),
    )
    .toEqual(expect.objectContaining({ attachmentId: 'replacement-id' }));
  const replaced = await page.evaluate(
    async () => (await window.__sharedDraftFixture?.saved())?.attachments?.[0],
  );
  expect(replaced).not.toHaveProperty('screen');
  await component.getByRole('button', { name: 'Remove main attachments', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.attachments ?? []),
    )
    .toEqual([]);
  await page.screenshot({ path: test.info().outputPath('shared-draft-metadata.png') });
});

test('rejects retired admission and stale clears while accepted edits survive their owner', async ({
  mount,
  page,
}) => {
  await mount(SharedDraftEditorsHarness);
  await expect.poll(() => page.evaluate(() => !!window.__sharedDraftFixture)).toBe(true);
  // Run the production broker with a held durable read and document-binding retirement.
  await page.evaluate(async () => {
    const fixture = window.__sharedDraftFixture;
    if (!fixture) throw new Error('missing shared fixture');
    const proof = await fixture.lifecycleProof();
    window.__sharedDraftLifetime = proof;
  });
  await expect
    .poll(() => page.evaluate(async () => window.__sharedDraftLifetime?.inspect()))
    .toEqual({
      retiredAdmission: true,
      records: ['survives closed origin', '<clear>', '<clear>'],
      clearBarrier: true,
      foreign: true,
    });
  await page.evaluate(() => {
    window.__sharedDraftLifetime?.dispose();
    delete window.__sharedDraftLifetime;
  });
});

declare global {
  interface Window {
    __sharedDraftLifetime?: {
      inspect(): Promise<{
        retiredAdmission: boolean;
        records: string[];
        clearBarrier: boolean;
        foreign: boolean;
      }>;
      dispose(): void;
    };
  }
}

test('keeps newer local typing when an older peer update arrives late', async ({ mount, page }) => {
  const component = await mount(SharedDraftEditorsHarness);
  const main = component.getByTestId('shared-main').locator('.tiptap-editor');
  const dock = component.getByTestId('shared-dock').locator('.tiptap-editor');
  await expect(main).toHaveAttribute('contenteditable', 'true');
  await expect(dock).toHaveAttribute('contenteditable', 'true');
  await page.evaluate(() => window.__sharedDraftFixture?.holdMain());
  await dock.fill('Peer edit');
  await expect
    .poll(() => page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.text))
    .toBe('Peer edit');
  await main.fill('New local typing');
  await page.evaluate(() => window.__sharedDraftFixture?.releaseMain());
  await expect(main).toHaveText('New local typing');
  // A deliberate subsequent edit rebases onto the returned canonical revision.
  await main.press('End');
  await page.keyboard.insertText(' continues');
  await expect(dock).toHaveText('New local typing continues');
  await expect
    .poll(() => page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.text))
    .toBe('New local typing continues');
  await component.getByRole('button', { name: 'Close notch draft' }).click();
  await expect(dock).toHaveCount(0);
  await component.getByRole('button', { name: 'Open notch draft' }).click();
  await expect(dock).toHaveText('New local typing continues');
  await expect(main).toHaveText('New local typing continues');
  await page.screenshot({ path: test.info().outputPath('shared-draft-delayed-reopen.png') });
});

test('shares admitted clears and rejection recovery without erasing newer app typing', async ({
  mount,
  page,
}) => {
  const component = await mount(SharedDraftEditorsHarness);
  const main = component.getByTestId('shared-main').locator('.tiptap-editor');
  const dockHost = component.getByTestId('shared-dock');
  const dock = dockHost.locator('.tiptap-editor');
  await expect(main).toHaveAttribute('contenteditable', 'true');
  await expect(dock).toHaveAttribute('contenteditable', 'true');
  await main.fill('One shared pending message');
  await expect(dock).toHaveText('One shared pending message');
  await page.evaluate(() => window.__sharedDraftFixture?.changeForeignPair());
  await expect(main).toHaveText('One shared pending message');
  await expect(dock).toHaveText('One shared pending message');
  await dockHost.getByTestId('composer-submit-button').click();
  await expect.poll(() => page.evaluate(() => window.__sharedDraftFixture?.sends().length)).toBe(1);
  await expect(dock).toHaveText('');
  await expect(main).toHaveText('');
  expect(
    await page.evaluate(
      () => window.__sharedDraftFixture?.delivery().draft?.delivery?.recovery?.text,
    ),
  ).toBe('One shared pending message');
  await page.evaluate(() => window.__sharedDraftFixture?.settleSend(false));
  await expect(dock).toHaveText('One shared pending message');
  await expect(main).toHaveText('One shared pending message');
  await replaceComposerText(main, 'Second pending message');
  await expect(dock).toHaveText('Second pending message');
  await dockHost.getByTestId('composer-submit-button').click();
  await expect.poll(() => page.evaluate(() => window.__sharedDraftFixture?.sends().length)).toBe(2);
  await expect(main).toHaveText('');
  await main.fill('Newer unsent app draft');
  try {
    await expect(dock).toHaveText('Newer unsent app draft');
  } finally {
    await test.info().attach('shared-recovery-state', {
      body: JSON.stringify(
        await page.evaluate(async () => ({
          transactions: window.__sharedDraftFixture?.transactions(),
          delivery: window.__sharedDraftFixture?.delivery(),
          saved: await window.__sharedDraftFixture?.saved(),
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  await page.evaluate(() => window.__sharedDraftFixture?.settleSend(false));
  await expect
    .poll(() =>
      page.evaluate(() => window.__sharedDraftFixture?.delivery().draft?.delivery?.settled),
    )
    .toBe(true);
  await expect(main).toHaveText('Newer unsent app draft');
  await expect(dock).toHaveText('Newer unsent app draft');
  await dockHost.getByTestId('composer-submit-button').click();
  await expect.poll(() => page.evaluate(() => window.__sharedDraftFixture?.sends().length)).toBe(3);
  await expect(main).toHaveText('');
  await main.fill('Typing after uncertain delivery');
  await expect(dock).toHaveText('Typing after uncertain delivery');
  await page.evaluate(() => window.__sharedDraftFixture?.loseSend());
  await expect
    .poll(() => page.evaluate(() => window.__sharedDraftFixture?.delivery().submission?.status))
    .toBe('uncertain');
  await expect(main).toHaveText('Typing after uncertain delivery');
  await expect(dock).toHaveText('Typing after uncertain delivery');
  expect(
    await page.evaluate(
      () => window.__sharedDraftFixture?.delivery().draft?.delivery?.recovery?.text,
    ),
  ).toBe('Newer unsent app draft');
  await expect
    .poll(() => page.evaluate(async () => (await window.__sharedDraftFixture?.saved())?.text))
    .toBe('Typing after uncertain delivery');
  await page.screenshot({ path: test.info().outputPath('shared-draft-recovery.png') });
});

test('retires captured drafts and queued writes across an authority round trip', async ({
  mount,
  page,
}) => {
  const component = await mount(SharedDraftEditorsHarness);
  const main = component.getByTestId('shared-main').locator('.tiptap-editor');
  const dock = component.getByTestId('shared-dock').locator('.tiptap-editor');
  await expect(main).toHaveAttribute('contenteditable', 'true');
  await main.fill('Same pair and same content');
  await expect(dock).toHaveText('Same pair and same content');
  const result = await page.evaluate(async () => {
    const manager = window.__sharedDraftManager;
    const fixture = window.__sharedDraftFixture;
    const capture = manager?.captureDraft();
    if (!capture || !manager || !fixture) throw new Error('shared draft fixture unavailable');
    fixture.retireContext();
    return {
      current: manager.isCurrentDraft(capture),
      flushed: await manager.flushDraft(capture),
      authorityChanged: manager.captureDraft()?.authority !== capture.authority,
      queued: await fixture.queuedAuthorityProof(),
    };
  });
  expect(result).toEqual({
    current: false,
    flushed: false,
    authorityChanged: true,
    queued: { rejected: true, methods: ['read'] },
  });
  await expect(main).toHaveText('Same pair and same content');
  await expect(dock).toHaveText('Same pair and same content');
  await page.screenshot({ path: test.info().outputPath('shared-draft-retired-authority.png') });
});
