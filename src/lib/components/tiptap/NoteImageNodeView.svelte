<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { node, selected, editor }: NodeViewProps = $props();

  let imageUrl = $derived<string>(node.attrs.src ?? '');
  let imageName = $derived<string>(
    node.attrs.alt || node.attrs.title || m.ui_imageLightbox_image_alt(),
  );
  let lightboxOpen = $state(false);
  let openerElement: HTMLElement | null = $state(null);

  function openLightbox(event: MouseEvent, opener?: HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    openerElement =
      opener ??
      (event.currentTarget instanceof HTMLElement ? event.currentTarget : editor.view.dom);
    lightboxOpen = true;
  }

  function handleImageClick(event: MouseEvent) {
    if (!editor.isEditable) openLightbox(event);
  }

  function handleImageDoubleClick(event: MouseEvent) {
    if (!editor.isEditable) return;
    openLightbox(event, editor.view.dom);
  }
</script>

<NodeViewWrapper
  class={`note-image-node${selected ? ' selected' : ''}${editor.isEditable ? ' editable' : ''}`}
>
  <!-- Editable clicks must bubble to ProseMirror selection; read-only clicks open the lightbox. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="group relative inline-block max-w-full" onclick={handleImageClick}>
    <img
      src={imageUrl}
      alt={imageName}
      title={node.attrs.title ?? undefined}
      class="note-image max-w-full rounded-md"
      ondblclick={handleImageDoubleClick}
      draggable="true"
    />
    <div
      class="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      contenteditable="false"
    >
      {#if editor.isEditable}
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={openLightbox}
          aria-label={m.chat_imageBlock_viewFullSize_ariaLabel({ alt: imageName })}
        >
          <Fa icon={faExpand} size="sm" />
        </button>
      {/if}
      <ImageActionsMenu {imageUrl} {imageName} triggerClass="data-[state=open]:opacity-100" />
    </div>
  </div>
</NodeViewWrapper>

<ImageLightbox bind:open={lightboxOpen} {imageUrl} {imageName} {openerElement} showActionsMenu />

<style>
  :global(.note-image-node) {
    display: block;
  }

  :global(.note-image-node.selected) img {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  :global(.note-image-node:not(.editable)) img {
    cursor: zoom-in;
  }
</style>
