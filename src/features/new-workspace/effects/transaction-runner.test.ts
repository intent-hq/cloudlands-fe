import { runSaga } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';

import type { AppClient } from '$lib/client';
import type { WorkspaceDraft } from '$shared/types';

import { createInitialControllerState, type ControllerState } from '../controller';
import { createDraftTransactionRunner, createWorkspaceAdoption, newWorkspaceEffectSaga } from '.';

const attachmentMocks = vi.hoisted(() => ({
  redeem: vi.fn(),
  send: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/staged-attachments', () => ({
  redeemStagedAttachments: attachmentMocks.redeem,
  sendHeldFirstMessage: attachmentMocks.send,
}));

vi.mock('$lib/client/live/live-support', () => ({
  newIdempotencyKey: () => 'message-1',
}));

describe('draft transaction integration seams', () => {
  it('owns controller transitions, subscriptions, and cancellation', () => {
    let effectDispatch:
      ((event: { type: 'backend.connected'; generation: number }) => void) | null = null;
    const cancel = vi.fn();
    const executeEffect = vi.fn((_state, dependencies, settled) => {
      effectDispatch = dependencies.dispatch;
      queueMicrotask(settled);
      return cancel;
    });
    const observed: ControllerState[] = [];
    const runner = createDraftTransactionRunner({ executeEffect });
    runner.subscribe((state) => observed.push(state));

    runner.start(createInitialControllerState(7));
    effectDispatch?.({ type: 'backend.connected', generation: 7 });

    expect(observed.map(({ phase }) => phase)).toEqual(['boot', 'pristine']);
    expect(executeEffect).toHaveBeenCalledTimes(1);
    runner.stop();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('hands the complete adoption action set to one synchronous batch', async () => {
    const dispatch = vi.fn();
    const adopt = createWorkspaceAdoption({ dispatch });

    await adopt({
      workspace: {
        id: 'amber-forest',
        title: 'Untitled',
        status: 'active',
        contextLinks: [],
        createdAt: '2026-09-04T20:00:00.000Z',
        updatedAt: '2026-09-04T20:00:00.000Z',
      },
      initialAgent: {
        id: 'agent-1',
        workspaceId: 'amber-forest',
        name: 'Coordinator',
        status: 'idle',
      },
      operationKey: 'operation-1',
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ type: 'renderer/batchActions' });
    expect(
      (dispatch.mock.calls[0]?.[0].payload as Array<{ type: string }>).map((action) => action.type),
    ).toEqual([
      'workspace/setWorkspaceEntity',
      'workspaceAgents/setInitialAgentId',
      'agentSessions/bulkUpsertSessions',
      'panelLayout/bootstrapNewWorkspaceLayout',
      'workspaceNavigation/hydrateWorkspaceNavigation',
      'tabState/openWorkspaceTab',
      'workspaceCreateProgress/clear',
    ]);
  });

  it('delivers the first message before live-phase route teardown stops the runner', async () => {
    const input = {
      intentText: 'Build it',
      source: null,
      contextLinks: [],
      attachments: [],
      config: {},
    };
    const draft: WorkspaceDraft = {
      id: 'draft-1',
      ownerClientId: 'client-1',
      revision: 1,
      phase: 'promoted',
      intentText: input.intentText,
      source: null,
      contextLinks: [],
      attachments: [],
      config: {},
      operationKey: 'operation-1',
      delivery: { state: 'none' },
      promotedWorkspaceId: 'amber-forest',
      createdAt: '2026-09-04T20:00:00.000Z',
      updatedAt: '2026-09-04T20:00:00.000Z',
    };
    const client = {
      workspaceDrafts: {
        get: vi.fn().mockResolvedValue(draft),
        markDelivery: vi.fn().mockResolvedValue(draft),
        delete: vi.fn().mockResolvedValue({ deleted: true }),
      },
      workspaces: {
        get: vi.fn().mockResolvedValue({
          id: 'amber-forest',
          title: 'Untitled',
          status: 'active',
          contextLinks: [],
          createdAt: '2026-09-04T20:00:00.000Z',
          updatedAt: '2026-09-04T20:00:00.000Z',
        }),
      },
      agents: {
        get: vi.fn().mockResolvedValue({
          id: 'agent-1',
          workspaceId: 'amber-forest',
          name: 'Coordinator',
          status: 'idle',
        }),
      },
    } as unknown as AppClient;
    attachmentMocks.send.mockResolvedValue({ sent: true, messageId: 'message-1' });
    const state = {
      ...createInitialControllerState(3, input),
      phase: 'adopting',
      draftId: draft.id,
      draft,
      acknowledgedInput: input,
      acknowledgedRevision: draft.revision,
      creationIssued: true,
      workspaceId: 'amber-forest',
      initialAgentId: 'agent-1',
    } as ControllerState;
    const phases: string[] = [];
    const runner = createDraftTransactionRunner({
      client,
      adopt: createWorkspaceAdoption({ dispatch: vi.fn() }),
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
    runner.subscribe((next) => {
      phases.push(next.phase);
      if (next.phase === 'live') runner.stop();
    });

    runner.start(state);

    await vi.waitFor(() => expect(attachmentMocks.send).toHaveBeenCalledOnce());
    expect(phases).toContain('sending');
    expect(phases.at(-1)).toBe('live');
  });
});
