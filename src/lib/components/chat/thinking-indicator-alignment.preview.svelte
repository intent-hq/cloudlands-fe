<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    phaseMessage?: string | null;
    streaming?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'thinking-indicator-alignment',
    title: 'Thinking indicator alignment',
    defaultState: 'waiting',
    states: {
      waiting: { props: {} },
      streaming: { props: { streaming: true, phaseMessage: 'Streaming response…' } },
      'long-status': {
        props: {
          phaseMessage:
            'Awaiting tool response while inspecting the current workspace configuration and preparing the next update',
        },
      },
      'no-status': { props: { phaseMessage: null } },
    },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import ChatContentLane from './ChatContentLane.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import StreamingStatus from './StreamingStatus.svelte';

  let { phaseMessage = 'Awaiting tool response', streaming = false }: Props = $props();
  const message: AgentMessage = {
    id: 'thinking-indicator-alignment',
    role: 'assistant',
    timestamp: '2026-11-06T12:00:00.000Z',
    contentBlocks: [
      { type: 'thinking', text: 'Inspecting the current layout' },
      {
        type: 'tool_use',
        id: 'alignment-read',
        name: 'view',
        input: { path: 'src/components/chat/StreamingTypingIndicator.svelte' },
      },
      {
        type: 'tool_result',
        tool_use_id: 'alignment-read',
        output: 'Read complete',
      },
      { type: 'thinking', text: 'Preparing the alignment update' },
      {
        type: 'tool_use',
        id: 'alignment-run',
        name: 'launch-process',
        input: { command: 'Review the activity icon alignment' },
      },
      { type: 'tool_result', tool_use_id: 'alignment-run', output: 'Review complete' },
    ],
  };
</script>

<section class="w-full min-w-0 py-4" style:container="chat-panel / inline-size">
  <ChatContentLane operational>
    <ChatMessage {message} />
    <StreamingStatus
      isProcessing={!streaming}
      isStreaming={streaming}
      statusEvents={phaseMessage
        ? [{ phase: 'tool-waiting', message: phaseMessage, level: 'info', timestamp: 1000 }]
        : []}
    />
  </ChatContentLane>
</section>
