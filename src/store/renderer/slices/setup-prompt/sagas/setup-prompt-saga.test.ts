/**
 * Setup Prompt Saga Tests
 */

import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { ConnectionRecord } from '../../connections/connections-types';
import { initialState as connectionsInitialState } from '../../connections/connections-slice';
import {
  checkAllProvidersComplete,
  ensureProvidersChecked,
} from '../../agent-availability/agent-availability-slice';
import { loadWorkspacesRequested, replaceWorkspaceList } from '../../workspace/workspace-slice';
import { evaluateSetupStateRequested, setupEvaluationCompleted } from '../setup-prompt-slice';
import { hasReadyProvider } from '../setup-prompt-utils';
import { evaluateSetupStateWorker, requestReevaluation } from './setup-prompt-saga';

const LOCAL: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

interface HarnessOptions {
  activeId?: string;
  workspaceIds?: string[];
  hasLoaded?: boolean;
  hasCheckedOnce?: boolean;
  providerStatusMap?: Record<string, { available: boolean; authenticated?: boolean }>;
  providerLoadingMap?: Record<string, boolean>;
}

function harness(opts: HarnessOptions = {}) {
  const channel = stdChannel();
  const dispatched: { type: string; payload?: unknown }[] = [];
  const state: {
    connections: unknown;
    workspace: { hasLoaded: boolean; workspaces: unknown; recency: Record<string, never> };
    agentAvailability: Record<string, unknown>;
  } = {
    connections: {
      ...connectionsInitialState,
      connections: createCollection<ConnectionRecord, 'id'>('id', [LOCAL, REMOTE]),
      activeId: opts.activeId ?? LOCAL_CONNECTION_ID,
    },
    workspace: {
      hasLoaded: opts.hasLoaded ?? true,
      workspaces: createCollection<{ id: string }, 'id'>(
        'id',
        (opts.workspaceIds ?? []).map((id) => ({ id })),
      ),
      recency: {},
    },
    agentAvailability: {
      providerStatusMap: opts.providerStatusMap ?? {},
      providerLoadingMap: opts.providerLoadingMap ?? {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: opts.hasCheckedOnce ?? true,
      watchedTerminalIds: [],
      npxStatus: null,
    },
  };
  const dispatch = (action: { type: string; payload?: unknown }) => {
    dispatched.push(action);
    channel.put(action as never);
    return action;
  };
  const task = runSaga(
    { channel, dispatch: dispatch as never, getState: () => state },
    evaluateSetupStateWorker,
  );
  return { channel, dispatched, task, state };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * The worker starts by dispatching loadWorkspacesRequested and waiting for
 * the resulting replaceWorkspaceList — answer that refresh.
 */
async function answerWorkspaceRefresh(h: ReturnType<typeof harness>) {
  await settle();
  expect(h.dispatched.some((a) => a.type === loadWorkspacesRequested.type)).toBe(true);
  h.channel.put(replaceWorkspaceList([]) as never);
  await settle();
}

function completedEvaluations(dispatched: { type: string; payload?: unknown }[]) {
  return dispatched
    .filter((a) => a.type === setupEvaluationCompleted.type)
    .map((a) => (a.payload as unknown[])[0]);
}

describe('evaluateSetupStateWorker', () => {
  it('reports setupNeeded for an empty backend with no ready providers', async () => {
    const h = harness({ providerStatusMap: { auggie: { available: false } } });
    await answerWorkspaceRefresh(h);
    await h.task.toPromise();
    expect(completedEvaluations(h.dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true },
    ]);
  });

  it('reports no setup needed when a ready provider exists', async () => {
    const h = harness({ providerStatusMap: { auggie: { available: true } } });
    await answerWorkspaceRefresh(h);
    await h.task.toPromise();
    expect(completedEvaluations(h.dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false },
    ]);
  });

  it('reports no setup needed when workspaces exist', async () => {
    const h = harness({ workspaceIds: ['ws-1'] });
    await answerWorkspaceRefresh(h);
    await h.task.toPromise();
    expect(completedEvaluations(h.dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false },
    ]);
  });

  it('stamps the evaluation with the remote connection identity', async () => {
    const h = harness({ activeId: 'remote-1' });
    await answerWorkspaceRefresh(h);
    await h.task.toPromise();
    expect(completedEvaluations(h.dispatched)).toEqual([
      { connectionId: 'remote-1', isLocal: false, setupNeeded: true },
    ]);
  });

  it('waits for the workspace list and the provider check before evaluating', async () => {
    const { channel, dispatched, task, state } = harness({
      hasLoaded: false,
      hasCheckedOnce: false,
    });
    await settle();
    // Blocked on the workspace-list refresh it requested: nothing evaluated,
    // no provider check yet.
    expect(dispatched.some((a) => a.type === loadWorkspacesRequested.type)).toBe(true);
    expect(completedEvaluations(dispatched)).toEqual([]);
    expect(dispatched.some((a) => a.type === ensureProvidersChecked.type)).toBe(false);

    state.workspace.hasLoaded = true;
    channel.put(replaceWorkspaceList([]) as never);
    await settle();
    // Now blocked on the bulk provider check it requested.
    expect(dispatched.some((a) => a.type === ensureProvidersChecked.type)).toBe(true);
    expect(completedEvaluations(dispatched)).toEqual([]);

    state.agentAvailability.hasCheckedOnce = true;
    channel.put(checkAllProvidersComplete() as never);
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true },
    ]);
  });

  it('re-requests the bulk provider check until one settles (missed-dispatch retry)', async () => {
    vi.useFakeTimers();
    try {
      const { channel, dispatched, task, state } = harness({ hasCheckedOnce: false });
      await settle();
      channel.put(replaceWorkspaceList([]) as never);
      await settle();
      const requests = () =>
        dispatched.filter((a) => a.type === ensureProvidersChecked.type).length;
      expect(requests()).toBe(1);

      // The first request was missed (no watcher yet): the retry timer fires
      // and the worker re-dispatches.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(requests()).toBe(2);

      state.agentAvailability.hasCheckedOnce = true;
      channel.put(checkAllProvidersComplete() as never);
      await task.toPromise();
      expect(completedEvaluations(dispatched)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('paces re-requests when a sweep settles without flipping hasCheckedOnce (all probes failed)', async () => {
    // Regression: an all-failed sweep dispatches checkAllProvidersComplete
    // without flipping hasCheckedOnce (it lands no statuses). The settle must
    // NOT immediately re-dispatch ensureProvidersChecked — with a fast-failing
    // provider check that becomes a zero-delay hot loop (the CI OOM in the
    // hardware-console composition test).
    vi.useFakeTimers();
    try {
      const { channel, dispatched, task, state } = harness({ hasCheckedOnce: false });
      await settle();
      channel.put(replaceWorkspaceList([]) as never);
      await settle();
      const requests = () =>
        dispatched.filter((a) => a.type === ensureProvidersChecked.type).length;
      expect(requests()).toBe(1);

      // Sweep settles all-failed: complete fires, hasCheckedOnce stays false.
      channel.put(checkAllProvidersComplete() as never);
      await settle();
      expect(requests()).toBe(1);

      // Only after the retry pause does the worker re-request.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(requests()).toBe(2);

      state.agentAvailability.hasCheckedOnce = true;
      channel.put(checkAllProvidersComplete() as never);
      await vi.advanceTimersByTimeAsync(3_000);
      await task.toPromise();
      expect(completedEvaluations(dispatched)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out an in-flight provider re-check before evaluating', async () => {
    const h = harness({
      providerLoadingMap: { auggie: true },
      providerStatusMap: { auggie: { available: true } },
    });
    await answerWorkspaceRefresh(h);
    // Blocked on the in-flight re-check.
    expect(completedEvaluations(h.dispatched)).toEqual([]);

    h.state.agentAvailability.providerLoadingMap = {};
    h.channel.put(checkAllProvidersComplete() as never);
    await h.task.toPromise();
    expect(completedEvaluations(h.dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false },
    ]);
  });
});

describe('requestReevaluation', () => {
  function run(hasCheckedOnce: boolean) {
    const channel = stdChannel();
    const dispatched: { type: string }[] = [];
    const task = runSaga(
      {
        channel,
        dispatch: (a: { type: string }) => {
          dispatched.push(a);
          return a;
        },
        getState: () => ({ agentAvailability: { hasCheckedOnce } }),
      },
      requestReevaluation,
    );
    return { dispatched, task };
  }

  it('dispatches evaluateSetupStateRequested immediately once checked', async () => {
    const { dispatched, task } = run(true);
    await task.toPromise();
    expect(dispatched.map((a) => a.type)).toEqual([evaluateSetupStateRequested.type]);
  });

  it('paces the re-evaluation while hasCheckedOnce is still false', async () => {
    // A settle without landed statuses (all probes failed) must not re-enter
    // the evaluate → ensure → sweep cycle with zero delay (hot-loop guard).
    vi.useFakeTimers();
    try {
      const { dispatched, task } = run(false);
      await Promise.resolve();
      expect(dispatched).toEqual([]);
      await vi.advanceTimersByTimeAsync(3_000);
      await task.toPromise();
      expect(dispatched.map((a) => a.type)).toEqual([evaluateSetupStateRequested.type]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('hasReadyProvider', () => {
  it('counts available + not explicitly unauthenticated as ready', () => {
    expect(hasReadyProvider({ a: { available: true } })).toBe(true);
    expect(hasReadyProvider({ a: { available: true, authenticated: true } })).toBe(true);
    expect(hasReadyProvider({ a: { available: true, authenticated: false } })).toBe(false);
    expect(hasReadyProvider({ a: { available: false } })).toBe(false);
    expect(hasReadyProvider({})).toBe(false);
  });
});
