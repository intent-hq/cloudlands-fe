import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  toastError: vi.fn(),
  backendRequest: vi.fn(),
}));
vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: mocks.createAgent },
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import type { AgentSession, Note, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';
import { agentSessionLaunchAgentRequested } from '../../agent-session/agent-session-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  initialState as specialistsInitialState,
  type FileSpecialist,
} from '../../specialists/specialists-slice';
import {
  createAgentFromConfigRequested,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  delegateExistingTaskRequested,
  runAgentForNoteRequested,
} from '../workspace-agents-slice';
import { agentCreationSaga } from './agent-creation-saga';

const WS = 'ws-create-saga';
const AGENT = 'agent-created';
const NOTE = 'note-task-1';
const settle = async () => {
  await vi.dynamicImportSettled();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function session(): AgentSession {
  return {
    id: AGENT,
    backendSessionId: `backend-${AGENT}`,
    workspaceId: WS,
    name: 'Created Agent',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as AgentSession;
}

function state(
  defaultSpecialistId = '',
  fileSpecialists: FileSpecialist[] = [],
  activeProviderId = 'augment',
  providerModels: Record<string, string> = { augment: 'sonnet' },
) {
  const workspace = { id: WS, title: 'Workspace', repositoryPath: '/tmp/repo' } as Workspace;
  const note = { id: NOTE, title: 'Task note', content: 'Do the thing' } as Note;
  return {
    workspace: { workspaces: { ids: [WS], map: { [WS]: workspace } } },
    workspaceAgents: { byWorkspaceId: { [WS]: { agentIds: [] } } },
    agentSessions: { byAgentId: {} },
    model: { providerModels, defaultProviderId: activeProviderId },
    providerSettings: {},
    specialists: {
      ...specialistsInitialState,
      defaultSpecialistId,
      fileSpecialists: createCollection<FileSpecialist, 'id'>('id', fileSpecialists),
    },
    workspaceNotes: {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [note]) } },
    },
    githubAuth: { isAuthenticated: false },
  };
}

function start(getState: () => unknown = state) {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    {
      channel,
      getState,
      dispatch: (action) => {
        dispatched.push(action);
        channel.put(action);
        return action;
      },
    },
    agentCreationSaga,
  );
  return { channel, dispatched, task };
}

describe('agentCreationSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('routes the fire-and-forget create trigger through agentFactory with server-minted identity', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: WS, repositoryPath: '/tmp/repo' }),
      expect.objectContaining({
        workspaceId: WS,
        source: 'keyboard-shortcut',
        agentType: 'chat',
        nameExplicitlySet: false,
      }),
    );
    expect(mocks.createAgent.mock.calls[0][1]).not.toHaveProperty('agentId');
    task.cancel();
    await task.toPromise();
  });

  it('pairs a blank agent model with its selected Claude provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() =>
      state('', [], 'claude-code', { 'claude-code': 'opus-4-1' }),
    );
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'opus-4-1',
        provider: 'claude-code',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('pairs General specialist-picker creation with the selected Claude provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() =>
      state('', [], 'claude-code', { 'claude-code': 'opus-4-1' }),
    );
    channel.put(createAgentWithSpecialistRequested(WS, null));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: 'opus-4-1',
        provider: 'claude-code',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('omits an inherited specialist preview while preserving its pinned provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const inherited: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude with an inherited model',
      codingAgent: 'claude-code',
      model: '',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('', [inherited]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'claude-code', model: undefined }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('splits a legacy compound specialist model into a bare model + owning provider', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude Opus',
      codingAgent: 'claude-code',
      model: 'claude-code:opus-4-1',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
    };
    const { channel, task } = start(() => state('', [pinned]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'claude-code',
        model: 'opus-4-1',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('passes a bare specialist frontmatter model through with its coding agent', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'claude-reviewer',
      name: 'Claude Reviewer',
      description: 'Pinned to Claude Opus',
      codingAgent: 'claude-code',
      model: 'opus-4-1',
      behaviorPrompt: 'Review changes.',
      filePath: '/tmp/claude-reviewer.md',
      source: 'user',
    };
    const { channel, task } = start(() => state('', [pinned]));
    channel.put(createAgentWithSpecialistRequested(WS, 'claude-reviewer'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'claude-code',
        model: 'opus-4-1',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens created agents in the panel captured by the creation trigger', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    channel.put(
      createAgentRequested(WS, undefined, {
        panelLayoutId: 'layout-1',
        panelId: 'working-panel',
      }),
    );
    await settle();

    expect(dispatched).toContainEqual(
      openAgentTabRequested(WS, {
        agentId: AGENT,
        panelLayoutId: 'layout-1',
        targetPanelId: 'working-panel',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens specialist agents in the panel captured by the creation trigger', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    channel.put(
      createAgentWithSpecialistRequested(WS, null, {
        panelLayoutId: 'layout-1',
        panelId: 'working-panel',
      }),
    );
    await settle();

    expect(dispatched).toContainEqual(
      openAgentTabRequested(WS, {
        agentId: AGENT,
        panelLayoutId: 'layout-1',
        targetPanelId: 'working-panel',
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a safe localized error when fire-and-forget creation fails', async () => {
    mocks.createAgent.mockResolvedValue({
      success: false,
      error: 'backend rejected request with secret details',
    });
    const { channel, task } = start();
    channel.put(createAgentRequested(WS));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to create agent', {
      description: 'Check your provider setup and selected model in Settings, then try again.',
    });
    expect(JSON.stringify(mocks.toastError.mock.calls)).not.toContain('secret details');
    task.cancel();
    await task.toPromise();
  });

  it('gives provider and model guidance for a confirmed mismatch', async () => {
    mocks.createAgent.mockResolvedValue({
      success: false,
      error: 'agent.create: model fable-5 does not belong to provider claude-code',
    });
    const { channel, task } = start();
    channel.put(createAgentWithSpecialistRequested(WS, null));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to create agent', {
      description:
        'The selected model does not belong to this provider. Choose a model for this provider in Settings, then try again.',
    });
    task.cancel();
    await task.toPromise();
  });

  it('settles create-from-config success and preserves launch options', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    const action = createAgentFromConfigRequested(
      WS,
      {
        name: 'Configured',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      },
      { openAgent: true, panelId: 'panel-1' },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: action.success(session()).type }),
        expect.objectContaining({ type: 'panelLayout/openTab' }),
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('routes adjacent created agents through the rightmost configured column', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, dispatched, task } = start();
    const action = createAgentFromConfigRequested(
      WS,
      {
        name: 'Configured',
        workspaceId: WorkspaceId(WS),
        agentType: createAgentTypeId('chat'),
        source: 'test',
      },
      { openAgent: true, openInAdjacentPanel: true },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: expect.objectContaining({
          wsId: WS,
          tab: expect.objectContaining({ type: 'agent', agentId: AGENT }),
        }),
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('chains launch through create-from-config and settles both actions', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    const action = agentSessionLaunchAgentRequested(
      WS,
      { name: 'Launch', agentType: createAgentTypeId('chat'), source: 'test' },
      { openAgent: false },
    );
    channel.put(action);

    await expect(action.promise).resolves.toEqual(session());
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'sonnet', provider: 'augment' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('surfaces create-from-config failures and still rejects its promise', async () => {
    mocks.createAgent.mockResolvedValue({ success: false, error: 'request failed' });
    const { channel, task } = start();
    const action = createAgentFromConfigRequested(WS, {
      name: 'Configured',
      workspaceId: WorkspaceId(WS),
      agentType: createAgentTypeId('chat'),
      source: 'test',
    });
    channel.put(action);

    await expect(action.promise).rejects.toThrow('request failed');
    expect(mocks.toastError).toHaveBeenCalledOnce();
    task.cancel();
    await task.toPromise();
  });

  it('runs a task note with the daemon specialists.default setting when set', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() => state('verifier'));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: WS }),
      expect.objectContaining({
        agentType: 'task-loop',
        source: 'task-metadata-bar-run',
        provider: 'augment',
        model: undefined,
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'verifier' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is unset', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start();
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('builds the initial message from cached content without fetching for a full row', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const get = vi.spyOn(appClient.notes, 'get');
    const { channel, task } = start();
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).not.toHaveBeenCalled();
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('Do the thing') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('fetches the full note before building the initial message for a stale slim row', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const slimState = state();
    const slimNote = {
      id: NOTE,
      workspaceId: WS,
      title: 'Task note',
      content: '',
      contentPreview: 'Do the',
      contentLength: 12,
    } as Note;
    slimState.workspaceNotes = {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [slimNote]) } },
    };
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockResolvedValue({ ...slimNote, content: 'Do the thing' } as Note);
    const { channel, task } = start(() => slimState);
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).toHaveBeenCalledWith(NOTE, WS);
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('Do the thing') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('keeps the cached slim row when the full-note fetch fails (fail-soft)', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const slimState = state();
    const slimNote = {
      id: NOTE,
      workspaceId: WS,
      title: 'Task note',
      content: '',
      contentPreview: 'Do the',
      contentLength: 12,
    } as Note;
    slimState.workspaceNotes = {
      byWorkspaceId: { [WS]: { notes: createCollection<Note, 'id'>('id', [slimNote]) } },
    };
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(null);
    const { channel, task } = start(() => slimState);
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(get).toHaveBeenCalledWith(NOTE, WS);
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ initialMessage: expect.stringContaining('(no content)') }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('runs on the default specialist\u2019s pinned coding agent when one is set', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'codex-runner',
      name: 'Codex Runner',
      description: 'Pinned to codex',
      codingAgent: 'codex',
      model: 'gpt-5',
      behaviorPrompt: 'Run tasks on codex.',
      filePath: '/tmp/codex-runner.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('codex-runner', [pinned]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'codex',
        model: 'gpt-5',
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'codex-runner' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('omits an inherited task-run preview so the daemon resolves the pinned provider default', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const pinned: FileSpecialist = {
      id: 'codex-runner',
      name: 'Codex Runner',
      description: 'Pinned to codex, no model',
      codingAgent: 'codex',
      model: '',
      behaviorPrompt: 'Run tasks on codex.',
      filePath: '/tmp/codex-runner.md',
      source: 'user',
      resolvedModel: 'fable-5',
      resolvedProvider: 'auggie',
    };
    const { channel, task } = start(() => state('codex-runner', [pinned]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: 'codex', model: undefined }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is a hidden specialist', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const hidden: FileSpecialist = {
      id: 'chief-of-staff',
      name: 'Chief of Staff',
      description: 'Hidden from pickers',
      model: '',
      behaviorPrompt: 'Coordinate.',
      filePath: '/tmp/chief-of-staff.md',
      source: 'user',
      hidden: true,
    };
    const { channel, task } = start(() => state('chief-of-staff', [hidden]));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('falls back to implementor when specialists.default is gated invisible (pr-reviewer without GitHub auth)', async () => {
    mocks.createAgent.mockResolvedValue({ success: true, agent: session(), agentId: AGENT });
    const { channel, task } = start(() => state('pr-reviewer'));
    channel.put(runAgentForNoteRequested(WS, NOTE, 'Task note'));
    await settle();

    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: { taskNoteId: NOTE, source: 'task-run', specialist: 'implementor' },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('rejects an in-flight promise action when the saga is cancelled', async () => {
    mocks.createAgent.mockReturnValue(new Promise(() => {}));
    const { channel, task } = start();
    const action = createAgentFromConfigRequested(WS, {
      name: 'Cancelled',
      workspaceId: WorkspaceId(WS),
      agentType: createAgentTypeId('chat'),
      source: 'test',
    });
    channel.put(action);
    await settle();
    task.cancel();

    await expect(action.promise).rejects.toThrow('Failed to create agent');
    await task.toPromise();
  });

  it('routes existing-task delegation to the daemon agent.delegate RPC', async () => {
    mocks.backendRequest.mockResolvedValue({ ok: true, agentId: AGENT, name: 'Task note' });
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', false));
    await settle();

    expect(mocks.backendRequest).toHaveBeenCalledWith('agent.delegate', {
      workspaceId: WS,
      taskNoteId: NOTE,
    });
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('opens the delegated agent when the trigger asks for it', async () => {
    mocks.backendRequest.mockResolvedValue({ ok: true, agentId: AGENT, name: 'Task note' });
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', true));
    await settle();

    expect(dispatched).toContainEqual(openAgentTabRequested(WS, { agentId: AGENT }));
    task.cancel();
    await task.toPromise();
  });

  it('surfaces a toast when agent.delegate rejects (e.g. occupancy guard)', async () => {
    mocks.backendRequest.mockRejectedValue(new Error('task already has a live assigned agent'));
    const { channel, dispatched, task } = start();
    channel.put(delegateExistingTaskRequested(WS, NOTE, 'Task note', true));
    await settle();

    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(dispatched).not.toContainEqual(
      expect.objectContaining({ type: 'appLayout/openAgentTabRequested' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('does not call the daemon when the workspace is unknown', async () => {
    const { channel, task } = start();
    channel.put(delegateExistingTaskRequested('ws-missing', NOTE, 'Task note', false));
    await settle();

    expect(mocks.backendRequest).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });
});
