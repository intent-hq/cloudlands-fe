import type { AgentMessage } from '$shared/types';
import { getAttentionNotice } from './attention-notice';

export interface ConversationTurn {
  userMessage: AgentMessage | null;
  /** Assistant output and recognized system notices in transcript order. */
  bodyMessages: AgentMessage[];
  /** Assistant-only projection for streaming, model selection, and completion UI. */
  assistantMessages: AgentMessage[];
  /** Model-change and provider re-home notices retain their placement before the turn body. */
  noticeMessages: AgentMessage[];
}

interface ConversationTurnGroup<TGroup> {
  group: TGroup;
  turns: ConversationTurn[];
}

export interface ConversationTurnIndex<TGroup> {
  groups: Array<ConversationTurnGroup<TGroup>>;
  globalIndexByTurnKey: Map<string, number>;
  turnKeyByMessageId: Map<string, string>;
}

function isVisibleTranscriptBlock(
  block: NonNullable<AgentMessage['contentBlocks']>[number],
): boolean {
  if (block.type === 'tool_result') return false;
  if (block.type !== 'text') return true;
  return Boolean((block.text ?? block.content ?? '').trim());
}

export function isToolOnlyAssistantMessage(message?: AgentMessage | null): boolean {
  if (message?.role !== 'assistant') return false;
  const visibleBlocks = (message.contentBlocks ?? []).filter(isVisibleTranscriptBlock);
  return visibleBlocks.length > 0 && visibleBlocks.every((block) => block.type === 'tool_use');
}

export function isOperationalOnlyAssistantMessage(message?: AgentMessage | null): boolean {
  if (message?.role !== 'assistant') return false;
  const visibleBlocks = (message.contentBlocks ?? []).filter(isVisibleTranscriptBlock);
  return (
    visibleBlocks.length > 0 &&
    visibleBlocks.every((block) => block.type === 'tool_use' || block.type === 'thinking')
  );
}

export function hasToolOnlyAssistantMessageBoundary(
  previous?: AgentMessage | null,
  current?: AgentMessage | null,
): boolean {
  return isToolOnlyAssistantMessage(previous) && isToolOnlyAssistantMessage(current);
}

export function hasOperationalAssistantMessageBoundary(
  previous?: AgentMessage | null,
  current?: AgentMessage | null,
): boolean {
  return isOperationalOnlyAssistantMessage(previous) && isOperationalOnlyAssistantMessage(current);
}

export function hasToolOnlyAssistantTurnBoundary(
  current: ConversationTurn,
  next?: ConversationTurn | null,
): boolean {
  if (!next || next.userMessage || next.noticeMessages.length > 0) return false;
  return hasToolOnlyAssistantMessageBoundary(
    current.bodyMessages[current.bodyMessages.length - 1],
    next.bodyMessages[0],
  );
}

export function hasOperationalAssistantTurnBoundary(
  current: ConversationTurn,
  next?: ConversationTurn | null,
): boolean {
  if (!next || next.userMessage || next.noticeMessages.length > 0) return false;
  return hasOperationalAssistantMessageBoundary(
    current.bodyMessages[current.bodyMessages.length - 1],
    next.bodyMessages[0],
  );
}

function isModelChangeNotice(message: AgentMessage): boolean {
  const type = message.metadata?.type;
  return type === 'model_changed' || type === 'provider_rehomed';
}

function isInlineSystemNotice(message: AgentMessage): boolean {
  return (
    message.role === 'system' &&
    (message.contentBlocks?.[0]?.meta?.kind === 'interruption' ||
      getAttentionNotice(message) !== null)
  );
}

export function groupIntoTurns(messages: AgentMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        userMessage: message,
        bodyMessages: [],
        assistantMessages: [],
        noticeMessages: [],
      };
    } else if (message.role === 'assistant') {
      if (currentTurn) {
        currentTurn.assistantMessages.push(message);
        currentTurn.bodyMessages.push(message);
      } else
        turns.push({
          userMessage: null,
          bodyMessages: [message],
          assistantMessages: [message],
          noticeMessages: [],
        });
    } else if (isModelChangeNotice(message)) {
      if (currentTurn) currentTurn.noticeMessages.push(message);
      else
        turns.push({
          userMessage: null,
          bodyMessages: [],
          assistantMessages: [],
          noticeMessages: [message],
        });
    } else if (isInlineSystemNotice(message)) {
      if (currentTurn) currentTurn.bodyMessages.push(message);
      else
        turns.push({
          userMessage: null,
          bodyMessages: [message],
          assistantMessages: [],
          noticeMessages: [],
        });
    }
  }

  if (currentTurn) turns.push(currentTurn);
  return turns;
}

export function indexConversationTurns<
  TGroup extends { messages: AgentMessage[]; groupKey?: string },
>(groups: TGroup[]): ConversationTurnIndex<TGroup> {
  const indexedGroups: Array<ConversationTurnGroup<TGroup>> = [];
  const globalIndexByTurnKey = new Map<string, number>();
  const turnKeyByMessageId = new Map<string, string>();
  let globalIndex = 0;

  groups.forEach((group, groupIndex) => {
    const turns = groupIntoTurns(group.messages);
    indexedGroups.push({ group, turns });
    turns.forEach((turn, turnIndex) => {
      // Orphan turns key off the group's stable `groupKey` when present
      // (scrollback composition — positional indexes shift on history
      // prepends and would churn LazyTurn height caches), else the
      // positional index (tail-only transcript, unchanged keys).
      // PARTIAL stability: `turnIndex` is still the turn's position WITHIN
      // the group, so a same-day prepend that inserts turns at the front of
      // an existing group re-keys the following orphan turns (assistant-only
      // turns; user-message turns key off the message id). Follow-up option:
      // key orphan turns off their first message id.
      const turnKey =
        turn.userMessage?.id ?? `group-${group.groupKey ?? groupIndex}-turn-${turnIndex}`;
      globalIndexByTurnKey.set(turnKey, globalIndex++);
      if (turn.userMessage) turnKeyByMessageId.set(turn.userMessage.id, turnKey);
      for (const message of turn.bodyMessages) {
        turnKeyByMessageId.set(message.id, turnKey);
      }
      for (const message of turn.noticeMessages) {
        turnKeyByMessageId.set(message.id, turnKey);
      }
    });
  });

  return { groups: indexedGroups, globalIndexByTurnKey, turnKeyByMessageId };
}
