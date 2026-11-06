<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ChatVideoBlock from './ChatVideoBlock.svelte';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
  import { observeAttachmentImageUrl } from './attachment-image-url';
  import type { EditedCapture } from '$lib/utils/dock-evidence-display';
  import { m } from '$shared/paraglide/messages.js';
  import VideoCameraIcon from 'phosphor-svelte/lib/VideoCameraIcon';
  import ImageIcon from 'phosphor-svelte/lib/ImageIcon';

  let {
    capture,
    workspaceId,
    readOnly = false,
    videoMimeType = 'video/mp4',
    images,
    onImage,
    onImageError,
    onOpenFile,
  }: {
    capture: EditedCapture;
    videoMimeType?: 'video/mp4' | 'video/webm';
    workspaceId: string | null | undefined;
    readOnly?: boolean;
    images: Record<string, string | null>;
    onImage: (id: string, opener: HTMLButtonElement) => void;
    onImageError: (id: string, src: string) => void;
    onOpenFile: (id: string) => void;
  } = $props();
  let videoUrl = $state<string | null>(null);
  $effect(() => {
    const id = capture.kind === 'recording' ? capture.primaryId : null,
      ws = workspaceId;
    videoUrl = null;
    if (!id || !ws || readOnly) return;
    const observer = observeAttachmentImageUrl(ws, id, (url) => (videoUrl = url));
    return () => observer.dispose();
  });
  const title = $derived(
    capture.kind === 'screenshot'
      ? m.dock_screenshotEditor_title()
      : m.dock_captureEditor_video_ariaLabel(),
  );
  const duration = $derived.by(() => {
    if (!capture.kept_ms?.length) return null;
    const seconds = Math.round(
      capture.kept_ms.reduce((sum, range) => sum + range.endMs - range.startMs, 0) / 1000,
    );
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });
  const count = $derived(
    capture.marks.length === 1
      ? m.dock_captureEditor_markCount_one()
      : m.dock_captureEditor_markCount_other({ count: capture.marks.length }),
  );
</script>

<article class="capture-card" aria-label={title}>
  <header>
    <div class="identity">
      {#if capture.kind === 'recording'}<VideoCameraIcon size={16} />{:else}<ImageIcon
          size={16}
        />{/if}
      <span class="type-caption font-medium">{title}</span>
      {#if duration}<span class="type-caption duration">{duration}</span>{/if}
    </div>
    <span class="type-caption secondary">{count}</span>
  </header>
  {#if capture.kind === 'recording'}
    <div class="choices type-caption">
      <span
        >{capture.video === 'highlights'
          ? m.dock_captureEditor_videoHighlights_label()
          : m.dock_captureEditor_videoFull_label()}</span
      >
      <span
        >{m.dock_captureEditor_voice_label()}: {capture.voice === 'audio'
          ? m.dock_captureEditor_voiceAudio_label()
          : capture.voice === 'transcript'
            ? m.dock_captureEditor_voiceTranscript_label()
            : m.dock_captureEditor_voiceOff_label()}</span
      >
    </div>
    {#if videoUrl}
      <ChatVideoBlock
        source={{ kind: 'workspace', url: videoUrl, mimeType: videoMimeType }}
        name={title}
        allowFileMedia={!readOnly}
        canOpenFile={() => !readOnly}
      />
    {:else if capture.primaryId}
      <Button
        variant="ghost"
        class="open-recording"
        disabled={readOnly}
        onclick={() => capture.primaryId && onOpenFile(capture.primaryId)}
      >
        <VideoCameraIcon size={20} />{m.chat_chatMessage_openAttachment_title({ name: title })}
      </Button>
    {/if}
    {#if capture.voice === 'transcript' && capture.transcript}
      <details class="transcript">
        <summary class="type-caption">{m.dock_captureEditor_voiceTranscript_label()}</summary>
        <p class="type-caption">{capture.transcript}</p>
      </details>
    {/if}
  {:else if capture.primaryId}
    {@const src = images[capture.primaryId]}
    {#if src}
      <Button
        variant="plain"
        wrapContent={false}
        class="image-preview"
        disabled={readOnly}
        aria-label={m.chat_attachmentPreview_viewFullSize_ariaLabel({ name: title })}
        onclick={(event) => capture.primaryId && onImage(capture.primaryId, event.currentTarget)}
      >
        <img
          {src}
          alt={title}
          loading="lazy"
          onerror={() => capture.primaryId && onImageError(capture.primaryId, src)}
        />
      </Button>
    {:else}<MediaUnavailable name={title} reason="load-failed" />{/if}
  {/if}
  {#if capture.frames?.length}
    <details class="frames">
      <summary class="type-caption">{count}</summary>
      <div class="frame-strip">
        {#each capture.frames as frame (frame.attachment_id)}
          {@const mark = capture.marks.find((mark) => mark.id === frame.mark_id)}
          {@const src = images[frame.attachment_id]}
          {@const label = m.dock_screenshotEditor_mark({
            n: mark?.n ?? 0,
            kind: mark?.label || m.dock_captureEditor_addedMark_label(),
          })}
          <Button
            variant="plain"
            wrapContent={false}
            class="frame"
            aria-label={label}
            tooltip={label}
            disabled={readOnly || !src}
            onclick={(event) => onImage(frame.attachment_id, event.currentTarget)}
          >
            {#if src}<img
                {src}
                alt={label}
                loading="lazy"
                onerror={() => onImageError(frame.attachment_id, src)}
              />{/if}
            <span class="type-caption">{mark?.n}</span>
          </Button>
        {/each}
      </div>
    </details>
  {/if}
</article>

<style>
  .capture-card {
    width: 100%;
    max-width: 32rem;
    min-width: 0;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    padding: 12px;
    background: hsl(var(--background));
    overflow: hidden;
  }
  header,
  .identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  header {
    justify-content: space-between;
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .identity {
    color: hsl(var(--foreground));
  }
  .duration {
    font-variant-numeric: tabular-nums;
  }
  .secondary,
  .duration,
  .choices {
    color: hsl(var(--muted-foreground));
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-top: 6px;
  }
  .capture-card :global(.image-preview) {
    display: block;
    width: 100%;
    height: auto;
    max-height: 18rem;
    margin-top: 10px;
    padding: 0;
    overflow: hidden;
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
  }
  :global(.image-preview) img {
    display: block;
    width: 100%;
    max-height: 18rem;
    object-fit: contain;
  }
  .capture-card :global(.open-recording) {
    width: 100%;
    margin-top: 10px;
    min-height: 5rem;
    background: hsl(var(--muted));
  }
  details {
    margin-top: 10px;
  }
  summary {
    cursor: pointer;
    color: hsl(var(--muted-foreground));
  }
  .transcript p {
    white-space: pre-wrap;
    max-height: 12rem;
    overflow: auto;
    line-height: 1.6;
  }
  .frame-strip {
    display: flex;
    gap: 6px;
    overflow: auto;
    padding-top: 8px;
  }
  .capture-card :global(.frame) {
    position: relative;
    width: 72px;
    height: 48px;
    flex: 0 0 auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
  }
  :global(.frame) img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  :global(.frame) span {
    position: absolute;
    bottom: 2px;
    left: 3px;
    padding: 0 4px;
    border-radius: var(--radius-small);
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
</style>
