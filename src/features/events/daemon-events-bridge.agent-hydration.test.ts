import { afterAll, beforeAll, expect, it, vi } from 'vitest';

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

beforeAll(() => appStore.init());
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
