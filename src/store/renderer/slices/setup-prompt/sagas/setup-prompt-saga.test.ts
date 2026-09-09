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
import {
  evaluateSetupStateWorker,
  requestReevaluation,
  setupPromptSaga,
} from './setup-prompt-saga';

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
      windowBackendId: opts.activeId ?? LOCAL_CONNECTION_ID,
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
    // Blocked on the workspace-list refresh it requested: nothing evaluated.
    expect(dispatched.some((a) => a.type === loadWorkspacesRequested.type)).toBe(true);
    expect(completedEvaluations(dispatched)).toEqual([]);

    state.workspace.hasLoaded = true;
    channel.put(replaceWorkspaceList([]) as never);
    await settle();
    // Setup requests exactly one bounded provider check and waits for it.
    expect(dispatched.filter((a) => a.type === ensureProvidersChecked.type)).toHaveLength(1);
    expect(completedEvaluations(dispatched)).toEqual([]);

    state.agentAvailability.hasCheckedOnce = true;
    channel.put(checkAllProvidersComplete() as never);
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true },
    ]);
  });

  it('stops after an all-failed provider attempt without evaluating or retrying', async () => {
    const h = harness({ hasCheckedOnce: false });
    await answerWorkspaceRefresh(h);

    h.channel.put(checkAllProvidersComplete() as never);
    await h.task.toPromise();

    expect(completedEvaluations(h.dispatched)).toEqual([]);
    expect(h.dispatched.map((action) => action.type)).toEqual([
      loadWorkspacesRequested.type,
      ensureProvidersChecked.type,
    ]);
  });

  it('bounds the wait when the initial provider attempt never settles', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ hasCheckedOnce: false });
      await answerWorkspaceRefresh(h);
      await vi.advanceTimersByTimeAsync(15_000);
      await h.task.toPromise();

      expect(completedEvaluations(h.dispatched)).toEqual([]);
      expect(h.dispatched.map((action) => action.type)).toEqual([
        loadWorkspacesRequested.type,
        ensureProvidersChecked.type,
      ]);
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

  it('does not re-evaluate after an all-failed provider attempt', async () => {
    const { dispatched, task } = run(false);
    await task.toPromise();
    expect(dispatched).toEqual([]);
  });
});

describe('setupPromptSaga', () => {
  it('single-flights repeated requests and retains one trailing evaluation', async () => {
    const originalElectronApi = window.electronAPI;
    let emit!: (payload: { status: string }) => void;
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn((_channel, handler) => {
        emit = handler;
        return 'setup-listener';
      }),
      offById: vi.fn(),
    };
    const channel = stdChannel();
    const dispatched: { type: string; payload?: unknown }[] = [];
    const state = {
      connections: {
        ...connectionsInitialState,
        connections: createCollection<ConnectionRecord, 'id'>('id', [LOCAL]),
        windowBackendId: LOCAL_CONNECTION_ID,
      },
      workspace: {
        hasLoaded: true,
        workspaces: createCollection<{ id: string }, 'id'>('id'),
        recency: {},
      },
      agentAvailability: {
        providerStatusMap: { auggie: { available: true } },
        providerLoadingMap: {},
        hasCheckedOnce: true,
      },
    };
    const dispatch = (action: { type: string; payload?: unknown }) => {
      dispatched.push(action);
      channel.put(action as never);
      return action;
    };
    const task = runSaga(
      { channel, dispatch: dispatch as never, getState: () => state },
      setupPromptSaga,
    );

    try {
      await settle();
      const workspaceLoads = () =>
        dispatched.filter((action) => action.type === loadWorkspacesRequested.type).length;
      expect(workspaceLoads()).toBe(1);

      emit({ status: 'connected' });
      channel.put(evaluateSetupStateRequested() as never);
      channel.put(evaluateSetupStateRequested() as never);
      await settle();
      expect(workspaceLoads()).toBe(1);

      channel.put(replaceWorkspaceList([]) as never);
      await settle();
      expect(workspaceLoads()).toBe(2);

      channel.put(replaceWorkspaceList([]) as never);
      await settle();
      expect(completedEvaluations(dispatched)).toHaveLength(2);
    } finally {
      task.cancel();
      await task.toPromise();
      window.electronAPI = originalElectronApi;
    }
  });
});

describe('hasReadyProvider', () => {
  it.each([undefined, false, true])(
    'requires confirmed Antigravity auth=%s without changing other providers',
    (authenticated) => {
      expect(hasReadyProvider({ antigravity: { available: true, authenticated } })).toBe(
        authenticated === true,
      );
      expect(
        hasReadyProvider({
          antigravity: { available: true, authenticated },
          codex: { available: true },
        }),
      ).toBe(true);
    },
  );
  it('counts available + not explicitly unauthenticated as ready', () => {
    expect(hasReadyProvider({ a: { available: true } })).toBe(true);
    expect(hasReadyProvider({ a: { available: true, authenticated: true } })).toBe(true);
    expect(hasReadyProvider({ a: { available: true, authenticated: false } })).toBe(false);
    expect(hasReadyProvider({ a: { available: false } })).toBe(false);
    expect(hasReadyProvider({})).toBe(false);
  });
});
