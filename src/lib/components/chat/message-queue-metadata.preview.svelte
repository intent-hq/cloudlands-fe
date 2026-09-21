<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { AgentMessage } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';

  interface Props {
    isSticky?: boolean;
    showQueueInfo?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'message-queue-metadata',
    title: 'Delivered message queue metadata',
    defaultState: 'default',
    states: {
      default: { props: {} },
      pinned: { props: { isSticky: true } },
      plain: { props: { showQueueInfo: false } },
    },
  });
</script>

<script lang="ts">
  let { isSticky = false, showQueueInfo = true }: Props = $props();
  const message = $derived<AgentMessage>({
    id: 'synthetic-delivered-message',
    role: 'user',
    timestamp: '2026-09-16T12:01:39.000Z',
    contentBlocks: [
      { type: 'text', text: 'Review the spacing and preserve the existing keyboard shortcuts.' },
    ],
    ...(showQueueInfo
      ? { metadata: { queueInfo: { queuedAt: '2026-09-16T12:00:00.000Z', waitedMs: 99_000 } } }
      : {}),
  });
  let previousRequests = $state(0);
</script>

<div data-testid="delivered-queue-preview" data-previous-requests={previousRequests}>
  <ChatMessage {message} {isSticky} onScrollToPrevious={() => previousRequests++} />
</div>
