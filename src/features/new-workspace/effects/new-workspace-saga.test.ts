import { runSaga } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppClient } from '$lib/client';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type { WorkspaceDraft } from '$shared/types';

import {
  createInitialControllerState,
  reduce,
  type ControllerEvent,
  type ControllerState,
} from '../controller';
import { FIXED_IDS, FIXED_TIMESTAMP } from '../sandbox/scenarios';
import {
  createWorkspaceAdoption,
  newWorkspaceEffectSaga,
  type NewWorkspaceSagaDependencies,
} from '.';

const attachmentMocks = vi.hoisted(() => ({
  redeem: vi.fn(),
  send: vi.fn(),
}));

vi.mock('$lib/components/workspace/initializer/staged-attachments', () => ({
  redeemStagedAttachments: attachmentMocks.redeem,
  sendHeldFirstMessage: attachmentMocks.send,
}));

vi.mock('$lib/client/live/live-support', () => ({
  newIdempotencyKey: () => FIXED_IDS.message,
}));

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    id: FIXED_IDS.draft,
    ownerClientId: 'client-1',
    revision: 1,
    phase: 'editing',
    intentText: '',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: FIXED_IDS.operation,
    delivery: { state: 'none' },
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    ...overrides,
  };
}

function baseState(remote = draft()): ControllerState {
  return {
    ...createInitialControllerState(3),
    phase: 'editing',
    draftId: remote.id,
    draft: remote,
    input: {
      title: remote.title,
      intentText: remote.intentText,
      source: remote.source,
      contextLinks: remote.contextLinks,
      attachments: remote.attachments,
      config: remote.config,
    },
    acknowledgedInput: {
      title: remote.title,
      intentText: remote.intentText,
      source: remote.source,
      contextLinks: remote.contextLinks,
      attachments: remote.attachments,
      config: remote.config,
    },
    acknowledgedRevision: remote.revision,
    creationIssued: true,
  };
}

function client(
  overrides: {
    workspaceDrafts?: Partial<AppClient['workspaceDrafts']>;
    workspaces?: Partial<AppClient['workspaces']>;
    agents?: Partial<AppClient['agents']>;
  } = {},
): AppClient {
  return {
    workspaceDrafts: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      promote: vi.fn(),
      markDelivery: vi.fn(),
      delete: vi.fn(),
      ...overrides.workspaceDrafts,
    },
    workspaces: { get: vi.fn(), ...overrides.workspaces },
    agents: { get: vi.fn(), getConversation: vi.fn(), ...overrides.agents },
  } as unknown as AppClient;
}

async function execute(
  state: ControllerState,
  appClient: AppClient,
  reduxDispatch = vi.fn(),
): Promise<{ state: ControllerState; events: ControllerEvent[] }> {
  let current = state;
  const events: ControllerEvent[] = [];
  const dependencies: NewWorkspaceSagaDependencies = {
    client: appClient,
    getState: () => current,
    dispatch: (event) => {
      events.push(event);
      current = reduce(current, event);
    },
    adopt: createWorkspaceAdoption({
      dispatch: reduxDispatch,
      navigate: vi.fn(),
    }),
    saveDebounceMs: 0,
  };
  await runSaga(
    { dispatch: reduxDispatch, getState: () => ({}) },
    newWorkspaceEffectSaga,
    current,
    dependencies,
  ).toPromise();
  return { state: current, events };
}

describe('newWorkspaceEffectSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores the oldest daemon draft when a fresh renderer has no local draft id', async () => {
    const durable = draft({ intentText: 'survived restart' });
    const list = vi.fn().mockResolvedValue([durable]);
    const get = vi.fn().mockResolvedValue(durable);
    const appClient = client({ workspaceDrafts: { list, get } });

    const identified = await execute(createInitialControllerState(3), appClient);
    expect(identified.state).toMatchObject({ phase: 'restoring', draftId: durable.id });

    const restored = await execute(identified.state, appClient);
    expect(get).toHaveBeenCalledWith(durable.id);
    expect(restored.state).toMatchObject({
      phase: 'editing',
      input: { intentText: 'survived restart' },
    });
  });

  it('sends the acknowledged revision and adopts the daemon draft on conflict', async () => {
    const remote = draft({ revision: 2, intentText: 'remote' });
    const update = vi.fn().mockRejectedValue(
      new BackendError({
        code: 'CONFLICT',
        message: 'revision conflict',
        rpcCode: -32009,
        data: { current: remote },
      }),
    );
    const state = {
      ...baseState(),
      input: { ...baseState().input, intentText: 'local' },
      inputVersion: 1,
    } as ControllerState;

    const result = await execute(state, client({ workspaceDrafts: { update } }));

    expect(update).toHaveBeenCalledWith(FIXED_IDS.draft, 1, {
      intentText: 'local',
      source: null,
      contextLinks: [],
      attachments: [],
      config: {},
    });
    expect(result.state).toMatchObject({ phase: 'conflict', remote });
  });

  it('reconciles a lost promotion acknowledgement before making another promote call', async () => {
    const promoted = draft({
      revision: 2,
      phase: 'promoted',
      promotedWorkspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
    });
    const promote = vi.fn().mockRejectedValue(new Error('socket closed'));
    const get = vi.fn().mockResolvedValue(promoted);
    const appClient = client({ workspaceDrafts: { promote, get } });
    const state = {
      ...baseState(),
      phase: 'promoting',
      operationKey: FIXED_IDS.operation,
      promoteAttempt: 'not-issued',
    } as ControllerState;

    const first = await execute(state, appClient);
    expect(first.state).toMatchObject({ phase: 'promoting', promoteAttempt: 'ack-lost' });

    const second = await execute(first.state, appClient);
    expect(get).toHaveBeenCalledWith(FIXED_IDS.draft);
    expect(promote).toHaveBeenCalledTimes(1);
    expect(second.state).toMatchObject({
      phase: 'adopting',
      workspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
    });
  });

  it('finalizes an incomplete durable reservation without creating another workspace', async () => {
    const reserved = draft({
      revision: 2,
      phase: 'failed',
      promotedWorkspaceId: FIXED_IDS.workspace,
    });
    const finalized = draft({
      revision: 3,
      phase: 'promoted',
      promotedWorkspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
    });
    const promote = vi.fn().mockResolvedValue({
      draft: finalized,
      workspace: { id: FIXED_IDS.workspace },
      initialAgent: { id: FIXED_IDS.agent },
    });
    const appClient = client({
      workspaceDrafts: { get: vi.fn().mockResolvedValue(reserved), promote },
    });
    const state = {
      ...baseState(),
      phase: 'promoting',
      operationKey: FIXED_IDS.operation,
      promoteAttempt: 'ack-lost',
    } as ControllerState;

    const result = await execute(state, appClient);

    expect(promote).toHaveBeenCalledWith(FIXED_IDS.draft, 2, {
      prompt: '',
      specialist: 'spec-writer',
    });
    expect(result.state).toMatchObject({
      phase: 'adopting',
      workspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
    });
  });

  it('never reissues promotion for a promoted draft whose workspace id is missing', async () => {
    const promote = vi.fn();
    const get = vi.fn().mockResolvedValue(draft({ revision: 2, phase: 'promoted' }));
    const state = {
      ...baseState(),
      phase: 'promoting',
      operationKey: FIXED_IDS.operation,
      promoteAttempt: 'ack-lost',
    } as ControllerState;

    const result = await execute(state, client({ workspaceDrafts: { get, promote } }));

    expect(promote).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      phase: 'failed',
      kind: 'promote',
      error: 'Promoted draft has no workspace',
    });
  });

  it('atomically seeds workspace, agent, layout, navigation, tab, and route before delivery', async () => {
    const workspace = {
      id: FIXED_IDS.workspace,
      title: 'Untitled',
      status: 'active',
      contextLinks: [],
      setupResult: { state: 'succeeded', exitCode: 0 },
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    } as Awaited<ReturnType<AppClient['workspaces']['get']>>;
    const agent = {
      id: FIXED_IDS.agent,
      workspaceId: FIXED_IDS.workspace,
      name: 'Coordinator',
      status: 'idle',
    } as Awaited<ReturnType<AppClient['agents']['get']>>;
    const reduxDispatch = vi.fn();
    const state = {
      ...baseState(),
      phase: 'adopting',
      workspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
      input: { ...baseState().input, intentText: 'Build it' },
    } as ControllerState;

    const result = await execute(
      state,
      client({
        workspaces: { get: vi.fn().mockResolvedValue(workspace) },
        agents: { get: vi.fn().mockResolvedValue(agent) },
      }),
      reduxDispatch,
    );

    expect(reduxDispatch).toHaveBeenCalledOnce();
    const transaction = reduxDispatch.mock.calls[0][0];
    expect(transaction.type).toBe('renderer/batchActions');
    expect(transaction.payload.map((action: { type: string }) => action.type)).toEqual([
      'workspace/setWorkspaceEntity',
      'workspaceAgents/setInitialAgentId',
      'agentSessions/bulkUpsertSessions',
      'panelLayout/bootstrapNewWorkspaceLayout',
      'workspaceNavigation/hydrateWorkspaceNavigation',
      'tabState/openWorkspaceTab',
      'workspaceCreateProgress/clear',
    ]);
    expect(transaction.payload[0].payload[0]).toEqual(workspace);
    expect(result.state).toMatchObject({ phase: 'sending', workspaceId: FIXED_IDS.workspace });
  });

  it('marks an uncertain send unknown, then reconciles the stable id without resending', async () => {
    const markDelivery = vi.fn().mockResolvedValue(draft());
    const remove = vi.fn().mockResolvedValue({ deleted: true });
    const get = vi
      .fn()
      .mockResolvedValue(draft({ delivery: { state: 'unknown', messageId: FIXED_IDS.message } }));
    const getConversation = vi.fn().mockResolvedValue({
      messages: [{ id: 'server-id', appMessageId: FIXED_IDS.message }],
      truncated: false,
      totalMessages: 1,
      nextToken: null,
      prevToken: null,
    });
    const appClient = client({
      workspaceDrafts: { markDelivery, delete: remove, get },
      agents: { getConversation },
    });
    attachmentMocks.send.mockResolvedValue({
      sent: false,
      deliveryUnknown: true,
      errorDetail: 'socket closed',
    });
    const state = {
      ...baseState(),
      phase: 'sending',
      workspaceId: FIXED_IDS.workspace,
      initialAgentId: FIXED_IDS.agent,
      deliveryStage: 'ready',
      input: { ...baseState().input, intentText: 'Build it' },
    } as ControllerState;

    const first = await execute(state, appClient);
    expect(markDelivery.mock.calls.map(([, delivery]) => delivery)).toEqual([
      { state: 'pending', messageId: FIXED_IDS.message },
      { state: 'unknown', messageId: FIXED_IDS.message, error: 'socket closed' },
    ]);
    expect(first.state).toMatchObject({ phase: 'sending', deliveryStage: 'unknown' });

    const second = await execute(first.state, appClient);
    expect(getConversation).toHaveBeenCalledWith(FIXED_IDS.agent, 200);
    expect(attachmentMocks.send).toHaveBeenCalledTimes(1);
    expect(markDelivery).toHaveBeenLastCalledWith(FIXED_IDS.draft, {
      state: 'sent',
      messageId: FIXED_IDS.message,
    });
    expect(remove).toHaveBeenCalledWith(FIXED_IDS.draft);
    expect(second.state.phase).toBe('live');
  });

  it('retries only attachment placements that did not finish', async () => {
    const firstAttachment = { id: 'file-1', type: 'file', label: 'one.txt', sourcePath: '/one' };
    const secondAttachment = { id: 'file-2', type: 'file', label: 'two.txt', sourcePath: '/two' };
    let current = draft({ attachments: [firstAttachment, secondAttachment] });
    const get = vi.fn(async () => current);
    const update = vi.fn(async (_id, _revision, patch) => {
      current = { ...current, ...patch, revision: current.revision + 1 };
      return current;
    });
    attachmentMocks.redeem
      .mockResolvedValueOnce({
        items: [{ ...firstAttachment, attachmentId: 'placed-1' }],
        fileBlocks: [],
        failedCount: 0,
      })
      .mockResolvedValueOnce({
        items: [{ ...secondAttachment, placementError: 'copy failed' }],
        fileBlocks: [],
        failedCount: 1,
      })
      .mockResolvedValueOnce({
        items: [{ ...secondAttachment, attachmentId: 'placed-2' }],
        fileBlocks: [],
        failedCount: 0,
      });
    const appClient = client({ workspaceDrafts: { get, update } });
    const state = {
      ...baseState(current),
      phase: 'placingAttachments',
      workspaceId: FIXED_IDS.workspace,
      pendingAttachmentIds: ['file-1', 'file-2'],
    } as ControllerState;

    const first = await execute(state, appClient);
    expect(first.state).toMatchObject({
      phase: 'failed',
      kind: 'attachments',
      retryState: { pendingAttachmentIds: ['file-2'] },
    });

    const retry = reduce(first.state, { type: 'retry' });
    const second = await execute(retry, appClient);
    expect(attachmentMocks.redeem.mock.calls.map(([, [item]]) => item.id)).toEqual([
      'file-1',
      'file-2',
      'file-2',
    ]);
    expect(second.state.phase).toBe('sending');
  });
});
