import { describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';
import type { SagaGenerator } from 'typed-redux-saga';
import { createAgentCreationWorkers } from './agent-creation-workers';
import {
  createAgentFromConfigRequested,
  workspaceAgentsReducer,
  clearAgentCreationOutcome,
} from '../workspace-agents-slice';
import { getAgentCreationOutcome } from '../workspace-agents-projections';
import { WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import type { CreateAgentResult } from '$shared/types/agent.types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const effect = <Args extends unknown[], R>(read: (...args: Args) => R) => ({
  *effect(...args: Args): SagaGenerator<R> {
    return read(...args);
  },
});
function setup() {
  let state = workspaceAgentsReducer(undefined, { type: 'init' });
  let context: string | null = 'owner:epoch1';
  const pending = new Map<string, ReturnType<typeof createAgentFromConfigRequested>>();
  const actions: { type: string; payload?: unknown }[] = [];
  const createAgent = vi.fn<(...args: unknown[]) => Promise<CreateAgentResult>>();
  const open = vi.fn();
  const workspace = { id: 'ws', path: '/owned/ws' } as Workspace;
  const agent = {
    id: 'daemon-agent',
    workspaceId: 'ws',
    backendSessionId: 'daemon-agent',
    name: 'Agent',
    status: AgentStatus.Idle,
  } as AgentSession;
  const selectors = {
    selectWorkspaceActionContext: effect(() => context),
    selectAllWorkspaceAgents: effect(() => [] as AgentSession[]),
    selectAgentCreationOutcome: effect((id: string, ws: string, resource: string) =>
      getAgentCreationOutcome(
        { workspaceAgents: state } as Parameters<typeof getAgentCreationOutcome>[0],
        id,
        ws,
        resource,
      ),
    ),
  };
  const workers = createAgentCreationWorkers({
    agentFactory: { createAgent },
    ...selectors,
    *refusedForCollaborator() {
      return context === null;
    },
    *validateWorkspace() {
      return workspace;
    },
    *openCreatedAgent() {
      open();
    },
    async showConsumerCreationError() {},
  });
  const dispatch = (action: Parameters<typeof workspaceAgentsReducer>[1]) => {
    state = workspaceAgentsReducer(state, action);
    actions.push(action);
  };
  const request = () =>
    createAgentFromConfigRequested(
      'ws',
      { workspaceId: WorkspaceId('ws') },
      {
        consumer: { id: 'control', resourceId: 'general:principal:ws' },
        activateAgent: false,
        notifyOnError: false,
        protectUncertainCreation: true,
      },
    );
  const runTask = (action: ReturnType<typeof request>) => {
    void action.promise.catch(() => undefined);
    dispatch(action);
    return runSaga({ dispatch }, workers.createFromConfig, pending, action);
  };
  const run = (action: ReturnType<typeof request>) => runTask(action).toPromise();
  const outcome = () =>
    selectors.selectAgentCreationOutcome.effect('control', 'ws', 'general:principal:ws').next()
      .value;
  return {
    createAgent,
    runTask,
    agent,
    request,
    run,
    actions,
    open,
    outcome,
    dispatch,
    retire: () => {
      context = 'replacement:epoch2';
    },
  };
}

describe('canonical connected creation ownership', () => {
  it('publishes only the returned daemon identity and settles once', async () => {
    const h = setup();
    h.createAgent.mockResolvedValue({ success: true, agent: h.agent });
    const a = h.request();
    await h.run(a);
    await expect(a.promise).resolves.toEqual(h.agent);
    expect(h.outcome()).toMatchObject({ status: 'success', agentId: 'daemon-agent' });
    expect(h.createAgent).toHaveBeenCalledTimes(1);
  });
  it('coalesces a repeated activation while the create is in flight', async () => {
    const h = setup(),
      d = deferred<CreateAgentResult>();
    h.createAgent.mockReturnValue(d.promise);
    const a = h.request(),
      first = h.run(a),
      b = h.request(),
      second = h.run(b);
    expect(h.createAgent).toHaveBeenCalledTimes(1);
    d.resolve({ success: true, agent: h.agent });
    await Promise.all([first, second]);
    await expect(b.promise).resolves.toEqual(h.agent);
    expect(h.outcome()).toMatchObject({ status: 'success', seq: a.seq });
  });
  it('allows a new attempt after a definite refusal', async () => {
    const h = setup();
    h.createAgent
      .mockResolvedValueOnce({ success: false, error: 'refused', cause: { rpcCode: -32003 } })
      .mockResolvedValueOnce({ success: true, agent: h.agent });
    await h.run(h.request());
    expect(h.outcome()).toMatchObject({ status: 'failure' });
    await h.run(h.request());
    expect(h.createAgent).toHaveBeenCalledTimes(2);
    expect(h.outcome()).toMatchObject({ status: 'success' });
  });
  it('retains uncertain delivery and refuses a new create request', async () => {
    const h = setup();
    h.createAgent.mockResolvedValue({
      success: false,
      error: 'transport lost',
      creationUncertain: true,
    });
    const a = h.request();
    await h.run(a);
    expect(h.outcome()).toMatchObject({ status: 'uncertain', seq: a.seq });
    await h.run(h.request());
    expect(h.createAgent).toHaveBeenCalledTimes(1);
    expect(h.outcome()).toMatchObject({ status: 'uncertain', seq: a.seq });
  });
  it('retains uncertainty across reconnection instead of admitting a duplicate create', async () => {
    const h = setup(),
      d = deferred<CreateAgentResult>();
    h.createAgent.mockReturnValue(d.promise);
    const done = h.run(h.request());
    h.retire();
    d.resolve({ success: false, error: 'reply lost', creationUncertain: true });
    await done;
    expect(h.outcome()).toMatchObject({ status: 'uncertain' });
    await h.run(h.request());
    expect(h.createAgent).toHaveBeenCalledTimes(1);
  });
  it('retains a cancelled in-flight factory as uncertain and ignores its late completion', async () => {
    const h = setup(),
      d = deferred<CreateAgentResult>();
    h.createAgent.mockReturnValue(d.promise);
    const task = h.runTask(h.request());
    task.cancel();
    await task.toPromise();
    expect(h.outcome()).toMatchObject({ status: 'uncertain' });
    await h.run(h.request());
    expect(h.createAgent).toHaveBeenCalledTimes(1);
    d.resolve({ success: true, agent: h.agent });
    await Promise.resolve();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.actions.some((a) => a.type.includes('upsert'))).toBe(false);
  });
  it('does not publish or open a late success under a replacement owner', async () => {
    const h = setup(),
      d = deferred<CreateAgentResult>();
    h.createAgent.mockReturnValue(d.promise);
    const done = h.run(h.request());
    h.retire();
    d.resolve({ success: true, agent: h.agent });
    await done;
    expect(h.outcome()).toMatchObject({ status: 'uncertain' });
    expect(h.open).not.toHaveBeenCalled();
    expect(h.actions.some((a) => a.type.includes('upsert'))).toBe(false);
  });
  it('does not activate a released consumer or recreate its outcome', async () => {
    const h = setup(),
      d = deferred<CreateAgentResult>();
    h.createAgent.mockReturnValue(d.promise);
    const a = h.request(),
      done = h.run(a);
    h.dispatch(clearAgentCreationOutcome('control', a.seq));
    d.resolve({ success: true, agent: h.agent });
    await done;
    expect(h.outcome()).toBeUndefined();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.createAgent).toHaveBeenCalledTimes(1);
  });
});
