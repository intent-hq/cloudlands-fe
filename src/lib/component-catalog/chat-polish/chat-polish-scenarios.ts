import {
  activeHookWakeMessage,
  agentMessage,
  assistantRichMessage,
  changedFilesMessage,
  coordinatorMessage,
  failedToolMessage,
  finalCompletionMessage,
  interruptedAssistantMessage,
  longUserMessage,
  mixedOrderMessage,
  nestedGroupAttemptMessage,
  optimisticUserMessage,
  queuedUserMessage,
  recoveryMessage,
  repeatedGroupsMessage,
  retiredHookWakeMessage,
  retryUserMessage,
  shortUserMessage,
  streamingMessage,
  toolStateMatrixMessage,
  turnFailureMessage,
  wakeResponseMessage,
} from './chat-polish-messages';
import type { ChatPolishScenario, ChatPolishWakeFixture } from './chat-polish-types';

export const longCompletionReport =
  'The UI verifier measured all operational seams at minimum, default, and maximum values. ' +
  'Static, streaming, grouped, hidden-result, and expanded-detail paths now agree at both zoom levels.\n\n' +
  'The final report keeps deliberate line breaks, Unicode text such as 你好世界 and café, and a long token such as ' +
  'completion-report-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 without clipping.';

const coordinationWake: ChatPolishWakeFixture = {
  eventCount: 2,
  eventTypes: ['agent:reportToParent', 'agent:idle'],
  events: [
    {
      type: 'agent:reportToParent',
      timestamp: '2026-08-15T12:01:00.000Z',
      data: {
        agentId: 'fixture-layout-agent',
        agentName: 'Layout verifier',
        report: 'Sent the row ownership findings to the coordinator.',
      },
    },
    {
      type: 'agent:idle',
      timestamp: '2026-08-15T12:02:00.000Z',
      data: {
        agentId: 'fixture-accessibility-agent',
        agentName: 'Accessibility verifier',
        completionReport: longCompletionReport,
      },
    },
  ],
};

const completionWake: ChatPolishWakeFixture = {
  eventCount: 1,
  eventTypes: ['agent:idle'],
  events: [
    {
      type: 'agent:idle',
      timestamp: '2026-08-15T12:04:00.000Z',
      data: {
        agentId: 'fixture-browser-agent',
        agentName: 'Browser verifier',
        completionReport: longCompletionReport,
      },
    },
  ],
};

export const comprehensiveChatPolishConversation: ChatPolishScenario = {
  id: 'comprehensive-conversation',
  items: [
    { kind: 'message', message: shortUserMessage },
    { kind: 'message', message: assistantRichMessage },
    { kind: 'message', message: longUserMessage },
    { kind: 'message', message: mixedOrderMessage },
    { kind: 'message', message: optimisticUserMessage },
    { kind: 'message', message: queuedUserMessage, isSticky: true },
    { kind: 'message', message: streamingMessage, isStreaming: true },
    { kind: 'message', message: coordinatorMessage },
    { kind: 'message', message: agentMessage },
    { kind: 'wake', id: 'coordination-wake', wake: coordinationWake },
    {
      kind: 'subscriptions',
      id: 'after-all-collapsed',
      agentCount: 9,
      expanded: false,
      cohort: 'after_all',
      finishedCount: 2,
    },
    { kind: 'message', message: repeatedGroupsMessage },
    { kind: 'message', message: nestedGroupAttemptMessage },
    {
      kind: 'subscriptions',
      id: 'after-all-expanded',
      agentCount: 7,
      expanded: true,
      cohort: 'after_all',
    },
    { kind: 'message', message: toolStateMatrixMessage },
    { kind: 'message', message: failedToolMessage },
    { kind: 'message', message: turnFailureMessage },
    { kind: 'message', message: interruptedAssistantMessage },
    { kind: 'message', message: retryUserMessage },
    { kind: 'message', message: retiredHookWakeMessage },
    { kind: 'message', message: recoveryMessage },
    {
      kind: 'subscriptions',
      id: 'immediate-expanded',
      agentCount: 1,
      expanded: true,
      cohort: 'immediate',
    },
    { kind: 'message', message: activeHookWakeMessage },
    { kind: 'wake', id: 'completion-wake', wake: completionWake },
    { kind: 'message', message: wakeResponseMessage },
    { kind: 'changed-files', id: 'changed-files', message: changedFilesMessage },
    { kind: 'message', message: finalCompletionMessage },
    {
      kind: 'suggested-prompts',
      id: 'suggested-prompts',
      prompts: [
        'Review the narrow layout',
        'Compare light and dark themes',
        'Measure the operational gaps again',
      ],
    },
  ],
};

export const chatPolishScenarios: ChatPolishScenario[] = [comprehensiveChatPolishConversation];

export function getChatPolishScenario(id: string): ChatPolishScenario | undefined {
  return id === comprehensiveChatPolishConversation.id
    ? comprehensiveChatPolishConversation
    : undefined;
}
