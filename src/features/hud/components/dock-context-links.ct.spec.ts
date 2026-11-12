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
  // UI and shortcut consumers must choose the same saved override at a prefix root without slash.
  await emit('https://shared.example/project/page');
  await action('link', 'choice-0');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  await emit('https://shared.example/project', { workspaceId: 'choice-1' });
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  await page.evaluate((sequence) => {
    const h = (window as any).__dockComposerE2E;
    h.shortcut({
      id: 'shared-prefix-shortcut',
      backendId: h.store.state.connections.windowBackendId,
      action: 'focus',
      appId: 'com.apple.Safari',
      contextVersion: `context-${sequence}`,
      identityKey: 'url:https://shared.example/project',
      url: 'https://shared.example/project',
      workspaceId: 'choice-1',
    });
  }, sequence);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__dockComposerE2E.store.state.dockConversation.workspaceId,
      ),
    )
    .toBe('choice-0');
  receipts.push({ sharedPrefix: await read(), hotkeyDestination: 'choice-0' });
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
  for (const appId of [
    'com.apple.Safari',
    'company.thebrowser.dia',
    'com.apple.SafariTechnologyPreview',
  ]) {
    await emit(null, { appId, identityKey: `app:${appId}` });
    await expect.poll(() => read().then((row) => row?.linkable)).toBe(false);
    receipts.push({ unavailableBrowser: await read() });
  }
  await emit('http://127.0.0.1:5173/project/', { workspaceId: 'choice-1' });
  await expect
    .poll(() => read().then((row) => [row?.linkedWorkspaceId, row?.linkKey, row?.linkable]))
    .toEqual(['choice-1', null, false]);
  await action('unlink');
  await expect.poll(() => read().then((row) => row?.linkedWorkspaceId)).toBe('choice-1');
  receipts.push({ readOnlyInference: await read() });
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

test('held metadata preserves service ownership, noise is bounded and contradictory entries invalidate it', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__dockComposerE2E?.store.state.dockConversation.loading),
    )
    .toBe(false);
  const runtime = {
    runId: 'context-run',
    status: 'running',
    pid: 1234,
    startedAt: '2026-11-04T00:00:00Z',
    restartCount: 0,
    detectedUrl: 'http://localhost:5173/project/',
  };
  const script = {
    id: 'context-service',
    workspaceId: 'choice-0',
    name: 'Synthetic context service',
    mode: 'service',
    purpose: 'saved',
    source: 'manual',
    createdAt: '2026-11-04T00:00:00Z',
    commandPreview: 'synthetic',
    commandTruncated: false,
    runtime,
  };
  await page.evaluate(
    ({ script }) => {
      const h = (window as any).__dockComposerE2E;
      h.seedChoices(2);
      h.contextReady();
      h.fixture.setServices([script]);
      h.contextScript(script);
      h.fixture.holdServiceList(true);
      h.context({
        sequence: 1,
        contextVersion: 'service-entry',
        backendId: h.store.state.connections.windowBackendId,
        identityKey: 'url:synthetic-service',
        identityKind: 'url',
        self: false,
        appId: 'company.thebrowser.dia',
        appName: 'Synthetic Dia',
        url: 'http://127.0.0.1:61999/project/page',
        serviceAddress: 'http://localhost:5173/project/page',
        icon: null,
      });
    },
    { script },
  );
  const snapshot = () => page.evaluate(() => (window as any).__dockComposerE2E.contextSnapshot());
  const count = () =>
    page.evaluate(
      () =>
        (window as any).__dockComposerE2E.calls.filter((call: any) => call.method === 'script.list')
          .length,
    );
  await expect.poll(count).toBeGreaterThan(0);
  const heldCount = await count();
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.context({
      sequence: 2,
      contextVersion: 'service-entry',
      backendId: h.store.state.connections.windowBackendId,
      identityKey: 'url:synthetic-service',
      identityKind: 'url',
      self: false,
      appId: 'company.thebrowser.dia',
      appName: 'Synthetic Dia metadata update',
      url: 'http://127.0.0.1:61999/project/page',
      serviceAddress: 'http://localhost:5173/project/page',
      icon: null,
    });
    h.fixture.holdServiceList(false);
  });
  await expect.poll(() => snapshot().then((row) => row?.linkedWorkspaceId)).toBe('choice-0');
  expect(await count()).toBe(heldCount);
  const before = await count();
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.contextRuntimeNoise('choice-0', 'context-service');
    h.contextRuntimeNoise('foreign-workspace', 'foreign-service');
    h.contextAction('dismiss');
  });
  await expect.poll(() => snapshot().then((row) => row?.dismissed)).toBe(true);
  expect(await count()).toBe(before);
  await page.evaluate(
    ({ script }) => {
      const h = (window as any).__dockComposerE2E;
      const stopped = { ...script.runtime, status: 'exited', exitCode: 0 };
      h.fixture.setServices([{ ...script, runtime: stopped }]);
      h.contextRuntime(script.workspaceId, script.id, stopped);
    },
    { script },
  );
  await expect.poll(() => snapshot().then((row) => row?.linkedWorkspaceId)).toBeNull();
  await expect.poll(count).toBeGreaterThan(before);
  const after = await count();
  expect(after - before).toBeLessThanOrEqual(3);
  // A contradictory URL during a second held read must retire its old result.
  await page.evaluate(
    ({ script }) => {
      const h = (window as any).__dockComposerE2E;
      h.fixture.setServices([script]);
      h.contextScript(script);
      h.fixture.holdServiceList(true);
      h.context({
        sequence: 3,
        contextVersion: 'held-again',
        backendId: h.store.state.connections.windowBackendId,
        identityKey: 'url:synthetic-service',
        identityKind: 'url',
        self: false,
        appId: 'company.thebrowser.dia',
        appName: 'Synthetic Dia',
        url: 'http://127.0.0.1:61999/project/page',
        serviceAddress: 'http://localhost:5173/project/page',
        icon: null,
      });
    },
    { script },
  );
  await expect.poll(count).toBeGreaterThan(after);
  await page.evaluate(() => {
    const h = (window as any).__dockComposerE2E;
    h.context({
      sequence: 4,
      contextVersion: 'moved-entry',
      backendId: h.store.state.connections.windowBackendId,
      identityKey: 'url:elsewhere',
      identityKind: 'url',
      self: false,
      appId: 'company.thebrowser.dia',
      appName: 'Synthetic Dia',
      url: 'https://elsewhere.example/project/',
      icon: null,
    });
    h.fixture.holdServiceList(false);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values((window as any).__dockComposerE2E.store.state.scripts.byWorkspaceId).reduce(
          (count: number, row: any) => count + Object.keys(row.pendingReads ?? {}).length,
          0,
        ),
      ),
    )
    .toBe(0);
  await expect
    .poll(() => snapshot().then((row) => [row?.url, row?.linkedWorkspaceId]))
    .toEqual(['https://elsewhere.example/project/', null]);
  await writeFile(
    info.outputPath('bounded-service-refresh.json'),
    JSON.stringify(
      {
        boundary:
          'Production context saga, scripts state and run recheck; synthetic daemon/service observations, no actual service or capture.',
        heldCount,
        before,
        after,
        snapshot: await snapshot(),
      },
      null,
      2,
    ),
  );
});
