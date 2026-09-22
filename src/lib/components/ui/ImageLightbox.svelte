<script lang="ts">
  /**
   * ImageLightbox - Full-screen image preview lightbox
   *
   * Opens images in a full-screen overlay with dark backdrop.
   * Closes on Escape, backdrop click, or X button.
   * Keyboard accessible with focus trap and focus return.
   */
  import MediaLightbox from './MediaLightbox.svelte';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { supportsImageActions } from '$lib/utils/image-actions';

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

  let zoomPanViewport: ZoomPanViewport | undefined = $state();
  let imageActionsMenu: ImageActionsMenu | undefined = $state();
  let imageActionsOpen = $state(false);

  $effect(() => {
    if (!open) imageActionsOpen = false;
  });

  function handleKeydown(e: KeyboardEvent) {
    handleCopy(e);
    if (!e.defaultPrevented) zoomPanViewport?.handleKeydown(e);
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
    <ZoomPanViewport bind:this={zoomPanViewport}>
      <img
        src={imageUrl}
        alt={imageName}
        class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        draggable="false"
        data-media-lightbox-content
        oncontextmenu={handleContextMenu}
      />
    </ZoomPanViewport>
  {/key}
</MediaLightbox>
