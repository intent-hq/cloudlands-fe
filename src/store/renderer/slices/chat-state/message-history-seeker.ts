import type { StoreAction } from '@themislib/themis/types';
import { CHAT_PAGE_SIZE } from '$shared/constants';
import type { AgentSession } from '$shared/types';
import type { AgentsClient } from '$lib/client/app-client';
import { Logger } from '$shared/logger';
import type { ChatAgentState } from './chat-state-types';
import {
  scrollbackFetchStarted,
  scrollbackSeekReleased,
  scrollbackSeekSettled,
} from './chat-state-slice';
import { seedHistoryAround, setHistoryOldestReached } from '../agent-session/agent-session-slice';

export const MESSAGE_HYDRATION_POLL_INTERVAL_MS = 150;
export const MESSAGE_HYDRATION_TIMEOUT_MS = 15_000;
const logger = new Logger('OpenMessage');

/** Canonical message-ID seek used by source navigation and the read-only reader. */
export function createMessageHistorySeeker({
  getConversation,
  readChat,
  readSession,
  hasMessage,
  dispatch,
}: {
  getConversation: AgentsClient['getConversation'];
  readChat: (agentId: string) => ChatAgentState;
  readSession: (agentId: string) => AgentSession | undefined | null;
  hasMessage: (agentId: string, messageId: string) => boolean;
  dispatch: (action: StoreAction<unknown>) => unknown;
}) {
  return async (
    agentId: string,
    messageId: string,
    workspaceId?: string,
    lifetime?: { isCurrent: () => boolean; signal: AbortSignal },
  ): Promise<boolean> => {
    const current = () => !lifetime || (!lifetime.signal.aborted && lifetime.isCurrent());
    const deadline = Date.now() + MESSAGE_HYDRATION_TIMEOUT_MS;
    while (readChat(agentId).initialHistoryPending) {
      if (!current() || Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, MESSAGE_HYDRATION_POLL_INTERVAL_MS));
    }
    const session = readSession(agentId);
    if (!current() || !session) return false;
    if (hasMessage(agentId, messageId)) return true;
    workspaceId ??= session.workspaceId;
    const previous = readChat(agentId);
    let tokens = {
      nextToken: previous.scrollbackOlderToken,
      prevToken: previous.scrollbackGapToken,
    };
    dispatch(scrollbackFetchStarted(agentId, 'seek'));
    const epoch = readChat(agentId).scrollbackDiscardEpoch;
    const ownsSeek = () =>
      Boolean(readSession(agentId)) && readChat(agentId).scrollbackDiscardEpoch === epoch;
    const release = () => {
      if (ownsSeek() && lifetime?.isCurrent()) dispatch(scrollbackSeekReleased(agentId));
    };
    lifetime?.signal.addEventListener('abort', release, { once: true });
    try {
      const page = await getConversation(
        agentId,
        CHAT_PAGE_SIZE,
        undefined,
        messageId,
        undefined,
        workspaceId,
      );
      if (!current() || !ownsSeek() || !page.messages.some((message) => message.id === messageId))
        return false;
      dispatch(seedHistoryAround(agentId, page.messages, page.messages[0]?.seq));
      if (page.nextToken === null) dispatch(setHistoryOldestReached(agentId));
      tokens = { nextToken: page.nextToken, prevToken: page.prevToken };
      return hasMessage(agentId, messageId);
    } catch (error) {
      if (current())
        logger.warn('[seekConversationToMessage] Seek fetch failed (message may no longer exist)', {
          agentId,
          messageId,
          error,
        });
      return false;
    } finally {
      lifetime?.signal.removeEventListener('abort', release);
      if (current() && ownsSeek()) dispatch(scrollbackSeekSettled(agentId, tokens));
    }
  };
}
