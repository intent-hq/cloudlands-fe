<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionImage } from '../discussion-images';

  let { images }: { images: readonly DiscussionImage[] } = $props();
  let open = $state(false);
  let selected = $state<DiscussionImage | null>(null);
  let opener = $state<HTMLElement | null>(null);
</script>

<div class="flex flex-wrap gap-1.5" data-discussion-images>
  {#each images as image (image.url)}
    <Button
      variant="plain"
      wrapContent={false}
      class="h-auto max-w-full cursor-zoom-in overflow-hidden rounded-[10px] bg-muted/50"
      aria-label={m.chat_attachmentPreview_viewFullSize_ariaLabel({ name: image.name })}
      onclick={(event: MouseEvent) => {
        opener = event.currentTarget as HTMLElement;
        selected = image;
        open = true;
      }}
    >
      <img
        src={image.url}
        alt={image.name}
        loading="lazy"
        class="block max-h-60 max-w-full object-contain"
        class:max-w-60={images.length > 1}
      />
    </Button>
  {/each}
</div>

{#if selected}
  <ImageLightbox
    bind:open
    imageUrl={selected.url}
    imageName={selected.name}
    openerElement={opener}
    showActionsMenu
  />
{/if}
