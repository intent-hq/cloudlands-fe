import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
import '$store/renderer/seeders/presence-bridge-seeder';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
import { store } from '$store/renderer/store';
import { workspaceDiscussionSaga } from '$store/renderer/slices/workspace-discussion/sagas/workspace-discussion-saga';
import type {
  DiscussionMessage,
  DiscussionConversation,
  DiscussionListParams,
  DiscussionSendParams,
  DiscussionReactParams,
  DiscussionAgentControlParams,
  DiscussionAgentActivity,
  DiscussionRenameParams,
  DiscussionDeleteParams,
} from '$shared/types/workspace-discussion';

export const startDiscussionTestSaga = () => {
  const stopDiscussion = store.runSaga(workspaceDiscussionSaga);
  const stopPresence = store.runSaga(presenceSaga);
  return () => {
    stopDiscussion();
    stopPresence();
  };
};

export function installDiscussionTestBackend(
  workspaceId: string,
  failSend: () => boolean,
  onRequests: (requests: Array<{ method: string; params: unknown }>) => void,
  options: {
    deferSend?: boolean;
    recentHistory?: boolean;
    principalMentions?: boolean;
    rejectSend?: 'invalid' | 'forbidden';
    messageActions?: boolean;
    agentMessaging?: boolean;
    agentActivity?: boolean;
    failRename?: boolean;
    failDelete?: boolean;
    legacyHistory?: boolean;
  } = {},
) {
  const requests: Array<{ method: string; params: unknown }> = [];
  let sendAttempts = 0;
  let finishOlder: (() => void) | undefined;
  let finishSend: (() => void) | undefined;
  const previousBridge = window.electronAPI;
  const author = { principalId: 'owner', displayName: 'Sam', login: 'sam', avatarUrl: null };
  const recipientMembers = [
    { principalId: 'alex', displayName: 'Alex', login: 'river-runner', avatarUrl: null },
    { principalId: 'jordan', displayName: 'Jordan', login: 'jordan', avatarUrl: null },
    { principalId: 'morgan', displayName: 'Morgan', login: 'morgan', avatarUrl: null },
  ];
  const self = { ...author, principalId: 'principal' };
  const conversation = (id = 'default', name?: string): DiscussionConversation => ({
    id,
    workspaceId,
    kind: 'workspace',
    ...(name ? { name } : {}),
    participants: [],
    createdAt: '2026-10-16T10:00:00Z',
  });
  const conversations = [
    conversation(),
    conversation('0199e991-0000-7000-8000-000000000001', 'Planning'),
    conversation('0199e991-0000-7000-8000-000000000002', 'Design'),
  ];
  if (options.legacyHistory) {
    conversations.push({
      id: '0199e991-0000-7000-8000-000000000003',
      workspaceId,
      kind: 'direct',
      participants: [self, recipientMembers[0]],
      createdAt: '2026-10-16T10:00:00Z',
    });
  }
  const reactions = new Map<
    string,
    { reactions: DiscussionMessage['reactions']; reactionVersion: number }
  >();
  const histories = new Map<string, DiscussionMessage[]>();
  if (options.legacyHistory) {
    const conversationId = '0199e991-0000-7000-8000-000000000003';
    histories.set(conversationId, [
      {
        ...message(1, 'An earlier private exchange.'),
        conversationId,
      },
    ]);
  }
  const activities = new Map<string, DiscussionAgentActivity>();
  function controlAgent(method: string, value: unknown) {
    const params = value as DiscussionAgentControlParams;
    record(method, params);
    const key = JSON.stringify([params.messageId, params.agentId]);
    const previous = activities.get(key);
    if (!previous || previous.attempt !== params.attempt) throw new Error('Stale attempt');
    const activity: DiscussionAgentActivity = {
      ...previous,
      attempt: previous.attempt + (method === 'discussion.retryAgent' ? 1 : 0),
      version: previous.version + 1,
      state: method === 'discussion.stopAgent' ? 'stopped' : 'queued',
      updatedAt: '2026-10-20T12:01:00Z',
    };
    activities.set(key, activity);
    return { activity };
  }
  function message(
    sequence: number,
    body = `Review note ${sequence}: keeping the discussion in view while the team works through the plan.`,
  ): DiscussionMessage {
    return {
      id: `message-${sequence}`,
      workspaceId,
      conversationId: 'default',
      sequence,
      body,
      author: options.recentHistory ? self : author,
      createdAt: options.recentHistory ? new Date().toISOString() : '2026-10-14T12:00:00Z',
      ...(options.agentMessaging ? { recipientAgentIds: [] } : {}),
      ...(options.agentActivity ? { agentMentions: [], agentActivity: [] } : {}),
      ...(options.principalMentions ? { principalMentions: [] } : {}),
      ...(options.messageActions !== false
        ? { replyToMessageId: null, replyTo: null, reactions: [], reactionVersion: 0 }
        : {}),
    };
  }
  function record(method: string, params: unknown) {
    requests.push({ method, params });
    onRequests([...requests]);
  }
  let peerPulse = 1;
  function receiveTyping(advance = false) {
    if (advance) peerPulse++;
    const pulse = (source: string) => ({ source, pulse: peerPulse, since: '2099-01-01T00:00:00Z' });
    const person = (principalId: string, displayName: string, sources: string[]) => ({
      principalId,
      displayName,
      login: null,
      avatarUrl: null,
      focus: [],
      typing: [],
      discussionTyping: sources.map(pulse),
    });
    routeDaemonEventsNotification(
      'events.event',
      {
        subscriptionId: 'ct-presence',
        event: {
          id: `typing-${peerPulse}`,
          type: 'presence:changed',
          workspaceId,
          data: {
            workspaceId,
            members: [
              person(store.state.principal.snapshot?.principal.id ?? 'owner', 'Me', [
                'self-device',
              ]),
              person('alex', 'Alex', ['alex-phone', 'alex-laptop']),
              person('samira', 'Samira', ['samira']),
            ],
          },
        },
      },
      ['ct-presence'],
    );
  }
  installMockElectronBridge({
    'system.capabilities': () => ({
      discussionConversations: 1,
      discussionManagement: 1,
      ...(options.principalMentions ? { discussionPrincipalMentions: 1 } : {}),
      ...(options.agentMessaging ? { discussionAgentMessaging: 1 } : {}),
      ...(options.agentActivity ? { discussionAgentActivity: 1 } : {}),
      ...(options.messageActions !== false ? { discussionMessageActions: 1 } : {}),
    }),
    'discussion.stopAgent': (params) => controlAgent('discussion.stopAgent', params),
    'discussion.retryAgent': (params) => controlAgent('discussion.retryAgent', params),
    'discussion.react': (value) => {
      const params = value as DiscussionReactParams;
      record('discussion.react', params);
      const previous = reactions.get(params.messageId);
      const result = {
        messageId: params.messageId,
        reactions: params.active ? [{ reaction: params.reaction, count: 1, reacted: true }] : [],
        reactionVersion: (previous?.reactionVersion ?? 0) + 1,
      };
      reactions.set(params.messageId, result);
      return result;
    },
    'discussion.conversations': (params) => {
      record('discussion.conversations', params);
      return {
        conversations: [...conversations].sort((a, b) =>
          a.id === b.id
            ? 0
            : a.id === 'default'
              ? -1
              : b.id === 'default'
                ? 1
                : a.id > b.id
                  ? -1
                  : 1,
        ),
        hasMore: false,
      };
    },
    'discussion.rename': (value) => {
      const params = value as DiscussionRenameParams;
      record('discussion.rename', params);
      if (options.failRename) throw new Error('Temporary rename failure');
      const index = conversations.findIndex((item) => item.id === params.conversationId);
      if (index < 0) throw new Error('Discussion not found');
      conversations[index] = { ...conversations[index], name: params.name.trim() };
      return { conversation: conversations[index] };
    },
    'discussion.delete': (value) => {
      const params = value as DiscussionDeleteParams;
      record('discussion.delete', params);
      if (options.failDelete) throw new Error('Temporary delete failure');
      const index = conversations.findIndex((item) => item.id === params.conversationId);
      if (index < 0) throw new Error('Discussion not found');
      conversations.splice(index, 1);
      histories.delete(params.conversationId);
      return { deleted: true, conversationId: params.conversationId };
    },
    'discussion.recipients': (params) => {
      record('discussion.recipients', params);
      const query = (params as { query?: string }).query?.toLowerCase() ?? '';
      return {
        members: recipientMembers.filter((person) =>
          [person.displayName, person.login, person.principalId]
            .join(' ')
            .toLowerCase()
            .includes(query),
        ),
        hasMore: false,
      };
    },
    'presence.snapshot': () => ({ workspaceId, members: [] }),
    'workspace.members.list': () => ({ members: [] }),
    'presence.update': (params) => {
      record('presence.update', params);
      return { ok: true, typingSource: 'own' };
    },
    'discussion.list': async (value) => {
      const params = value as DiscussionListParams;
      record('discussion.list', params);
      const descriptor = conversations.find(
        (item) => item.id === (params.conversationId ?? 'default'),
      )!;
      if (params.conversationId && params.conversationId !== 'default')
        return {
          conversation: descriptor,
          messages: (histories.get(params.conversationId) ?? []).filter(
            (message) =>
              (params.afterSequence === undefined || message.sequence > params.afterSequence) &&
              (params.beforeSequence === undefined || message.sequence < params.beforeSequence),
          ),
          hasMore: false,
        };
      if (params.afterSequence === 100)
        return {
          conversation: descriptor,
          messages: [message(101, 'Recovered after reconnect.')],
          hasMore: false,
        };
      if (params.afterSequence !== undefined)
        return { conversation: descriptor, messages: [], hasMore: false };
      if (params.beforeSequence && params.beforeSequence > 11) {
        const cached = Array.from({ length: 25 }, (_, i) => message(i + 11));
        if (params.beforeSequence > 101)
          cached.push(message(100), message(101, 'Recovered after reconnect.'));
        return {
          conversation: descriptor,
          messages: cached.filter((item) => item.sequence < params.beforeSequence!),
          hasMore: false,
        };
      }
      if (params.beforeSequence) {
        await new Promise<void>((resolve) => {
          finishOlder = resolve;
        });
        return {
          conversation: descriptor,
          messages: Array.from({ length: 10 }, (_, i) => message(i + 1)),
          hasMore: false,
        };
      }
      return {
        conversation: descriptor,
        messages: Array.from({ length: 25 }, (_, i) => message(i + 11)),
        hasMore: true,
      };
    },
    'discussion.send': async (value) => {
      const params = value as DiscussionSendParams;
      record('discussion.send', params);
      sendAttempts++;
      if (options.deferSend && sendAttempts === 1 && failSend())
        await new Promise<void>((resolve) => (finishSend = resolve));
      if (options.rejectSend && sendAttempts === 1)
        throw Object.assign(new Error('Rejected discussion send'), {
          rpcCode: options.rejectSend === 'invalid' ? -32602 : -32003,
        });
      if (failSend() && sendAttempts === 1) throw new Error('Temporary connection failure');
      let descriptor = conversations.find(
        (item) => item.id === (params.conversationId ?? 'default'),
      )!;
      if (params.createConversation) {
        descriptor = conversation(crypto.randomUUID());
        conversations.push(descriptor);
      }
      const quoted = params.replyToMessageId
        ? message(Number(params.replyToMessageId.replace('message-', '')))
        : undefined;
      const sent = {
        ...message(35 + sendAttempts, params.body),
        id: crypto.randomUUID(),
        author: self,
        ...(options.principalMentions ? { principalMentions: params.principalMentions ?? [] } : {}),
        ...(options.agentMessaging ? { recipientAgentIds: params.recipientAgentIds ?? [] } : {}),
        ...(options.agentActivity
          ? {
              agentMentions: params.agentMentions ?? [],
              agentActivity: (params.recipientAgentIds ?? []).map(
                (agentId): DiscussionAgentActivity => ({
                  agentId,
                  attempt: 1,
                  version: 1,
                  state: 'queued',
                  updatedAt: '2026-10-20T12:00:00Z',
                  error: null,
                }),
              ),
            }
          : {}),
        conversationId: descriptor.id,
        ...(quoted
          ? {
              replyToMessageId: quoted.id,
              replyTo: { id: quoted.id, author: quoted.author, body: quoted.body },
            }
          : {}),
      };
      histories.set(descriptor.id, [...(histories.get(descriptor.id) ?? []), sent]);
      for (const activity of sent.agentActivity ?? [])
        activities.set(JSON.stringify([sent.id, activity.agentId]), activity);
      if (options.deferSend && sendAttempts === 1)
        await new Promise<void>((resolve) => (finishSend = resolve));
      return { message: sent, conversation: descriptor };
    },
  });
  return {
    message,
    conversation,
    receiveMessage: (conversationId: string, own = false) => {
      const history = histories.get(conversationId) ?? [];
      const received: DiscussionMessage = {
        ...message((history.at(-1)?.sequence ?? 0) + 1, 'A new discussion update.'),
        conversationId,
        author: own ? self : recipientMembers[0],
      };
      histories.set(conversationId, [...history, received]);
      routeDaemonEventsNotification(
        'events.event',
        {
          subscriptionId: 'ct-discussion',
          event: {
            id: `discussion-${conversationId}-${received.sequence}`,
            type: 'discussion:message',
            workspaceId,
            data: {
              workspaceId,
              conversationId,
              conversation: conversations.find((item) => item.id === conversationId),
              message: received,
            },
          },
        },
        ['ct-discussion'],
      );
    },
    lastSent: () => histories.get('default')?.at(-1),
    completeActivity: (messageId: string, agentId: string) => {
      const key = JSON.stringify([messageId, agentId]);
      const previous = activities.get(key);
      if (!previous) return undefined;
      const activity: DiscussionAgentActivity = {
        ...previous,
        state: 'completed',
        version: previous.version + 1,
        updatedAt: '2026-10-20T12:02:00Z',
      };
      activities.set(key, activity);
      return activity;
    },
    receiveTyping,
    finishOlder: () => finishOlder?.(),
    finishSend: () => finishSend?.(),
    restore: () => {
      window.electronAPI = previousBridge;
    },
  };
}
