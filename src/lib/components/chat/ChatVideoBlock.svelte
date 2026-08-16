<script lang="ts">
  import type { VideoSource } from '$shared/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    source: VideoSource;
    name?: string;
    poster?: string;
  }

  let { source, name = m.chat_videoBlock_fromAgent_label(), poster }: Props = $props();
  let open = $state(false);
  let frameReady = $state(false);
  let frameUnavailable = $state(false);
  let playbackUnavailable = $state(false);

  const videoUrl = $derived(
    source.kind === 'inline' ? `data:${source.mimeType};base64,${source.data}` : source.url,
  );
  const safePoster = $derived.by(() => {
    if (!poster) return undefined;
    if (/^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(poster)) return poster;
    try {
      const url = new URL(poster);
      return url.protocol === 'https:' && !url.username && !url.password ? poster : undefined;
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
  <Dialog.Root bind:open>
    <Dialog.Trigger
      class="group relative block aspect-video w-full max-w-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted/40 p-0 shadow-(--elevation-raised) focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 forced-colors:border"
      aria-label={m.chat_videoBlock_play_ariaLabel({ name })}
      data-testid="chat-video-snapshot"
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
    </Dialog.Trigger>

    <Dialog.Content class="max-w-4xl" closeLabel={m.chat_videoBlock_close_ariaLabel()}>
      <Dialog.Header class="sr-only">
        <Dialog.Title>{m.chat_videoBlock_dialog_title({ name })}</Dialog.Title>
        <Dialog.Description>{m.chat_videoBlock_dialog_description()}</Dialog.Description>
      </Dialog.Header>
      <div class="flex min-w-0 flex-col gap-3">
        <!-- svelte-ignore a11y_media_has_caption (normalized agent video output has no captions field) -->
        <video
          src={videoUrl}
          controls
          preload="metadata"
          playsinline
          class="aspect-video max-h-[calc(100dvh-8rem)] w-full rounded-md bg-black object-contain"
          aria-label={name}
          onerror={() => (playbackUnavailable = true)}
          data-testid="chat-video-player"
        >
          {m.chat_videoBlock_unsupported_description()}
        </video>
        {#if playbackUnavailable}
          <p class="type-body text-muted-foreground" role="status">
            {m.chat_videoBlock_unavailable_description()}
          </p>
        {/if}
        <a
          href={videoUrl}
          target="_blank"
          rel="noreferrer"
          download={source.kind === 'inline' ? name : undefined}
          class="type-body w-fit rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {m.chat_videoBlock_openDownload_label()}
        </a>
      </div>
    </Dialog.Content>
  </Dialog.Root>
</div>
