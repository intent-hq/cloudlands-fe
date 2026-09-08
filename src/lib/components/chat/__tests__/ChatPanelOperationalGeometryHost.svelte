<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { faComment } from '@fortawesome/free-solid-svg-icons';
  import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import InitialAgentChatTabType from './InitialAgentChatTabType.svelte';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

  let {
    theme = 'light',
    zoom = 1,
    width = 560,
    seamOnly = false,
    detachedStatus = false,
    reasoningSearchOnly = false,
    groupedOrphanSearchOnly = false,
    terminalStatusOnly = false,
    setupCardOnly = false,
  }: {
    theme?: 'light' | 'dark';
    zoom?: number;
    width?: number;
    seamOnly?: boolean;
    detachedStatus?: boolean;
    reasoningSearchOnly?: boolean;
    groupedOrphanSearchOnly?: boolean;
    terminalStatusOnly?: boolean;
    setupCardOnly?: boolean;
  } = $props();
  const setupCardFixture = untrack(() => setupCardOnly);
  const reasoningSearchFixture = untrack(() => reasoningSearchOnly);
  const workspaceId = 'chat-panel-operational-geometry';
  const agentId = 'chat-panel-operational-agent';
  const timestamp = '2026-08-17T12:00:00.000Z';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  const operationalContent = (prefix: string, includeStreamingThinking = false) =>
    [
      {
        type: 'thinking',
        id: `${prefix}-thinking-a`,
        text: 'Inspect the production render path\n\nGeometry detail.',
      },
      {
        type: 'tool_use',
        id: `${prefix}-view`,
        name: 'view',
        input: { path: 'src/very/long/path/to/operational-row-geometry.ts' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-view-result`,
        tool_use_id: `${prefix}-view`,
        output: 'read complete',
      },
      {
        type: 'thinking',
        id: `${prefix}-thinking-after-view`,
        text: 'Compare the tool row\n\nGeometry detail.',
      },
      {
        type: 'tool_use',
        id: `${prefix}-context`,
        name: 'codebase-retrieval',
        input: {
          information_request:
            'Find the production operational row spacing owner and all disclosure wrappers',
        },
      },
      {
        type: 'tool_result',
        id: `${prefix}-context-result`,
        tool_use_id: `${prefix}-context`,
        output: 'search complete',
      },
      {
        type: 'thinking',
        id: `${prefix}-thinking-after-context`,
        text: 'Compare the context row\n\nGeometry detail.',
      },
      {
        type: 'text',
        text: '<group:Response group with a deliberately long summary>',
      },
      {
        type: 'text',
        text: 'Nested prose alignment reference.',
      },
      {
        type: 'thinking',
        id: `${prefix}-grouped-thinking-before-tool`,
        text: 'Compare the grouped tool row',
      },
      {
        type: 'tool_use',
        id: `${prefix}-grouped-tool`,
        name: 'view',
        input: { path: 'src/grouped/operational-row.ts' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-grouped-result`,
        tool_use_id: `${prefix}-grouped-tool`,
        output: 'grouped read complete',
      },
      {
        type: 'thinking',
        id: `${prefix}-grouped-thinking-before-context`,
        text: 'Compare the grouped context row',
      },
      {
        type: 'tool_use',
        id: `${prefix}-grouped-context`,
        name: 'codebase-retrieval',
        input: { information_request: 'Find the grouped operational row owner' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-grouped-context-result`,
        tool_use_id: `${prefix}-grouped-context`,
        output: 'grouped search complete',
      },
      {
        type: 'thinking',
        id: `${prefix}-grouped-thinking-after-context`,
        text: 'Verify the grouped row baselines',
      },
      {
        type: 'text',
        text: '</group:Response group with a deliberately long summary>',
      },
      {
        type: 'thinking',
        id: `${prefix}-thinking-after-group`,
        text: 'Compare the response group row\n\nGeometry detail.',
      },
      {
        type: 'tool_use',
        id: `${prefix}-command`,
        name: 'launch-process',
        input: { command: 'pnpm vitest run operational-row-production-regression.test.ts' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-command-result`,
        tool_use_id: `${prefix}-command`,
        output: 'command complete',
      },
      {
        type: 'thinking',
        id: `${prefix}-thinking-b`,
        text: 'Verify every final edge\n\nGeometry detail.',
      },
      {
        type: 'tool_use',
        id: `${prefix}-input-only`,
        name: 'custom_input_tool',
        input: { command: 'inspect input only' },
      },
      { type: 'tool_use', id: `${prefix}-output-only`, name: 'custom_output_tool', input: {} },
      {
        type: 'tool_result',
        id: `${prefix}-output-only-result`,
        tool_use_id: `${prefix}-output-only`,
        output: { status: 'complete', payload: ['output only payload'] },
      },
      {
        type: 'tool_use',
        id: `${prefix}-both`,
        name: 'custom_both_tool',
        input: { command: 'inspect both payloads' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-both-result`,
        tool_use_id: `${prefix}-both`,
        output: { status: 'complete', payload: ['both output payload'] },
      },
      { type: 'tool_use', id: `${prefix}-empty`, name: 'custom_empty_tool', input: {} },
      {
        type: 'tool_use',
        id: `${prefix}-error`,
        name: 'custom_error_tool',
        input: { command: 'fail safely' },
      },
      {
        type: 'tool_result',
        id: `${prefix}-error-result`,
        tool_use_id: `${prefix}-error`,
        output: { message: 'Expected tool failure', code: -1 },
        is_error: true,
      },
      {
        type: 'tool_use',
        id: `${prefix}-long`,
        name: 'custom_long_tool',
        input: { payload: 'long input payload '.repeat(120) },
      },
      {
        type: 'tool_result',
        id: `${prefix}-long-result`,
        tool_use_id: `${prefix}-long`,
        output: {
          status: 'complete',
          payload: `long output payload ${'0123456789 '.repeat(180)}`,
        },
      },
      ...(includeStreamingThinking
        ? [
            {
              type: 'thinking',
              id: `${prefix}-streaming-thinking`,
              text: 'Stream the final alignment check',
            },
          ]
        : []),
    ] as AgentMessage['contentBlocks'];

  const message = (
    id: string,
    role: AgentMessage['role'],
    contentBlocks: AgentMessage['contentBlocks'],
  ) => ({ id, role, contentBlocks, timestamp }) as AgentMessage;
  const thinking = (id: string): ContentBlock => ({
    type: 'thinking',
    id,
    text: `Thinking ${id}\n\nGeometry detail.`,
  });
  const seamContent = (prefix: string, startsWithThinking = false) =>
    [
      ...(startsWithThinking ? [thinking(`${prefix}-leading-thinking`)] : []),
      { type: 'tool_use', id: `${prefix}-tool-a`, name: 'view', input: { path: 'src/a.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-result-a`,
        tool_use_id: `${prefix}-tool-a`,
        output: 'a',
      },
      thinking(`${prefix}-thinking`),
      { type: 'tool_use', id: `${prefix}-tool-b`, name: 'view', input: { path: 'src/b.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-result-b`,
        tool_use_id: `${prefix}-tool-b`,
        output: 'b',
      },
      { type: 'tool_use', id: `${prefix}-tool-c`, name: 'view', input: { path: 'src/c.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-result-c`,
        tool_use_id: `${prefix}-tool-c`,
        output: 'c',
      },
      { type: 'text', text: `<group:${prefix} grouped seams>` },
      { type: 'tool_use', id: `${prefix}-group-tool-a`, name: 'view', input: { path: 'src/d.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-group-result-a`,
        tool_use_id: `${prefix}-group-tool-a`,
        output: 'd',
      },
      thinking(`${prefix}-group-thinking`),
      { type: 'tool_use', id: `${prefix}-group-tool-b`, name: 'view', input: { path: 'src/e.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-group-result-b`,
        tool_use_id: `${prefix}-group-tool-b`,
        output: 'e',
      },
      { type: 'tool_use', id: `${prefix}-group-tool-c`, name: 'view', input: { path: 'src/f.ts' } },
      {
        type: 'tool_result',
        id: `${prefix}-group-result-c`,
        tool_use_id: `${prefix}-group-tool-c`,
        output: 'f',
      },
      { type: 'text', text: `</group:${prefix} grouped seams>` },
    ] as AgentMessage['contentBlocks'];
  const toolOnlyContent = (prefix: string) =>
    [
      {
        type: 'tool_use',
        id: `${prefix}-tool`,
        name: 'view',
        input: { path: `src/${prefix}.ts` },
      },
      {
        type: 'tool_result',
        id: `${prefix}-result`,
        tool_use_id: `${prefix}-tool`,
        output: `${prefix} complete`,
      },
    ] as NonNullable<AgentMessage['contentBlocks']>;
  const productionWrapperMessages = [
    {
      ...message('assistant-production-search', 'assistant', [
        {
          type: 'tool_use',
          id: 'production-search-tool',
          name: 'codebase-retrieval',
          input: { information_request: 'Find the production chat renderer' },
        },
        {
          type: 'tool_result',
          id: 'production-search-result',
          tool_use_id: 'production-search-tool',
          output: 'Search complete',
        },
      ]),
      timestamp: '2026-08-17T11:00:00.000Z',
    } as AgentMessage,
    {
      ...message('assistant-production-reopen', 'assistant', [
        {
          type: 'tool_use',
          id: 'production-reopen-tool',
          name: 'view',
          input: { path: 'src/lib/components/chat/ChatPanel.svelte' },
        },
        {
          type: 'tool_result',
          id: 'production-reopen-result',
          tool_use_id: 'production-reopen-tool',
          output: 'File reopened',
        },
      ]),
      timestamp: '2026-08-17T11:00:01.000Z',
    } as AgentMessage,
    {
      ...message('assistant-production-reasoning', 'assistant', [
        {
          type: 'thinking',
          id: 'production-following-reasoning',
          text: 'Trace the higher-level list wrapper\n\nGeometry detail.',
        },
      ]),
      timestamp: '2026-08-17T11:00:02.000Z',
    } as AgentMessage,
  ];
  const eventTurn = (
    id: string,
    type: string,
    data: Record<string, unknown>,
    assistantContent: AgentMessage['contentBlocks'] = [thinking(`${id}-thinking`)],
  ) => [
    {
      ...message(`event-${id}`, 'user', [{ type: 'text', text: `Event ${id}` }]),
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: [type],
        events: [{ type, data, timestamp }],
      },
    } as AgentMessage,
    message(`assistant-${id}`, 'assistant', assistantContent),
  ];
  const alignmentMessages = [
    message('user-finished', 'user', [{ type: 'text', text: 'Render the finished rows' }]),
    message('assistant-finished', 'assistant', operationalContent('finished')),
    message('user-streaming', 'user', [{ type: 'text', text: 'Render the streaming rows' }]),
    message('assistant-streaming', 'assistant', operationalContent('streaming', true)),
  ];
  const terminalStatusMessages = [
    message('user-stopped', 'user', [{ type: 'text', text: 'Render the stopped row' }]),
    {
      ...message('assistant-stopped', 'assistant', toolOnlyContent('stopped-reference')),
      metadata: {
        interrupted: true,
        stopReason: 'interrupted',
        interruptReason: 'user_stop',
      },
    } as AgentMessage,
    message('user-abnormal-finish', 'user', [
      { type: 'text', text: 'Render the abnormal finish row' },
    ]),
    {
      ...message('assistant-abnormal-finish', 'assistant', [
        ...toolOnlyContent('finish-reference'),
        { type: 'text', text: '<group:Prepping>' },
        {
          type: 'thinking',
          id: 'finish-reasoning-group',
          text: 'Thinking\n\nInspect the terminal row geometry.',
        },
        { type: 'text', text: '</group:Prepping>' },
      ]),
      metadata: { finishReason: 'max_tokens' },
    } as AgentMessage,
  ];
  const reasoningSearchMessages = [
    message('user-inline-search', 'user', [
      { type: 'text', text: 'Check inline reasoning search' },
    ]),
    message('assistant-inline-search', 'assistant', [
      {
        type: 'thinking',
        id: 'inline-search-predecessor',
        text: 'Inline headingless search target remains visible without opening anything.',
      },
      {
        type: 'text',
        id: 'inline-search-open',
        text: '<group:Prepping>Visible inline description.',
      },
      {
        type: 'thinking',
        id: 'inline-search-later',
        text: 'Later inline reasoning stays visible in source order.',
      },
      { type: 'text', id: 'inline-search-close', text: '</group:Prepping>Visible final prose.' },
    ]),
    message('user-titled-search', 'user', [
      { type: 'text', text: 'Check titled reasoning search' },
    ]),
    message('assistant-titled-search', 'assistant', [
      {
        type: 'text',
        id: 'titled-search-open',
        text: '<group:Prepping>Visible titled description.',
      },
      {
        type: 'thinking',
        id: 'titled-search-reasoning',
        text: 'Model-derived reasoning title\n\nHidden titled reasoning search target.',
      },
      {
        type: 'text',
        id: 'titled-search-close',
        text: '</group:Prepping>Visible titled final prose.',
      },
    ]),
  ];
  const groupedOrphanSearchMessages = [
    message('user-grouped-orphan-search', 'user', [
      { type: 'text', text: 'Check grouped orphan search' },
    ]),
    message('assistant-grouped-orphan-search', 'assistant', [
      { type: 'text', text: '<group:Grouped result search>Visible group summary.' },
      {
        type: 'tool_use',
        id: 'grouped-search-tool',
        toolCallId: 'grouped-search-call',
        name: 'view',
        input: { path: 'src/grouped-search.ts' },
      },
      {
        type: 'tool_result',
        id: 'grouped-search-paired-result',
        tool_use_id: 'grouped-search-call',
        output: 'grouped-search-paired-marker',
      },
      { type: 'text', text: 'Visible middle content.' },
      {
        type: 'tool_result',
        id: 'grouped-search-orphan-result',
        tool_use_id: 'missing-grouped-search-call',
        output: { output: 'grouped-search-orphan-tool-marker' },
      },
      { type: 'text', text: 'Visible ending content.</group:Grouped result search>' },
    ]),
    message('user-after-grouped-orphan-search', 'user', [
      { type: 'text', text: 'Continue after grouped orphan search' },
    ]),
  ];
  const seamMessages = [
    {
      ...message('assistant-orphan-tool-a', 'assistant', toolOnlyContent('orphan-a')),
      timestamp: '2026-08-15T12:00:00.000Z',
    } as AgentMessage,
    {
      ...message('assistant-orphan-tool-b', 'assistant', toolOnlyContent('orphan-b')),
      timestamp: '2026-08-16T12:00:00.000Z',
    } as AgentMessage,
    ...productionWrapperMessages,
    {
      ...message('assistant-before-event-tool', 'assistant', toolOnlyContent('before-event')),
      timestamp: '2026-08-17T11:30:00.000Z',
    } as AgentMessage,
    ...eventTurn('tool-spacing', 'custom:event', {}, toolOnlyContent('event-tool')),
    ...eventTurn('wake', 'custom:event', {}),
    ...eventTurn('subscription', 'agent:subscriptions-changed', { agentName: 'Subscriber' }),
    ...eventTurn('finished-event', 'agent:idle', { agentName: 'Finisher' }),
    ...eventTurn('sent', 'agent:reportToParent', { agentName: 'Sender' }),
    ...eventTurn('waiting', 'agent:status-changed', { agentName: 'Waiter', status: 'waiting' }),
    message('user-static-tools', 'user', [{ type: 'text', text: 'Static tool seams' }]),
    message('assistant-static-tools', 'assistant', seamContent('static')),
    {
      ...message('event-streaming-seam', 'user', [{ type: 'text', text: 'Streaming seam' }]),
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['custom:event'],
        events: [{ type: 'custom:event', data: {}, timestamp }],
      },
    } as AgentMessage,
    message('assistant-streaming-seam', 'assistant', seamContent('streaming', true)),
    message('user-tool-message-boundary', 'user', [
      { type: 'text', text: 'Render consecutive tool-only assistant messages' },
    ]),
    message('assistant-tool-message-static', 'assistant', toolOnlyContent('message-static')),
    message('assistant-tool-message-streaming', 'assistant', toolOnlyContent('message-streaming')),
  ];
  // svelte-ignore state_referenced_locally -- each CT mount uses one immutable fixture scenario.
  const messages = setupCardFixture
    ? []
    : terminalStatusOnly
      ? terminalStatusMessages
      : groupedOrphanSearchOnly
        ? groupedOrphanSearchMessages
        : reasoningSearchOnly
          ? reasoningSearchMessages
          : seamOnly
            ? seamMessages
            : alignmentMessages;
  // svelte-ignore state_referenced_locally -- each CT mount uses one immutable fixture scenario.
  const fixtureIsStreaming =
    !setupCardFixture &&
    !terminalStatusOnly &&
    !reasoningSearchOnly &&
    !groupedOrphanSearchOnly &&
    !detachedStatus;
  const session = {
    id: agentId,
    workspaceId,
    name: 'Operational geometry agent',
    status: 'active',
    isActive: true,
    isStreaming: fixtureIsStreaming,
    isProcessing: !setupCardFixture && !reasoningSearchFixture,
    isResponding: !setupCardFixture && !reasoningSearchFixture,
    isInitialAgent: setupCardFixture,
    metadata: setupCardFixture ? { isInitialAgent: true } : undefined,
    messages,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as unknown as AgentSession;

  tabTypeRegistry.register({
    type: 'agent',
    component: setupCardFixture ? InitialAgentChatTabType : AgentTabType,
    icon: faComment,
    defaultTitle: 'Agent',
    categoryLabel: 'Agents',
    defaultWidthTier: 'narrow',
    sidebarTabId: 'agents',
    renameable: true,
  });
  store.dispatch(
    setWorkspaceEntity({
      id: workspaceId,
      title: 'Operational geometry',
      repositoryName: setupCardFixture ? 'intent' : undefined,
      repositoryPath: setupCardFixture ? '/tmp/intent' : undefined,
      branch: 'test',
      status: 'active',
      path: '/tmp/chat-panel-operational-geometry',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(workspaceId, [session]));
  store.dispatch(
    initializeLayout(workspaceId, {
      root: { type: 'panel', panelId: 'chat-panel' },
      panels: {
        'chat-panel': {
          id: 'chat-panel',
          tabs: [
            {
              id: 'agent-tab',
              type: 'agent',
              title: 'Operational geometry agent',
              agentId,
              workspaceId,
              closable: true,
            },
          ],
          activeTabId: 'agent-tab',
        },
      },
      focusedPanelId: 'chat-panel',
    }),
  );
  store.dispatch(setRestoreStatus(workspaceId, 'restored'));
  onDestroy(disposeStore);
</script>

<section class:dark={theme === 'dark'} style:zoom data-testid="chat-panel-operational-host">
  <div style:height="900px" style:width="{width}px">
    <PanelLayout {workspaceId} layoutId={workspaceId} contained />
  </div>
</section>
