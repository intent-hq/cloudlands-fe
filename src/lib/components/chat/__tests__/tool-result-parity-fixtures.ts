import { ChatTranscriptReconciler } from '$lib/client/live/live-chat-client';
import type { AgentMessage, ContentBlock } from '$shared/types';

const messageId = 'message-tool-result-parity';

export function reconcileToolResultMessage(
  blocks: ContentBlock[],
  streamingComplete = false,
): AgentMessage {
  const reconciler = new ChatTranscriptReconciler();
  reconciler.applySnapshot(0, {
    agentId: 'agent-tool-result-parity',
    messages: [],
    truncated: false,
    totalMessages: 0,
    deltaEncoding: 'incremental',
  });
  const added = blocks.map((block, index) => ({
    messageId,
    role: 'assistant' as const,
    block: { ...block, id: block.id ?? `${messageId}:${index}` },
    streamingComplete: streamingComplete && index === blocks.length - 1,
  }));
  if (reconciler.applyDelta(1, { added, updated: [], removedIds: [] }) !== 'applied') {
    throw new Error('Tool-result parity fixture did not reconcile');
  }
  return reconciler.transcript().messages[0];
}

export const liveGroupBlocks = (): ContentBlock[] => [
  { type: 'text', text: '<group:Inspecting>' },
  { type: 'thinking', text: 'Review the production renderer path.' },
];

export const orphanResultBlocks = (): ContentBlock[] => [
  ...liveGroupBlocks(),
  { type: 'text', text: '</group:Inspecting>' },
  {
    type: 'tool_result',
    tool_use_id: 'call-without-visible-use',
    output: 'orphan-search-marker',
  },
];

export const pairedResultBlocks = (): ContentBlock[] => [
  {
    type: 'tool_use',
    toolCallId: 'call-visible-shell',
    name: 'launch-process',
    input: { command: 'printf paired' },
  },
  { type: 'text', text: '<group:Final check>' },
  { type: 'thinking', text: 'The paired result must stay with its call.' },
  { type: 'text', text: '</group:Final check>' },
  {
    type: 'tool_result',
    tool_use_id: 'call-visible-shell',
    output: 'paired-result-marker',
  },
];

export const resilienceBlocks = (): ContentBlock[] => [
  { type: 'text', text: '   ' },
  {
    type: 'tool_use',
    toolCallId: 'call-first',
    name: 'launch-process',
    input: { command: 'printf first' },
  },
  { type: 'text', text: '<group:Checks>Keep the titled group.' },
  {
    type: 'tool_use',
    toolCallId: 'call-second',
    name: 'workspace_api',
    input: { summary: 'Verify result parity' },
  },
  { type: 'tool_result', tool_use_id: 'call-first', output: 'first-paired-marker' },
  {
    type: 'tool_result',
    tool_use_id: 'call-second',
    output: 'Error: second-paired-marker',
    is_error: true,
  },
  { type: 'text', text: '</group:Checks>Trailing prose stays visible.' },
  { type: 'tool_result', output: 'missing-id-orphan-marker' },
  {
    type: 'tool_result',
    tool_use_id: 'call-missing',
    output: 'later-orphan-marker',
  },
];
