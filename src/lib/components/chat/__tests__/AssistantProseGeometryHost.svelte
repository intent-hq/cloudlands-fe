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
  const tool = [
    { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'src/example.ts' } },
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
      <div data-testid="full-width-tool"><MessageContent content={tool} /></div>
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
  </div>
</section>
