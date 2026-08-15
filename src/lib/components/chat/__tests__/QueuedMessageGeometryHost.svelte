<script lang="ts">
  import QueuedMessageList from '../QueuedMessageList.svelte';

  interface Props {
    width?: number;
    zoom?: number;
  }

  let { width = 240, zoom = 1 }: Props = $props();
  const messages = [
    {
      id: 'queued-geometry',
      content: 'A long queued message must keep exactly the same height when actions appear',
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: 0,
    },
  ];
</script>

<div data-testid="queued-message-geometry-host" style="width: {width}px; zoom: {zoom};">
  <QueuedMessageList {messages} />
</div>
