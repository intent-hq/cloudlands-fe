import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './DockComposerE2EHarness.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';
import type { DockLinkedContextSnapshot } from '$shared/dock-context-links';

/**
 * Global "open related" (default Ctrl+Shift+A) through the real dock shortcut saga and
 * context-links saga. The harness delivers what main sends: the feed-admitted observation
 * (DOCK_CONTEXT changed) and the shortcut context carrying that raw feed version and identity
 * (FOCUS_DOCK). OS key delivery and native foreground sampling are NOT exercised here.
 */
test('open related follows only the admitted linked context', async ({ mount, page }, info) => {
  test.setTimeout(120_000);
  // The real notch shell (rail, companion, conversation surface, focus requests).
  await page.setViewportSize({ width: 1000, height: 740 });
  await mount(Harness, { props: { shell: dockRailPreview.states.notch.props } });
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
  const draftLength = (workspaceId: string) =>
    page.evaluate((id) => {
      const map = (window as any).__dockComposerE2E.store.state.dockConversation.drafts?.map ?? {};
      const entry = Object.entries(map).find(([key]) => JSON.parse(key)[0] === id);
      return ((entry?.[1] as { text?: string } | undefined)?.text ?? '').length;
    }, workspaceId);
  const DRAFT = 'Keep this draft';
  // A draft in the source conversation (the fixture conversation has a real agent and composer).
  await page.locator('.tiptap-editor').first().click();
  await page.keyboard.type(DRAFT);
  await expect.poll(() => draftLength(origin)).toBe(DRAFT.length);

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
  expect(await draftLength(origin)).toBe(DRAFT.length);
  await page.screenshot({ path: info.outputPath('related-first-publication.png') });
  receipts.firstPublication = {
    open: 'choice-0',
    follows: 1,
    chooserUsed: false,
    sourceDraftKept: true,
  };

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

  // 7. A valid destination with a real agent: the press opens it, its composer renders and
  // takes focus, and the draft written there earlier is still there.
  const D = 'https://github.com/example/fixture/issues/7';
  await observe('v7', D);
  await expect.poll(() => read().then((row) => row?.url)).toBe(D);
  await page.evaluate((id) => (window as any).__dockComposerE2E.contextAction('link', id), origin);
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe(origin);
  await related('v7', D);
  await expect.poll(open).toBe(origin);
  const composer = page.locator('.tiptap-editor').first();
  await expect(composer).toBeVisible();
  await expect(composer).toContainText(DRAFT);
  await expect
    .poll(() =>
      page.evaluate(() => {
        // Same composer-focus check as the side shortcut spec.
        const active = document.activeElement as HTMLElement | null;
        return (
          !!active?.closest('.tiptap-editor') || active?.getAttribute('contenteditable') === 'true'
        );
      }),
    )
    .toBe(true);
  expect(await draftLength(origin)).toBe(DRAFT.length);
  await page.screenshot({ path: info.outputPath('related-valid-destination.png') });
  receipts.validDestination = { open: origin, composerFocused: true, draftKept: true };

  // 8. Live input (push-to-talk recording): no selection change, no media intent.
  await observe('v8', A);
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  const before = await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.store.dispatch({ type: 'hardwareConsole/pttRecordingStarted', payload: [] });
    const s = h.store.state;
    return {
      ptt: s.hardwareConsole.pttRecording,
      speech: s.dockConversation.nativeSpeech.activeId ?? null,
      follows: h.contextSnapshot()?.policy.follows ?? null,
    };
  });
  expect(before.ptt).toBe(true);
  await related('v8', A);
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(1800);
  const during = await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    const s = h.store.state;
    return {
      open: s.dockConversation.workspaceId,
      shortcut: s.dockConversation.shortcut ?? null,
      ptt: s.hardwareConsole.pttRecording,
      speech: s.dockConversation.nativeSpeech.activeId ?? null,
      follows: h.contextSnapshot()?.policy.follows ?? null,
    };
  });
  expect(during.open).toBe(origin);
  expect(during.shortcut).toBeNull();
  expect(during.ptt).toBe(true);
  expect(during.speech).toBe(before.speech);
  expect(during.follows).toBe(before.follows);
  await page.evaluate(() =>
    (window as any).__dockComposerE2E.store.dispatch({
      type: 'hardwareConsole/pttRecordingStopped',
      payload: [],
    }),
  );
  receipts.liveInput = { before, during };

  // 9. A newer accepted press supersedes a held related wait: the related context publishes
  // only after a plain focus press (no foreground context, so it cannot route there itself).
  const followsBefore = (await read())?.policy.follows;
  await related('v9', A);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.shortcut({
      id: crypto.randomUUID(),
      backendId: h.store.state.connections.windowBackendId,
      action: 'focus',
    });
  });
  await observe('v9', A);
  await expect.poll(() => read().then((row) => row?.contextVersion ?? '')).toContain('v9');
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may happen during or after the bounded related wait
  await page.waitForTimeout(1800);
  expect(await open()).not.toBe('choice-0');
  expect((await read())?.policy.follows).toBe(followsBefore);
  receipts.supersededByNewerFocus = {
    open: await open(),
    followsBefore,
    followsAfter: followsBefore,
  };

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
