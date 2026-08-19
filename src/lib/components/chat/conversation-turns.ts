import type { AgentMessage } from '$shared/types';

export interface ConversationTurn {
  userMessage: AgentMessage | null;
  assistantMessages: AgentMessage[];
  noticeMessages: AgentMessage[];
}

export interface ConversationTurnGroup<TGroup> {
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
    current.assistantMessages[current.assistantMessages.length - 1],
    next.assistantMessages[0],
  );
}

export function hasOperationalAssistantTurnBoundary(
  current: ConversationTurn,
  next?: ConversationTurn | null,
): boolean {
  if (!next || next.userMessage || next.noticeMessages.length > 0) return false;
  return hasOperationalAssistantMessageBoundary(
    current.assistantMessages[current.assistantMessages.length - 1],
    next.assistantMessages[0],
  );
}

function isModelChangeNotice(message: AgentMessage): boolean {
  return message.metadata?.type === 'model_changed';
}

export function groupIntoTurns(messages: AgentMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = { userMessage: message, assistantMessages: [], noticeMessages: [] };
    } else if (message.role === 'assistant') {
      if (currentTurn) currentTurn.assistantMessages.push(message);
      else turns.push({ userMessage: null, assistantMessages: [message], noticeMessages: [] });
    } else if (isModelChangeNotice(message)) {
      if (currentTurn) currentTurn.noticeMessages.push(message);
      else turns.push({ userMessage: null, assistantMessages: [], noticeMessages: [message] });
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
      const turnKey =
        turn.userMessage?.id ?? `group-${group.groupKey ?? groupIndex}-turn-${turnIndex}`;
      globalIndexByTurnKey.set(turnKey, globalIndex++);
      if (turn.userMessage) turnKeyByMessageId.set(turn.userMessage.id, turnKey);
      for (const message of turn.assistantMessages) {
        turnKeyByMessageId.set(message.id, turnKey);
      }
      for (const message of turn.noticeMessages) {
        turnKeyByMessageId.set(message.id, turnKey);
      }
    });
  });

  return { groups: indexedGroups, globalIndexByTurnKey, turnKeyByMessageId };
}
