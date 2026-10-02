import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AgentsClient } from '$lib/client/app-client';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { AgentStatus } from '$shared/types';
import {
  agentSessionRetryLastMessageRequested,
  updateSession,
} from '../../agent-session/agent-session-slice';
import { chatErrorCleared, chatSendFailed } from '../../chat-state/chat-state-slice';
import { selectChatAgentState, selectChatError } from '../../chat-state/chat-state-selectors';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import { selectUserMessageIndexUi } from '../chat-panel-ui-selectors';
import {
  chatPanelRetryAgentFinished,
  chatPanelRetryAgentRequested,
  userMessageIndexFinished,
  userMessageIndexRequested,
} from '../chat-panel-ui-slice';

type Client = Pick<AgentsClient, 'listUserMessages' | 'retry'>;
type IndexAction = ReturnType<typeof userMessageIndexRequested>;
type RetryAction = ReturnType<typeof chatPanelRetryAgentRequested>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* indexIsCurrent(action: IndexAction): SagaGenerator<boolean> {
  const [workspaceId, consumerId, requestId] = action.payload;
  const current = yield* selectUserMessageIndexUi.effect(workspaceId, consumerId);
  return current?.requestId === requestId && current.status === 'pending';
}

function* loadUserMessageIndex(client: Client, action: IndexAction): SagaGenerator<void> {
  const [workspaceId, consumerId, requestId, agentId, epoch] = action.payload;
  try {
    const result = yield* call([client, client.listUserMessages], agentId, undefined, workspaceId);
    if (!(yield* indexIsCurrent(action))) return;
    if ((yield* selectChatAgentState.effect(agentId)).scrollbackDiscardEpoch !== epoch) {
      yield* put(userMessageIndexFinished(workspaceId, consumerId, requestId, 'cancelled'));
      return;
    }
    yield* put(
      userMessageIndexFinished(
        workspaceId,
        consumerId,
        requestId,
        result.ok || result.unsupported ? 'succeeded' : 'failed',
        result,
        result.ok ? undefined : result.error,
      ),
    );
  } catch (error) {
    if (yield* indexIsCurrent(action))
      yield* put(
        userMessageIndexFinished(
          workspaceId,
          consumerId,
          requestId,
          'failed',
          undefined,
          errorMessage(error),
        ),
      );
  } finally {
    if ((yield* cancelled()) && (yield* indexIsCurrent(action)))
      yield* put(userMessageIndexFinished(workspaceId, consumerId, requestId, 'cancelled'));
  }
}

function* retryAgent(client: Client, action: RetryAction): SagaGenerator<void> {
  const [workspaceId, consumerId, requestId, agentId] = action.payload;
  const priorError =
    (yield* selectChatError.effect(agentId)) ?? m.chat_chatPanel_agentFailedToStart_error();
  try {
    yield* put(chatErrorCleared(agentId));
    const result = yield* call([client, client.retry], agentId, workspaceId);
    if (!result.ok) {
      const failure = result.error || priorError;
      yield* put(chatSendFailed(agentId, failure));
      yield* put(agentSessionRetryLastMessageRequested(agentId, workspaceId));
      yield* put(
        chatPanelRetryAgentFinished(workspaceId, consumerId, requestId, 'failed', failure),
      );
      return;
    }
    yield* put(
      updateSession(agentId, {
        status: result.redriven === false ? AgentStatus.RuntimeIdle : AgentStatus.Pending,
        stopReason: null,
      }),
    );
    if (result.redriven === false) notify.info(m.chat_chatPanel_nothingToRetry_toast());
    yield* put(chatPanelRetryAgentFinished(workspaceId, consumerId, requestId, 'succeeded'));
  } catch (error) {
    const failure = errorMessage(error) || priorError;
    yield* put(chatSendFailed(agentId, failure));
    yield* put(agentSessionRetryLastMessageRequested(agentId, workspaceId));
    yield* put(chatPanelRetryAgentFinished(workspaceId, consumerId, requestId, 'failed', failure));
  } finally {
    if (yield* cancelled())
      yield* put(chatPanelRetryAgentFinished(workspaceId, consumerId, requestId, 'cancelled'));
  }
}

function* discardRetry(action: RetryAction): SagaGenerator<void> {
  const [workspaceId, consumerId, requestId] = action.payload;
  yield* put(chatPanelRetryAgentFinished(workspaceId, consumerId, requestId, 'cancelled'));
}

export function* chatPanelUiSaga(client: Client = appClient.agents): SagaGenerator<void> {
  yield* takeEvery(userMessageIndexRequested, loadUserMessageIndex, client);
  yield* takeEveryByContextFIFO(
    chatPanelRetryAgentRequested,
    (action) => action.payload[3],
    retryAgent,
    { onDiscardPending: discardRetry },
    client,
  );
}
