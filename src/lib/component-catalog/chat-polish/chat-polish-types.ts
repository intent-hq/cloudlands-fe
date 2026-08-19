import type { AgentMessage } from '$shared/types';

export type ChatPolishScenarioId = 'comprehensive-conversation';

export interface ChatPolishMessageFixture {
  message: AgentMessage;
  isStreaming?: boolean;
  isSticky?: boolean;
}

export interface ChatPolishScenario {
  id: ChatPolishScenarioId;
  items: ChatPolishConversationItem[];
}

export type ChatPolishConversationItem =
  | ({ kind: 'message' } & ChatPolishMessageFixture)
  | { kind: 'wake'; id: string; wake: ChatPolishWakeFixture }
  | {
      kind: 'subscriptions';
      id: string;
      agentCount: number;
      expanded: boolean;
      cohort: 'after_all' | 'immediate';
      finishedCount?: number;
    }
  | { kind: 'changed-files'; id: string; message: AgentMessage }
  | { kind: 'suggested-prompts'; id: string; prompts: string[] };

export interface ChatPolishWakeFixture {
  eventCount: number;
  eventTypes: string[];
  events: Array<{
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>;
}

export interface ChatPolishSubscriptionFixture {
  id: string;
  agentCount: 0 | 1 | 6 | 7;
  expanded: boolean;
}
