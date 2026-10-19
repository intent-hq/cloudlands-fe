import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('svelte')>()),
  getContext: () => undefined,
}));

const { pendingGets } = vi.hoisted(() => ({
  pendingGets: [] as Array<(result: unknown) => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
  backendRequest: (method: string) =>
    new Promise((resolve) => {
      if (method === 'agent.get') pendingGets.push(resolve);
    }),
}));

import { store as appStore } from '$store/renderer/store';
import { routeDaemonEventsNotification } from './daemon-events-bridge.client';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { ensureAgentSession } from '$features/agent/agent-read-service';
import type { AgentSession } from '$shared/types';

beforeAll(() => appStore.init());
beforeEach(() => {
  pendingGets.length = 0;
});
afterAll(() => appStore.dispose());

it('converges unknown-agent lifecycle bursts with one bounded trailing recovery', async () => {
  const agentId = 'unknown-lifecycle-race';
  const workspaceId = 'ws-lifecycle-race';
  const emit = (type: string, data: Record<string, unknown>) =>
    routeDaemonEventsNotification('events.event', {
      event: {
        id: `${type}-${pendingGets.length}`,
        workspaceId,
        type,
        timestamp: '2026-10-12T00:00:00Z',
        actor: { type: 'system', id: 'daemon' },
        data: { agentId, ...data },
      },
    });
  const row = (status: string) => ({
    id: agentId,
    workspaceId,
    name: 'Racing agent',
    status,
    messageCount: 0,
    isResponding: status === 'active',
    isStreaming: status === 'active',
  });

  emit('agent:status-changed', { status: 'active', isActive: true });
  for (let i = 0; i < 8; i++) emit('agent:idle', {});
  expect(pendingGets).toHaveLength(1);
  pendingGets[0]!(row('active'));
  await vi.waitFor(() => expect(pendingGets).toHaveLength(2));
  pendingGets[1]!(row('idle'));
  await vi.waitFor(() => {
    expect(appStore.state.agentSessions.byAgentId[agentId]?.status).toBe('idle');
    expect(appStore.state.agentSessions.byAgentId[agentId]?.isResponding).toBe(false);
  });
  emit('agent:idle', {});
  expect(pendingGets).toHaveLength(2);
});

function knownAgent(id: string): AgentSession {
  return {
    id,
    workspaceId: 'ws-projection-order',
    name: 'Agent',
    status: 'active',
    isActive: true,
    isResponding: true,
    messages: [],
    createdAt: '2026-10-12T00:00:00Z',
    updatedAt: '2026-10-12T00:00:00Z',
    metadata: { specialist: 'before' },
  } as AgentSession;
}
let eventSequence = 0;
function push(agent: AgentSession, type: string, data: Record<string, unknown>) {
  routeDaemonEventsNotification('events.event', {
    event: {
      id: `projection-${++eventSequence}`,
      workspaceId: agent.workspaceId,
      type,
      timestamp: '2026-10-12T00:00:02Z',
      actor: { type: 'system', id: 'daemon' },
      data: { agentId: agent.id, ...data },
    },
  });
}

it.each(['ABA', 'same-value'])(
  'preserves %s lifecycle pushes over one held detail read',
  async (sequence) => {
    const agent = knownAgent(`lifecycle-${sequence}`);
    appStore.dispatch(bulkUpsertSessions([agent]));
    const read = ensureAgentSession(agent.id, agent.workspaceId);
    if (sequence === 'ABA') push(agent, 'agent:idle', {});
    push(agent, 'agent:status-changed', { status: 'active', isActive: true, isResponding: true });
    expect(pendingGets).toHaveLength(1);
    pendingGets[0]!({
      ...agent,
      status: 'idle',
      isActive: false,
      isResponding: false,
      updatedAt: '2026-10-12T00:00:01Z',
      metadata: { specialist: 'fetched', taskNoteId: 'new-detail' },
    });
    await read;
    expect(appStore.state.agentSessions.byAgentId[agent.id]).toMatchObject({
      status: 'active',
      isActive: true,
      isResponding: true,
      updatedAt: '2026-10-12T00:00:02Z',
      metadata: { specialist: 'fetched', taskNoteId: 'new-detail' },
    });
    expect(pendingGets).toHaveLength(1);
    // A later explicit read is still authoritative when no push supersedes it.
    const fresh = ensureAgentSession(agent.id, agent.workspaceId);
    pendingGets[1]!({ ...agent, status: 'idle', isActive: false, isResponding: false });
    await fresh;
    expect(appStore.state.agentSessions.byAgentId[agent.id].isResponding).toBe(false);
    expect(pendingGets).toHaveLength(2);
  },
);

it.each(['ABA', 'same-value'])(
  'preserves %s attention clears while accepting untouched fetched metadata',
  async (sequence) => {
    const agent = knownAgent(`attention-${sequence}`);
    appStore.dispatch(bulkUpsertSessions([agent]));
    const read = ensureAgentSession(agent.id, agent.workspaceId);
    if (sequence === 'ABA') {
      push(agent, 'agent:attention-requested', {
        kind: 'discussion',
        reason: 'new question',
        agentName: 'Agent',
        parentAgentId: 'parent',
      });
      expect(appStore.state.agentSessions.byAgentId[agent.id].attentionRequestReason).toBe(
        'new question',
      );
    }
    push(agent, 'agent:updated', { attentionRequestCleared: true });
    expect(pendingGets).toHaveLength(1);
    pendingGets[0]!({
      ...agent,
      status: 'idle',
      isActive: false,
      isResponding: false,
      attentionRequestKind: 'discussion',
      attentionRequestReason: 'old question',
      attentionRequestTimestamp: '2026-10-12T00:00:01Z',
      metadata: {
        specialist: 'fetched',
        taskNoteId: 'new-detail',
        attentionRequestKind: 'discussion',
        attentionRequestReason: 'old question',
        attentionRequestTimestamp: '2026-10-12T00:00:01Z',
      },
    });
    await read;
    const stored = appStore.state.agentSessions.byAgentId[agent.id];
    expect(stored.attentionRequestKind).toBeUndefined();
    expect(stored.attentionRequestReason).toBeUndefined();
    expect(stored.attentionRequestTimestamp).toBeUndefined();
    expect(stored.metadata).toMatchObject({ specialist: 'fetched', taskNoteId: 'new-detail' });
    expect(stored.metadata?.attentionRequestKind).toBeUndefined();
    expect(stored.metadata?.attentionRequestReason).toBeUndefined();
    expect(stored.metadata?.attentionRequestTimestamp).toBeUndefined();
    expect(stored.isResponding).toBe(false);
    expect(pendingGets).toHaveLength(1);
  },
);

it('preserves a repeated absent completion-report clear over a held detail read', async () => {
  const agent = knownAgent('completion-clear');
  appStore.dispatch(bulkUpsertSessions([agent]));
  const read = ensureAgentSession(agent.id, agent.workspaceId);
  push(agent, 'agent:updated', { completionReportCleared: true });
  pendingGets[0]!({
    ...agent,
    metadata: {
      specialist: 'fetched',
      completionReport: 'old report',
      completionReportTimestamp: '2026-10-12T00:00:01Z',
    },
  });
  await read;
  const metadata = appStore.state.agentSessions.byAgentId[agent.id].metadata;
  expect(metadata?.completionReport).toBeUndefined();
  expect(metadata?.completionReportTimestamp).toBeUndefined();
  expect(metadata?.specialist).toBe('fetched');
  expect(pendingGets).toHaveLength(1);
});
