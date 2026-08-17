<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';

  interface Props {
    width?: number;
    zoom?: number;
    messageCount?: number;
    heldForQuestions?: boolean;
  }

  let { width = 240, zoom = 1, messageCount = 1, heldForQuestions = false }: Props = $props();
  let lastAction = $state('none');
  const messages = $derived(
    Array.from({ length: messageCount }, (_, i) => ({
      id: `queued-geometry-${i}`,
      content:
        i === 0
          ? 'A long queued message must keep exactly the same height when actions appear'
          : `Message ${i + 1}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: i,
    })),
  );
</script>

<div data-testid="queued-message-geometry-host" style="width: {width}px; zoom: {zoom};">
  <QueuedMessageList
    {messages}
    {heldForQuestions}
    onsendnow={(id) => (lastAction = `send:${id}`)}
    onremove={(id) => (lastAction = `remove:${id}`)}
    onedit={async (id, _content, editing) => {
      lastAction = `${editing ? 'edit' : 'save'}:${id}`;
      return { success: true };
    }}
  />
  <output hidden data-testid="queued-message-last-action">{lastAction}</output>
</div>
