import { expect, test } from '../../../../test/ct-test';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';
import type { ComposerDraftRequest } from './mocks/composer-draft-transport';

const scope = { workspaceId: 'chat-panel-composer-geometry', agentId: 'regular-composer-agent' };

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
  await editor.fill('Edited after restoration');
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
  await editor.fill('Only the new fixture saves');
  await expect
    .poll(() => requests)
    .toContainEqual({
      method: 'drafts.set',
      params: { ...scope, text: 'Only the new fixture saves' },
    });
  expect(oldRequests).toEqual([{ method: 'drafts.get', params: scope }]);
});
