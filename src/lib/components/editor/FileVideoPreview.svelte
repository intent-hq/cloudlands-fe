<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectVideoPreview } from '$store/renderer/slices/video-preview/video-preview-selectors';
  import {
    videoPreviewRequested,
    videoPreviewReleased,
  } from '$store/renderer/slices/video-preview/video-preview-slice';

  let {
    sourceUrl,
    fileName,
    allowDownload,
    downloading,
    onDownload,
  }: {
    sourceUrl: string;
    fileName: string;
    allowDownload: boolean;
    downloading: boolean;
    onDownload: () => void;
  } = $props();

  let error = $state<'network' | 'unsupported' | null>(null);
  const viewId = crypto.randomUUID();
  const preview = selectVideoPreview(viewId);
  const preparing = $derived($preview?.status === 'loading');
  const shownError = $derived(error ?? $preview?.error);
  let attempted = false;
  let disposed = false;

  onDestroy(() => {
    disposed = true;
    appStore.dispatch(videoPreviewReleased(viewId));
  });

  function recover() {
    if (disposed || preparing) return;
    // Only the contained workspace MP4 route supports the optional system converter.
    const url = sourceUrl.startsWith('workspace-file://') ? new URL(sourceUrl) : null;
    if (attempted || !url || !url.pathname.toLowerCase().endsWith('.mp4')) {
      error = 'unsupported';
      return;
    }
    attempted = true;
    url.searchParams.set('preview', 'h264');
    appStore.dispatch(videoPreviewRequested(viewId, url.hostname, url.toString()));
  }

  function handleError(event: Event) {
    if (disposed) return;
    const code = (event.currentTarget as HTMLVideoElement).error?.code;
    if (code === 2) error = 'network';
    else if (code !== 1) void recover();
  }
</script>

<div class="min-h-0 flex-1 flex items-center justify-center bg-background">
  {#if shownError || preparing}
    <div class="flex flex-col items-center gap-3 p-6 text-center text-sm text-subtle">
      <p class="break-all">{fileName}</p>
      {#if preparing}
        <p role="status">{m.editor_fileViewer_videoPreparing_label()}</p>
      {:else}
        <p role="alert">
          {shownError === 'network'
            ? m.editor_fileViewer_videoLoad_error()
            : m.editor_fileViewer_videoUnsupported_label()}
        </p>
      {/if}
      {#if allowDownload}
        <Button variant="secondary" size="sm" onclick={onDownload} disabled={downloading}>
          {m.layout_fileTab_downloadFile_label()}
        </Button>
      {/if}
    </div>
  {:else}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      src={$preview?.url ?? sourceUrl}
      controls
      preload="metadata"
      playsinline
      class="max-w-full max-h-full"
      data-testid="file-video"
      onerror={handleError}
      onloadedmetadata={(event) => {
        // Chromium can discard an unsupported video track and load only AAC audio.
        if (event.currentTarget.videoWidth === 0) void recover();
      }}
    >
      {m.editor_fileViewer_videoUnsupported_label()}
    </video>
  {/if}
</div>
