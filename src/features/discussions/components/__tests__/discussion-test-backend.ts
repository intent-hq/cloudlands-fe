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
  options: { deferSend?: boolean; rejectSend?: 'invalid' | 'forbidden' } = {},
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
  const conversation = (
    id = 'default',
    participants = [self, recipientMembers[0]],
  ): DiscussionConversation => ({
    id,
    workspaceId,
    kind: id === 'default' ? 'workspace' : participants.length === 2 ? 'direct' : 'group',
    participants: id === 'default' ? [] : participants,
    createdAt: '2026-10-16T10:00:00Z',
  });
  const conversations = [
    conversation(),
    conversation('0199e991-0000-7000-8000-000000000001'),
    conversation('0199e991-0000-7000-8000-000000000002', [self, recipientMembers[1]]),
  ];
  const histories = new Map<string, DiscussionMessage[]>();
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
      author,
      createdAt: '2026-10-14T12:00:00Z',
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
    'system.capabilities': () => ({ discussionConversations: 1 }),
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
      if (options.deferSend && sendAttempts === 1)
        await new Promise<void>((resolve) => (finishSend = resolve));
      if (options.rejectSend && sendAttempts === 1)
        throw Object.assign(new Error('Rejected recipients'), {
          rpcCode: options.rejectSend === 'invalid' ? -32602 : -32003,
        });
      if (failSend() && sendAttempts === 1) throw new Error('Temporary connection failure');
      let descriptor = conversations.find(
        (item) => item.id === (params.conversationId ?? 'default'),
      )!;
      if (params.recipientPrincipalIds) {
        descriptor = conversation(crypto.randomUUID(), [
          self,
          ...recipientMembers.filter((person) =>
            params.recipientPrincipalIds?.includes(person.principalId),
          ),
        ]);
        conversations.push(descriptor);
      }
      const sent = {
        ...message(35 + sendAttempts, params.body),
        id: crypto.randomUUID(),
        author: self,
        conversationId: descriptor.id,
      };
      histories.set(descriptor.id, [...(histories.get(descriptor.id) ?? []), sent]);
      return { message: sent, conversation: descriptor };
    },
  });
  return {
    message,
    conversation,
    receiveTyping,
    finishOlder: () => finishOlder?.(),
    finishSend: () => finishSend?.(),
    restore: () => {
      window.electronAPI = previousBridge;
    },
  };
}
