<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId, assetId }: { workspaceId: string; assetId?: string | null } = $props();

  const imageUrl = $derived(assetId ? `workspace-asset://${workspaceId}/${assetId}` : '');
  let failedImageUrl = $state('');
  const showImage = $derived(!!imageUrl && imageUrl !== failedImageUrl);
  let lightboxOpen = $state(false);
  let imageButtonRef: HTMLButtonElement | null = $state(null);

  $effect.pre(() => {
    // A changed or restored asset should only open after a new activation.
    const currentImageUrl = imageUrl;
    untrack(() => {
      if (!lightboxOpen) return;
      lightboxOpen = false;
      if (currentImageUrl && imageButtonRef?.isConnected)
        imageButtonRef.focus({ preventScroll: true });
    });
  });
</script>

{#if showImage}
  <Button
    variant="ghost-light"
    bind:ref={imageButtonRef}
    type="button"
    wrapContent={false}
    class="my-1 flex h-auto w-full cursor-zoom-in justify-start gap-3 px-2 py-2 text-left"
    onclick={() => (lightboxOpen = true)}
    title={m.workspace_progressCard_statusImage_title()}
    aria-label={m.workspace_progressCard_statusImage_ariaLabel()}
  >
    <img
      src={imageUrl}
      alt={m.workspace_progressCard_statusImage_alt()}
      class="block h-14 w-20 shrink-0 rounded-(--radius-medium) bg-selected object-cover"
      onerror={(event) => (failedImageUrl = event.currentTarget.getAttribute('src') ?? imageUrl)}
    />
    <span class="type-caption min-w-0 whitespace-normal text-muted-foreground">
      {m.workspace_progressCard_statusImage_alt()}
    </span>
  </Button>
  <ImageLightbox
    bind:open={lightboxOpen}
    {imageUrl}
    imageName={m.workspace_progressCard_statusImage_alt()}
    openerElement={imageButtonRef}
  />
{/if}
