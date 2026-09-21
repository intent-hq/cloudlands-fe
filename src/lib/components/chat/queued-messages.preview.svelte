<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { QueuedMessage } from '$shared/types';
  import QueuedMessageList from './QueuedMessageList.svelte';

  interface Props {
    messageCount?: number;
  }

  export const preview = definePreview<Props>({
    id: 'queued-messages',
    title: 'Queued messages',
    defaultState: 'multiple',
    states: {
      single: { props: { messageCount: 1 } },
      multiple: { props: { messageCount: 3 } },
    },
  });
</script>

<script lang="ts">
  let { messageCount = 3 }: Props = $props();
  let messages = $state<QueuedMessage[]>([]);
  $effect(() => {
    messages = Array.from({ length: messageCount }, (_, i) => ({
      id: `preview-queue-${i}`,
      content: [
        'Check the empty state too.',
        'Keep the spacing consistent.',
        'Add a keyboard navigation test.',
      ][i],
      queuedAt: '2026-09-16T12:00:00.000Z',
      position: i,
    }));
  });

  function remove(id: string) {
    messages = messages.filter((message) => message.id !== id);
  }
</script>

<QueuedMessageList
  {messages}
  onedit={async (id, content, editing) => {
    messages = messages.map((message) =>
      message.id === id ? { ...message, content, editing } : message,
    );
    return { success: true };
  }}
  onremove={remove}
  onsendnow={remove}
/>
