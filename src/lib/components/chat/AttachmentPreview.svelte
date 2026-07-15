<!--
  AttachmentPreview.svelte

  Shows a preview of an attached file with thumbnail for images.
  Supports removal and displays file metadata.
-->
<script lang="ts">
  import {
  fade,
  scale,
} from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faFile,
  faImage,
  faFileCode,
  faFileAlt,
} from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';

  interface Props {
    id: string;
    name: string;
    type?: string;
    size?: number;
    file?: File;
    // For base64 image data (from loaded messages)
    imageData?: string;
    imageMimeType?: string;
    onRemove?: (id: string) => void;
    class?: string;
    /** Display mode - 'chip' for small inline preview, 'thumbnail' for larger Slack-style preview */
    variant?: 'chip' | 'thumbnail';
  }

  let {
    id,
    name,
    type = '',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    size,
    file,
    imageData,
    imageMimeType,
    onRemove,
    class: className = '',
    variant = 'chip',
  }: Props = $props();

  // Generate thumbnail URL for images
  let thumbnailUrl = $state<string | null>(null);

  $effect(() => {
    // Use base64 data if available
    if (imageData && imageMimeType) {
      thumbnailUrl = `data:${imageMimeType};base64,${imageData}`;
      return undefined; // explicit - no cleanup needed for data URLs
    }
    // Otherwise use File object
    if (file && type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      thumbnailUrl = url;
      return () => URL.revokeObjectURL(url);
    }
    // Clear thumbnailUrl if neither condition matches
    thumbnailUrl = null;
  });

  // Determine icon based on file type
  const icon = $derived.by(() => {
    const mimeType = type || imageMimeType || '';
    if (mimeType.startsWith('image/')) return faImage;
    if (
      mimeType.includes('javascript') ||
      mimeType.includes('typescript') ||
      mimeType.includes('json')
    )
      return faFileCode;
    if (mimeType.includes('text') || mimeType.includes('markdown')) return faFileAlt;
    return faFile;
  });

  // Format file size

  const isImage = $derived(type.startsWith('image/') || !!imageMimeType?.startsWith('image/'));

  // Lightbox state
  let lightboxOpen = $state(false);
  let thumbnailButtonElement: HTMLButtonElement | null = $state(null);

  function openLightbox() {
    if (variant === 'thumbnail' && isImage && thumbnailUrl) {
      lightboxOpen = true;
    }
  }

  function handleThumbnailKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLightbox();
    }
  }

  function handleRemoveClick(e: MouseEvent) {
    e.stopPropagation();
    onRemove?.(id);
  }
</script>

{#if variant === 'thumbnail' && isImage && thumbnailUrl}
  <!-- Slack-style thumbnail for images: larger, rounded corners, X overlaid on hover -->
  <div
    class="relative group shrink-0 {className}"
    in:scale={{ duration: 200, start: 0.9, easing: cubicOut }}
    out:fade={{ duration: 150 }}
  >
    <!-- Clickable thumbnail button -->
    <button
      bind:this={thumbnailButtonElement}
      type="button"
      class="w-16 h-16 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary"
      onclick={openLightbox}
      onkeydown={handleThumbnailKeydown}
      aria-label="View {name} full size"
      title={name}
    >
      <img
        src={thumbnailUrl}
        alt={name}
        class="w-full h-full object-cover"
      />
    </button>
    {#if onRemove}
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-background/80 hover:bg-background shadow-sm"
        onclick={handleRemoveClick}
        aria-label="Remove {name}"
      >
        <Fa icon={faXmark} size="10" />
      </Button>
    {/if}
  </div>

  <!-- Image Lightbox -->
  <ImageLightbox
    bind:open={lightboxOpen}
    imageUrl={thumbnailUrl}
    imageName={name}
    openerElement={thumbnailButtonElement}
  />
{:else}
  <!-- Chip variant: small inline preview for all files -->
  <div
    class="flex items-center gap-1.5 px-2 py-0.5 bg-muted/70 text-subtle rounded text-xs whitespace-nowrap group shrink-0 {className}"
    in:scale={{ duration: 200, start: 0.9, easing: cubicOut }}
    out:fade={{ duration: 150 }}
  >
    {#if isImage && thumbnailUrl}
      <!-- Image thumbnail -->
      <div class="w-4 h-4 rounded overflow-hidden shrink-0">
        <img src={thumbnailUrl} alt={name} class="w-full h-full object-cover" />
      </div>
    {:else}
      <!-- File icon -->
      <Fa {icon} size="15" class="opacity-30 shrink-0" />
    {/if}

    <span class="font-medium truncate max-w-30">{name}</span>

    {#if onRemove}
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 -my-1 -mr-1"
        onclick={() => onRemove(id)}
        aria-label="Remove attachment"
      >
        <Fa icon={faXmark} size="10" />
      </Button>
    {/if}
  </div>
{/if}
