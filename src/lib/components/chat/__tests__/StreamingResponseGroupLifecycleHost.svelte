<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  let {
    phase = 'opening',
    isStreaming = true,
  }: { phase?: 'opening' | 'live' | 'terminal' | 'closed'; isStreaming?: boolean } = $props();

  const leadingContent = [
    {
      type: 'tool_use',
      id: 'msg_1:0',
      toolCallId: 'call-figma',
      name: 'Figma startup',
      input: { summary: 'Figma startup' },
    },
    { type: 'tool_result', id: 'msg_1:1', tool_use_id: 'call-figma', output: 'Figma ready' },
    {
      type: 'thinking',
      id: 'msg_1:2',
      text: 'Searching workspace API for title setting',
    },
  ] as ContentBlock[];

  const liveContent = [
    ...leadingContent,
    {
      type: 'text',
      id: 'msg_1:3',
      text: '<group:Prepping>I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
    },
    {
      type: 'thinking',
      id: 'msg_1:4',
      text: 'Reasoning\n\n**Invoking workspace API to set title**',
    },
    {
      type: 'tool_use',
      id: 'msg_1:5',
      toolCallId: 'call-1',
      name: 'workspace_api',
      input: { summary: 'Set workspace title and read the current spec' },
    },
    { type: 'tool_result', id: 'msg_1:6', tool_use_id: 'call-1', output: 'Workspace ready' },
    {
      type: 'thinking',
      id: 'msg_1:7',
      text: 'Planning clarification questions on formatting issues\n\n**Planning code inspection and question sequencing**\n\nThe screenshot shows three possible faults: large vertical gaps, raw reasoning rows that stay open, and mixed tool-row indentation.',
    },
    {
      type: 'tool_use',
      id: 'msg_1:8',
      toolCallId: 'call-2',
      name: 'ask',
      input: { summary: 'Ask for the expected agent chat layout' },
    },
  ] as ContentBlock[];

  const content = $derived(
    phase === 'opening'
      ? ([
          ...leadingContent,
          { type: 'text', id: 'msg_1:3', text: '<group:Prepping>' },
        ] as ContentBlock[])
      : phase === 'live'
        ? liveContent
        : phase === 'terminal'
          ? ([
              ...liveContent,
              { type: 'text', id: 'msg_1:9', text: '</group:Prepping>' },
            ] as ContentBlock[])
          : ([
              ...liveContent,
              {
                type: 'text',
                id: 'msg_1:9',
                text: '</group:Prepping>Workspace inspection complete.',
              },
            ] as ContentBlock[]),
  );
</script>

<StreamingMessageContent {content} {isStreaming} isLastConversationMessage={isStreaming} />
