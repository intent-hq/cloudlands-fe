<script lang="ts">
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';

  interface Props {
    data: string;
    mimeType: string;
    alt?: string;
  }

  let { data, mimeType, alt = 'Image from agent' }: Props = $props();
  let lightboxOpen = $state(false);
  let openerElement: HTMLButtonElement | null = $state(null);

  const imageUrl = $derived(`data:${mimeType};base64,${data}`);
</script>

<div class="my-2 min-w-0 max-w-2xl" data-chat-image>
  <button
    bind:this={openerElement}
    type="button"
    class="block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted/30 p-0 shadow-(--elevation-raised) transition-opacity hover:opacity-90 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    onclick={() => (lightboxOpen = true)}
    aria-label="View {alt.toLowerCase()} full size"
  >
    <img
      src={imageUrl}
      {alt}
      loading="lazy"
      decoding="async"
      class="block max-h-[32rem] w-auto max-w-full object-contain"
    />
  </button>
</div>

<ImageLightbox bind:open={lightboxOpen} {imageUrl} imageName={alt} {openerElement} />
