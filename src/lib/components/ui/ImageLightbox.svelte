<!-- @catalog-exempt: full-screen overlay composed from MediaLightbox and ZoomPanViewport; no catalog fixtures yet -->

<script lang="ts">
  /**
   * ImageLightbox - Full-screen image preview lightbox
   *
   * Opens images in a full-screen overlay with dark backdrop.
   * Closes on Escape, backdrop click, or X button.
   * Keyboard accessible with focus trap and focus return.
   * Left/Right arrows open the previous/next image of the opener's gallery.
   */
  import MediaLightbox from './MediaLightbox.svelte';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { supportsImageActions } from '$lib/utils/image-actions';
  import { adjacentLightboxOpener } from './lightbox-gallery';

  interface Props {
    open?: boolean;
    imageUrl: string;
    imageName?: string;
    onClose?: () => void;
    /** Element that opened the lightbox, to return focus on close */
    openerElement?: HTMLElement | null;
    /** Show the image actions (download / copy / info) ellipsis menu. */
    showActionsMenu?: boolean;
  }

  let {
    open = $bindable(false),
    imageUrl,
    imageName = m.ui_imageLightbox_image_alt(),
    onClose,
    openerElement = null,
    showActionsMenu = false,
  }: Props = $props();

  let mediaLightbox: MediaLightbox | undefined = $state();
  let zoomPanViewport: ZoomPanViewport | undefined = $state();
  let pannable = $state(false);
  let imageActionsMenu: ImageActionsMenu | undefined = $state();
  let imageActionsOpen = $state(false);

  $effect(() => {
    if (!open) imageActionsOpen = false;
  });

  function handleKeydown(e: KeyboardEvent) {
    handleCopy(e);
    if (e.defaultPrevented) return;
    if (!zoomPanViewport?.handleKeydown(e)) handleArrowKey(e);
  }

  function handleArrowKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || imageActionsOpen) return;
    if (e.target instanceof HTMLInputElement) return;
    const next = adjacentLightboxOpener(openerElement, e.key === 'ArrowLeft' ? -1 : 1);
    if (!next) return;
    e.preventDefault();
    mediaLightbox?.handOffTo(next);
  }

  function handleCopy(event: KeyboardEvent | ClipboardEvent) {
    if (open && showActionsMenu) imageActionsMenu?.handleCopy(event);
  }

  function handleContextMenu(event: MouseEvent) {
    if (!showActionsMenu || !supportsImageActions(imageUrl)) return;
    event.preventDefault();
    event.stopPropagation();
    imageActionsOpen = true;
  }
</script>

{#snippet actions()}
  {#if showActionsMenu}
    <ImageActionsMenu
      bind:this={imageActionsMenu}
      {imageUrl}
      {imageName}
      bind:open={imageActionsOpen}
      triggerClass="h-9 w-9 bg-white/0 hover:bg-white/20"
      contentClass="z-[1003]"
    />
  {/if}
{/snippet}

<MediaLightbox
  bind:this={mediaLightbox}
  bind:open
  ariaLabel={m.ui_imageLightbox_preview_ariaLabel()}
  closeLabel={m.ui_imageLightbox_close_ariaLabel()}
  {onClose}
  {openerElement}
  {actions}
  onKeydown={handleKeydown}
  onCopy={handleCopy}
>
  {#key imageUrl}
    <ZoomPanViewport bind:this={zoomPanViewport} bind:pannable>
      <img
        src={imageUrl}
        alt={imageName}
        class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain {pannable
          ? ''
          : 'cursor-default'}"
        draggable={!pannable}
        data-media-lightbox-content
        oncontextmenu={handleContextMenu}
      />
    </ZoomPanViewport>
  {/key}
</MediaLightbox>
