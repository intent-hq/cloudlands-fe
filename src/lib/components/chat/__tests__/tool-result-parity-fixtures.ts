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

export function rehydrateToolResultMessage(blocks: ContentBlock[]): AgentMessage {
  const reconciler = new ChatTranscriptReconciler();
  reconciler.applySnapshot(0, {
    agentId: 'agent-tool-result-parity',
    messages: [
      {
        id: messageId,
        role: 'assistant',
        timestamp: '2026-01-01T00:00:00.000Z',
        contentBlocks: blocks.map((block, index) => ({
          ...block,
          id: block.id ?? `${messageId}:${index}`,
        })),
      },
    ],
    truncated: false,
    totalMessages: 1,
    deltaEncoding: 'incremental',
  });
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

export const objectEnvelopeOrphanBlocks = (): ContentBlock[] => [
  {
    type: 'tool_result',
    tool_use_id: 'missing-object-envelope-call',
    output: { output: 'object-orphan-marker' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'missing-unsupported-object-call',
    output: { privateMetadata: 'unsupported-object-hidden-marker' },
  },
];

export const groupedObjectEnvelopeOrphanBlocks = (): ContentBlock[] => [
  { type: 'text', text: '<group:Grouped object results>Visible object result summary.' },
  {
    type: 'tool_use',
    toolCallId: 'grouped-object-paired-call',
    name: 'launch-process',
    input: { command: 'printf paired-object' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'grouped-object-paired-call',
    output: { output: 'paired-object-marker' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'missing-grouped-object-call',
    output: { output: 'grouped-object-orphan-marker' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'missing-grouped-unsupported-call',
    output: { privateMetadata: 'grouped-unsupported-hidden-marker' },
  },
  { type: 'text', text: 'Visible object result ending.</group:Grouped object results>' },
];

export const markdownImageOrphanBlocks = (): ContentBlock[] => [
  {
    type: 'tool_result',
    tool_use_id: 'missing-markdown-image-call',
    output: [
      {
        type: 'text',
        text: [
          '![Workspace result image](intent://local/file/images/result.png)',
          '![External result image](https://example.com/unrelated.png)',
        ].join('\n'),
      },
    ],
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

export const groupedResultBlocks = (): ContentBlock[] => [
  { type: 'text', text: '<group:Grouped results>Grouped start marker.' },
  {
    type: 'tool_use',
    toolCallId: 'grouped-call-first',
    name: 'launch-process',
    input: { command: 'printf grouped-first' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'grouped-call-first',
    output: 'grouped-first-paired-marker',
  },
  { type: 'text', text: 'Grouped middle marker.' },
  {
    type: 'tool_result',
    tool_use_id: 'grouped-call-missing',
    output: 'grouped-orphan-search-marker',
  },
  {
    type: 'tool_use',
    toolCallId: 'grouped-call-error',
    name: 'workspace_api',
    input: { summary: 'Verify grouped result parity' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'grouped-call-error',
    output: 'Error: grouped-paired-error-marker',
    is_error: true,
  },
  {
    type: 'tool_result',
    tool_use_id: 'grouped-call-missing-id',
    output: 'Error: grouped-missing-id-orphan-marker',
    is_error: true,
  },
  { type: 'text', text: 'Grouped end marker.</group:Grouped results>' },
];

export const headinglessGroupedOrphanBlocks = (): ContentBlock[] => [
  { type: 'text', text: '<group:Prepping>Inline group start marker.' },
  { type: 'tool_result', tool_use_id: 'inline-missing-call', output: 'inline-orphan-marker' },
  { type: 'text', text: 'Inline group end marker.</group:Prepping>' },
];

export const liveGroupedOrphanBlocks = (): ContentBlock[] => [
  { type: 'text', text: '<group:Live grouped result>Live group preview.' },
  { type: 'thinking', text: 'Current visible live child.' },
  { type: 'tool_result', tool_use_id: 'live-missing-call', output: 'live-grouped-orphan' },
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
