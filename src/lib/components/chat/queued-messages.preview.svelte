<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { QueuedMessage } from '$shared/types';
  import QueuedMessageList from './QueuedMessageList.svelte';

  interface Props {
    messageCount?: number;
    heldCount?: number;
    retry?: boolean;
    disabled?: boolean;
    longContent?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'queued-messages',
    title: 'Queued messages',
    defaultState: 'multiple',
    states: {
      empty: { props: { messageCount: 0 } },
      single: { props: { messageCount: 1 } },
      multiple: { props: { messageCount: 3 } },
      'held-for-editing': { props: { messageCount: 3, heldCount: 1 } },
      'all-held': { props: { messageCount: 2, heldCount: 2 } },
      retry: { props: { messageCount: 2, retry: true } },
      disabled: { props: { messageCount: 3, disabled: true } },
      'long-content': { props: { messageCount: 3, longContent: true } },
    },
  });
</script>

<script lang="ts">
  let {
    messageCount = 3,
    heldCount = 0,
    retry = false,
    disabled = false,
    longContent = false,
  }: Props = $props();
  let messages = $state<QueuedMessage[]>([]);
  $effect(() => {
    messages = Array.from({ length: messageCount }, (_, i) => ({
      id: `preview-queue-${i}`,
      content: longContent
        ? 'Please check that a long queued message stays readable and its actions remain available in a narrow chat panel.'
        : [
            'Check the empty state too.',
            'Keep the spacing consistent.',
            'Add a keyboard navigation test.',
          ][i],
      queuedAt: '2026-09-16T12:00:00.000Z',
      position: i,
      editing: i < heldCount,
      requeuedAfterFailure: retry && i === 0,
    }));
  });

  function remove(id: string) {
    messages = messages.filter((message) => message.id !== id);
  }
</script>

<QueuedMessageList
  {messages}
  {disabled}
  onedit={async (id, content, editing) => {
    messages = messages.map((message) =>
      message.id === id ? { ...message, content, editing } : message,
    );
    return { success: true };
  }}
  onremove={remove}
  onsendnow={remove}
/>
