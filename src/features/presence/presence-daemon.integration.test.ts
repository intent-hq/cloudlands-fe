/**
 * Opt-in real daemon → real FE transport/bridge/store → mounted avatar proof.
 * Default unit runs explicitly skip these SIX external-fixture cases. To request
 * them, set INTENT_PRESENCE_DAEMON_TEST=1, CI=1 (the existing native60s budget),
 * and INTENT_PRESENCE_FIXTURE_INPUT to reviewed external archive/source DATA.
 * Missing/wrong requested input FAILS setup; it never silently skips or passes.
 * No credentials, local evidence paths or daemon installation are committed.
 *
 * No IPC/preload/native window, genuine tunnel/provider bootstrap or real users.
 * Deliberate original-frame holds are marked below; no RPC reply or notification
 * is synthesized. Backend production/source and all earlier suites are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { BrowserWebSocketTransport } from '$lib/client/live/browser-websocket-transport';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { BackendRequestOptions } from '$lib/client/live/backend-transport-types';
import { invoke } from '$lib/electron-bridge';
import { store } from '$store/renderer/store';
import type { Workspace } from '$shared/types';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { principalSaga } from '$store/renderer/slices/principal/sagas/principal-saga';
import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
import { MemberProvider } from '$lib/services/mentions/providers/member-provider';
import LivePresenceHarness from './__tests__/LivePresenceHarness.svelte';
import { DaemonPresenceFixture, eventually, type Frame } from './__tests__/daemon-presence-fixture';

// Platform selection seam only. backend-transport.ts, parser, hello, JSON-RPC
// correlation and subscription lifecycle remain actual production code.
const platform = vi.hoisted(() => ({ transport: null as BrowserWebSocketTransport | null }));
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: () => {
    if (!platform.transport) throw new Error('Live fixture transport not installed');
    return platform.transport;
  },
}));
// Ordinary test setup installs an independent invoke mock. Use the real module
// and the production browser report seeder instead of returning a fake result.
vi.unmock('$lib/electron-bridge');

const enabled = process.env.INTENT_PRESENCE_DAEMON_TEST === '1';
if (process.env.INTENT_PRESENCE_DAEMON_TEST && !enabled)
  throw new Error('INTENT_PRESENCE_DAEMON_TEST must be 1 or absent');
const suite = enabled ? describe : describe.skip;
const featureMethods = new Set(['presence.snapshot', 'workspace.members.list', 'presence.update']);
let fixture: DaemonPresenceFixture;
let transport: BrowserWebSocketTransport;
let stops: Array<() => void>;
let started: boolean;
let restoreVisibility: () => void;
let outcomes: Array<{ method: string; ok: boolean; code?: string }>;
let restoreRequest: () => void;
const people = () => selectWorkspacePresencePeople.select(store.state, fixture.workspaceId);
const target = () =>
  document.querySelector(`[data-presence-avatar="${fixture.target.principalId}"]`);
const requests = (method: string) => fixture.renderer.requests.filter((r) => r.method === method);
const settled = (method: string) => outcomes.filter((r) => r.method === method);
const mentions = () => new MemberProvider().search('target', { workspaceId: fixture.workspaceId });
async function settleDom() {
  await tick();
}
async function loaded() {
  await waitFor(
    () => {
      expect(store.state.principal.snapshot?.principal.id).toBe(fixture.remaining.principalId);
      expect(store.state.principal.snapshot?.principal.hostRole).toBe('guest');
      expect(people().find((p) => p.principalId === fixture.target.principalId)).toMatchObject({
        hostRole: 'guest',
        online: false,
      });
      expect(target()).not.toBeNull();
      expect(target()).toHaveAttribute('data-presence-ring', 'guest');
      expect(target()).toHaveAttribute('data-presence-offline', 'true');
    },
    { timeout: 10_000 },
  );
  await eventually(
    () => outcomes.some((o) => o.method === 'presence.update' && o.ok),
    'positive admitted own report',
  );
  expect(store.state.presence.ownTypingSource).toEqual(expect.any(String));
  expect(vi.isMockFunction(invoke)).toBe(false);
  // Settle an actual focus-driven member refresh before arming a later gate.
  // A FIFO event marker alone would not wait for the saga's debounce/read.
  const accepted = settled('workspace.members.list').length;
  await fixture.owner.request('presence.update', {
    focus: [{ workspaceId: fixture.workspaceId }],
    typing: null,
  });
  await rendererMarker();
  await eventually(
    () => settled('workspace.members.list').length > accepted,
    'accepted focus-driven member refresh',
  );
}
async function mount(enabled = true) {
  started = true;
  store.dispatch(setLabsMultiplayerEnabled(enabled));
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'fixture', windowBackendId: 'fixture' }),
  );
  stops.push(
    transport.onConnectionStatusChange((status) => store.dispatch(connectionStatusChanged(status))),
  );
  store.dispatch(connectionStatusChanged(transport.getConnectionStatus()));
  store.dispatch(replaceWorkspaceList([(await fixture.workspace()) as Workspace]));
  store.dispatch(openWorkspaceTab(fixture.workspaceId));
  stops.push(store.runSaga(principalSaga));
  stops.push(store.runSaga(presenceSaga));
  stops.push(store.runSaga(daemonEventsSaga));
  render(LivePresenceHarness, { props: { workspaceId: fixture.workspaceId } });
}
async function rendererMarker() {
  const title = `fe-marker-${fixture.renderer.received.length}`;
  const offset = fixture.renderer.received.length;
  await fixture.owner.request('workspace.update', { workspaceId: fixture.workspaceId, title });
  await eventually(
    () =>
      fixture.renderer.received
        .slice(offset)
        .some((f) => f.params?.event?.data?.changes?.title === title),
    'actual FE subscription marker',
  );
  await settleDom();
}
const isSharedPresence = (frame: Frame) =>
  frame.method === 'events.event' &&
  frame.params?.event?.type === 'presence:changed' &&
  frame.params.event.data.workspaceId === fixture.workspaceId;

suite('hermetic daemon event to mounted workspace avatar', () => {
  beforeEach(async () => {
    // Case6 observes the production30s timeout. Require the repository's normal
    // CI60s mode; never overwrite request/test/hook budgets to force a pass.
    fixture = undefined as unknown as DaemonPresenceFixture;
    transport = undefined as unknown as BrowserWebSocketTransport;
    stops = [];
    outcomes = [];
    started = false;
    restoreRequest = () => undefined;
    restoreVisibility = () => undefined;
    if (!process.env.CI || process.env.CI === 'false')
      throw new Error('Requested live suite requires normal CI timeout mode');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    restoreVisibility = () => visibility.mockRestore();
    store.init();
    fixture = await DaemonPresenceFixture.start();
    transport = new BrowserWebSocketTransport({
      // This URL only reaches the platform constructor. The owned actual WSS URL
      // and disposable credential stay private inside RendererWire.
      url: 'wss://fixture.invalid/ws',
      webSocketFactory: fixture.renderer.create,
    });
    platform.transport = transport;
    const request = transport.request.bind(transport);
    const spy = vi
      .spyOn(transport, 'request')
      .mockImplementation(
        async <T = unknown>(
          method: string,
          params?: unknown,
          options?: BackendRequestOptions,
        ): Promise<T> => {
          try {
            const result = await request<T>(method, params, options);
            outcomes.push({ method, ok: true });
            return result;
          } catch (error) {
            outcomes.push({ method, ok: false, code: (error as { code?: string }).code });
            throw error;
          }
        },
      );
    restoreRequest = () => spy.mockRestore();
    await import('$store/renderer/seeders/presence-bridge-seeder');
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    try {
      cleanup();
      // Presence cleanup runs while the actual connection can still accept it.
      const reports = started ? requests('presence.update') : [];
      if (reports.length > 0 && reports.at(-1)?.params.focus?.length !== 0) {
        const count = reports.length;
        store.dispatch(setLabsMultiplayerEnabled(false));
        await eventually(
          () =>
            requests('presence.update')
              .slice(count)
              .some((r) => r.params.focus?.length === 0),
          'own-window clear',
        );
      }
      await settleDom();
    } catch (error) {
      failures.push(error);
    } finally {
      for (const stop of (stops ?? []).reverse()) {
        try {
          stop();
        } catch (error) {
          failures.push(error);
        }
      }
      transport?.dispose();
      restoreRequest?.();
      platform.transport = null;
      store.dispose();
      restoreVisibility?.();
      try {
        await fixture?.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Live composition teardown incomplete');
  });

  it('uncached offline promotion reaches a real guest and removes the loaded avatar', async () => {
    await mount();
    await loaded();
    const before = await fixture.snapshot();
    const count = (await fixture.workspace()).memberCount;
    expect(
      before.members.some(
        (p: { principalId: string }) => p.principalId === fixture.target.principalId,
      ),
    ).toBe(false);
    const hold = fixture.renderer.hold(isSharedPresence);
    await fixture.promote();
    await eventually(() => hold.frames.length > 0, 'real promotion frame received');
    expect(
      hold.frames.every((f) => JSON.stringify(f.params!.event.data) === JSON.stringify(before)),
    ).toBe(true);
    expect((await fixture.workspace()).memberCount).toBe(count);
    expect(target()).not.toBeNull(); // Causal control BEFORE delivering the actual frame.
    const reads = requests('workspace.members.list').length;
    hold.release();
    await waitFor(() => expect(requests('workspace.members.list').length).toBeGreaterThan(reads), {
      timeout: 10_000,
    });
    await waitFor(() => expect(target()).toBeNull(), { timeout: 10_000 });
    expect(
      (await fixture.members()).members.find(
        (p: { principalId: string }) => p.principalId === fixture.target.principalId,
      ).hostRole,
    ).toBe('member');
    expect(people().some((p) => p.hostRole === 'owner' && p.online)).toBe(true);
    expect(people().find((p) => p.principalId === fixture.stable.principalId)).toMatchObject({
      hostRole: 'guest',
      online: false,
    });
  });

  it('cached offline promotion retains a no-hello lease but not an offline member avatar', async () => {
    await fixture.retainCachedTarget();
    await mount();
    await loaded();
    const before = await fixture.snapshot();
    const offset = fixture.renderer.received.length;
    await fixture.promote();
    await waitFor(() => expect(target()).toBeNull(), { timeout: 10_000 });
    const frames = fixture.renderer.received.slice(offset).filter(isSharedPresence);
    expect(frames.length).toBeGreaterThan(0);
    expect(
      frames.every((f) => JSON.stringify(f.params!.event.data) === JSON.stringify(before)),
    ).toBe(true);
    await eventually(
      () =>
        fixture.noteObserver!.frames.some(
          (f) =>
            f.params?.delta?.kind === 'updated' &&
            f.params.delta.viewer.principalId === fixture.target.principalId &&
            f.params.delta.viewer.hostRole === 'member',
        ),
      'existing note observer sees changed target',
    );
    expect(fixture.targetLease!.wire.readyState).toBe(1);
    expect(people().find((p) => p.principalId === fixture.stable.principalId)).toMatchObject({
      hostRole: 'guest',
      online: false,
    });
    expect(
      (await fixture.snapshot()).members.some(
        (p: { principalId: string }) => p.principalId === fixture.target.principalId,
      ),
    ).toBe(false);
  });

  it('withholds feature reads until admission and preserves saved access across disable', async () => {
    const admission = fixture.renderer.hold((_frame, method) => method === 'principal.me');
    await mount(false);
    await eventually(() => admission.frames.length > 0, 'real principal response held');
    expect(target()).toBeNull();
    expect(fixture.renderer.requests.filter((r) => featureMethods.has(r.method))).toEqual([]);
    admission.release();
    await waitFor(() => expect(store.state.principal.status).toBe('ready'), { timeout: 10_000 });
    await rendererMarker();
    expect(fixture.renderer.requests.filter((r) => featureMethods.has(r.method))).toEqual([]);
    store.dispatch(setLabsMultiplayerEnabled(true));
    await loaded();
    const hold = fixture.renderer.hold((_frame, method) => method === 'workspace.members.list');
    await fixture.owner.request('presence.update', {
      focus: [{ workspaceId: fixture.workspaceId }],
      typing: null,
    });
    await eventually(() => hold.frames.length > 0, 'real feature reply held');
    store.dispatch(setLabsMultiplayerEnabled(false));
    await waitFor(() => expect(target()).toBeNull());
    hold.release();
    await rendererMarker();
    expect(people()).toEqual([]);
    expect(
      (await fixture.members()).members.some(
        (p: { principalId: string }) => p.principalId === fixture.remaining.principalId,
      ),
    ).toBe(true);
    store.dispatch(setLabsMultiplayerEnabled(true));
    await loaded();
  });

  it('reconnects with a fresh lease/admission and fences removed-workspace old replies', async () => {
    await mount();
    await loaded();
    const prior = selectPrincipalActionContext.select(store.state);
    const generation = store.state.workspaceEvents.subscriptionGeneration;
    const hold = fixture.renderer.hold((_frame, method) => method === 'workspace.members.list');
    await fixture.owner.request('presence.update', {
      focus: [{ workspaceId: fixture.workspaceId }],
      typing: null,
    });
    await eventually(() => hold.frames.length > 0, 'old socket member response');
    store.dispatch(replaceWorkspaceList([]));
    await waitFor(() => expect(target()).toBeNull());
    fixture.renderer.disconnect();
    await waitFor(
      () => expect(store.state.workspaceEvents.subscriptionGeneration).toBeGreaterThan(generation),
      { timeout: 10_000 },
    );
    await waitFor(() => expect(store.state.principal.status).toBe('ready'), { timeout: 10_000 });
    expect(selectPrincipalActionContext.select(store.state)).not.toBe(prior);
    expect(store.state.principal.snapshot?.principal.id).toBe(fixture.remaining.principalId);
    hold.release();
    await rendererMarker();
    expect(target()).toBeNull();
    store.dispatch(replaceWorkspaceList([(await fixture.workspace()) as Workspace]));
    await loaded();
    expect(
      requests('events.subscribe').filter((r) => !r.params.workspaceId).length,
    ).toBeGreaterThan(1);
  });

  it('receives shared markers without private, host-global or note-firehose identities', async () => {
    await mount();
    await loaded();
    const begin = fixture.renderer.received.length;
    await fixture.owner.request('workspace.update', {
      workspaceId: fixture.privateWorkspaceId,
      title: 'Private change',
    });
    await fixture.promote();
    await rendererMarker();
    const events = fixture.renderer.received
      .slice(begin)
      .filter((f) => f.method === 'events.event')
      .map((f) => f.params!.event);
    expect(events.some((e) => e.type === 'presence:changed')).toBe(true);
    for (const event of events) {
      expect(event.workspaceId).toBe(fixture.workspaceId);
      expect(['host:members-changed', 'host:invites-changed', 'note:presence']).not.toContain(
        event.type,
      );
    }
    await expect(
      backendRequest('workspace.members.list', { workspaceId: fixture.privateWorkspaceId }),
    ).rejects.toMatchObject({ code: 'not-found', data: { code: 'not-found' } });
    expect(selectWorkspacePresencePeople.select(store.state, fixture.privateWorkspaceId)).toEqual(
      [],
    );
  });

  it('retains actual avatar and mention consumers during held and timed-out ordinary refresh', async () => {
    await mount();
    await loaded();
    const initialMentions = await mentions();
    expect(initialMentions.some((m) => m.id === `member-${fixture.target.principalId}`)).toBe(true);
    const hold = fixture.renderer.hold((_frame, method) => method === 'workspace.members.list');
    const baseline = settled('workspace.members.list').length;
    await fixture.owner.request('presence.update', {
      focus: [{ workspaceId: fixture.workspaceId }],
      typing: null,
    });
    await eventually(() => hold.frames.length > 0, 'held real membership response');
    expect(target()).not.toBeNull();
    expect(await mentions()).toEqual(initialMentions);
    // Observe actual default30s transport timeout, not an invented RPC refusal.
    // CI's existing60s native test budget includes this wait and its assertions.
    await waitFor(
      () =>
        expect(settled('workspace.members.list').slice(baseline)).toContainEqual({
          method: 'workspace.members.list',
          ok: false,
          code: 'TIMEOUT',
        }),
      { timeout: 35_000 },
    );
    expect(target()).not.toBeNull();
    expect(await mentions()).toEqual(initialMentions);
    hold.release(); // Late original response must not change the completed request.
    await rendererMarker();
    expect(target()).not.toBeNull();
    store.dispatch(replaceWorkspaceList([]));
    await waitFor(() => expect(target()).toBeNull());
    expect(await mentions()).toEqual([]);
    // The real invoke boundary remains connected, not the setup file's mock.
    expect(vi.isMockFunction(invoke)).toBe(false);
  });
});
