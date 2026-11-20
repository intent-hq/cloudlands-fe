import type { AgentMessage } from '$shared/types';
import { readAdvisoryWake } from './advisory-wake';
import type { ConversationTurn } from './conversation-turns';

export function advisoryFoldKey(message?: AgentMessage | null): string | null {
  const metadata = message?.metadata;
  if (message?.role !== 'user' || metadata?.type !== 'event_notification') return null;
  const waiting = readAdvisoryWake(metadata);
  if (!waiting || metadata.eventCount !== 1 || !Array.isArray(metadata.events)) return null;
  if (metadata.events.length !== 1) return null;
  const event = metadata.events[0];
  if (event?.type !== 'agent:idle' || !event.data || typeof event.data !== 'object') return null;
  const data = event.data as Record<string, unknown>;
  const agentId = typeof data.agentId === 'string' ? data.agentId.trim() : '';
  if (!agentId || data.completionReport || data.report) return null;
  return JSON.stringify([
    agentId,
    data.agentName ?? data.name ?? null,
    waiting.refs.length > 2 ? waiting.refs.length : waiting.refs,
  ]);
}

export function foldRepeatedAdvisoryTurns(
  turns: ConversationTurn[],
  keepMessageId?: string | null,
): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let previousKey: string | null = null;
  for (const turn of turns) {
    const key = advisoryFoldKey(turn.userMessage);
    const previous = result.at(-1);
    if (
      key !== null &&
      key === previousKey &&
      previous?.userMessage &&
      previous.userMessage.id !== keepMessageId &&
      previous.bodyMessages.length === 0 &&
      previous.noticeMessages.length === 0
    ) {
      result[result.length - 1] = {
        ...turn,
        foldedMessages: [
          ...(previous.foldedMessages ?? []),
          previous.userMessage,
          ...(turn.foldedMessages ?? []),
        ],
      };
    } else result.push(turn);
    previousKey = key;
  }
  return result;
}
