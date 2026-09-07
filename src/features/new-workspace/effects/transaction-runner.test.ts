import { runSaga } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.useRealTimers();
});

function savedEditingState(remote: WorkspaceDraft): ControllerState {
  const input = {
    intentText: remote.intentText,
    source: remote.source,
    contextLinks: remote.contextLinks,
    attachments: remote.attachments,
    config: remote.config,
  };
  return {
    ...createInitialControllerState(7, input),
    phase: 'editing',
    draftId: remote.id,
    draft: remote,
    acknowledgedInput: input,
    acknowledgedRevision: remote.revision,
    creationIssued: true,
  } as ControllerState;
}

function sagaExecutor(
  snapshot: ControllerState,
  dependencies: Parameters<typeof newWorkspaceEffectSaga>[1],
  settled: () => void,
): () => void {
  const task = runSaga({ dispatch: vi.fn() }, function* () {
    try {
      yield* newWorkspaceEffectSaga(snapshot, dependencies);
    } finally {
      queueMicrotask(settled);
    }
  });
  return () => task.cancel();
}

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    id: 'draft-1',
    ownerClientId: 'client-1',
    revision: 1,
    phase: 'editing',
    intentText: '',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: 'operation-1',
    delivery: { state: 'none' },
    createdAt: '2026-09-04T20:00:00.000Z',
    updatedAt: '2026-09-04T20:00:00.000Z',
    ...overrides,
  };
}

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

  it('retains no listeners across 100 open-close cycles', () => {
    const lateDispatches: Array<
      (event: { type: 'backend.connected'; generation: number }) => void
    > = [];
    const cancel = vi.fn();
    const listener = vi.fn();

    for (let index = 0; index < 100; index += 1) {
      const runner = createDraftTransactionRunner({
        executeEffect: (_state, dependencies) => {
          lateDispatches.push(dependencies.dispatch);
          return cancel;
        },
      });
      runner.subscribe(listener);
      runner.start(createInitialControllerState(index));
      runner.stop();
    }
    for (const [generation, dispatch] of lateDispatches.entries()) {
      dispatch({ type: 'backend.connected', generation });
    }

    expect(listener).toHaveBeenCalledTimes(100);
    expect(cancel).toHaveBeenCalledTimes(100);
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

  it('uses the acknowledged revision and latest value for one trailing in-flight save', async () => {
    vi.useFakeTimers();
    const remote = draft();
    let resolveFirst: (value: WorkspaceDraft) => void = () => undefined;
    const firstPending = new Promise<WorkspaceDraft>((resolve) => {
      resolveFirst = resolve;
    });
    const update = vi
      .fn()
      .mockImplementationOnce(() => firstPending)
      .mockImplementationOnce((_id, _revision, input) =>
        Promise.resolve({ ...remote, ...input, revision: 3 }),
      );
    const runner = createDraftTransactionRunner({
      client: { workspaceDrafts: { update } } as unknown as AppClient,
      executeEffect: sagaExecutor,
    });
    runner.start(savedEditingState(remote));
    await vi.advanceTimersByTimeAsync(0);

    runner.dispatch({ type: 'user.edited', patch: { intentText: 'first edit' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(update).toHaveBeenNthCalledWith(
      1,
      remote.id,
      1,
      expect.objectContaining({ intentText: 'first edit' }),
    );

    runner.dispatch({ type: 'user.edited', patch: { intentText: 'latest edit' } });
    resolveFirst({ ...remote, intentText: 'first edit', revision: 2 });
    await vi.advanceTimersByTimeAsync(249);
    expect(update).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(
      2,
      remote.id,
      2,
      expect.objectContaining({ intentText: 'latest edit' }),
    );
    runner.stop();
  });

  it('flushes pending input immediately when Start is requested', async () => {
    vi.useFakeTimers();
    const remote = draft({
      id: 'draft-start',
      revision: 2,
      operationKey: 'operation-start',
    });
    const update = vi
      .fn()
      .mockImplementation((_id, _revision, input) =>
        Promise.resolve({ ...remote, ...input, revision: 3 }),
      );
    const runner = createDraftTransactionRunner({
      client: { workspaceDrafts: { update } } as unknown as AppClient,
      executeEffect: sagaExecutor,
    });
    const state = {
      ...savedEditingState(remote),
      capabilities: {
        ...savedEditingState(remote).capabilities,
        provider: 'missing' as const,
      },
    } as ControllerState;
    runner.start(state);
    await vi.advanceTimersByTimeAsync(0);
    runner.dispatch({ type: 'user.edited', patch: { intentText: 'start now' } });
    runner.dispatch({ type: 'start.requested', requiredCapabilities: ['provider'] });

    await vi.advanceTimersByTimeAsync(0);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      'draft-start',
      2,
      expect.objectContaining({ intentText: 'start now' }),
    );
  });

  it('persists ready-provider config before issuing promote', async () => {
    vi.useFakeTimers();
    const remote = draft({
      id: 'draft-ready-start',
      revision: 2,
      config: { specialist: 'spec-writer', model: 'old-model', provider: 'old-provider' },
      operationKey: 'operation-ready-start',
    });
    const callOrder: string[] = [];
    const update = vi.fn().mockImplementation((_id, _revision, input) => {
      callOrder.push('update');
      return Promise.resolve({ ...remote, ...input, revision: 3 });
    });
    const promote = vi.fn().mockImplementation(() => {
      callOrder.push('promote');
      return new Promise(() => undefined);
    });
    const runner = createDraftTransactionRunner({
      client: { workspaceDrafts: { update, promote } } as unknown as AppClient,
      executeEffect: sagaExecutor,
    });
    const state = {
      ...savedEditingState(remote),
      capabilities: { provider: 'ready', git: 'ready', node: 'ready', github: 'ready' },
    } as ControllerState;
    runner.start(state);
    await vi.advanceTimersByTimeAsync(0);

    runner.dispatch({
      type: 'user.edited',
      patch: {
        config: {
          specialist: 'implementor',
          model: 'model-latest',
          provider: 'provider-latest',
        },
      },
    });
    runner.dispatch({ type: 'start.requested', requiredCapabilities: ['provider'] });
    await vi.advanceTimersByTimeAsync(0);

    expect(callOrder).toEqual(['update', 'promote']);
    expect(update).toHaveBeenCalledWith(
      remote.id,
      2,
      expect.objectContaining({
        config: {
          specialist: 'implementor',
          model: 'model-latest',
          provider: 'provider-latest',
        },
      }),
    );
    expect(promote).toHaveBeenCalledWith(remote.id, 3, {
      prompt: '',
      specialist: 'implementor',
      model: 'model-latest',
      provider: 'provider-latest',
    });
    runner.stop();
  });

  it('flushes the latest edit immediately and releases listeners on close', async () => {
    vi.useFakeTimers();
    const remote = draft({
      id: 'draft-close',
      revision: 4,
      intentText: 'saved',
      operationKey: 'operation-close',
    });
    const update = vi
      .fn()
      .mockImplementation((_id, _revision, input) =>
        Promise.resolve({ ...remote, ...input, revision: 5 }),
      );
    const listener = vi.fn();
    const runner = createDraftTransactionRunner({
      client: { workspaceDrafts: { update } } as unknown as AppClient,
      executeEffect: sagaExecutor,
    });
    runner.subscribe(listener);
    runner.start(savedEditingState(remote));
    await vi.advanceTimersByTimeAsync(0);
    runner.dispatch({ type: 'user.edited', patch: { intentText: 'last keystroke' } });
    const callsBeforeClose = listener.mock.calls.length;

    runner.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      'draft-close',
      4,
      expect.objectContaining({ intentText: 'last keystroke' }),
    );
    expect(listener).toHaveBeenCalledTimes(callsBeforeClose);
  });

  it('contains a teardown save rejection without notifying released listeners', async () => {
    vi.useFakeTimers();
    const remote = draft({ id: 'draft-rejected-close', revision: 6 });
    const update = vi.fn().mockRejectedValue(new Error('save rejected'));
    const listener = vi.fn();
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    try {
      const runner = createDraftTransactionRunner({
        client: { workspaceDrafts: { update } } as unknown as AppClient,
        executeEffect: sagaExecutor,
      });
      runner.subscribe(listener);
      runner.start(savedEditingState(remote));
      await vi.advanceTimersByTimeAsync(0);
      runner.dispatch({ type: 'user.edited', patch: { intentText: 'reject this save' } });
      const callsBeforeClose = listener.mock.calls.length;

      runner.stop();
      await vi.advanceTimersByTimeAsync(0);

      expect(update).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledTimes(callsBeforeClose);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
    }
  });
});
