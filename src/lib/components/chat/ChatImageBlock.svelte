<script lang="ts">
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faImage } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Base64 image data — the §5.5 slim thumbnail or nothing when truncated. */
    data?: string;
    mimeType: string;
    alt?: string;
    /** §5.5 slim projection: original `data` was over budget. */
    dataTruncated?: boolean;
    /** §5.5 slim projection: `data` carries the write-time thumbnail. */
    dataIsThumbnail?: boolean;
    /** True while the original image is being hydrated. */
    hydrationLoading?: boolean;
    /** Fetch the original via agent.getMessageBlock; absent → no hydration. */
    onHydrate?: () => void;
  }

  let {
    data,
    mimeType,
    alt = m.chat_imageBlock_fromAgent_alt(),
    dataTruncated = false,
    dataIsThumbnail = false,
    hydrationLoading = false,
    onHydrate,
  }: Props = $props();
  let lightboxOpen = $state(false);
  let openerElement: HTMLButtonElement | null = $state(null);
  let failedImageUrl = $state<string | null>(null);

  const imageUrl = $derived(data ? `data:${mimeType};base64,${data}` : null);
  const imageUnavailable = $derived(imageUrl !== null && failedImageUrl === imageUrl);
  // A truncated block renders its thumbnail (or placeholder); clicking asks
  // for the original first — the lightbox opens once hydration swaps the
  // full block in (dataTruncated then disappears from the merged block).
  const needsHydration = $derived(dataTruncated && onHydrate !== undefined);

  function handleClick() {
    if (needsHydration) {
      onHydrate?.();
      return;
    }
    if (imageUrl) lightboxOpen = true;
  }
</script>

<div class="my-2 min-w-0 max-w-2xl" data-chat-image>
  {#if imageUrl && !imageUnavailable}
    <div class="group relative size-40">
      <button
        bind:this={openerElement}
        type="button"
        class="block size-40 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted/30 p-0 shadow-(--elevation-raised) transition-opacity hover:opacity-90 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        class:animate-pulse={hydrationLoading}
        onclick={handleClick}
        aria-label={needsHydration
          ? m.chat_imageBlock_loadFullImage_ariaLabel({ alt })
          : m.chat_imageBlock_viewFullSize_ariaLabel({ alt })}
        title={needsHydration && dataIsThumbnail
          ? m.chat_imageBlock_thumbnail_tooltip()
          : undefined}
        data-image-thumbnail={dataIsThumbnail || undefined}
      >
        <img
          src={imageUrl}
          {alt}
          loading="lazy"
          decoding="async"
          class="block size-full object-cover"
          onerror={() => (failedImageUrl = imageUrl)}
        />
      </button>
      {#if !dataTruncated}
        <!-- Truncated blocks only carry the low-res write-time thumbnail, so
             the menu would download/copy/inspect the wrong bytes; clicking
             hydrates the original, after which the menu (and the lightbox's)
             acts on the real image. -->
        <ImageActionsMenu
          {imageUrl}
          imageName={alt}
          triggerClass="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      {/if}
    </div>
  {:else if imageUnavailable}
    <MediaUnavailable name={alt} reason="load-failed" />
  {:else if dataTruncated}
    <!-- Legacy slim row with no persisted thumbnail: placeholder chip with
         the same on-demand fetch. -->
    <Button
      variant="outline"
      class="h-auto gap-2 rounded-lg bg-muted/30 px-3 py-2 text-subtle hover:text-foreground {hydrationLoading
        ? 'animate-pulse'
        : ''}"
      onclick={handleClick}
      disabled={!onHydrate}
      aria-label={m.chat_imageBlock_loadFullImage_ariaLabel({ alt })}
      data-testid="chat-image-placeholder"
    >
      <Fa icon={faImage} size={14} />
      <span class="type-caption">
        {hydrationLoading
          ? m.chat_imageBlock_loadingImage_label()
          : m.chat_imageBlock_loadImage_label()}
      </span>
    </Button>
  {/if}
</div>

{#if imageUrl && !imageUnavailable}
  <ImageLightbox
    bind:open={lightboxOpen}
    {imageUrl}
    imageName={alt}
    {openerElement}
    showActionsMenu
  />
{/if}
