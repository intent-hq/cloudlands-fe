<script lang="ts">
  import EditedCaptureCard from './EditedCaptureCard.svelte';
  import type { EditedCapture } from '$lib/utils/dock-evidence-display';
  import FileIcon from 'phosphor-svelte/lib/File';
  import { Button } from '$lib/components/ui/button';
  import type { QueuedMessage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { isSupportedImageMimeType, imageAttachmentName } from './input/image-attachment-format';

  type ImageBlock = NonNullable<QueuedMessage['imageBlocks']>[number];
  type FileBlock = NonNullable<QueuedMessage['fileBlocks']>[number];
  let {
    message,
    captures = [],
    workspaceId,
    imageFailures = {},
    queuedImageSrc,
    openImageLightbox,
    handleReferenceImageError,
    openQueuedFileAttachment,
  }: {
    message: Pick<QueuedMessage, 'imageBlocks' | 'fileBlocks'>;
    captures?: EditedCapture[];
    workspaceId?: string;
    imageFailures?: Record<string, true>;
    queuedImageSrc: (block: ImageBlock) => string | null;
    openImageLightbox: (block: ImageBlock, opener: HTMLButtonElement, index: number) => void;
    handleReferenceImageError: (block: ImageBlock, src: string) => void;
    openQueuedFileAttachment: (block: FileBlock) => void;
  } = $props();
  const captureIds = $derived(
    new Set(
      captures.flatMap((capture) => [
        ...(capture.primaryId ? [capture.primaryId] : []),
        ...(capture.frames ?? []).map((frame) => frame.attachment_id),
      ]),
    ),
  );
  const remainingImages = $derived(
    (message.imageBlocks ?? []).filter(
      (block) => !block.attachmentId || !captureIds.has(block.attachmentId),
    ),
  );
  const captureImages = $derived(
    Object.fromEntries(
      (message.imageBlocks ?? []).flatMap((block) =>
        block.attachmentId ? [[block.attachmentId, queuedImageSrc(block)]] : [],
      ),
    ),
  );
  const unsupportedImages = $derived(
    remainingImages.filter((block) => block.mimeType && !isSupportedImageMimeType(block.mimeType)),
  );
  const imageBlocks = $derived(
    remainingImages.filter((block) => !unsupportedImages.includes(block)),
  );
  const fileBlocks = $derived([
    ...(message.fileBlocks ?? [])
      .filter((block) => !captureIds.has(block.attachmentId))
      .map((block) => ({
        ...block,
        data: undefined as string | undefined,
      })),
    ...unsupportedImages.map((block) => ({
      type: 'file' as const,
      attachmentId: block.attachmentId,
      data: block.data,
      fileName: imageAttachmentName(block.mimeType, 'image'),
      mimeType: block.mimeType,
    })),
  ]);
</script>

{#if captures.length}
  <div
    class="mb-2 flex max-w-full flex-wrap items-start gap-2"
    data-testid="queued-capture-previews"
  >
    {#each captures as capture (capture.id)}
      <EditedCaptureCard
        {capture}
        compact
        {workspaceId}
        images={captureImages}
        {imageFailures}
        videoMimeType={message.fileBlocks?.find((block) => block.attachmentId === capture.primaryId)
          ?.mimeType === 'video/webm'
          ? 'video/webm'
          : 'video/mp4'}
        onImage={(id, opener) => {
          const index = message.imageBlocks?.findIndex((block) => block.attachmentId === id) ?? -1;
          const block = message.imageBlocks?.[index];
          if (block) openImageLightbox(block, opener, index);
        }}
        onImageError={(id, src) => {
          const block = message.imageBlocks?.find((block) => block.attachmentId === id);
          if (block) handleReferenceImageError(block, src);
        }}
        onOpenFile={(id) => {
          const block = message.fileBlocks?.find((block) => block.attachmentId === id);
          if (block) openQueuedFileAttachment(block);
        }}
      />
    {/each}
  </div>
{/if}

{#if imageBlocks.length > 0}
  <div class="inline-flex max-w-full flex-wrap items-center gap-1">
    {#each imageBlocks as block, i (i)}
      {@const src = queuedImageSrc(block)}
      <Button
        type="button"
        variant="plain"
        size="compact"
        class="inline-flex shrink-0 p-0 border-0 bg-transparent cursor-pointer align-text-bottom rounded-xs"
        data-testid="queued-image-thumbnail"
        onclick={(e) => {
          e.stopPropagation();
          openImageLightbox(block, e.currentTarget as HTMLButtonElement, i);
        }}
        aria-label={m.chat_chatMessage_viewAttachedImage_ariaLabel({
          number: formatInteger(i + 1),
          total: formatInteger(imageBlocks.length),
        })}
      >
        {#if src}
          <img
            {src}
            alt={m.chat_chatMessage_attachedImage_alt({ number: formatInteger(i + 1) })}
            class="h-[1.1em] w-[1.1em] rounded-xs border border-border object-cover hover:opacity-90 transition-opacity"
            onerror={() => handleReferenceImageError(block, src)}
          />
        {:else}
          <!-- Reference still resolving, failed to load, or its file is
             gone: neutral placeholder tile instead of a broken img. -->
          <span
            class="h-[1.1em] w-[1.1em] rounded-xs border border-border bg-muted/50 inline-block"
            data-testid="queued-image-placeholder"
          ></span>
        {/if}
      </Button>
    {/each}
  </div>
{/if}

{#if fileBlocks.length > 0}
  <div class="inline-flex max-w-full flex-wrap items-center gap-1">
    {#each fileBlocks as block, i (i)}
      <Button
        type="button"
        variant="plain"
        class="inline-flex max-w-full min-w-0 items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/50 hover:bg-muted transition-colors text-[0.7rem] text-muted-foreground hover:text-foreground cursor-pointer"
        data-testid="queued-file-chip"
        href={!block.attachmentId && block.data
          ? `data:application/octet-stream;base64,${block.data}`
          : undefined}
        download={!block.attachmentId ? block.fileName : undefined}
        disabled={!block.attachmentId && !block.data}
        onclick={(e) => {
          e.stopPropagation();
          if (block.attachmentId)
            openQueuedFileAttachment({ ...block, attachmentId: block.attachmentId });
        }}
        title={m.chat_chatMessage_openAttachment_title({ name: block.fileName })}
      >
        <FileIcon size={10} aria-hidden="true" />
        <span class="truncate max-w-[120px]">{block.fileName}</span>
      </Button>
    {/each}
  </div>
{/if}
