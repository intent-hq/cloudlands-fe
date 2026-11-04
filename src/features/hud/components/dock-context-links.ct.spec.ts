import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import type {
  DockLinkedContextSnapshot,
  DockForegroundObservation,
} from '$shared/dock-context-links';

test('one shared context API owns links, policy, stale actions and principal isolation', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  const read = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.contextSnapshot(),
    ) as Promise<DockLinkedContextSnapshot | null>;
  await expect.poll(() => page.evaluate(() => !!(window as any).__dockComposerE2E)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E.store.state.dockConversation.loading),
    )
    .toBe(false);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.seedChoices(2);
    h.contextReady();
    (window as any).originalContextPrincipal = h.store.state.principal.snapshot.principal.id;
  });
  let sequence = 0;
  const emit = async (url: string | null, extra: Partial<DockForegroundObservation> = {}) => {
    sequence++;
    await page.evaluate(
      ({ url, sequence, extra }) => {
        const h = (window as any).__dockComposerE2E;
        h.context({
          sequence,
          contextVersion: `context-${sequence}`,
          backendId: h.store.state.connections.windowBackendId,
          identityKey: url ? `url:${url}` : 'app:com.apple.Safari',
          identityKind: url ? 'url' : 'app',
          self: false,
          appId: 'com.apple.Safari',
          appName: 'Synthetic Safari',
          url,
          icon: null,
          ...extra,
        });
      },
      { url, sequence, extra },
    );
    await expect.poll(() => read().then((row) => row?.url)).toBe(url);
  };
  const action = (kind: string, workspaceId?: string, version?: string) =>
    page.evaluate(
      ({ kind, workspaceId, version }) =>
        (window as any).__dockComposerE2E.contextAction(kind, workspaceId, version),
      { kind, workspaceId, version },
    );
  const receipts: unknown[] = [];
  await emit('https://github.com/example/linked/issues/1');
  await expect.poll(() => read().then((row) => row?.linkable)).toBe(true);
  await action('link', 'choice-0');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  const linked = await read();
  receipts.push(linked);
  await action('follow');
  await action('follow');
  await expect.poll(() => read().then((row) => row?.policy.follows)).toBe(2);
  await action('no');
  await expect.poll(() => read().then((row) => row?.policy.decision)).toBe('no');
  await action('dismiss');
  await expect.poll(() => read().then((row) => row?.dismissed)).toBe(true);
  await emit('https://github.com/example/other/issues/1');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBeNull();
  await action('link', 'choice-1', linked!.contextVersion);
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBeNull();
  await emit('https://github.com/example/linked/issues/1');
  await expect.poll(() => read().then((row) => row?.policy.decision)).toBe('no');
  await expect.poll(() => read().then((row) => row?.dismissed)).toBe(true);
  await action('link', 'choice-1');
  await expect
    .poll(() => read().then((row) => [row?.linkedWorkspaceId, row?.dismissed, row?.policy]))
    .toEqual(['choice-1', false, { follows: 0, decision: 'unasked' }]);
  await action('follow');
  await action('follow');
  await action('yes');
  await expect.poll(() => read().then((row) => row?.policy.decision)).toBe('yes');
  receipts.push(await read());
  // Same-prefix sibling paths and unlinked browser documents cannot inherit an app association.
  await emit('https://github.com/example/linked-extra/issues/1');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBeNull();
  await emit(null);
  await expect.poll(() => read().then((row) => row?.linkable)).toBe(false);
  await emit('http://127.0.0.1:5173/project/');
  await expect.poll(() => read().then((row) => row?.linkable)).toBe(false);
  await emit('https://github.com/example/linked/issues/1');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-1');
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.contextPrincipal('synthetic-other-principal'),
  );
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBeNull();
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.contextPrincipal((window as any).originalContextPrincipal),
  );
  await expect.poll(() => read().then((row) => row?.policy.decision)).toBe('yes');
  await action('unlink');
  await expect
    .poll(() => read().then((row) => [row?.linkedWorkspaceId, row?.policy]))
    .toEqual([null, { follows: 0, decision: 'unasked' }]);
  await action('link', 'choice-0');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  await page.evaluate(() => (window as any).__dockComposerE2E.archiveWorkspace('choice-0'));
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBeNull();
  const final = await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    return {
      snapshot: h.contextSnapshot(),
      captures: h.native.log.captures,
      recordings: h.native.log.clips.started.length,
      stored: Object.fromEntries(
        Object.entries(localStorage).filter(([key]) => key.startsWith('dock-context-links:')),
      ),
    };
  });
  expect(final.captures).toBe(0);
  expect(final.recordings).toBe(0);
  expect(Object.values(final.stored).join('')).not.toContain('choice-0');
  await writeFile(
    info.outputPath('shared-context-links.json'),
    JSON.stringify(
      {
        boundary:
          'Production Redux/selectors/saga/storage and real dock shell. Foreground, daemon and native actions are synthetic boundaries; no OS input or user data.',
        receipts,
        final,
      },
      null,
      2,
    ),
  );
});
