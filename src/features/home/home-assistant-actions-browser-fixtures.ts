import { IPC_CHANNELS } from '$shared/ipc-registry';
import { emitMockIpcEvent } from '$shared/ipc-mock-router';
import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  replaceMessages,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
import { chatSubscribeSaga } from '$store/renderer/slices/chat-state/sagas/chat-subscribe-saga';
import { unreadTrackingSaga } from '$store/renderer/slices/unread-tracking/sagas/unread-tracking-saga';
import type { AgentMessage } from '$shared/types';

interface ActionCall {
  method: string;
  params: Record<string, unknown>;
}

declare global {
  interface Window {
    __homeAssistantActions?: {
      calls: ActionCall[];
      prepareTranscriptTest: () => void;
      deliverTranscript: (agentId: string) => void;
      refreshActivity: (agentId: string, timestamp: string) => void;
      isUnread: (agentId: string) => boolean | undefined;
    };
  }
}

const SCRIPTED = new Set([
  'agent.update',
  'agent.retire',
  'agent.restore',
  'agent.delete',
  'agent.cancelDelete',
]);

function agentEvent(type: string, agentId: string, timestamp: string, changes: object) {
  routeDaemonEventsNotification('events.event', {
    event: {
      id: crypto.randomUUID(),
      type,
      workspaceId: '__chief__',
      timestamp,
      actor: { type: 'agent', id: agentId, name: agentId },
      data: { agentId, ...changes },
    },
  });
}

/**
 * Scripts the Assistant chat lifecycle writes (PROTOCOL §5.5: `agent.update`
 * pinned, `agent.retire`, `agent.restore`, `agent.delete` with the undo window,
 * `agent.cancelDelete`) and advertises `agentRetire` on `client.hello`.
 */
export function setupHomeAssistantActionsFixtures() {
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: ActionCall[] = [];
  const agents = new Map<string, Record<string, unknown>>();
  const transcripts = new Map<string, AgentMessage[]>();
  const subscriptions = new Map<string, string>();
  const stops: Array<() => void> = [];
  window.__homeAssistantActions = {
    calls,
    prepareTranscriptTest() {
      for (let index = 0; index < 4; index++) {
        const id = `home-assistant-${index}`;
        const { messages, ...summary } = store.state.agentSessions.byAgentId[id];
        const rows = messages.map((message) => ({
          ...message,
          timestamp: index === 1 || index === 2 ? '2026-09-29T12:20:00Z' : message.timestamp,
          ...(message.role === 'assistant'
            ? { contentBlocks: [{ type: 'text' as const, text: `Saved reply ${index}` }] }
            : {}),
        }));
        const tail = rows.at(-1)!;
        const agent = {
          ...summary,
          status: 'idle',
          pinned: index === 3,
          messageCount: rows.length,
          lastMessageId: tail.id,
          lastMessageRole: tail.role,
          metadata: { ...summary.metadata, ...(index === 2 ? {} : { lastSeenMessageId: tail.id }) },
        };
        agents.set(id, agent);
        transcripts.set(id, rows);
        store.dispatch(replaceMessages(id, []));
      }
      store.dispatch(bulkUpsertSessions([...agents.values()].map(normalizeAgent)));
      stops.push(
        store.runSaga(chatReadSaga),
        store.runSaga(chatSubscribeSaga),
        store.runSaga(unreadTrackingSaga),
      );
    },
    deliverTranscript(agentId) {
      const messages = transcripts
        .get(agentId)!
        .map((message, seq) => ({ ...message, agentId, seq }));
      emitMockIpcEvent(IPC_CHANNELS.BACKEND.NOTIFICATION, {
        method: 'subscription.push',
        params: {
          subscriptionId: subscriptions.get(agentId),
          kind: 'snapshot',
          seq: 0,
          snapshot: { agentId, messages, truncated: false, totalMessages: messages.length },
        },
      });
    },
    refreshActivity(agentId, timestamp) {
      Object.assign(agents.get(agentId)!, { lastActivity: timestamp, updatedAt: timestamp });
      agentEvent('agent:status-changed', agentId, timestamp, { status: 'active' });
    },
    isUnread: (agentId) => store.state.agentSessions.byAgentId[agentId]?.hasUnread,
  };
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: Record<string, unknown> };
      if (channel !== IPC_CHANNELS.BACKEND.REQUEST || !request?.method)
        return previous.invoke(channel, payload);
      if (request.method === 'client.hello') {
        const base = (await previous.invoke(channel, payload).catch(() => null)) as {
          result?: { server?: { capabilities?: Record<string, unknown> } };
        } | null;
        const result = base?.result ?? {};
        return {
          ok: true,
          result: {
            ...result,
            server: {
              ...result.server,
              capabilities: { ...result.server?.capabilities, agentRetire: 1 },
            },
          },
        };
      }
      const agentId = String(request.params?.agentId ?? '');
      const agent = agents.get(agentId);
      if (agent && request.params?.workspaceId === '__chief__') {
        switch (request.method) {
          case 'agent.get':
            calls.push({ method: request.method, params: { ...request.params } });
            return { ok: true, result: { agent: structuredClone(agent) } };
          case 'agent.getQueue':
            return { ok: true, result: { success: true, queue: [] } };
          case 'chat.subscribe': {
            calls.push({ method: request.method, params: { ...request.params } });
            const subscriptionId = crypto.randomUUID();
            subscriptions.set(agentId, subscriptionId);
            return { ok: true, result: { subscriptionId } };
          }
          case 'agent.markSeen': {
            calls.push({ method: request.method, params: { ...request.params } });
            const lastSeenMessageId = String(request.params.messageId);
            const metadata = agent.metadata as { lastSeenMessageId?: string };
            if (metadata.lastSeenMessageId !== lastSeenMessageId) {
              agent.metadata = { ...metadata, lastSeenMessageId };
              agentEvent('agent:updated', agentId, new Date().toISOString(), { lastSeenMessageId });
            }
            return { ok: true, result: { success: true, lastSeenMessageId } };
          }
        }
      }
      if (!SCRIPTED.has(request.method) || request.params?.workspaceId !== '__chief__')
        return previous.invoke(channel, payload);
      calls.push({ method: request.method, params: { ...request.params } });
      const now = new Date().toISOString();
      switch (request.method) {
        case 'agent.retire':
          return { ok: true, result: { success: true, retiredAt: now } };
        case 'agent.delete':
          return {
            ok: true,
            result: { success: true, scheduled: true, deleteAt: now },
          };
        case 'agent.cancelDelete':
          return { ok: true, result: { cancelled: true } };
        default:
          return { ok: true, result: { success: true } };
      }
    },
  };
  return () => {
    stops.forEach((stop) => stop());
    window.electronAPI = previous;
    delete window.__homeAssistantActions;
  };
}
