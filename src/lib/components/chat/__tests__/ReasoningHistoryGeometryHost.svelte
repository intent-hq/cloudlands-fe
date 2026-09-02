<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import MessageContent from '../MessageContent.svelte';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    phase?: 'live' | 'completed';
  }

  let { theme = 'light', width = 720, zoom = 1, phase = 'completed' }: Props = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  const titledHistory = (live: boolean): ContentBlock[] => [
    { type: 'text', id: 'history:0', text: '<group:Prepping>Reviewing the recorded input.' },
    {
      type: 'thinking',
      id: 'history:1',
      text: 'Reasoning\n\nThe production-path analysis ends with input.',
    },
    { type: 'text', id: 'history:blank', text: '\n\n' },
    {
      type: 'thinking',
      id: 'history:2',
      text: '**Specifying task requirements**\n\n**Checking detailed constraints**\n\nRequired steps:\n\n- preserve source order\n- keep tool results paired',
    },
    {
      type: 'tool_use',
      id: 'history:3',
      toolCallId: 'history-tool',
      name: 'view',
      input: { path: 'src/lib/components/chat/ReasoningHistoryBlock.svelte' },
    },
    {
      type: 'tool_result',
      id: 'history:4',
      tool_use_id: 'history-tool',
      output: 'Renderer source inspected',
    },
    {
      type: 'thinking',
      id: 'history:5',
      text: "# Validating renderer output\n\n```ts\nconst seam = 'token';\n```\n\nFinal nested reasoning prose.",
    },
    ...(live
      ? []
      : [
          {
            type: 'text',
            id: 'history:6',
            text: '</group:Prepping>Final assistant answer.',
          } as ContentBlock,
        ]),
  ];

  const inlineHistory: ContentBlock[] = [
    {
      type: 'thinking',
      id: 'inline:0',
      text: 'Headingless predecessor remains inline without a disclosure.',
    },
    { type: 'text', id: 'inline:1', text: '<group:Prepping>Inline group description.' },
    { type: 'text', id: 'inline:blank', text: '   ' },
    {
      type: 'thinking',
      id: 'inline:2',
      text: 'Later headingless reasoning stays in source order.',
    },
    { type: 'text', id: 'inline:3', text: '</group:Prepping>Inline final prose.' },
  ];

  const isStreaming = $derived(phase === 'live');
  const history = $derived(titledHistory(isStreaming));
</script>

<section
  class:dark={theme === 'dark'}
  class="bg-background text-foreground"
  style:width="{width}px"
  style:zoom
  data-testid="history-geometry-host"
>
  <div data-testid="message-titled"><MessageContent content={history} {isStreaming} /></div>
  <div data-testid="streaming-titled">
    <StreamingMessageContent content={history} {isStreaming} />
  </div>
  <div data-testid="message-inline"><MessageContent content={inlineHistory} /></div>
  <div data-testid="streaming-inline">
    <StreamingMessageContent content={inlineHistory} isStreaming={false} />
  </div>
</section>
