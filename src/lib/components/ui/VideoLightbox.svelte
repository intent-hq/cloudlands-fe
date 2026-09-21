<script lang="ts">
  import type { VideoSource } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import MediaLightbox from '$lib/components/ui/MediaLightbox.svelte';
  import VideoActionsMenu from '$lib/components/ui/VideoActionsMenu.svelte';

  interface Props {
    open?: boolean;
    videoUrl: string;
    videoName?: string;
    poster?: string;
    sourceKind?: VideoSource['kind'];
    mimeType?: string;
    openerElement?: HTMLElement | null;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    videoUrl,
    videoName = m.chat_videoBlock_fromAgent_label(),
    poster,
    sourceKind,
    mimeType,
    openerElement = null,
    onClose,
  }: Props = $props();

  let playbackUnavailable = $state(false);

  $effect(() => {
    if (!open || !videoUrl) return;
    playbackUnavailable = false;
  });
</script>

{#snippet actions()}
  <VideoActionsMenu
    {videoUrl}
    {videoName}
    {sourceKind}
    {mimeType}
    triggerClass="h-9 w-9 bg-white/0 hover:bg-white/20"
    contentClass="z-[1003]"
  />
{/snippet}

<MediaLightbox
  bind:open
  ariaLabel={m.chat_videoBlock_dialog_title({ name: videoName })}
  closeLabel={m.chat_videoBlock_close_ariaLabel()}
  {openerElement}
  {onClose}
  {actions}
>
  <div
    data-media-lightbox-content
    data-video-lightbox-root
    class="flex max-h-[90vh] max-w-[90vw] cursor-default flex-col items-center gap-3"
  >
    <!-- svelte-ignore a11y_media_has_caption (agent video output has no captions field) -->
    <video
      src={videoUrl}
      {poster}
      controls
      preload="metadata"
      playsinline
      class="max-h-[85vh] max-w-[90vw] rounded-lg bg-black object-contain shadow-(--elevation-overlay)"
      aria-label={videoName}
      onerror={() => (playbackUnavailable = true)}
      data-testid="chat-video-player"
    >
      {m.chat_videoBlock_unsupported_description()}
    </video>
    {#if playbackUnavailable}
      <p class="type-body text-white/80" role="status">
        {m.chat_videoBlock_unavailable_description()}
      </p>
    {/if}
  </div>
</MediaLightbox>
