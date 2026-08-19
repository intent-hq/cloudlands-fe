import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createAgent: vi.fn() }));
vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: { createAgent: mocks.createAgent },
}));

import type { AgentSession, Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { createAgentTypeId } from '$shared/types/agent.types';
import { agentSessionLaunchAgentRequested } from '../../agent-session/agent-session-slice';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  createAgentFromConfigRequested,
  createAgentRequested,
  createAgentWithSpecialistRequested,
} from '../workspace-agents-slice';
import { agentCreationSaga } from './agent-creation-saga';

const WS = 'ws-create-saga';
const AGENT = 'agent-created';
const settle = async () => {
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

function state() {
  const workspace = { id: WS, title: 'Workspace', repositoryPath: '/tmp/repo' } as Workspace;
  return {
    workspace: { workspaces: { ids: [WS], map: { [WS]: workspace } } },
    workspaceAgents: { byWorkspaceId: { [WS]: { agentIds: [] } } },
    agentSessions: { byAgentId: {} },
    model: { providerModels: { augment: 'sonnet' } },
    providerSettings: { activeProviderId: 'augment' },
  };
}

function start() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    {
      channel,
      getState: state,
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
        sourcePanelId: 'working-panel',
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
        sourcePanelId: 'working-panel',
      }),
    );
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
});
