<script lang="ts">
  import { onDestroy, setContext } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { WORKSPACE_ROUTE_CONTEXT } from '$lib/utils/workspace-route-context';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { QueuedMessage } from '$shared/types';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import QueuedMessageList from '../QueuedMessageList.svelte';

  let {
    messages: incoming,
    lookupFails = false,
  }: { messages: QueuedMessage[]; lookupFails?: boolean } = $props();
  let messages = $state<QueuedMessage[]>([]);
  let requests = $state<{ attachmentId: string; workspaceId: string }[]>([]);
  let sent = $state<QueuedMessage | null>(null);
  let reconnected = false;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  setContext(WORKSPACE_ROUTE_CONTEXT, { workspaceId: WorkspaceId('queue-images') });
  $effect(() => {
    messages = structuredClone($state.snapshot(incoming));
  });

  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only attachment transport and reconnect fixture.
  installMockElectronBridge({
    'file.getAttachmentInfo': (params) => {
      const request = params as { attachmentId: string; workspaceId: string };
      requests = [...requests, request];
      if (request.attachmentId === 'second' && lookupFails && !reconnected)
        throw new Error('Attachment lookup temporarily unavailable');
      return {
        attachmentId: request.attachmentId,
        fileName: `${request.attachmentId}.png`,
        path: `.intent/attachments/${request.attachmentId}.png`,
        mimeType: 'image/png',
        size: 100,
        uploadedAt: '2026-10-05T12:00:00Z',
        exists: request.attachmentId !== 'missing',
      };
    },
  });
  const api = window.electronAPI!;
  const originalOn = api.on;
  const originalOffById = api.offById;
  api.on = (channel, callback) => {
    if (channel !== IPC_CHANNELS.BACKEND.STATUS) return originalOn(channel, callback);
    const id = `queue-images-listener-${listeners.size}`;
    listeners.set(id, callback);
    return id;
  };
  api.offById = (channel, id) => {
    if (channel !== IPC_CHANNELS.BACKEND.STATUS || !listeners.delete(id))
      originalOffById(channel, id);
  };
  onDestroy(() => {
    api.on = originalOn;
    api.offById = originalOffById;
  });
</script>

<!-- i18n-ignore (isolated functional test controls) -->
<section class="w-[420px] bg-background p-4" data-testid="queued-image-host">
  <QueuedMessageList
    {messages}
    ownPrincipalId="image-author"
    onedit={async (id, content, editing) => {
      messages = messages.map((message) =>
        message.id === id ? { ...message, content, editing } : message,
      );
      return { success: true };
    }}
    onremove={(id) => {
      messages = messages.filter((message) => message.id !== id);
    }}
    onsendnow={(id) => {
      sent = messages.find((message) => message.id === id) ?? null;
      messages = messages.filter((message) => message.id !== id);
    }}
  />
  <Button
    onclick={() => {
      reconnected = true;
      for (const listener of listeners.values())
        listener({ status: 'connected', reconnected: true });
    }}>Reconnect backend</Button
  >
  <output hidden data-testid="image-requests">{JSON.stringify(requests)}</output>
  <output hidden data-testid="sent-images">{JSON.stringify(sent)}</output>
</section>
