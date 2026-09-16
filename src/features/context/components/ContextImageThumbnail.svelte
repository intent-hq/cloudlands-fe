<script lang="ts">
  import type { ContextAttachment } from '$store/renderer/slices/context/context-types';
  import { Button } from '$lib/components/ui/button';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import {
    resolveAttachmentImageUrl,
    evictAttachmentImageUrl,
  } from '$lib/components/chat/attachment-image-url';
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import { faImage } from '@fortawesome/free-solid-svg-icons';

  let {
    image,
    workspaceId,
    name,
    onHydrate,
  }: {
    image: ContextAttachment;
    workspaceId: string;
    name: string;
    onHydrate?: () => void;
  } = $props();

  let resolvedUrl = $state<string | null>(null);
  let failedUrl = $state<string | null>(null);
  let open = $state(false);
  let waitingForOriginal = $state(false);
  let openerElement = $state<HTMLButtonElement | null>(null);
  const imageUrl = $derived(
    image.block.attachmentId
      ? resolvedUrl
      : image.block.data && image.block.mimeType
        ? `data:${image.block.mimeType};base64,${image.block.data}`
        : null,
  );

  // Resolve the existing attachment URL seam for this DOM image; ignore stale completions.
  $effect(() => {
    const attachmentId = image.block.attachmentId;
    const owner = workspaceId;
    resolvedUrl = null;
    let current = true;
    if (attachmentId)
      void resolveAttachmentImageUrl(owner, attachmentId).then((url) => {
        if (current) resolvedUrl = url;
      });
    return () => {
      current = false;
    };
  });

  $effect(() => {
    if (
      waitingForOriginal &&
      (image.hydrationStatus === 'loaded' || image.hydrationStatus === 'error')
    ) {
      waitingForOriginal = false;
      if (imageUrl) open = true;
    }
  });

  function preview() {
    if (image.block.dataTruncated && onHydrate) {
      waitingForOriginal = true;
      onHydrate();
    } else if (imageUrl) open = true;
  }
</script>

<Button
  variant="plain"
  wrapContent={false}
  bind:ref={openerElement}
  class="aspect-square h-auto w-full min-w-0 overflow-hidden rounded-md border border-border bg-muted/30 p-0 cursor-zoom-in"
  aria-label={m.chat_imageBlock_viewFullSize_ariaLabel({ alt: name })}
  title={name}
  aria-busy={image.hydrationStatus === 'loading'}
  disabled={(!imageUrl || failedUrl === imageUrl) && !(image.block.dataTruncated && onHydrate)}
  onclick={preview}
>
  {#if imageUrl && failedUrl !== imageUrl}
    <img
      src={imageUrl}
      alt={name}
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      onerror={() => {
        failedUrl = imageUrl;
        if (image.block.attachmentId)
          evictAttachmentImageUrl(workspaceId, image.block.attachmentId);
      }}
    />
  {:else}
    <Fa icon={faImage} class="size-5 text-muted-foreground" />
  {/if}
</Button>

{#if imageUrl && failedUrl !== imageUrl}
  <ImageLightbox
    bind:open
    {imageUrl}
    imageName={name}
    {openerElement}
    showActionsMenu={!image.block.dataTruncated}
  />
{/if}
