/**
 * Setup Prompt Saga Tests
 */

import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { ConnectionRecord } from '../../connections/connections-types';
import { initialState as connectionsInitialState } from '../../connections/connections-slice';
import {
  checkAllProvidersComplete,
  ensureProvidersChecked,
} from '../../agent-availability/agent-availability-slice';
import { setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { setupEvaluationCompleted } from '../setup-prompt-slice';
import { hasReadyProvider } from '../setup-prompt-utils';
import { evaluateSetupStateWorker } from './setup-prompt-saga';

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
      providerLoadingMap: {},
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
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function completedEvaluations(dispatched: { type: string; payload?: unknown }[]) {
  return dispatched
    .filter((a) => a.type === setupEvaluationCompleted.type)
    .map((a) => (a.payload as unknown[])[0]);
}

describe('evaluateSetupStateWorker', () => {
  it('reports setupNeeded for an empty backend with no ready providers', async () => {
    const { dispatched, task } = harness({
      providerStatusMap: { auggie: { available: false } },
    });
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true },
    ]);
  });

  it('reports no setup needed when a ready provider exists', async () => {
    const { dispatched, task } = harness({
      providerStatusMap: { auggie: { available: true } },
    });
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false },
    ]);
  });

  it('reports no setup needed when workspaces exist', async () => {
    const { dispatched, task } = harness({ workspaceIds: ['ws-1'] });
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: false },
    ]);
  });

  it('stamps the evaluation with the remote connection identity', async () => {
    const { dispatched, task } = harness({ activeId: 'remote-1' });
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: 'remote-1', isLocal: false, setupNeeded: true },
    ]);
  });

  it('waits for the workspace list and the provider check before evaluating', async () => {
    const { channel, dispatched, task, state } = harness({
      hasLoaded: false,
      hasCheckedOnce: false,
    });
    await settle();
    // Blocked on the workspace list: nothing evaluated, no provider check yet.
    expect(completedEvaluations(dispatched)).toEqual([]);
    expect(dispatched.some((a) => a.type === ensureProvidersChecked.type)).toBe(false);

    state.workspace.hasLoaded = true;
    channel.put(setWorkspaceHasLoaded(true) as never);
    await settle();
    // Now blocked on the bulk provider check it requested.
    expect(dispatched.some((a) => a.type === ensureProvidersChecked.type)).toBe(true);
    expect(completedEvaluations(dispatched)).toEqual([]);

    channel.put(checkAllProvidersComplete() as never);
    await task.toPromise();
    expect(completedEvaluations(dispatched)).toEqual([
      { connectionId: LOCAL_CONNECTION_ID, isLocal: true, setupNeeded: true },
    ]);
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
