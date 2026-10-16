import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
import '$store/renderer/seeders/presence-bridge-seeder';
import { routeDaemonEventsNotification } from '$features/events/daemon-events-bridge.client';
import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
import { store } from '$store/renderer/store';
import { workspaceDiscussionSaga } from '$store/renderer/slices/workspace-discussion/sagas/workspace-discussion-saga';
import type {
  DiscussionMessage,
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
) {
  const requests: Array<{ method: string; params: unknown }> = [];
  let sendAttempts = 0;
  let finishOlder: (() => void) | undefined;
  const previousBridge = window.electronAPI;
  const author = { principalId: 'owner', displayName: 'Sam', login: 'sam', avatarUrl: null };
  function message(
    sequence: number,
    body = `Review note ${sequence}: keeping the discussion in view while the team works through the plan.`,
  ): DiscussionMessage {
    return {
      id: `message-${sequence}`,
      workspaceId,
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
    'presence.snapshot': () => ({ workspaceId, members: [] }),
    'workspace.members.list': () => ({ members: [] }),
    'presence.update': (params) => {
      record('presence.update', params);
      return { ok: true, typingSource: 'own' };
    },
    'discussion.list': async (value) => {
      const params = value as DiscussionListParams;
      record('discussion.list', params);
      if (params.afterSequence === 100)
        return { messages: [message(101, 'Recovered after reconnect.')], hasMore: false };
      if (params.afterSequence !== undefined) return { messages: [], hasMore: false };
      if (params.beforeSequence) {
        await new Promise<void>((resolve) => {
          finishOlder = resolve;
        });
        return { messages: Array.from({ length: 10 }, (_, i) => message(i + 1)), hasMore: false };
      }
      return { messages: Array.from({ length: 25 }, (_, i) => message(i + 11)), hasMore: true };
    },
    'discussion.send': (value) => {
      const params = value as DiscussionSendParams;
      record('discussion.send', params);
      sendAttempts++;
      if (failSend() && sendAttempts === 1) throw new Error('Temporary connection failure');
      return { message: { ...message(35 + sendAttempts, params.body), id: crypto.randomUUID() } };
    },
  });
  return {
    message,
    receiveTyping,
    finishOlder: () => finishOlder?.(),
    restore: () => {
      window.electronAPI = previousBridge;
    },
  };
}
