import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backendRequest,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import { subscribeAgentWorkers, type AgentWorkersChannel } from './agent-workers-channel';
import type { AgentWorkersState, WorkerSnapshot } from './types';
import { workerFixture, workerSnapshotFixture } from './agent-workers.fixture';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));

const ws = workerSnapshotFixture.workspaceId;
const agent = workerSnapshotFixture.agentId;
let emit: (n: BackendNotification) => void;
let reconnect: () => void;
let capability: number | undefined;
let acks: string[];
let states: AgentWorkersState[];
let channel: AgentWorkersChannel | undefined;

const push = (subscriptionId: string, seq: number, snapshot: unknown = workerSnapshotFixture) =>
  emit({
    method: 'subscription.push',
    params: { subscriptionId, kind: 'snapshot', seq, snapshot },
  });
const last = () => states[states.length - 1];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  capability = 1;
  acks = ['sub-1', 'sub-2'];
  states = [];
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    emit = fn;
    return vi.fn();
  });
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnect = fn;
    return vi.fn();
  });
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello')
      return { server: { capabilities: { agentWorkers: capability } } };
    if (method === 'agent.workers.subscribe') return { subscriptionId: acks.shift() };
    if (method === 'agent.workers.stop')
      return { asyncTaskId: workerFixture.identity.asyncTaskId, stopped: true };
    throw new Error(`Unexpected call: ${method}`);
  });
});
afterEach(() => channel?.dispose());

async function open() {
  channel = subscribeAgentWorkers(ws, agent, (state) => states.push(state));
  await settle();
}

describe('agent workers channel', () => {
  it('stays silent and unsupported without the agentWorkers capability', async () => {
    capability = undefined;
    await open();
    expect(last()).toEqual({ status: 'unsupported' });
    expect(backendRequest).not.toHaveBeenCalledWith('agent.workers.subscribe', expect.anything());
  });

  it('accepts seq 0 then strictly increasing snapshots from the acknowledged subscription only', async () => {
    await open();
    expect(backendRequest).toHaveBeenCalledWith('agent.workers.subscribe', {
      workspaceId: ws,
      agentId: agent,
    });
    push('sub-1', 1);
    expect(states).toEqual([]);
    push('sub-1', 0);
    expect(last()).toEqual({ status: 'ready', snapshot: workerSnapshotFixture });
    push('other-sub', 1, { ...workerSnapshotFixture, workers: [] });
    push('sub-1', 0, { ...workerSnapshotFixture, workers: [] });
    expect(last().snapshot?.workers).toHaveLength(1);
    push('sub-1', 5, { ...workerSnapshotFixture, workers: [] });
    expect(last().snapshot?.workers).toEqual([]);
  });

  it('queues frames that race the subscribe acknowledgement', async () => {
    let ack!: (value: unknown) => void;
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { agentWorkers: 1 } } };
      return new Promise((resolve) => (ack = resolve));
    });
    channel = subscribeAgentWorkers(ws, agent, (state) => states.push(state));
    await settle();
    push('sub-1', 0);
    expect(states).toEqual([]);
    ack({ subscriptionId: 'sub-1' });
    await settle();
    expect(last().status).toBe('ready');
  });

  it('rejects snapshots for another scope or with foreign rows', async () => {
    await open();
    push('sub-1', 0, { ...workerSnapshotFixture, agentId: 'agent-other' });
    const foreignRow = {
      ...workerFixture,
      identity: { ...workerFixture.identity, connectionGeneration: 'generation-other' },
    };
    push('sub-1', 0, { ...workerSnapshotFixture, workers: [foreignRow] });
    push('sub-1', 0, { ...workerSnapshotFixture, workers: [{ ...workerFixture, canStop: 'yes' }] });
    expect(states).toEqual([]);
  });

  it('shows running rows as unknown after a reconnect, then resubscribes', async () => {
    await open();
    push('sub-1', 0);
    reconnect();
    expect(last().snapshot?.workers[0]).toMatchObject({
      status: 'unknown',
      unknownReason: 'disconnected',
    });
    await settle();
    push('sub-1', 1);
    expect(last().snapshot?.workers[0].status).toBe('unknown');
    push('sub-2', 0);
    expect(last().snapshot?.workers[0].status).toBe('running');
  });

  it('maps a missing method to unsupported and other failures to failed', async () => {
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { agentWorkers: 1 } } };
      throw Object.assign(new Error('no method'), { rpcCode: -32601 });
    });
    await open();
    expect(last()).toEqual({ status: 'unsupported' });
    channel!.dispose();
    states = [];
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'client.hello') return { server: { capabilities: { agentWorkers: 1 } } };
      throw new Error('boom');
    });
    await open();
    expect(last().status).toBe('failed');
  });

  it("stops a worker with its row's generation and releases the subscription on dispose", async () => {
    await open();
    push('sub-1', 0);
    await expect(channel!.stop(workerFixture.identity.asyncTaskId)).resolves.toEqual({
      asyncTaskId: workerFixture.identity.asyncTaskId,
      stopped: true,
    });
    expect(backendRequest).toHaveBeenCalledWith('agent.workers.stop', {
      workspaceId: ws,
      agentId: agent,
      connectionGeneration: workerFixture.identity.connectionGeneration,
      asyncTaskId: workerFixture.identity.asyncTaskId,
    });
    await expect(channel!.stop('missing')).rejects.toThrow();
    channel!.dispose();
    expect(backendUnsubscribe).toHaveBeenCalledWith('sub-1', ws);
    push('sub-1', 1, { ...workerSnapshotFixture, workers: [] } satisfies WorkerSnapshot);
    expect(last().snapshot?.workers).toHaveLength(1);
  });
});
