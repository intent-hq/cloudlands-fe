import { runSaga } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppClient } from '$lib/client';
import type { WorkspaceDraft } from '$shared/types';
import { createInitialControllerState, type ControllerState } from '../controller';
import { createDraftTransactionRunner, newWorkspaceEffectSaga } from '.';

const remote: WorkspaceDraft = {
  id: 'draft-measurement',
  ownerClientId: 'client-1',
  revision: 1,
  phase: 'editing',
  intentText: '',
  source: null,
  contextLinks: [],
  attachments: [],
  config: {},
  operationKey: 'operation-measurement',
  delivery: { state: 'none' },
  createdAt: '2026-09-04T20:00:00.000Z',
  updatedAt: '2026-09-04T20:00:00.000Z',
};

function savedState(): ControllerState {
  const input = {
    intentText: remote.intentText,
    source: remote.source,
    contextLinks: remote.contextLinks,
    attachments: remote.attachments,
    config: remote.config,
  };
  return {
    ...createInitialControllerState(1, input),
    phase: 'editing',
    draftId: remote.id,
    draft: remote,
    acknowledgedInput: input,
    acknowledgedRevision: remote.revision,
    creationIssued: true,
    capabilities: { provider: 'ready', git: 'ready', node: 'ready', github: 'ready' },
  } as ControllerState;
}

afterEach(() => vi.useRealTimers());

describe('draft update coalescing measurement', () => {
  it('issues one final-value RPC for 100 rapid edits', async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockImplementation((_id, revision, input) =>
      Promise.resolve({
        ...remote,
        ...input,
        revision: revision + 1,
      }),
    );
    const runner = createDraftTransactionRunner({
      client: { workspaceDrafts: { update } } as unknown as AppClient,
      executeEffect: (snapshot, dependencies, settled) => {
        const task = runSaga({}, function* () {
          try {
            yield* newWorkspaceEffectSaga(snapshot, dependencies);
          } finally {
            queueMicrotask(settled);
          }
        });
        return () => task.cancel();
      },
    });
    runner.start(savedState());
    await vi.advanceTimersByTimeAsync(0);

    for (let index = 1; index <= 100; index += 1) {
      runner.dispatch({ type: 'user.edited', patch: { intentText: 'x'.repeat(index) } });
    }
    await vi.advanceTimersByTimeAsync(500);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      remote.id,
      remote.revision,
      expect.objectContaining({ intentText: 'x'.repeat(100) }),
    );
    runner.stop();
  });
});
