<script lang="ts">
  import FileIcon from 'phosphor-svelte/lib/File';
  import { Button } from '$lib/components/ui/button';
  import type { QueuedMessage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  type ImageBlock = NonNullable<QueuedMessage['imageBlocks']>[number];
  type FileBlock = NonNullable<QueuedMessage['fileBlocks']>[number];
  let {
    message,
    queuedImageSrc,
    openImageLightbox,
    handleReferenceImageError,
    openQueuedFileAttachment,
  }: {
    message: QueuedMessage;
    queuedImageSrc: (block: ImageBlock) => string | null;
    openImageLightbox: (block: ImageBlock, opener: HTMLButtonElement, index: number) => void;
    handleReferenceImageError: (block: ImageBlock, src: string) => void;
    openQueuedFileAttachment: (block: FileBlock) => void;
  } = $props();
</script>

{#if message.imageBlocks && message.imageBlocks.length > 0}
  <div class="inline-flex max-w-full flex-wrap items-center gap-1">
    {#each message.imageBlocks as block, i (i)}
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
          total: formatInteger(message.imageBlocks?.length ?? 0),
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

{#if message.fileBlocks && message.fileBlocks.length > 0}
  <div class="inline-flex max-w-full flex-wrap items-center gap-1">
    {#each message.fileBlocks as block, i (i)}
      <Button
        type="button"
        variant="plain"
        class="inline-flex max-w-full min-w-0 items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/50 hover:bg-muted transition-colors text-[0.7rem] text-muted-foreground hover:text-foreground cursor-pointer"
        data-testid="queued-file-chip"
        onclick={(e) => {
          e.stopPropagation();
          openQueuedFileAttachment(block);
        }}
        title={m.chat_chatMessage_openAttachment_title({ name: block.fileName })}
      >
        <FileIcon size={10} aria-hidden="true" />
        <span class="truncate max-w-[120px]">{block.fileName}</span>
      </Button>
    {/each}
  </div>
{/if}
