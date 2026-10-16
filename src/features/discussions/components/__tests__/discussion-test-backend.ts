import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
import { store } from '$store/renderer/store';
import { workspaceDiscussionSaga } from '$store/renderer/slices/workspace-discussion/sagas/workspace-discussion-saga';
import type {
  DiscussionMessage,
  DiscussionListParams,
  DiscussionSendParams,
} from '$shared/types/workspace-discussion';

export const startDiscussionTestSaga = () => store.runSaga(workspaceDiscussionSaga);

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
  installMockElectronBridge({
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
    finishOlder: () => finishOlder?.(),
    restore: () => {
      window.electronAPI = previousBridge;
    },
  };
}
