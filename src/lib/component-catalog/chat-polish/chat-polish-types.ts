import type { AgentMessage } from '$shared/types';

type ChatPolishScenarioId = 'comprehensive-conversation';

interface ChatPolishMessageFixture {
  message: AgentMessage;
  isStreaming?: boolean;
  isSticky?: boolean;
}

export interface ChatPolishScenario {
  id: ChatPolishScenarioId;
  items: ChatPolishConversationItem[];
}

type ChatPolishConversationItem =
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
