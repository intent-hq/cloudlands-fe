/** @vitest-environment jsdom */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { waitFor } from '@testing-library/svelte';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { ensureAgentSession } from '$features/agent/agent-read-service';
import { claimAgentReadOwnership } from '$features/agent/agent-read-ownership';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  __resetDaemonEventsBridgeForTests,
} from './daemon-events-bridge.client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '@/test/mocks/backend-transport.mock';

vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('@/test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

const workspaceId = WorkspaceId('preview-origin');
const replacementWorkspaceId = WorkspaceId('preview-replacement');
const eventTypes = ['agent:last-message', 'agent:stream:activity', 'agent:stream:end'] as const;
let backend: MockBackendHandle;
let task: Task | undefined;
let agentId: ReturnType<typeof AgentId>;
let sequence = 0;
let original: AgentSession;
const current = () => selectAgentSession.select(appStore.state, agentId);
const preview = () => {
  const session = current();
  return (
    session && {
      workspaceId: session.workspaceId,
      lastAgentResponse: session.lastAgentResponse,
      lastMessageId: session.lastMessageId,
      lastMessageRole: session.lastMessageRole,
      hasUnread: session.hasUnread,
      digest: session.digest,
      lastToolUse: session.lastToolUse,
    }
  );
};

beforeAll(() => {
  // Keep transport listeners installed across cases, including the real read
  // ownership reconnect listener. Each case gets a distinct opaque agent ID.
  backend = installMockBackend();
  backend.onSubscribe(() => ({ subscriptionId: 'preview-sub' }));
  appStore.init();
});
beforeEach(async () => {
  agentId = AgentId(`preview-agent-${++sequence}`);
  original = {
    id: agentId,
    workspaceId,
    backendSessionId: null,
    name: 'Preview owner',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-09-28T08:00:00Z',
    updatedAt: '2026-09-28T08:00:00Z',
    lastAgentResponse: 'original preview',
    lastMessageId: 'original-message',
    lastMessageRole: 'assistant',
    hasUnread: false,
    digest: 'original digest',
    lastToolUse: { name: 'original tool' },
  };
  appStore.dispatch(bulkUpsertSessions([original]));
  __resetDaemonEventsBridgeForTests();
  const previousSubscriptions = backend.subscribes.length;
  task = runSaga(
    {
      channel: stdChannel(),
      dispatch: (action) => appStore.dispatch(action),
      getState: () => appStore.state,
    },
    daemonEventsSaga,
  );
  await waitFor(() =>
    expect(backend.subscribes.slice(previousSubscriptions)).toContainEqual({
      eventTypes: [...DAEMON_EVENTS_SUBSCRIBE_TYPES],
    }),
  );
});
afterEach(async () => {
  task?.cancel();
  await task?.toPromise();
  task = undefined;
  appStore.dispatch(removeSession(agentId));
  __resetDaemonEventsBridgeForTests();
});
afterAll(() => resetMockBackend());

function deliver(
  type: (typeof eventTypes)[number],
  scope: string | undefined = workspaceId,
  shape: 'wrapped' | 'flat' = 'wrapped',
  messageId = 'event-message',
) {
  const event = {
    id: `preview-${sequence}`,
    type,
    ...(scope === undefined ? {} : { workspaceId: scope }),
    timestamp: '2026-09-28T08:01:00Z',
    actor: { type: 'system' },
    data: {
      agentId,
      messageId,
      role: 'assistant',
      lastMessageRole: 'assistant',
      lastMessageId: 'event-message',
      lastAgentResponse: 'event preview',
      digest: 'event digest',
      lastToolUse: { name: 'event tool' },
    },
  };
  backend.pushEvent({
    method: 'events.event',
    params: shape === 'wrapped' ? { subscriptionId: 'preview-sub', event } : event,
  });
}
function replaceRow() {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        ...original,
        workspaceId: replacementWorkspaceId,
        lastAgentResponse: 'replacement preview',
        lastMessageId: 'replacement-message',
      },
    ]),
  );
}
async function pendingHydration(type: (typeof eventTypes)[number]) {
  appStore.dispatch(removeSession(agentId));
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  backend.onRequest(
    'agent.get',
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  deliver(type);
  await waitFor(() =>
    expect(backend.requests).toContainEqual({
      method: 'agent.get',
      params: { agentId, workspaceId },
    }),
  );
  // Join the real in-flight read, so assertions follow both the read-service
  // completion and the bridge callback, without a timing-based sleep.
  const settled = ensureAgentSession(agentId, workspaceId);
  return { resolve, reject, settled };
}

it.each(['wrapped', 'flat'] as const)(
  'rejects a prior-workspace last-message in a %s envelope',
  async (shape) => {
    replaceRow();
    const before = current();
    deliver('agent:last-message', workspaceId, shape);
    await Promise.resolve();
    expect(current()).toEqual(before);
  },
);

it.each(eventTypes)('%s rejects immediate preview writes to another workspace', async (type) => {
  replaceRow();
  const before = preview();
  deliver(type);
  await Promise.resolve();
  expect(preview()).toEqual(before);
});

it.each(eventTypes)('%s rejects a late hydration after the row changes workspace', async (type) => {
  const read = await pendingHydration(type);
  replaceRow();
  const before = preview();
  read.resolve({ agent: original });
  await read.settled;
  expect(preview()).toEqual(before);
});

it.each(eventTypes)(
  '%s rejects a failed hydration after the row changes workspace',
  async (type) => {
    const read = await pendingHydration(type);
    replaceRow();
    const before = preview();
    read.reject(new Error('preview hydration failed'));
    await read.settled;
    expect(preview()).toEqual(before);
  },
);

it.each(eventTypes)(
  '%s accepts immediate current-workspace previews without fetching',
  async (type) => {
    const requestsBefore = backend.requests.length;
    deliver(type);
    await Promise.resolve();
    expect(current()?.lastAgentResponse).toBe('event preview');
    expect(backend.requests.slice(requestsBefore).filter((r) => r.method === 'agent.get')).toEqual(
      [],
    );
  },
);

it.each(eventTypes)(
  '%s accepts valid hydration and then applies the event preview',
  async (type) => {
    const read = await pendingHydration(type);
    read.resolve({ agent: original });
    await read.settled;
    expect(current()?.workspaceId).toBe(workspaceId);
    expect(current()?.lastAgentResponse).toBe('event preview');
  },
);

it.each(eventTypes)('%s does not apply an old preview after reconnect', async (type) => {
  const read = await pendingHydration(type);
  backend.triggerReconnect();
  appStore.dispatch(bulkUpsertSessions([original]));
  const before = preview();
  read.resolve({ agent: original });
  await read.settled;
  expect(preview()).toEqual(before);
  deliver(type);
  await Promise.resolve();
  expect(current()?.lastAgentResponse).toBe('event preview');
});

it.each(eventTypes)('%s does not reclaim a row from a newer read owner', async (type) => {
  claimAgentReadOwnership(agentId, replacementWorkspaceId);
  const before = preview();
  deliver(type);
  await Promise.resolve();
  expect(preview()).toEqual(before);
});

it.each(eventTypes)('%s preserves the router rule for an omitted workspace', async (type) => {
  const before = preview();
  // Use an explicit raw envelope: the transport fixture otherwise fills in a workspace.
  backend.pushEvent({
    method: 'events.event',
    params: {
      type,
      data: {
        agentId,
        messageId: 'unscoped',
        role: 'assistant',
        lastAgentResponse: 'unscoped preview',
      },
    },
  });
  await Promise.resolve();
  expect(preview()).toEqual(before);
});

it('keeps omitted-context direct hydration compatible with subsequent scoped previews', async () => {
  appStore.dispatch(removeSession(agentId));
  backend.onRequest('agent.get', () => ({ agent: original }));
  await ensureAgentSession(agentId);
  expect(backend.requests).toContainEqual({ method: 'agent.get', params: { agentId } });
  deliver('agent:last-message');
  await Promise.resolve();
  expect(current()?.lastAgentResponse).toBe('event preview');
});

it.each(eventTypes)(
  '%s rejects an earlier read lifetime even when the workspace returns to the origin',
  async (type) => {
    const read = await pendingHydration(type);
    claimAgentReadOwnership(agentId, replacementWorkspaceId);
    claimAgentReadOwnership(agentId, workspaceId);
    appStore.dispatch(bulkUpsertSessions([original]));
    const before = preview();
    read.resolve({ agent: original });
    await read.settled;
    expect(preview()).toEqual(before);
  },
);

it.each(eventTypes)('%s leaves an unknown session absent after hydration fails', async (type) => {
  const read = await pendingHydration(type);
  read.reject(new Error('preview hydration failed'));
  await read.settled;
  expect(current()).toBeUndefined();
});

it('a foreign terminal preview cannot suppress current-workspace stream activity', async () => {
  replaceRow();
  deliver('agent:stream:end', workspaceId, 'wrapped', 'zz-foreign-turn');
  deliver('agent:stream:activity', replacementWorkspaceId, 'wrapped', 'aa-current-turn');
  await Promise.resolve();
  expect(current()?.lastAgentResponse).toBe('event preview');
  expect(current()?.lastToolUse).toEqual({ name: 'event tool' });
});

it('preview turn ordering belongs to the workspace even after its row is replaced', async () => {
  deliver('agent:stream:end', workspaceId, 'wrapped', 'zz-origin-turn');
  replaceRow();
  deliver('agent:stream:activity', replacementWorkspaceId, 'wrapped', 'aa-replacement-turn');
  await Promise.resolve();
  expect(current()?.lastAgentResponse).toBe('event preview');
  expect(current()?.lastToolUse).toEqual({ name: 'event tool' });
});
