<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import MessageContent from '../MessageContent.svelte';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';
  import ThinkingBlock from '../ThinkingBlock.svelte';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 720, zoom = 1 }: Props = $props();

  const plain = [{ type: 'text', text: 'Plain assistant response' }] as ContentBlock[];
  const markdown = [{ type: 'text', text: '**Markdown** assistant response' }] as ContentBlock[];
  const grouped: ContentBlock[] = [
    {
      type: 'text',
      text: '<group:Adjacent group>**Nested** markdown remains group-relative</group>\nFollowing top-level response',
    },
  ];
  const expandedGroupProse: ContentBlock[] = [
    { type: 'text', text: '<group:Audit>The first hygiene command failed.</group>' },
  ];
  const expandedGroupOperationalRows: ContentBlock[] = [
    { type: 'text', text: '<group:Recovery>' },
    { type: 'thinking', id: 'nested-thinking', text: 'Inspecting cancellation state' },
    { type: 'tool_use', id: 'nested-tool', name: 'view', input: { path: 'src/example.ts' } },
    { type: 'text', text: '</group:Recovery>' },
  ];
  const headerlessInlineResponseGroup: ContentBlock[] = [
    { type: 'thinking', id: 'inline-history', text: 'Earlier reasoning history' },
    { type: 'text', text: '<group:Prepping>Inline assistant prose' },
    { type: 'tool_use', id: 'inline-tool', name: 'view', input: { path: 'src/inline.ts' } },
    { type: 'text', text: '</group>' },
  ];
  const tool = [
    { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'src/example.ts' } },
  ] as ContentBlock[];
  const richBlock = [
    {
      type: 'text',
      text: 'Prose beside a rich block\n\n```ts\nconst inset = true;\n```',
    },
  ] as ContentBlock[];

  const operationalRows = [
    { type: 'thinking', id: 'thinking-first', text: '# First reasoning\n\nFirst detail' },
    { type: 'tool_use', id: 'tool-read', name: 'view', input: { path: 'src/example.ts' } },
    { type: 'thinking', id: 'thinking-middle', text: '# Middle reasoning\n\nMiddle detail' },
    {
      type: 'tool_use',
      id: 'tool-context',
      name: 'codebase-retrieval',
      input: { information_request: 'Find the cluster spacing contract' },
    },
    { type: 'thinking', id: 'thinking-last', text: '# Final reasoning\n\nFinal detail' },
  ] as ContentBlock[];
  const boundedOperationalRows = [
    { type: 'text', text: 'Prose before the operational cluster' },
    ...operationalRows,
    { type: 'text', text: 'Prose after the operational cluster' },
  ] as ContentBlock[];
  const streamingRows = [
    { type: 'tool_use', id: 'stream-read-a', name: 'view', input: { path: 'src/a.ts' } },
    {
      type: 'tool_use',
      id: 'stream-context',
      name: 'codebase-retrieval',
      input: { information_request: 'Find streaming cluster spacing' },
    },
    {
      type: 'tool_use',
      id: 'stream-command',
      name: 'launch-process',
      input: { command: 'pnpm vitest run cluster.test.ts' },
    },
    {
      type: 'tool_use',
      id: 'stream-workspace',
      name: 'workspace_api',
      input: { summary: 'Inspect streaming cluster', code: 'return await ws.agent.list()' },
    },
    { type: 'tool_use', id: 'stream-read-b', name: 'view', input: { path: 'src/b.ts' } },
  ] as ContentBlock[];
  const streamingOperationalRows = [
    { type: 'text', text: 'Streaming prose before the operational cluster' },
    ...streamingRows.flatMap((block, index) => [
      block,
      {
        type: 'tool_result',
        id: `result-${index}`,
        tool_use_id: block.id,
        output: `result ${index}`,
      } as ContentBlock,
    ]),
    { type: 'text', text: 'Streaming prose after the operational cluster' },
  ] as ContentBlock[];
  const operationalPairs: Array<{ id: string; content: ContentBlock[] }> = [
    {
      id: 'tool-tool',
      content: [
        { type: 'tool_use', id: 'pair-tool-a', name: 'view', input: { path: 'src/a.ts' } },
        { type: 'tool_use', id: 'pair-tool-b', name: 'view', input: { path: 'src/b.ts' } },
      ],
    },
    {
      id: 'tool-reasoning',
      content: [
        { type: 'tool_use', id: 'pair-tool-c', name: 'view', input: { path: 'src/c.ts' } },
        {
          type: 'thinking',
          id: 'pair-reasoning-a',
          text: 'Inspect the tool result\n\nOperational geometry detail.',
        },
      ],
    },
    {
      id: 'reasoning-tool',
      content: [
        {
          type: 'thinking',
          id: 'pair-reasoning-b',
          text: 'Choose the next tool\n\nOperational geometry detail.',
        },
        { type: 'tool_use', id: 'pair-tool-d', name: 'view', input: { path: 'src/d.ts' } },
      ],
    },
    {
      id: 'reasoning-context',
      content: [
        {
          type: 'thinking',
          id: 'pair-reasoning-c',
          text: 'Search for the owning primitive\n\nOperational geometry detail.',
        },
        {
          type: 'tool_use',
          id: 'pair-context-a',
          name: 'codebase-retrieval',
          input: { information_request: 'Find operational spacing' },
        },
      ],
    },
    {
      id: 'context-tool',
      content: [
        {
          type: 'tool_use',
          id: 'pair-context-b',
          name: 'codebase-retrieval',
          input: { information_request: 'Find a follow-up file' },
        },
        { type: 'tool_use', id: 'pair-tool-e', name: 'view', input: { path: 'src/e.ts' } },
      ],
    },
    {
      id: 'group-tool',
      content: [
        { type: 'text', text: '<group:Resume>Continue the operation</group:Resume>' },
        { type: 'tool_use', id: 'pair-tool-f', name: 'view', input: { path: 'src/f.ts' } },
      ],
    },
    {
      id: 'tool-group',
      content: [
        { type: 'tool_use', id: 'pair-tool-g', name: 'view', input: { path: 'src/g.ts' } },
        { type: 'text', text: '<group:Review>Review the operation</group:Review>' },
      ],
    },
    {
      id: 'group-group',
      content: [
        {
          type: 'text',
          text: '<group:First>First operation</group:First><group:Second>Second operation</group:Second>',
        },
      ],
    },
  ];
</script>

<section
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="assistant-prose-host"
>
  <div class="bg-background text-foreground" data-testid="assistant-prose-lane">
    <div data-testid="baseline-geometry">
      <div data-testid="plain-response"><MessageContent content={plain} /></div>
      <div data-testid="markdown-response"><MessageContent content={markdown} /></div>
      <div data-testid="streaming-response">
        <StreamingMessageContent content={markdown} isStreaming />
      </div>
      <div data-testid="thinking-row">
        <ThinkingBlock content="# Inspecting response geometry\n\nReasoning body" />
      </div>
      <div data-testid="streaming-thinking-row">
        <ThinkingBlock content="Inspecting streaming geometry" isStreaming />
      </div>
      <div data-testid="group-adjacency"><MessageContent content={grouped} /></div>
      <div data-testid="expanded-group-prose"><MessageContent content={expandedGroupProse} /></div>
      <div data-testid="full-width-tool"><MessageContent content={tool} /></div>
    </div>
    <div data-testid="expanded-group-operational-rows">
      <MessageContent content={expandedGroupOperationalRows} />
    </div>
    <div data-testid="streaming-expanded-group-operational-rows">
      <StreamingMessageContent content={expandedGroupOperationalRows} isStreaming />
    </div>
    <div data-testid="headerless-inline-static">
      <MessageContent content={headerlessInlineResponseGroup} />
    </div>
    <div data-testid="headerless-inline-streaming">
      <StreamingMessageContent content={headerlessInlineResponseGroup} isStreaming />
    </div>
    <div data-testid="static-rich-block"><MessageContent content={richBlock} /></div>
    <div data-testid="streaming-rich-block">
      <StreamingMessageContent content={richBlock} isStreaming />
    </div>
    <div data-testid="single-operational-cluster">
      <MessageContent content={tool} />
    </div>
    <div data-testid="static-operational-cluster">
      <MessageContent content={boundedOperationalRows} />
    </div>
    <div data-testid="streaming-operational-cluster">
      <StreamingMessageContent content={streamingOperationalRows} isStreaming />
    </div>
    <div data-testid="operational-pair-fixtures">
      {#each operationalPairs as pair (pair.id)}
        <div data-testid="operational-pair-static-{pair.id}">
          <MessageContent content={pair.content} />
        </div>
        <div data-testid="operational-pair-streaming-{pair.id}">
          <StreamingMessageContent content={pair.content} isStreaming />
        </div>
      {/each}
    </div>
  </div>
</section>
