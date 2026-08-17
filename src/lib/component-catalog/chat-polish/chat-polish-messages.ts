import type { AgentMessage, ContentBlock } from '$shared/types';

const FIXTURE_TIME = '2026-08-15T12:00:00.000Z';

function message(
  id: string,
  role: AgentMessage['role'],
  contentBlocks: ContentBlock[],
): AgentMessage {
  return { id, role, timestamp: FIXTURE_TIME, contentBlocks };
}

export const shortUserMessage = message('fixture-user-short', 'user', [
  { type: 'text', text: 'Please polish the chat transcript spacing.' },
]);

export const longUserMessage = message('fixture-user-long', 'user', [
  {
    type: 'text',
    text: '[Currently viewing file: src/lib/components/chat/ChatPanel.svelte]\nCompare the compact and wide layouts, keep the response rhythm stable, and verify the attachment and context-pill treatment at narrow widths.',
  },
  {
    type: 'file',
    attachmentId: 'fixture-attachment-1',
    fileName: 'spacing-reference.txt',
    mimeType: 'text/plain',
    size: 2048,
  },
  {
    type: 'image',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    mimeType: 'image/png',
    fileName: 'chat-reference.png',
  },
]);

export const optimisticUserMessage: AgentMessage = {
  ...message('fixture-user-optimistic', 'user', [
    { type: 'text', text: 'Queue this follow-up while the agent is still working.' },
  ]),
  metadata: { optimistic: true },
};

export const queuedUserMessage: AgentMessage = {
  ...message('fixture-user-queued', 'user', [
    {
      type: 'text',
      text: 'Verify the queued handoff after the current response.\n\n[SYSTEM NOTE] This message was queued at 2026-08-15T12:00:00.000Z and waited 12s before delivery.',
    },
  ]),
  metadata: { queueInfo: { queuedAt: FIXTURE_TIME, waitedMs: 12500 } },
};

export const assistantRichMessage = message('fixture-assistant-rich', 'assistant', [
  {
    type: 'text',
    text: 'The transcript now keeps a clear hierarchy.\n\n- **User prompts** have a larger handoff gap.\n- Rich Markdown keeps `inline code` and links readable.\n\n```ts\nconst gap = 10;\n```',
  },
]);

export const mixedOrderMessage = message('fixture-mixed-order', 'assistant', [
  {
    type: 'thinking',
    text: '**Check production** _spacing_, `tool rows`, [readable labels](https://example.com), &amp; escaped \\*markers\\* with Unicode 👩‍💻 first.',
  },
  {
    type: 'tool_use',
    id: 'fixture-mixed-command',
    toolCallId: 'call-mixed-command',
    name: 'launch-process',
    input: { command: 'pnpm vitest run chat-polish.test.ts' },
  },
  {
    type: 'tool_result',
    id: 'result-mixed-command',
    tool_use_id: 'call-mixed-command',
    output: 'Focused chat-polish tests passed.',
  },
  {
    type: 'tool_use',
    id: 'fixture-context-running',
    toolCallId: 'call-context-running',
    name: 'codebase-retrieval',
    input: { information_request: 'production chat spacing contracts' },
  },
  {
    type: 'tool_result',
    id: 'result-context-running',
    tool_use_id: 'call-context-running',
    output: [
      'The following code sections were retrieved:',
      'Path: src/lib/component-catalog/chat-polish/operational-disclosure-row.ts',
      '  12 | export const COMPACT_TOOL_ROW_CLASS =',
      'Path: src/lib/styles/tokens.css',
      '  42 | --chat-polish-thinking-top-gap: 16px;',
    ].join('\n'),
  },
  {
    type: 'tool_use',
    id: 'fixture-mixed-pending',
    toolCallId: 'call-mixed-pending',
    name: 'view',
    input: { path: 'src/lib/components/chat/MessageContent.svelte', view_range: [760, 835] },
  },
  { type: 'text', text: 'The shared response rhythm is consistent across prose and tools.' },
]);

export const repeatedGroupsMessage = message('fixture-repeated-groups', 'assistant', [
  { type: 'text', text: '<group:Inspecting>' },
  {
    type: 'tool_use',
    id: 'fixture-view-one',
    toolCallId: 'call-view-one',
    name: 'view',
    input: { path: 'src/lib/components/chat/ChatMessage.svelte', view_range: [1, 120] },
  },
  { type: 'tool_result', id: 'result-view-one', tool_use_id: 'call-view-one', output: 'ok' },
  {
    type: 'text',
    text: 'The **first component** uses the _shared_ `operational row` with a [readable label](https://example.com).</group>',
  },
  { type: 'text', text: '<group:Inspecting>' },
  {
    type: 'tool_use',
    id: 'fixture-view-two',
    toolCallId: 'call-view-two',
    name: 'view',
    input: { path: 'src/lib/components/chat/ResponseGroup.svelte', view_range: [1, 90] },
  },
  { type: 'tool_result', id: 'result-view-two', tool_use_id: 'call-view-two', output: 'ok' },
  { type: 'text', text: 'Repeated group names and tools stay deterministic.</group>' },
]);

export const nestedGroupAttemptMessage = message('fixture-nested-group-attempt', 'assistant', [
  {
    type: 'text',
    text: '<group:Outer review>Check the outer transcript layer.<group:Inner verification>',
  },
  {
    type: 'tool_use',
    id: 'fixture-nested-view',
    toolCallId: 'call-nested-view',
    name: 'view',
    input: { path: 'src/lib/components/chat/ResponseGroup.svelte', view_range: [190, 260] },
  },
  {
    type: 'tool_result',
    id: 'result-nested-view',
    tool_use_id: 'call-nested-view',
    output: 'Nested openings auto-close the active group.',
  },
  {
    type: 'text',
    text: 'The production parser renders this nested attempt as sibling groups.</group></group>',
  },
]);

export const failedToolMessage = message('fixture-failed-tool', 'assistant', [
  {
    type: 'tool_use',
    id: 'fixture-command-failed',
    toolCallId: 'call-command-failed',
    name: 'launch-process',
    input: { command: 'pnpm vitest run broken.test.ts' },
  },
  {
    type: 'tool_result',
    id: 'result-command-failed',
    tool_use_id: 'call-command-failed',
    output: 'Command failed with exit code 1.',
    is_error: true,
  },
  { type: 'text', text: 'The failed check is visible before the recovery response.' },
]);

export const wakeResponseMessage = message('fixture-wake-response', 'assistant', [
  { type: 'text', text: 'The background verification finished. All focused checks pass.' },
]);

export const streamingMessage = message('fixture-streaming', 'assistant', [
  {
    type: 'thinking',
    text: 'Compare the **streaming row** with the _completed_ `inline preview` layout.',
  },
  {
    type: 'tool_use',
    id: 'fixture-context-streaming',
    toolCallId: 'call-context-streaming',
    name: 'codebase-retrieval',
    input: { information_request: 'streaming transcript layout' },
  },
  { type: 'text', text: 'I am checking the final responsive state…' },
]);

export const turnFailureMessage = message('fixture-turn-failure', 'system', [
  {
    type: 'text',
    text: 'The fixture agent stopped before it could finish the response.',
    meta: { kind: 'turn-failure' },
  },
]);

export const changedFilesMessage = message('fixture-changed-files', 'assistant', [
  {
    type: 'tool_use',
    id: 'fixture-save-file',
    name: 'save_file',
    input: { path: 'src/lib/components/chat/ChatMessage.svelte', content: 'fixture' },
  },
]);

export const coordinatorMessage: AgentMessage = {
  ...message('fixture-coordinator-message', 'user', [
    {
      type: 'text',
      text: 'Keep the transcript as one reviewable story. Verify every real production seam before the final handoff.',
    },
  ]),
  metadata: {
    type: 'agent_message',
    fromAgentId: 'fixture-coordinator',
    fromAgentName: 'Product polish coordinator with a deliberately long accessible label',
  },
};

export const agentMessage: AgentMessage = {
  ...message('fixture-agent-message', 'user', [
    {
      type: 'text',
      text: 'The renderer audit found one fixed gap in the production row stack. I sent the exact ownership path and a focused regression plan.',
    },
  ]),
  metadata: {
    type: 'agent_message',
    fromAgentId: 'fixture-layout-agent',
    fromAgentName: 'Layout verifier',
  },
};

export const interruptedAssistantMessage: AgentMessage = {
  ...message('fixture-assistant-interrupted', 'assistant', [
    { type: 'thinking', text: 'Re-run the failed geometry measurement before editing.' },
    {
      type: 'tool_use',
      id: 'fixture-cancelled-command',
      toolCallId: 'call-cancelled-command',
      name: 'launch-process',
      input: { command: 'pnpm playwright test chat-polish-controls.spec.ts' },
    },
    {
      type: 'tool_result',
      id: 'result-cancelled-command',
      tool_use_id: 'call-cancelled-command',
      output: 'Cancelled when the retry replaced this turn.',
    },
  ]),
  metadata: { interrupted: true, interruptReason: 'preempted_by_message' },
};

export const retryUserMessage = message('fixture-user-retry', 'user', [
  { type: 'text', text: 'Retry with the row-stack owner fixed, then measure all visible pairs.' },
]);

export const recoveryMessage = message('fixture-assistant-recovery', 'assistant', [
  { type: 'thinking', text: 'Confirm the sandbox override does not escape its scoped root.' },
  { type: 'text', text: 'The retry now follows the production ownership path.' },
  {
    type: 'tool_use',
    id: 'fixture-search-success',
    toolCallId: 'call-search-success',
    name: 'web-search',
    input: { query: 'CSS pixel geometry browser zoom measurement' },
  },
  {
    type: 'tool_result',
    id: 'result-search-success',
    tool_use_id: 'call-search-success',
    output: 'CSS pixels scale geometrically under page zoom.',
  },
  { type: 'thinking', text: 'The static, streaming, grouped, and hidden-result paths agree.' },
]);

export const toolStateMatrixMessage = message('fixture-tool-state-matrix', 'assistant', [
  { type: 'text', text: 'Inspect the production details before changing the row stack.' },
  {
    type: 'tool_use',
    id: 'fixture-input-only',
    toolCallId: 'call-input-only',
    name: 'view',
    input: { path: 'src/lib/components/chat/ChatOperationalRow.svelte' },
  },
  {
    type: 'tool_use',
    id: 'fixture-output-only',
    toolCallId: 'call-output-only',
    name: 'list-processes',
    input: {},
  },
  {
    type: 'tool_result',
    id: 'result-output-only',
    tool_use_id: 'call-output-only',
    output: 'No active processes.',
  },
  {
    type: 'tool_use',
    id: 'fixture-long-payload',
    toolCallId: 'call-long-payload',
    name: 'view',
    input: {
      path: 'src/lib/components/chat/ThisIsAnIntentionallyLongProductionFileLabelThatMustEllipsizeWithoutLosingItsAccessibleFullText.svelte',
      view_range: [1, 240],
    },
  },
  {
    type: 'tool_result',
    id: 'result-long-payload',
    tool_use_id: 'call-long-payload',
    output: Array.from(
      { length: 24 },
      (_, index) => `${index + 1} | deterministic payload line`,
    ).join('\n'),
  },
  { type: 'text', text: 'Inputs, outputs, and long payloads stay inside one disclosure.' },
  { type: 'text', text: '<group:Inspect production details>' },
  {
    type: 'tool_use',
    id: 'fixture-empty-hidden',
    toolCallId: 'call-empty-hidden',
    name: 'workspace_api',
    input: {},
  },
  {
    type: 'tool_result',
    id: 'result-empty-hidden',
    tool_use_id: 'call-empty-hidden',
    output: {},
  },
  {
    type: 'text',
    text: 'Empty internal activity remains hidden without adding a false seam.</group>',
  },
]);

function hookWakeMessage(id: string, active: boolean): AgentMessage {
  const hookName = active ? 'continuous-layout-watch' : 'one-shot-geometry-check';
  return {
    ...message(id, 'user', [
      {
        type: 'text',
        text: `[Background hook "${hookName}"] ${
          active
            ? 'The narrow-width check changed and the hook remains active.'
            : 'The grouped-row check completed and unblocked the final accessibility task.'
        }`,
      },
    ]),
    metadata: {
      type: 'hook_wake',
      hookId: `${id}-hook`,
      hookName,
      reason: 'dispatched',
      hookStillActive: active,
      ...(active ? {} : { queueInfo: { queuedAt: '2026-08-15T12:00:05.000Z', waitedMs: 4200 } }),
    },
  };
}

export const retiredHookWakeMessage = hookWakeMessage('fixture-hook-retired', false);
export const activeHookWakeMessage = hookWakeMessage('fixture-hook-active', true);

export const finalCompletionMessage = message('fixture-assistant-complete', 'assistant', [
  {
    type: 'text',
    text: 'The conversation is ready for visual review.\n\n- Every operational pair uses the selected gap.\n- Prose boundaries keep their independent rhythm.\n- The scoped override does not change application defaults.\n\nReview the [production chat components](https://example.com/chat) and the inline `--chat-operational-row-gap` contract.\n\n```css\n[data-adjacent-operational-row="true"] {\n  margin-top: var(--chat-operational-row-gap, 0.25rem);\n}\n```',
  },
]);
