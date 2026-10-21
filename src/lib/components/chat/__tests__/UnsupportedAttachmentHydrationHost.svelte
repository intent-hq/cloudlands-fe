<script lang="ts">
  import { onDestroy } from 'svelte';
  import ChatMessage from '../ChatMessage.svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { createAttachmentHydrationFixture } from './mocks/attachment-hydration';

  let { data, thumbnail }: { data: string; thumbnail?: string } = $props();
  let requests = $state<unknown[]>([]);
  const fixture = createAttachmentHydrationFixture((params) => {
    requests = [...requests, params];
  });
  const stop = startRootStoreLifecycle(store, {
    startSagas: fixture.startSagas,
  });
  onDestroy(stop);
</script>

<ChatMessage
  agentId="legacy-agent"
  message={{
    id: 'legacy-message',
    role: 'user',
    timestamp: new Date('2026-01-01T12:00:00Z'),
    contentBlocks: [
      {
        id: 'legacy-image',
        type: 'image',
        mimeType: 'image/svg+xml',
        dataTruncated: true,
        data: thumbnail,
      },
    ],
  }}
/>
<button onclick={() => fixture.finish(data)}>Finish hydration</button>
<button onclick={() => fixture.fail()}>Fail hydration</button>
<output data-testid="hydration-requests">{JSON.stringify(requests)}</output>
