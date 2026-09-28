import { describe, expect, it } from 'vitest';
import { AgentSessionSchema } from '$shared/schemas';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { isAgentRunningState } from '$shared/utils/agent-runtime-state';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import { agentSessionReducer, initialState, bulkUpsertSessions } from './agent-session-slice';
import type { WorkspaceEvent } from '$features/events/types';

// Independent examples from protocol §5.50, including checkpoint ordering at
// equal journal watermarks (fixtures/nodes/contract.json, reverse completion).
const checkpoint = (revision: string, epoch = '1') => ({
  id: `checkpoint-${epoch}-${revision}`,
  assignmentEpoch: epoch,
  captureRevision: revision,
  capturedAt: '2026-09-28T09:00:00Z',
  committedAt: '2026-09-28T09:00:01Z',
});
const remote = {
  nodeId: 'node-build',
  leaseId: 'lease-build',
  nodeState: 'offline',
  placement: {
    target: 'remote',
    checkout: 'isolated',
    os: 'linux',
    nodeId: 'node-build',
    exclusive: true,
  },
  effectiveIsolation: 'isolated',
  nodePath: '/node/private/checkout',
  checkpoint: checkpoint('10'),
};
const session = (extra = {}): AgentSession => ({
  id: AgentId('agent-remote'),
  backendSessionId: null,
  workspaceId: WorkspaceId('ws-remote'),
  name: 'Remote',
  status: AgentStatus.Active,
  messages: [],
  createdAt: '2026-09-28T09:00:00Z',
  updatedAt: '2026-09-28T09:00:00Z',
  ...extra,
});
const event = (type: string, data: object) =>
  eventReceived('ws-remote', {
    id: 'event-remote',
    type,
    workspaceId: 'ws-remote',
    timestamp: '2026-09-28T09:00:02Z',
    data: { agentId: 'agent-remote', workspaceId: 'ws-remote', ...data },
  } as WorkspaceEvent);
const upsertSession = (value: AgentSession) =>
  bulkUpsertSessions([value], { preserveExplicitRuntimeFlags: true });
const row = (state: typeof initialState) => state.byAgentId['agent-remote'];

describe('node agent compatibility', () => {
  it('round-trips remote and legacy sessions through validation', () => {
    expect(AgentSessionSchema.parse(session({ ...remote, status: 'halted' }))).toMatchObject(
      remote,
    );
    expect(AgentSessionSchema.parse(session())).not.toHaveProperty('placement');
    expect(AgentSessionSchema.parse(session({ ...remote, status: 'resuming' })).status).toBe(
      'resuming',
    );
  });
  it('rejects invalid placement and malformed checkpoint ordering fields', () => {
    for (const placement of [
      { target: 'remote', checkout: 'shared' },
      { target: 'local', checkout: 'isolated', exclusive: true },
      {},
    ]) {
      expect(AgentSessionSchema.safeParse(session({ placement })).success).toBe(false);
    }
    for (const revision of ['-1', '1e3', '18446744073709551616', 'invalid']) {
      expect(
        AgentSessionSchema.safeParse(session({ checkpoint: checkpoint(revision) })).success,
      ).toBe(false);
    }
  });
  it('does not swallow a placement-only subscription update', () => {
    const before = agentSessionReducer(initialState, upsertSession(session()));
    const after = agentSessionReducer(before, upsertSession(session(remote)));
    expect(row(after)).toMatchObject(remote);
  });
  it('keeps the newest numeric checkpoint on list reload and reordered events', () => {
    let state = agentSessionReducer(initialState, upsertSession(session(remote)));
    state = agentSessionReducer(
      state,
      bulkUpsertSessions([session({ ...remote, checkpoint: checkpoint('9') })]),
    );
    expect(row(state)).toHaveProperty('checkpoint.id', 'checkpoint-1-10');
    state = agentSessionReducer(
      state,
      event('hub:checkpoint', { checkpoint: checkpoint('9007199254740993') }),
    );
    state = agentSessionReducer(
      state,
      event('hub:checkpoint', { checkpoint: checkpoint('9007199254740992') }),
    );
    expect(row(state)).toHaveProperty('checkpoint.id', 'checkpoint-1-9007199254740993');
    state = agentSessionReducer(
      state,
      event('hub:checkpoint', { checkpoint: checkpoint('1', '2') }),
    );
    expect(row(state)).toHaveProperty('checkpoint.id', 'checkpoint-2-1');
    state = agentSessionReducer(
      state,
      event('agent:updated', { checkpoint: { ...checkpoint('1', '2'), id: 'conflicting-id' } }),
    );
    expect(row(state)).toHaveProperty('checkpoint.id', 'checkpoint-2-1');
    state = agentSessionReducer(
      state,
      event('hub:checkpoint', { checkpoint: checkpoint('not-a-number') }),
    );
    expect(row(state)).toHaveProperty('checkpoint.id', 'checkpoint-2-1');
  });
  it('applies placement/status events and stops stale running flags on halt', () => {
    let state = agentSessionReducer(initialState, upsertSession(session({ isStreaming: true })));
    state = agentSessionReducer(state, event('agent:updated', remote));
    expect(row(state)).toMatchObject(remote);
    state = agentSessionReducer(
      state,
      event('agent:status-changed', { status: 'halted', nodeState: 'offline' }),
    );
    expect(row(state)).toMatchObject({ status: 'halted', isStreaming: false });
    expect(isAgentRunningState(row(state))).toBe(false);
    state = agentSessionReducer(
      state,
      event('agent:status-changed', { status: 'resuming', nodeState: 'ready' }),
    );
    expect(row(state)).toMatchObject({ status: 'resuming', nodeState: 'ready' });
    expect(isAgentRunningState(row(state))).toBe(true);
  });
  it('keeps node path provenance when a legacy-shaped reload omits additive fields', () => {
    let state = agentSessionReducer(initialState, upsertSession(session(remote)));
    state = agentSessionReducer(state, bulkUpsertSessions([session()]));
    expect(row(state)).toMatchObject(remote);
  });
  it('treats halted as stopped even with stale tool activity', () => {
    expect(
      isAgentRunningState({
        status: 'halted',
        turnInFlight: true,
        lastToolUse: { status: 'running' },
      }),
    ).toBe(false);
  });
});
