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

export function indexConversationTurns<TGroup extends { messages: AgentMessage[] }>(
  groups: TGroup[],
): ConversationTurnIndex<TGroup> {
  const indexedGroups: Array<ConversationTurnGroup<TGroup>> = [];
  const globalIndexByTurnKey = new Map<string, number>();
  const turnKeyByMessageId = new Map<string, string>();
  let globalIndex = 0;

  groups.forEach((group, groupIndex) => {
    const turns = groupIntoTurns(group.messages);
    indexedGroups.push({ group, turns });
    turns.forEach((turn, turnIndex) => {
      const turnKey = turn.userMessage?.id ?? `group-${groupIndex}-turn-${turnIndex}`;
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