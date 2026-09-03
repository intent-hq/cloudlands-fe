<!--
  AttachmentPreview.svelte

  Shows a preview of an attached file with thumbnail for images.
  Supports removal and displays file metadata.
-->
<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faXmark,
    faFile,
    faFolder,
    faImage,
    faFileCode,
    faFileAlt,
    faCircleExclamation,
    faRotateRight,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';

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
    /**
     * Placement lifecycle for placed workspace attachments (shared across
     * chat input, new-workspace modal, and onboarding): 'placing' shows a
     * spinner, 'failed' shows an error state with a retry affordance.
     * Absent/'placed' renders the normal chip.
     */
    placementStatus?: 'placing' | 'failed' | 'placed';
    /**
     * Chunk-acknowledged upload fraction (0..1) while a chunked remote
     * placement is in flight — renders a percent label next to the spinner.
     * Absent for single-shot placements (indeterminate spinner only).
     */
    placementProgress?: number;
    /**
     * Human-readable reason for a failed placement (daemon error detail,
     * e.g. "sourcePath is a directory"). Appended to the failed tooltip.
     */
    placementError?: string;
    /** Retry a failed placement. Rendered only when placementStatus is 'failed'. */
    onRetry?: (id: string) => void;
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
    placementStatus = undefined,
    placementProgress = undefined,
    placementError = undefined,
    onRetry,
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
    // Staged folder pills (path-only references) pass the literal 'folder'
    // marker instead of a mime type.
    if (type === 'folder') return faFolder;
    const mimeType = type || imageMimeType || '';
    // 'image' (no subtype) is the neutral marker for an attachment-reference
    // image restored without a persisted mime (monorepo#3338).
    if (mimeType.startsWith('image')) return faImage;
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

  const isImage = $derived(type.startsWith('image/') || !!imageMimeType?.startsWith('image'));

  // Chip tooltip: only failed placements explain themselves on hover; the
  // daemon's failure detail (when captured) is appended after the generic copy.
  const chipTitle = $derived.by(() => {
    if (placementStatus !== 'failed') return undefined;
    const base = m.chat_attachmentPreview_placementFailed_tooltip({ name });
    return placementError ? `${base} — ${placementError}` : base;
  });

  // Percent label for a chunked upload in flight (chunk-acknowledged
  // fraction); undefined keeps the indeterminate spinner alone.
  const progressLabel = $derived.by(() => {
    if (placementStatus !== 'placing' || placementProgress === undefined) return undefined;
    const clamped = Math.max(0, Math.min(1, placementProgress));
    return formatNumber(clamped, { style: 'percent', maximumFractionDigits: 0 });
  });

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
      aria-label={m.chat_attachmentPreview_viewFullSize_ariaLabel({ name })}
      title={name}
    >
      <img src={thumbnailUrl} alt={name} class="w-full h-full object-cover" />
    </button>
    {#if onRemove}
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 bg-background/80 hover:bg-background shadow-sm"
        onclick={handleRemoveClick}
        aria-label={m.chat_attachmentPreview_remove_ariaLabel({ name })}
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
    class="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs whitespace-nowrap group shrink-0 {placementStatus ===
    'failed'
      ? 'bg-danger-background/10 text-danger border border-danger/40'
      : 'bg-muted/70 text-subtle'} {className}"
    in:scale={{ duration: 200, start: 0.9, easing: cubicOut }}
    out:fade={{ duration: 150 }}
    data-placement-status={placementStatus}
    title={chipTitle}
  >
    {#if placementStatus === 'placing'}
      <!-- Placement in flight: spinner replaces the file icon; chunked
           uploads add the chunk-acknowledged percent next to it -->
      <Fa icon={faSpinner} size="15" class="opacity-50 shrink-0 animate-spin" />
      {#if progressLabel !== undefined}
        <span class="tabular-nums opacity-70 shrink-0" data-testid="attachment-upload-progress"
          >{progressLabel}</span
        >
      {/if}
    {:else if placementStatus === 'failed'}
      <!-- Placement failed: error icon -->
      <Fa icon={faCircleExclamation} size="15" class="shrink-0" />
    {:else if isImage && thumbnailUrl}
      <!-- Image thumbnail -->
      <div class="w-4 h-4 rounded overflow-hidden shrink-0">
        <img src={thumbnailUrl} alt={name} class="w-full h-full object-cover" />
      </div>
    {:else}
      <!-- File icon -->
      <Fa {icon} size="15" class="opacity-30 shrink-0" />
    {/if}

    <span class="font-medium truncate max-w-30">{name}</span>

    {#if placementStatus === 'failed' && onRetry}
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="shrink-0 -my-1"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          onRetry(id);
        }}
        aria-label={m.chat_attachmentPreview_retryPlacement_ariaLabel({ name })}
        data-testid="attachment-retry"
      >
        <Fa icon={faRotateRight} size="10" />
      </Button>
    {/if}

    {#if onRemove}
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="shrink-0 {placementStatus === 'failed'
          ? ''
          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'} transition-opacity duration-150 -my-1 -mr-1"
        onclick={() => onRemove(id)}
        aria-label={m.chat_attachmentPreview_removeAttachment_ariaLabel()}
      >
        <Fa icon={faXmark} size="10" />
      </Button>
    {/if}
  </div>
{/if}
