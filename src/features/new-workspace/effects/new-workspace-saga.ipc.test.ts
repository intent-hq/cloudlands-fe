import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveAppClient } from '$lib/client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import type { WorkspaceDraft } from '$shared/types';

import { createInitialControllerState, reduce, type ControllerState } from '../controller';
import { newWorkspaceEffectSaga, type NewWorkspaceSagaDependencies } from '.';

const durableDraft: WorkspaceDraft = {
  id: 'draft-current-newest',
  ownerClientId: 'client-current',
  revision: 3,
  phase: 'editing',
  intentText: 'survived renderer restart',
  source: null,
  contextLinks: [],
  attachments: [],
  config: {},
  operationKey: 'operation-1',
  delivery: { state: 'none' },
  createdAt: '2026-09-04T20:00:00.000Z',
  updatedAt: '2026-09-04T21:00:00.000Z',
};

describe('new workspace saga IPC recovery', () => {
  const originalInvoke = window.electronAPI!.invoke;

  beforeEach(() => {
    resetMockIpcRouter();
    window.electronAPI!.invoke = vi.fn((channel: string, payload?: unknown) =>
      mockInvoke(channel, payload),
    );
  });

  afterEach(() => {
    window.electronAPI!.invoke = originalInvoke;
    resetMockIpcRouter();
  });

  it('restores a protocol-shaped draft through the live IPC client', async () => {
    const requests: unknown[] = [];
    registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
      requests.push(payload);
      const request = payload as { method: string; params?: unknown };
      if (request.method === 'client.hello') {
        return { ok: true, result: { clientId: 'client-current' } };
      }
      if (request.method === 'workspaceDraft.list') {
        return { ok: true, result: [durableDraft] };
      }
      if (request.method === 'workspaceDraft.get') {
        return { ok: true, result: durableDraft };
      }
      throw new Error(`Unexpected backend method: ${request.method}`);
    });

    let state: ControllerState = createInitialControllerState(4);
    const dependencies: NewWorkspaceSagaDependencies = {
      client: new LiveAppClient(),
      getState: () => state,
      dispatch: (event) => {
        state = reduce(state, event);
      },
    };
    await runSaga({}, newWorkspaceEffectSaga, state, dependencies).toPromise();
    await runSaga({}, newWorkspaceEffectSaga, state, dependencies).toPromise();

    expect(requests).toEqual([
      { method: 'client.hello', params: {} },
      { method: 'workspaceDraft.list', params: {} },
      { method: 'workspaceDraft.get', params: { id: durableDraft.id } },
    ]);
    expect(state).toMatchObject({
      phase: 'editing',
      ownerClientId: 'client-current',
      draftId: durableDraft.id,
      input: { intentText: 'survived renderer restart' },
    });
  });
});
