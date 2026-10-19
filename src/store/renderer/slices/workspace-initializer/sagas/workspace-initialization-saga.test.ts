import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { take } from 'typed-redux-saga';

const mocks = vi.hoisted(() => ({
  redeem: vi.fn(),
  send: vi.fn(),
  clearLayout: vi.fn(),
}));
vi.mock('$lib/components/workspace/initializer/staged-attachments', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  redeemStagedAttachments: mocks.redeem,
  sendHeldFirstMessage: mocks.send,
}));
vi.mock('$features/layout/panel-layout-adapter', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPanelLayoutManager: () => ({ clearLayout: mocks.clearLayout }),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { appClient } from '$lib/client';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { bootstrapNewWorkspaceLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { hydrateWorkspaceNavigation } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { workspaceStorageManager } from '$store/renderer/slices/workspace/utils/workspace-storage-manager';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createMockWorkspace } from '../../../../../test/factories/workspace.factory';
import { selectWorkspaceInitializationOutcome } from '../workspace-initializer-selectors';
import {
  clearWorkspaceInitializationOutcome,
  workspaceInitializationRequested,
} from '../workspace-initializer-slice';
import type {
  WorkspaceInitializationRequest,
  WorkspaceInitializationStagedItem,
} from '../workspace-initializer-types';
import { workspaceInitializationSaga } from './workspace-initialization-saga';

const consumer = { id: 'compact-1', resourceId: 'resource-1' };
const staged: WorkspaceInitializationStagedItem[] = [
  { id: 'file-1', type: 'file', label: 'a.txt', sourcePath: '/tmp/a.txt' },
];
const placed = [{ ...staged[0], attachmentId: 'att-1', placementStatus: 'placed' as const }];
const failed = [{ ...staged[0], placementStatus: 'failed' as const, placementError: 'gone' }];
const workspace = createMockWorkspace({ id: WorkspaceId('ws-1'), worktreePath: '/wt/ws-1' });
const agentSettings = { selectedModel: 'sonnet' };

interface RecordedAction {
  type: string;
  payload?: unknown;
}

let recorded: RecordedAction[];
let stops: Array<() => void>;
let create: ReturnType<typeof vi.spyOn>;
let pull: ReturnType<typeof vi.spyOn>;
let clearState: ReturnType<typeof vi.spyOn>;

function request(overrides: Partial<WorkspaceInitializationRequest> = {}) {
  return {
    entrypoint: 'compact',
    admission: selectPrincipalActionContext.select(appStore.state) as string,
    createRequest: { title: 'Work', repositoryPath: '/repo', branch: 'main' },
    agentTitle: 'Agent',
    coordinator: false,
    stagedItems: staged,
    heldMessage: { content: 'hello', imageBlocks: [], contextReferences: [] },
    lastSubmittedAgent: agentSettings,
    ...overrides,
  } satisfies WorkspaceInitializationRequest;
}

const outcome = () =>
  selectWorkspaceInitializationOutcome.select(appStore.state, consumer.id, consumer.resourceId);
const types = () => recorded.map((action) => action.type);
const installationActionTypes = [
  setWorkspaceEntity.type,
  setInitialAgentId.type,
  bootstrapNewWorkspaceLayout.type,
  hydrateWorkspaceNavigation.type,
  openWorkspaceTab.type,
];
const created = { ok: true, data: { workspace, initialAgent: { id: 'agent-1' } } } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  const dispose = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  appStore.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  admitLegacyPrincipal();
  pull = vi.spyOn(appClient.git, 'pull').mockResolvedValue({ success: true });
  create = vi.spyOn(workspaceClient, 'create').mockResolvedValue(created);
  clearState = vi.spyOn(workspaceStorageManager, 'clearState').mockImplementation(() => {});
  mocks.redeem.mockResolvedValue({ items: placed, fileBlocks: [{ id: 'block' }], failedCount: 0 });
  mocks.send.mockResolvedValue({ sent: true });
  const recorder = appStore.runSaga(function* () {
    while (true) {
      recorded.push(
        (yield* take([
          setWorkspaceEntity,
          setInitialAgentId,
          bootstrapNewWorkspaceLayout,
          hydrateWorkspaceNavigation,
          openWorkspaceTab,
        ])) as RecordedAction,
      );
    }
  });
  stops = [recorder, appStore.runSaga(workspaceInitializationSaga), dispose];
});
afterEach(() => {
  for (const stop of stops) stop();
  vi.restoreAllMocks();
});

describe('workspaceInitializationSaga (production saga, reducer-backed store)', () => {
  it('pulls, creates with exact params, installs, and publishes a correlated success', async () => {
    mocks.redeem.mockImplementationOnce(async () => {
      expect(types()).toEqual(installationActionTypes);
      return { items: placed, fileBlocks: [{ id: 'block' }], failedCount: 0 };
    });
    const action = workspaceInitializationRequested(
      request({ pull: { repositoryPath: '/repo', branch: 'main' } }),
      consumer,
    );
    appStore.dispatch(action);

    await expect(action.promise).resolves.toEqual({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      workspacePath: '/wt/ws-1',
    });
    expect(pull.mock.calls).toEqual([['/repo', 'main']]);
    expect(create.mock.calls).toEqual([
      [
        {
          title: 'Work',
          repositoryPath: '/repo',
          branch: 'main',
          progressId: action.payload.progressId,
        },
      ],
    ]);
    expect(mocks.clearLayout).toHaveBeenCalledTimes(1);
    expect(clearState.mock.calls).toEqual([['ws-1']]);
    expect(mocks.redeem.mock.calls).toEqual([
      ['ws-1', staged, undefined, undefined, expect.any(Function)],
    ]);
    expect(mocks.send.mock.calls[0]?.slice(0, 2)).toEqual([
      {
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        content: 'hello',
        imageBlocks: [],
        contextReferences: [],
      },
      [{ id: 'block' }],
    ]);
    expect(recorded).toContainEqual(setWorkspaceEntity(workspace));
    expect(recorded).toContainEqual(setInitialAgentId('ws-1', 'agent-1'));
    expect(recorded).toContainEqual(openWorkspaceTab('ws-1'));
    expect(types()).toEqual(installationActionTypes);
    expect(
      recorded.find((a) => a.type === 'panelLayout/bootstrapNewWorkspaceLayout'),
    ).toMatchObject({
      payload: {
        wsId: 'ws-1',
        initialAgentId: 'agent-1',
        initialAgentTitle: 'Agent',
        coordinator: false,
      },
    });
    expect(recorded.find((a) => a.type === hydrateWorkspaceNavigation.type)).toMatchObject({
      payload: ['ws-1', { workspace: { id: 'ws-1' }, mainPanel: { type: 'empty' } }],
    });
    expect(outcome()).toEqual({
      ...consumer,
      seq: action.seq,
      entrypoint: 'compact',
      status: 'success',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      workspacePath: '/wt/ws-1',
      pullCompleted: true,
      stagedItems: placed,
    });
    expect(appStore.state.workspaceInitializer.lastSubmittedAgent).toEqual(agentSettings);
  });

  it('publishes a resumable attachment failure, rejects, and never creates a second time', async () => {
    mocks.redeem.mockResolvedValue({ items: failed, fileBlocks: [], failedCount: 1 });
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow('attachment-placement-failed');
    expect(create).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(outcome()).toEqual({
      ...consumer,
      seq: action.seq,
      entrypoint: 'compact',
      status: 'failure',
      stage: 'attachments',
      error: 'attachment-placement-failed',
      stagedItems: failed,
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      workspacePath: '/wt/ws-1',
    });
    expect(appStore.state.workspaceInitializer.lastSubmittedAgent).toBeNull();

    mocks.redeem.mockResolvedValue({
      items: placed,
      fileBlocks: [{ id: 'block' }],
      failedCount: 0,
    });
    const resume = workspaceInitializationRequested(
      request({
        resume: { workspaceId: 'ws-1', agentId: 'agent-1', workspacePath: '/wt/ws-1' },
        stagedItems: failed,
      }),
      consumer,
    );
    appStore.dispatch(resume);

    await expect(resume.promise).resolves.toEqual({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      workspacePath: '/wt/ws-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(mocks.redeem.mock.calls[1]?.slice(0, 2)).toEqual(['ws-1', failed]);
    expect(outcome()).toMatchObject({ seq: resume.seq, status: 'success', workspaceId: 'ws-1' });
  });

  it('remembers the base branch for the repo only once the workspace is fully created', async () => {
    const rememberBranch = { repoPath: '/repo', branch: 'feature' };
    mocks.redeem.mockResolvedValue({ items: failed, fileBlocks: [], failedCount: 1 });
    const action = workspaceInitializationRequested(request({ rememberBranch }), consumer);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow('attachment-placement-failed');
    expect(appStore.state.workspaceInitializer.branchByRepo['/repo']).toBeUndefined();

    mocks.redeem.mockResolvedValue({
      items: placed,
      fileBlocks: [{ id: 'block' }],
      failedCount: 0,
    });
    const resume = workspaceInitializationRequested(
      request({
        rememberBranch,
        resume: { workspaceId: 'ws-1', agentId: 'agent-1', workspacePath: '/wt/ws-1' },
        stagedItems: failed,
      }),
      consumer,
    );
    appStore.dispatch(resume);
    await expect(resume.promise).resolves.toMatchObject({ workspaceId: 'ws-1' });
    expect(appStore.state.workspaceInitializer.branchByRepo['/repo']).toBe('feature');
  });

  it('remembers the agent setup for the repo only once the workspace is fully created', async () => {
    const repoKey = 'github:github.com/acme/app';
    const teamSetup = {
      isTeamMode: true,
      selectedSpecialist: 'spec-writer',
      selectedProvider: 'claude-code',
      selectedModel: 'opus',
      selectedReasoningEffort: 'high',
    };
    mocks.redeem.mockResolvedValue({ items: failed, fileBlocks: [], failedCount: 1 });
    const action = workspaceInitializationRequested(
      request({ rememberAgentRepoKey: repoKey, lastSubmittedAgent: teamSetup }),
      consumer,
    );
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow('attachment-placement-failed');
    expect(appStore.state.workspaceInitializer.agentByRepo).toEqual({});

    mocks.redeem.mockResolvedValue({
      items: placed,
      fileBlocks: [{ id: 'block' }],
      failedCount: 0,
    });
    const resume = workspaceInitializationRequested(
      request({
        rememberAgentRepoKey: repoKey,
        lastSubmittedAgent: teamSetup,
        resume: { workspaceId: 'ws-1', agentId: 'agent-1', workspacePath: '/wt/ws-1' },
        stagedItems: failed,
      }),
      consumer,
    );
    appStore.dispatch(resume);
    await expect(resume.promise).resolves.toMatchObject({ workspaceId: 'ws-1' });
    expect(appStore.state.workspaceInitializer.agentByRepo).toEqual({ [repoKey]: teamSetup });
  });

  it('does not remember a per-repo agent setup when the request names no repo', async () => {
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);
    await expect(action.promise).resolves.toMatchObject({ workspaceId: 'ws-1' });
    expect(appStore.state.workspaceInitializer.lastSubmittedAgent).toEqual(agentSettings);
    expect(appStore.state.workspaceInitializer.agentByRepo).toEqual({});
  });

  it('retains redeemed files when the held first message fails', async () => {
    mocks.send.mockResolvedValue({ sent: false, errorDetail: 'send failed' });
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow('send failed');
    expect(outcome()).toMatchObject({
      seq: action.seq,
      status: 'failure',
      stage: 'first-message',
      stagedItems: placed,
    });
  });

  it('marks a successful pull when create fails so a retry does not pull again', async () => {
    create.mockResolvedValue({ ok: false, error: 'create failed' });
    const action = workspaceInitializationRequested(
      request({ pull: { repositoryPath: '/repo', branch: 'main' } }),
      consumer,
    );
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow('create failed');
    expect(outcome()).toMatchObject({
      seq: action.seq,
      status: 'failure',
      stage: 'create',
      pullCompleted: true,
    });
  });

  it('publishes an unexpected post-create delivery failure as resumable', async () => {
    mocks.redeem.mockRejectedValueOnce(new Error('placement transport failed'));
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow('placement transport failed');
    expect(outcome()).toMatchObject({
      seq: action.seq,
      status: 'failure',
      stage: 'attachments',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      workspacePath: '/wt/ws-1',
    });
  });

  it('stops post-create work after the consumer releases an in-flight outcome', async () => {
    const held = deferred<typeof created>();
    create.mockReturnValue(held.promise);
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

    appStore.dispatch(clearWorkspaceInitializationOutcome(consumer.id, action.seq));
    held.resolve(created);

    await expect(action.promise).rejects.toThrow('initialization-cancelled');
    expect(outcome()).toBeUndefined();
    expect(mocks.clearLayout).not.toHaveBeenCalled();
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it('does not install or publish for a consumer replaced during installation', async () => {
    let replacement: ReturnType<typeof workspaceInitializationRequested> | undefined;
    create.mockResolvedValueOnce(created).mockReturnValue(new Promise(() => {}));
    mocks.clearLayout.mockImplementationOnce(() => {
      replacement = workspaceInitializationRequested(request(), consumer);
      appStore.dispatch(replacement);
    });
    const action = workspaceInitializationRequested(request(), consumer);
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow('initialization-cancelled');
    expect(replacement).toBeDefined();
    expect(create).toHaveBeenCalledTimes(2);
    expect(clearState).not.toHaveBeenCalled();
    expect(types()).not.toContain(setWorkspaceEntity.type);
    expect(types()).not.toContain('panelLayout/bootstrapNewWorkspaceLayout');
    expect(types()).not.toContain(openWorkspaceTab.type);
    expect(mocks.redeem).not.toHaveBeenCalled();
    expect(outcome()).toEqual({
      ...consumer,
      seq: replacement!.seq,
      entrypoint: 'compact',
      status: 'pending',
    });
  });
});
