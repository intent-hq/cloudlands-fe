import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { request, reconnect } = vi.hoisted(() => ({
  request: vi.fn(),
  reconnect: [] as Array<() => void>,
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: request,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn((cb: () => void) => {
    reconnect.push(cb);
    return () => {};
  }),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class extends Error {},
}));

import { store } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
import {
  chatReset,
  chatLastAttemptedMessageSet,
  sendMessage as sendAction,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { chatSendSaga } from '$store/renderer/slices/chat-state/sagas/chat-send-saga';
import { AgentStatus, type AgentSession, type QueuedMessage, type Workspace } from '$shared/types';
import { ensureAgentSession } from './agent-read-service';
import { sendMessage } from './agent-send';
import { activateAgentRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

let agentId = 'shared-agent';
let sequence = 0;
const workspace = (id: string) =>
  ({ id, title: id, path: '/repo', repositoryPath: '/repo', status: 'active' }) as Workspace;
const row = (id: string): QueuedMessage => ({
  id,
  turnId: id,
  content: id,
  position: 0,
  queuedAt: '2026-09-28T00:00:00Z',
});
const session = (workspaceId: string): AgentSession =>
  ({
    id: agentId,
    workspaceId,
    name: 'Agent',
    backendSessionId: agentId,
    status: AgentStatus.Active,
    isResponding: true,
    isStreaming: true,
    messages: [
      {
        id: 'seed',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'seed' }],
        timestamp: '2026-09-28T00:00:00Z',
      },
    ],
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
  }) as AgentSession;
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

// Both production consumers run against the real store and real mutation sagas.
// The daemon seam is the only mock; replies carry the protocol's turnId.
describe.each(['agent.sendMessage', 'agent.queueMessage'] as const)(
  '%s workspace ownership',
  (method) => {
    let stopMutation: () => void;
    let stopSend: () => void;
    beforeAll(() => {
      store.init();
      stopMutation = store.runSaga(agentMutationSaga);
      stopSend = store.runSaga(chatSendSaga);
    });
    afterAll(() => {
      stopSend();
      stopMutation();
    });
    beforeEach(() => {
      reconnect.forEach((cb) => cb());
      agentId = `shared-agent-${++sequence}`;
      store.dispatch(clearAllSessions());
      store.dispatch(chatReset(agentId));
      for (const id of ['a', 'b']) store.dispatch(setWorkspaceEntity(workspace(id)));
      request.mockReset();
      request.mockImplementation(async (name: string, params: { workspaceId?: string }) => {
        if (name === 'agent.get') return { agent: session(params.workspaceId ?? 'a') };
        if (name === method) return { success: true, queued: true, queuedMessage: row('sent') };
        return {};
      });
    });
    function start(ws: string): Promise<void> {
      if (method === 'agent.sendMessage') return sendMessage(agentId, 'send', workspace(ws));
      store.dispatch(sendAction(agentId, { wsId: ws, text: 'send' }));
      return flush();
    }
    it.each(['a', 'b', undefined])(
      'merges only compatible queue rows (previous owner %s)',
      async (previous) => {
        store.dispatch(replaceAgentQueue(agentId, [row('prior')], previous));
        await ensureAgentSession(agentId, 'b');
        store.dispatch(bulkUpsertSessions([session('b')]));
        await start('b');
        await vi.waitFor(() =>
          expect(request.mock.calls.some(([name]) => name === method)).toBe(true),
        );
        await flush();
        expect(
          selectAgentQueueMessages.select(store.state, agentId).map((item) => item.id),
        ).toEqual(previous === 'a' ? ['sent'] : ['prior', 'sent']);
        expect(store.state.agentQueue.byAgentId[agentId].workspaceId).toBe('b');
      },
    );
    if (method === 'agent.sendMessage') {
      it.each(['a', 'b'])(
        'sends B independently while A is pending (first completion %s)',
        async (first) => {
          await ensureAgentSession(agentId, 'a');
          store.dispatch(replaceAgentQueue(agentId, [], 'a'));
          const finishes = new Map<string, (value: unknown) => void>();
          request.mockImplementation(async (name: string, params: { workspaceId?: string }) => {
            if (name === 'agent.get') return { agent: session(params.workspaceId ?? 'a') };
            if (name === method)
              return new Promise((resolve) => {
                finishes.set(params.workspaceId!, resolve);
              });
            return {};
          });
          const a = start('a');
          await vi.waitFor(() => expect(finishes.has('a')).toBe(true));
          await ensureAgentSession(agentId, 'b');
          store.dispatch(replaceAgentQueue(agentId, [], 'b'));
          const b = start('b');
          try {
            await vi.waitFor(() => expect(finishes.has('b')).toBe(true));
            for (const ws of [first, first === 'a' ? 'b' : 'a']) {
              finishes.get(ws)!({ success: true, queued: true, queuedMessage: row(`${ws}-only`) });
              await flush();
            }
            await Promise.all([a, b]);
            expect(
              selectAgentQueueMessages.select(store.state, agentId).map((item) => item.id),
            ).toEqual(['b-only']);
          } finally {
            for (const finish of finishes.values()) finish({ success: true });
            await Promise.all([a, b]);
          }
        },
      );

      it.each(['restore', 'activate'])(
        'does not rebind B when pending %s for A finishes',
        async (phase) => {
          if (phase === 'activate')
            store.dispatch(
              bulkUpsertSessions([
                { ...session('a'), status: AgentStatus.Pending, backendSessionId: null },
              ]),
            );
          let finish!: (value: unknown) => void;
          request.mockImplementation(async (name: string, params: { workspaceId?: string }) => {
            if (name === 'agent.get' && params.workspaceId === 'a')
              return new Promise((resolve) => {
                finish = resolve;
              });
            if (name === 'agent.get') return { agent: session(params.workspaceId ?? 'a') };
            return {};
          });
          const pending =
            phase === 'activate'
              ? store.dispatch(activateAgentRequested('a', agentId))
              : start('a');
          await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
          await ensureAgentSession(agentId, 'b');
          reconnect.forEach((cb) => cb());
          finish({ agent: session('a') });
          await pending;
          expect(store.state.agentSessions.byAgentId[agentId].workspaceId).toBe('b');
          expect(request.mock.calls.filter(([name]) => name === method)).toHaveLength(0);
        },
      );
    }
    it.each([
      [false, 'success'],
      [true, 'success'],
      [false, 'failure'],
      [true, 'failure'],
      [true, 'reject'],
      ['store-only', 'success'],
      ['same-workspace-reconnect', 'success'],
    ] as const)(
      'ignores late %s / %s after rebind, including retry metadata and streaming',
      async (reconnected, outcome) => {
        await ensureAgentSession(agentId, 'a');
        store.dispatch(bulkUpsertSessions([session('a')]));
        store.dispatch(replaceAgentQueue(agentId, [], 'a'));
        let resolve!: (value: unknown) => void;
        let reject!: (reason: Error) => void;
        request.mockImplementation(async (name: string, params: { workspaceId?: string }) => {
          if (name === 'agent.get') return { agent: session(params.workspaceId ?? 'a') };
          if (name === method)
            return new Promise((yes, no) => {
              resolve = yes;
              reject = no;
            });
          return {};
        });
        const pending = start('a').catch(() => undefined);
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        const target = reconnected === 'same-workspace-reconnect' ? 'a' : 'b';
        if (reconnected !== 'store-only') await ensureAgentSession(agentId, target);
        store.dispatch(bulkUpsertSessions([session(target)]));
        store.dispatch(replaceAgentQueue(agentId, [row('b-private')], target));
        store.dispatch(chatReset(agentId));
        store.dispatch(setAgentStreaming(agentId, true));
        store.dispatch(chatLastAttemptedMessageSet(agentId, { text: 'b-private' }));
        const before = store.state.chatState.byAgentId[agentId];
        if (reconnected === true || reconnected === 'same-workspace-reconnect')
          reconnect.forEach((cb) => cb());
        if (outcome === 'reject') reject(new Error('old connection failed'));
        else
          resolve(
            outcome === 'success'
              ? { success: true, queued: true, queuedMessage: row('a-late') }
              : { success: false, error: 'old send failed' },
          );
        await pending;
        await flush();
        expect(store.state.agentQueue.byAgentId[agentId].workspaceId).toBe(target);
        expect(
          selectAgentQueueMessages.select(store.state, agentId).map((item) => item.id),
        ).toEqual(['b-private']);
        expect(store.state.chatState.byAgentId[agentId]).toEqual(before);
        expect(store.state.agentSessions.byAgentId[agentId].isStreaming).toBe(true);
        expect(request.mock.calls.filter(([name]) => name === method)).toHaveLength(1);
      },
    );
  },
);
