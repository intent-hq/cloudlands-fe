<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { isUserQueuedMessage } from '$lib/utils/queued-message-visibility';
  import type { QueuedMessage } from '$shared/types';
  import QueuedMessageList from './QueuedMessageList.svelte';

  interface Props {
    messageCount?: number;
    scenario?: 'owner' | 'participant' | 'merged' | 'system-interleaved' | 'author-barrier';
  }

  export const preview = definePreview<Props>({
    id: 'queued-messages',
    title: 'Queued messages',
    defaultState: 'multiple',
    states: {
      single: { props: { messageCount: 1 } },
      multiple: { props: { messageCount: 3 } },
      owner: { props: { scenario: 'owner' } },
      participant: { props: { scenario: 'participant' } },
      merged: { props: { scenario: 'merged' } },
      'system-interleaved': { props: { scenario: 'system-interleaved' } },
      'author-barrier': { props: { scenario: 'author-barrier' } },
    },
  });
</script>

<script lang="ts">
  let { messageCount = 3, scenario }: Props = $props();
  let messages = $state<QueuedMessage[]>([]);
  $effect(() => {
    let next: QueuedMessage[] = Array.from({ length: messageCount }, (_, i) => ({
      id: `preview-queue-${i}`,
      content: [
        'Check the empty state too.',
        'Keep the spacing consistent.',
        'Add a keyboard navigation test.',
      ][i],
      queuedAt: '2026-09-16T12:00:00.000Z',
      position: i,
      messageMetadata: { fromPrincipalId: 'owner' },
    }));
    if (scenario) {
      const author = (principalId: string, displayName: string) => ({
        principalId,
        displayName,
        login: null,
        avatarUrl: null,
      });
      const first = {
        ...next[0],
        content: 'Check the empty state too.',
        author: author('owner', 'Alex'),
        messageMetadata: { fromPrincipalId: 'owner' },
      };
      const guest = {
        ...next[1],
        content: 'Keep the spacing consistent.',
        author: author('guest', 'Sam'),
        messageMetadata: { fromPrincipalId: 'guest' },
      };
      next = [first, guest, { ...next[2], author: first.author }];
      if (scenario === 'merged' || scenario === 'system-interleaved') {
        next = [
          { ...first, content: 'Check the empty state too.\n\nAdd a keyboard navigation test.' },
        ];
        if (scenario === 'system-interleaved')
          next.push({
            id: 'system',
            content: 'Automatic wake',
            position: 1,
            queuedAt: first.queuedAt,
            messageMetadata: { source: 'system' },
          });
      }
    }
    messages = next;
  });

  function remove(id: string) {
    messages = messages.filter((message) => message.id !== id);
  }
</script>

<QueuedMessageList
  messages={messages.filter(isUserQueuedMessage)}
  ownPrincipalId={scenario === 'participant' ? 'guest' : 'owner'}
  ownerPrincipalId="owner"
  authors={scenario ? new Map() : null}
  onedit={async (id, content, editing) => {
    messages = messages.map((message) =>
      message.id === id ? { ...message, content, editing } : message,
    );
    return { success: true };
  }}
  onremove={remove}
  onsendnow={remove}
/>
