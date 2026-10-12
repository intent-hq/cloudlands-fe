// Source: src/lib/components/chat/QueuedMessageAttachments.svelte.
import { FileIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { QueuedMessage } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

type ImageBlock = NonNullable<QueuedMessage['imageBlocks']>[number];
type FileBlock = NonNullable<QueuedMessage['fileBlocks']>[number];

export interface QueuedMessageAttachmentsProps {
  message: Pick<QueuedMessage, 'imageBlocks' | 'fileBlocks'>;
  queuedImageSrc: (block: ImageBlock) => string | null;
  openImageLightbox: (block: ImageBlock, opener: HTMLButtonElement, index: number) => void;
  handleReferenceImageError: (block: ImageBlock, src: string) => void;
  openQueuedFileAttachment: (block: FileBlock) => void;
}

export function QueuedMessageAttachments({
  message,
  queuedImageSrc,
  openImageLightbox,
  handleReferenceImageError,
  openQueuedFileAttachment,
}: QueuedMessageAttachmentsProps) {
  return (
    <>
      {message.imageBlocks && message.imageBlocks.length > 0 && (
        <div className="inline-flex max-w-full flex-wrap items-center gap-1">
          {message.imageBlocks.map((block, index) => {
            const src = queuedImageSrc(block);
            return (
              <Button
                key={index}
                type="button"
                variant="plain"
                size="compact"
                className="inline-flex shrink-0 p-0 border-0 bg-transparent cursor-pointer align-text-bottom rounded-xs"
                data-testid="queued-image-thumbnail"
                onClick={(event) => {
                  event.stopPropagation();
                  openImageLightbox(block, event.currentTarget, index);
                }}
                aria-label={m.chat_chatMessage_viewAttachedImage_ariaLabel({
                  number: formatInteger(index + 1),
                  total: formatInteger(message.imageBlocks?.length ?? 0),
                })}
              >
                {src ? (
                  <img
                    src={src}
                    alt={m.chat_chatMessage_attachedImage_alt({
                      number: formatInteger(index + 1),
                    })}
                    className="h-[1.1em] w-[1.1em] rounded-xs border border-border object-cover hover:opacity-90 transition-opacity"
                    onError={() => handleReferenceImageError(block, src)}
                  />
                ) : (
                  <span
                    className="h-[1.1em] w-[1.1em] rounded-xs border border-border bg-muted/50 inline-block"
                    data-testid="queued-image-placeholder"
                  />
                )}
              </Button>
            );
          })}
        </div>
      )}
      {message.fileBlocks && message.fileBlocks.length > 0 && (
        <div className="inline-flex max-w-full flex-wrap items-center gap-1">
          {message.fileBlocks.map((block, index) => (
            <Button
              key={index}
              type="button"
              variant="plain"
              className="inline-flex max-w-full min-w-0 items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/50 hover:bg-muted transition-colors text-[0.7rem] text-muted-foreground hover:text-foreground cursor-pointer"
              data-testid="queued-file-chip"
              onClick={(event) => {
                event.stopPropagation();
                openQueuedFileAttachment(block);
              }}
              title={m.chat_chatMessage_openAttachment_title({ name: block.fileName })}
            >
              <FileIcon size={10} weight="regular" aria-hidden="true" />
              <span className="truncate max-w-[120px]">{block.fileName}</span>
            </Button>
          ))}
        </div>
      )}
    </>
  );
}

export default QueuedMessageAttachments;
