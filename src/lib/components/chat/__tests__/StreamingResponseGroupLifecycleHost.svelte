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
  }: { phase?: 'opening' | 'live' | 'closed'; isStreaming?: boolean } = $props();

  const liveContent = [
    {
      type: 'text',
      id: 'msg_1:0',
      text: '<group:Prepping>I will set the workspace title and inspect the current workspace.',
    },
    {
      type: 'thinking',
      id: 'msg_1:1',
      text: 'Figma startup\n\nCheck the workspace before changing files.',
    },
    {
      type: 'tool_use',
      id: 'msg_1:2',
      toolCallId: 'call-1',
      name: 'workspace_api',
      input: { summary: 'Set workspace title and read details' },
    },
    { type: 'tool_result', id: 'msg_1:3', tool_use_id: 'call-1', output: 'Workspace ready' },
    {
      type: 'thinking',
      id: 'msg_1:4',
      text: 'Searching workspace API\n\nFind the relevant implementation.',
    },
  ] as ContentBlock[];

  const content = $derived(
    phase === 'opening'
      ? ([{ type: 'text', id: 'msg_1:0', text: '<group:Prepping>' }] as ContentBlock[])
      : phase === 'live'
        ? liveContent
        : ([
            ...liveContent,
            {
              type: 'text',
              id: 'msg_1:5',
              text: '</group:Prepping>Workspace inspection complete.',
            },
          ] as ContentBlock[]),
  );
</script>

<StreamingMessageContent {content} {isStreaming} />
