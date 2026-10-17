import { afterEach, expect, it, vi } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../test/fixtures/principal-state';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';
import {
  scriptsReducer,
  setScriptsData,
  appendScriptOutput,
} from '$store/renderer/slices/scripts/scripts-slice';
import {
  installScriptsRecovery,
  recordScriptsRecoveryPage,
  trackScriptsRecoveryRead,
} from './scripts-event-recovery';
import type { ScriptWithState } from './types';
const row: ScriptWithState = {
  id: 'one',
  workspaceId: 'ws',
  name: 'Run',
  command: 'make test',
  mode: 'command',
  source: 'user',
  createdAt: 'now',
  runtime: { status: 'running', restartCount: 0 },
};
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
let dispose = () => {};
afterEach(() => {
  dispose();
  rendererEventRecovery.dispose();
  vi.useRealTimers();
});
function setup(request: EventRecoverySession['request']) {
  const handlers = new Set<(n: RecoveryNotification) => void | Promise<void>>();
  const state = withLegacyPrincipal({
    scripts: scriptsReducer(undefined, setScriptsData('ws', [row])),
    workspace: { workspaces: createCollection('id', [{ id: 'ws', myRole: 'owner' }]) },
    workspaceLifecycle: { sessionPhaseByWorkspaceId: { ws: 'live' }, loadByWorkspaceId: {} },
  });
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state,
    dispatch: (action: { type: string }) => {
      state.scripts = scriptsReducer(state.scripts, action);
      for (const fn of listeners) fn();
      return action;
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const scope = rendererEventRecovery.attach({
    supported: true,
    isCurrent: () => true,
    request,
    fence: async (_ids, observe) => {
      observe();
    },
    dispose: () => {},
    onRetired: () => () => {},
    onNotification: (fn) => {
      handlers.add(fn);
      return () => {
        handlers.delete(fn);
      };
    },
  });
  dispose = installScriptsRecovery(scope, store);
  return {
    scope,
    state,
    store,
    emit: (method: string, params: unknown) => {
      for (const fn of handlers) void fn({ method, params });
    },
  };
}
it('replaces loaded summary pages without replaying output or removed-row journals', async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    if (method === 'script.list')
      return (params as { cursor?: string }).cursor
        ? { view: 'summary', scripts: [], nextCursor: 'unloaded' }
        : { view: 'summary', scripts: [], nextCursor: 'second' };
    throw new Error(method);
  });
  const h = setup(request as EventRecoverySession['request']);
  h.store.dispatch(appendScriptOutput('ws', 'one', { text: 'retained bytes', timestamp: 'now' }));
  const output = h.state.scripts.byWorkspaceId.ws.outputBuffers;
  recordScriptsRecoveryPage('ws', false);
  recordScriptsRecoveryPage('ws', true);
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(h.state.scripts.byWorkspaceId.ws.scripts).toEqual({});
  expect(h.state.scripts.byWorkspaceId.ws.nextCursor).toBe('unloaded');
  expect(h.state.scripts.byWorkspaceId.ws.outputBuffers).toBe(output);
  expect(request.mock.calls.filter(([method]) => method === 'script.list')).toEqual([
    ['script.list', { workspaceId: 'ws', archive: 'active', view: 'summary', limit: 100 }],
    [
      'script.list',
      { workspaceId: 'ws', archive: 'active', view: 'summary', limit: 100, cursor: 'second' },
    ],
  ]);
});
it('serializes recovery behind ordinary reads and clears data on authority loss', async () => {
  let finish!: (value: string) => void;
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : { view: 'summary', scripts: [row] },
  );
  const h = setup(request as EventRecoverySession['request']);
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  const ordinary = trackScriptsRecoveryRead(
    'ws',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await settle();
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(request.mock.calls.filter(([method]) => method === 'script.list')).toHaveLength(0);
  finish('result');
  expect(await ordinary).toBe('result');
  await settle();
  expect(request.mock.calls.filter(([method]) => method === 'script.list')).toHaveLength(1);
  rendererEventRecovery.retireWorkspace('ws');
  expect(h.state.scripts.byWorkspaceId.ws).toBeUndefined();
});

it('drops a held recovery response across an authority ABA transition', async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(async (method: string) => {
    if (method === 'events.subscribe') return { subscriptionId: 'lease', lossRecovery: 1 };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const h = setup(request as EventRecoverySession['request']);
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  const authority = h.state.principal;
  h.state.principal = { ...authority, status: 'loading' };
  h.store.dispatch({ type: 'authority-changed' });
  expect(h.state.scripts.byWorkspaceId.ws).toBeUndefined();
  h.state.principal = authority;
  h.store.dispatch(setScriptsData('ws', []));
  finish({ view: 'summary', scripts: [row] });
  await settle();
  expect(h.state.scripts.byWorkspaceId.ws.scripts).toEqual({});
});
it('preserves exact loaded-page demand when the recovery owner is reinstalled', async () => {
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : { view: 'summary', scripts: [], nextCursor: 'second' },
  );
  const h = setup(request as EventRecoverySession['request']);
  recordScriptsRecoveryPage('ws', false);
  recordScriptsRecoveryPage('ws', true);
  expect(h.state.scripts.byWorkspaceId.ws.loadedPageCount).toBe(2);
  dispose();
  dispose = installScriptsRecovery(h.scope, h.store);
  let page = 0;
  request.mockImplementation(async (method) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : ({
          view: 'summary',
          scripts: [],
          nextCursor: ++page === 1 ? 'fresh-second' : undefined,
        } as never),
  );
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  expect(page).toBe(2);
});

import { RecoveryRequestTimeoutError as VerifierTimeout } from '$shared/event-recovery/session';
it('physical read: scripts retain timeout physical drain', async () => {
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : { view: 'summary', scripts: [] },
  );
  const h = setup(request as EventRecoverySession['request']);
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  let finish!: (v: any) => void;
  const error = new VerifierTimeout(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await trackScriptsRecoveryRead('ws', () => Promise.reject(error)).catch(() => {});
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  const before = request.mock.calls.filter(([m]) => m === 'script.list').length;
  finish({ retired: false, errors: [] });
  await settle();
  expect(before).toBe(0);
  expect(request.mock.calls.filter(([m]) => m === 'script.list')).toHaveLength(1);
});
it('physical read: scripts keep physical lane through installer replacement', async () => {
  const request = vi.fn(async (method: string) =>
    method === 'events.subscribe'
      ? { subscriptionId: 'lease', lossRecovery: 1 }
      : { view: 'summary', scripts: [] },
  );
  const h = setup(request as EventRecoverySession['request']);
  await h.scope.subscribe({ workspaceId: 'ws', eventTypes: ['script:*'] }, { recover: true });
  let finish!: (v: any) => void;
  const ordinary = trackScriptsRecoveryRead(
    'ws',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await settle();
  dispose();
  dispose = installScriptsRecovery(h.scope, h.store);
  h.emit('events.lost', { subscriptionId: 'lease', generation: '1', scope: { workspaceId: 'ws' } });
  await settle();
  const before = request.mock.calls.filter(([m]) => m === 'script.list').length;
  finish('old');
  await ordinary;
  await settle();
  expect(before).toBe(0);
  expect(request.mock.calls.filter(([m]) => m === 'script.list')).toHaveLength(1);
});
