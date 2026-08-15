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
  const grouped = [
    {
      type: 'content_group',
      name: 'Adjacent group',
      children: [{ type: 'text', text: '**Nested** markdown remains group-relative' }],
      isStreaming: false,
    },
    { type: 'text', text: 'Following top-level response' },
  ] as unknown as ContentBlock[];
  const tool = [
    { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'src/example.ts' } },
  ] as ContentBlock[];
</script>

<section
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="assistant-prose-host"
>
  <div class="bg-background text-foreground" data-testid="assistant-prose-lane">
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
</section>
