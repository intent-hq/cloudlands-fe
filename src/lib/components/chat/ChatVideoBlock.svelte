<script lang="ts">
  import type { VideoSource } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import VideoActionsMenu from '$lib/components/ui/VideoActionsMenu.svelte';
  import VideoLightbox from '$lib/components/ui/VideoLightbox.svelte';

  interface Props {
    source: VideoSource;
    name?: string;
    poster?: string;
  }

  let { source, name = m.chat_videoBlock_fromAgent_label(), poster }: Props = $props();
  let lightboxOpen = $state(false);
  let frameReady = $state(false);
  let frameUnavailable = $state(false);
  let triggerRef: HTMLButtonElement | null = $state(null);

  const videoUrl = $derived(
    source.kind === 'inline' ? `data:${source.mimeType};base64,${source.data}` : source.url,
  );
  const safePoster = $derived.by(() => {
    if (!poster) return undefined;
    if (/^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(poster)) return poster;
    try {
      const url = new URL(poster);
      return (url.protocol === 'https:' || url.protocol === 'workspace-file:') &&
        !url.username &&
        !url.password
        ? poster
        : undefined;
    } catch {
      return undefined;
    }
  });

  function markFrameReady() {
    frameReady = true;
    frameUnavailable = false;
  }
</script>

<div class="my-2 min-w-0 max-w-2xl" data-chat-video>
  <div
    class="group relative aspect-video w-full max-h-40 max-w-2xl"
    style="width: min(100%, calc(10rem * 16 / 9));"
  >
    <button
      bind:this={triggerRef}
      type="button"
      class="relative block size-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted/40 p-0 shadow-(--elevation-raised) focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 forced-colors:border"
      aria-label={m.chat_videoBlock_play_ariaLabel({ name })}
      data-testid="chat-video-snapshot"
      onclick={() => (lightboxOpen = true)}
    >
      <div
        class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" class="size-10" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" />
          <path d="m10 9 5 3-5 3V9Z" fill="currentColor" />
        </svg>
      </div>
      <video
        src={videoUrl}
        poster={safePoster}
        preload="metadata"
        muted
        playsinline
        tabindex="-1"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 size-full object-contain transition-opacity motion-reduce:transition-none {safePoster ||
        (frameReady && !frameUnavailable)
          ? 'opacity-100'
          : 'opacity-0'}"
        onloadeddata={markFrameReady}
        onerror={() => (frameUnavailable = true)}
      ></video>
      <span
        class="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/20 motion-reduce:transition-none forced-colors:bg-transparent"
        aria-hidden="true"
      >
        <span
          class="flex size-11 items-center justify-center rounded-full border border-white/70 bg-black/60 text-white shadow-(--elevation-raised) forced-colors:border forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
        >
          <svg viewBox="0 0 20 20" class="ml-0.5 size-5" fill="currentColor">
            <path d="m7 5 7 5-7 5V5Z" />
          </svg>
        </span>
      </span>
      {#if frameUnavailable}
        <span class="type-caption absolute inset-x-2 bottom-2 text-muted-foreground" role="status">
          {m.chat_videoBlock_thumbnailUnavailable_description()}
        </span>
      {/if}
    </button>
    <VideoActionsMenu
      {videoUrl}
      videoName={name}
      sourceKind={source.kind}
      mimeType={source.mimeType}
      triggerClass="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
    />
  </div>
</div>

<VideoLightbox
  bind:open={lightboxOpen}
  {videoUrl}
  videoName={name}
  poster={safePoster}
  sourceKind={source.kind}
  mimeType={source.mimeType}
  openerElement={triggerRef}
/>
