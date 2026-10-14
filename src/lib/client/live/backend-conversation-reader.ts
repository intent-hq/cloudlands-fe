import { CHAT_PAGE_SIZE } from '$shared/constants';
import type { AgentMessage } from '$shared/types';
import type { BackendRuntime } from './backend-transport-runtime';

const MAX_OUTBOUND_FRAME_BYTES = 41_943_040;
const OVERSIZED_CONVERSATION_RESPONSE =
  /^response for agent\.getConversation exceeds maximum outbound frame size: ([1-9][0-9]*) bytes > 41943040 bytes$/;

function isOversizedConversationResponse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name !== 'BackendError' || typeof candidate.message !== 'string') return false;
  const match = OVERSIZED_CONVERSATION_RESPONSE.exec(candidate.message);
  return match !== null && Number(match[1]) > MAX_OUTBOUND_FRAME_BYTES;
}

/** Canonical slim history reader, shared by renderer bindings. */
export function createConversationReader({
  backendRequest,
}: Pick<BackendRuntime, 'backendRequest'>) {
  return async function getConversation(
    agentId: string,
    limit = CHAT_PAGE_SIZE,
    pageToken?: string,
    aroundMessageId?: string,
    aroundIndex?: number,
    workspaceId?: string,
  ): Promise<{
    messages: AgentMessage[];
    truncated: boolean;
    totalMessages: number;
    nextToken: string | null;
    prevToken: string | null;
  }> {
    type ConversationResult = {
      messages?: unknown[];
      truncated?: boolean;
      totalMessages?: number;
      nextToken?: unknown;
      prevToken?: unknown;
    };
    let requestLimit = limit;
    let result: ConversationResult;
    for (;;) {
      const params: Record<string, unknown> = {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        limit: requestLimit,
        projection: 'slim',
      };
      if (pageToken !== undefined) params.nextToken = pageToken;
      if (aroundMessageId !== undefined) params.aroundMessageId = aroundMessageId;
      if (aroundIndex !== undefined) params.aroundIndex = aroundIndex;
      try {
        result = await backendRequest<ConversationResult>('agent.getConversation', params);
        break;
      } catch (error) {
        if (
          !isOversizedConversationResponse(error) ||
          !Number.isFinite(requestLimit) ||
          requestLimit <= 1
        ) {
          throw error;
        }
        requestLimit = Math.max(1, Math.floor(requestLimit / 2));
      }
    }
    if (!result || typeof result !== 'object') {
      return { messages: [], truncated: false, totalMessages: 0, nextToken: null, prevToken: null };
    }
    const messages = Array.isArray(result.messages) ? (result.messages as AgentMessage[]) : [];
    return {
      messages,
      truncated: Boolean(result.truncated),
      totalMessages: typeof result.totalMessages === 'number' ? result.totalMessages : 0,
      nextToken: typeof result.nextToken === 'string' ? result.nextToken : null,
      prevToken: typeof result.prevToken === 'string' ? result.prevToken : null,
    };
  };
}
