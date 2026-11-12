import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';

/** Actual composer with synthetic capture/recorder; no OS media or real Send. */
test('capture and recording keep the contextual placeholder and draft', async ({
  mount,
  page,
}, info) => {
  const component = await mount(Harness);
  const editor = component.locator('.tiptap-editor');
  const empty = editor.locator('p[data-placeholder]').first();
  await expect(empty).toHaveAttribute('data-placeholder', /^Message /);
  const normal = await empty.getAttribute('data-placeholder');
  const states: Record<string, unknown>[] = [];
  const unchanged = async (mode: string) => {
    await editor.focus();
    await expect(editor).toBeFocused();
    await expect(empty).toHaveAttribute('data-placeholder', normal!);
    states.push({ mode, placeholder: await empty.getAttribute('data-placeholder') });
  };
  await unchanged('normal');
  await page.evaluate(() => (window as any).__dockComposerE2E.native.holdCaptures(true));
  await component.getByRole('button', { name: /^Capture the screen/ }).dispatchEvent('click');
  await unchanged('screenshot-pending');
  await page.evaluate(() => (window as any).__dockComposerE2E.native.holdCaptures(false));
  await expect(component.locator('[data-dock-media-attachments] .tile')).toHaveCount(1);
  await unchanged('screenshot-attached');
  await page.screenshot({ path: info.outputPath('screenshot-placeholder.png') });
  await page.evaluate(() => {
    const { store } = (window as any).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'dockConversation/evidenceToolSelectRequested',
      payload: [workspaceId, agentId, 'box'],
    });
  });
  await expect(component.getByText('Annotating', { exact: true })).toBeVisible();
  await unchanged('annotating');
  await page.evaluate(() => {
    const { store } = (window as any).__dockComposerE2E;
    const { workspaceId, agentId } = store.state.dockConversation;
    store.dispatch({
      type: 'dockConversation/evidenceAnnotationToggleRequested',
      payload: [workspaceId, agentId],
    });
  });
  await expect(component.getByText('Annotating', { exact: true })).toHaveCount(0);
  await component.getByRole('button', { name: /^Record the screen/ }).dispatchEvent('click');
  await expect(component.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await unchanged('recording');
  await page.screenshot({ path: info.outputPath('recording-placeholder.png') });
  await editor.fill('Keep this synthetic draft');
  await component.getByRole('button', { name: 'Stop recording' }).dispatchEvent('click');
  await expect(editor).toHaveText('Keep this synthetic draft');
  await page.screenshot({ path: info.outputPath('draft-retained.png') });
  await writeFile(
    info.outputPath('placeholder-receipt.json'),
    JSON.stringify(
      {
        states,
        recordingDraftRetained: true,
        scope:
          'Real DockConversation / SimpleRichInput / controller, synthetic native media and transport; no real Send',
      },
      null,
      2,
    ),
  );
});
