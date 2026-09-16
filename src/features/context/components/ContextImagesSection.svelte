<script lang="ts">
  import type { ContextImage } from '$store/renderer/slices/context/context-types';
  import { store as appStore } from '$store/renderer/store';
  import { messageBlockHydrationRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
  import SidebarGroupHeader from '$lib/components/workspace/sidebar/SidebarGroupHeader.svelte';
  import ContextImageThumbnail from './ContextImageThumbnail.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  let { images, workspaceId }: { images: ContextImage[]; workspaceId: string } = $props();
  let expanded = $state(true);
</script>

{#if images.length > 0}
  <section class="mt-3" aria-label={m.context_images_title_label()}>
    <SidebarGroupHeader
      title={m.context_images_title_label()}
      meta={formatInteger(images.length)}
      {expanded}
      onclick={() => (expanded = !expanded)}
    />
    {#if expanded}
      <div class="grid grid-cols-3 gap-2 p-2" data-context-image-grid>
        {#each images as image, index (image.id)}
          <ContextImageThumbnail
            {image}
            {workspaceId}
            name={image.name ||
              m.chat_chatMessage_attachedImage_alt({ number: formatInteger(index + 1) })}
            onHydrate={image.agentId && image.messageId && image.block.id
              ? () =>
                  appStore.dispatch(
                    messageBlockHydrationRequested(
                      image.agentId!,
                      image.messageId!,
                      image.block.id!,
                    ),
                  )
              : undefined}
          />
        {/each}
      </div>
    {/if}
  </section>
{/if}
