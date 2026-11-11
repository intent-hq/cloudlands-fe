import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import type { DockLinkedContextSnapshot } from '$shared/dock-context-links';

/**
 * Global "open related" (default Ctrl+Shift+A) through the real dock shortcut saga and
 * context-links saga. The harness delivers what main sends: the feed-admitted observation
 * (DOCK_CONTEXT changed) and the shortcut context carrying that raw feed version and identity
 * (FOCUS_DOCK). OS key delivery and native foreground sampling are NOT exercised here.
 */
test('open related follows only the admitted linked context', async ({ mount, page }, info) => {
  test.setTimeout(120_000);
  await mount(Harness);
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
  });
  const read = () =>
    page.evaluate(() =>
      (window as any).__dockComposerE2E.contextSnapshot(),
    ) as Promise<DockLinkedContextSnapshot | null>;
  const open = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
    ) as Promise<string | null>;
  const destination = () =>
    page.evaluate(
      () => (window as any).__dockComposerE2E.store.state.dockConversation.shortcut ?? null,
    );
  const origin = (await open())!;
  expect(origin).toBeTruthy();
  let sequence = 0;
  const observe = (version: string, url: string) =>
    page.evaluate(
      ({ version, url, sequence }) => {
        const h = (window as any).__dockComposerE2E;
        h.context({
          sequence,
          contextVersion: version,
          backendId: h.store.state.connections.windowBackendId,
          identityKey: `url:${url}`,
          identityKind: 'url',
          self: false,
          appId: 'com.apple.Safari',
          appName: 'Synthetic Safari',
          url,
          icon: null,
        });
      },
      { version, url, sequence: ++sequence },
    );
  const related = (version: string, url: string, backend?: string) =>
    page.evaluate(
      ({ version, url, backend }) => {
        const h = (window as any).__dockComposerE2E;
        h.shortcut({
          id: crypto.randomUUID(),
          backendId: backend ?? h.store.state.connections.windowBackendId,
          action: 'related',
          url,
          identityKey: `url:${url}`,
          contextVersion: version,
        });
      },
      { version, url, backend },
    );
  const back = async () => {
    await page.evaluate((id) => {
      (window as any).__dockComposerE2E.store.dispatch({
        type: 'dockConversation/open',
        payload: [id],
      });
    }, origin);
    await expect.poll(open).toBe(origin);
  };
  const A = 'https://github.com/example/linked/issues/1';
  const B = 'https://github.com/example/held/issues/2';
  const C = 'https://github.com/example/unlinked/issues/3';
  const receipts: Record<string, unknown> = { origin };

  // Link A to choice-0 on its own context first.
  await observe('v0', A);
  await expect.poll(() => read().then((row) => row?.url)).toBe(A);
  await page.evaluate(() => (window as any).__dockComposerE2E.contextAction('link', 'choice-0'));
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');

  // 1. First publication after the press: the press waits, then follows the linked workspace.
  await related('v1', A);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(300);
  expect(await open()).toBe(origin);
  await observe('v1', A);
  await expect.poll(open).toBe('choice-0');
  await expect.poll(() => read().then((row) => row?.policy.follows)).toBe(1);
  expect(await destination()).toBeNull();
  await page.screenshot({ path: info.outputPath('related-first-publication.png') });
  receipts.firstPublication = { open: 'choice-0', follows: 1, chooserUsed: false };

  // 2. Held publication: the same version republishes with a link made after the press.
  await back();
  await observe('v2', B);
  await expect.poll(() => read().then((row) => row?.url)).toBe(B);
  await related('v2', B);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(250);
  expect(await open()).toBe(origin);
  await page.evaluate(() => (window as any).__dockComposerE2E.contextAction('link', 'choice-1'));
  await expect.poll(open).toBe('choice-1');
  receipts.heldPublication = { open: 'choice-1' };

  // 3. No link: nothing happens, also after the wait expires.
  await back();
  await observe('v3', C);
  await expect.poll(() => read().then((row) => row?.url)).toBe(C);
  await related('v3', C);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(1800);
  expect(await open()).toBe(origin);
  receipts.noLink = { open: origin };

  // 4a. A press for a context that is not the admitted one (older version) does nothing.
  await observe('v4', A);
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  await related('v-older', A);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(1800);
  expect(await open()).toBe(origin);
  // 4b. The admitted context is replaced by a newer one before it links: stale, no follow,
  // even though the newer context is linked.
  await related('v5', C);
  await observe('v5', C);
  await expect.poll(() => read().then((row) => row?.url)).toBe(C);
  await observe('v6', A);
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(1800);
  expect(await open()).toBe(origin);
  receipts.stale = { olderVersion: origin, replacedBeforeLink: origin };

  // 5. Another machine's press is rejected.
  await related('v6', A, 'another-machine');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(800);
  expect(await open()).toBe(origin);
  receipts.otherBackend = { open: origin };

  // 6. Already on the linked conversation: no second follow.
  const follows = (await read())?.policy.follows;
  await related('v6', A);
  await expect.poll(open).toBe('choice-0');
  const after = (await read())?.policy.follows;
  await related('v6', A);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(800);
  expect((await read())?.policy.follows).toBe(after);
  expect(await destination()).toBeNull();
  receipts.alreadyOpen = { followsBefore: follows, followsAfter: after };
  await page.screenshot({ path: info.outputPath('related-final.png') });

  await writeFile(
    info.outputPath('related-shortcut-receipt.json'),
    JSON.stringify(
      {
        ...receipts,
        scope:
          'Real dock shortcut + context-links sagas in the component harness; synthetic feed observation and FOCUS_DOCK context (what main sends). No OS key delivery or native sampling.',
      },
      null,
      2,
    ),
  );
});
