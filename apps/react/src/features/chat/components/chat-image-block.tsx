// Source: src/lib/components/chat/ChatImageBlock.svelte.
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { ImageActionsMenu, type ImageActionsMenuHandle } from '@/components/ui/image-actions-menu';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { MediaLoadingPlaceholder } from '@/components/ui/media-loading-placeholder';
import { MediaUnavailable, type MediaUnavailableProps } from '@/components/ui/media-unavailable';
import { cn } from '@/lib/utils';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import { faImage } from '$lib/icons/phosphor-icon-definitions';
import { supportsImageActions } from '$lib/utils/image-actions';
import { createFormatters } from '$shared/i18n/formatters';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';

const { formatInteger } = createFormatters(getLocale);

export interface ChatImageBlockProps {
  /** User attachments use the compact sent-message tile; tool reads retain their file caption. */
  variant?: 'default' | 'file' | 'user-attachment';
  /** Resolved workspace media URL for a local image read. */
  src?: string;
  /** Base64 image data — the slim thumbnail or nothing when truncated. */
  data?: string;
  mimeType: string;
  alt?: string;
  /** Positive intrinsic pixel dimensions reserve the image's final box. */
  width?: number;
  height?: number;
  /** The original data was over budget in the slim projection. */
  dataTruncated?: boolean;
  /** The data carries the write-time thumbnail. */
  dataIsThumbnail?: boolean;
  /** True while the original image is being hydrated. */
  hydrationLoading?: boolean;
  /** Fetch the original via agent.getMessageBlock; absent means no hydration. */
  onHydrate?: () => void;
  /** Read-only hosts can omit copy/download actions while retaining image viewing. */
  showActionsMenu?: boolean;
  /** The host supplies real workspace file navigation for unavailable media. */
  onOpenLink: MediaUnavailableProps['onOpenLink'];
}

export function ChatImageBlock({
  showActionsMenu = true,
  variant = 'default',
  src,
  data,
  mimeType,
  alt = m.chat_imageBlock_fromAgent_alt(),
  width,
  height,
  dataTruncated = false,
  dataIsThumbnail = false,
  hydrationLoading = false,
  onHydrate,
  onOpenLink,
}: ChatImageBlockProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageActionsOpen, setImageActionsOpen] = useState(false);
  const imageActionsMenu = useRef<ImageActionsMenuHandle>(null);
  const [openerElement, setOpenerElement] = useState<HTMLButtonElement | null>(null);
  const openerRef = useCallback((node: HTMLButtonElement | HTMLAnchorElement | null) => {
    setOpenerElement(node instanceof HTMLButtonElement ? node : null);
  }, []);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const imageUrl = src || (data ? `data:${mimeType};base64,${data}` : null);
  const imageUnavailable = imageUrl !== null && failedImageUrl === imageUrl;
  const hasOriginal = !dataTruncated && !dataIsThumbnail;
  const needsHydration = !hasOriginal && onHydrate !== undefined;
  const isPositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;
  const userAttachment = variant === 'user-attachment';
  const sized = !userAttachment && isPositiveInteger(width) && isPositiveInteger(height);
  // As in the source, URL changes retain decoded dimensions, failure identity,
  // and the revealed frame so hydration does not flash a placeholder.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [decodedDimensions, setDecodedDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const fileCard = variant === 'file';
  const showPlaceholder = sized && !hasLoaded;

  const titleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);
  const titleRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    // This span contains only alt; initialize every attachment from its committed text.
    const action = truncatedTitle(node, node.textContent ?? undefined);
    titleAction.current = action;
    return () => {
      action?.destroy?.();
      if (titleAction.current === action) titleAction.current = undefined;
    };
  }, []);
  // Update after every commit, including a newly mounted file caption with the same alt.
  useLayoutEffect(() => {
    titleAction.current?.update?.(alt);
  });

  function handleClick() {
    if (needsHydration) {
      onHydrate?.();
      return;
    }
    if (imageUrl) setLightboxOpen(true);
  }

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>) {
    if (!showActionsMenu || !hasOriginal || !imageUrl || !supportsImageActions(imageUrl)) return;
    event.preventDefault();
    event.stopPropagation();
    setImageActionsOpen(true);
  }

  function handleCopy(event: SyntheticEvent<HTMLButtonElement, KeyboardEvent | ClipboardEvent>) {
    if (
      hasOriginal &&
      !imageUnavailable &&
      imageActionsMenu.current?.handleCopy(event.nativeEvent)
    ) {
      // Carry the native menu handler's cancellation through React's event propagation too.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <>
      <div
        className={cn(
          'min-w-0',
          userAttachment ? 'mt-2' : 'my-2',
          fileCard ? 'max-w-sm' : 'max-w-2xl',
        )}
        data-chat-image=""
      >
        {imageUrl && !imageUnavailable ? (
          <div
            className={cn(
              'group relative',
              userAttachment
                ? 'size-10'
                : fileCard
                ? 'overflow-hidden rounded-lg border border-border bg-muted/30'
                : sized
                  ? 'max-w-full'
                  : 'size-40',
            )}
            style={{
              aspectRatio: sized ? `${width} / ${height}` : undefined,
              width: sized ? `min(${width}px, 100%)` : undefined,
            }}
            data-image-sized={sized || undefined}
            data-loaded={sized ? String(hasLoaded) : undefined}
          >
            <Button
              variant="plain"
              wrapContent={false}
              ref={openerRef}
              type="button"
              className={cn(
                'block',
                userAttachment
                  ? 'relative size-10 shrink-0 rounded border-0 bg-transparent'
                  : fileCard
                  ? 'h-auto w-full rounded-none border-0 bg-transparent'
                  : `${sized ? 'absolute inset-0 size-full' : 'size-40'} rounded-lg border border-border bg-muted/30 shadow-(--elevation-raised)`,
                'cursor-zoom-in overflow-hidden p-0 transition-opacity hover:opacity-90 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                showPlaceholder && 'border-dashed',
                hydrationLoading && 'animate-pulse',
              )}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onKeyDown={handleCopy}
              onCopy={handleCopy}
              aria-label={
                needsHydration
                  ? m.chat_imageBlock_loadFullImage_ariaLabel({ alt })
                  : m.chat_imageBlock_viewFullSize_ariaLabel({ alt })
              }
              title={
                needsHydration && dataIsThumbnail
                  ? m.chat_imageBlock_thumbnail_tooltip()
                  : undefined
              }
              data-image-thumbnail={dataIsThumbnail || undefined}
            >
              <img
                src={imageUrl}
                alt={alt}
                loading="lazy"
                decoding="async"
                className={cn(
                  'block',
                  userAttachment
                    ? 'size-full rounded border border-border object-cover'
                    : fileCard
                    ? 'h-auto max-h-80 w-full object-contain'
                    : `size-full ${sized ? 'object-contain' : 'object-cover'}`,
                  showPlaceholder && 'opacity-0',
                )}
                onLoad={(event) => {
                  setHasLoaded(true);
                  const image = event.currentTarget;
                  if (image instanceof HTMLImageElement) {
                    setDecodedDimensions({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }
                }}
                onError={() => setFailedImageUrl(imageUrl)}
              />
            </Button>
            {fileCard && (
              <div
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 type-caption"
                data-testid="image-file-metadata"
              >
                <span ref={titleRef} className="min-w-0 flex-1 truncate text-foreground">
                  {alt}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {decodedDimensions && (
                    <span>
                      {m.ui_imageActionsMenu_dimensions_label({
                        width: formatInteger(decodedDimensions.width),
                        height: formatInteger(decodedDimensions.height),
                      })}
                    </span>
                  )}
                  <span className="font-medium">{mimeType.split('/')[1]?.toUpperCase()}</span>
                </span>
              </div>
            )}
            {showPlaceholder && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center p-2">
                <MediaLoadingPlaceholder name={alt} />
              </span>
            )}
            {hasOriginal && showActionsMenu && (
              <ImageActionsMenu
                ref={imageActionsMenu}
                imageUrl={imageUrl}
                imageName={alt}
                open={imageActionsOpen}
                onOpenChange={setImageActionsOpen}
                triggerClass="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            )}
          </div>
        ) : imageUnavailable ? (
          <MediaUnavailable name={alt} reason="load-failed" onOpenLink={onOpenLink} />
        ) : dataTruncated ? (
          <Button
            variant="outline"
            className={cn(
              'h-auto gap-2 rounded-lg bg-muted/30 px-3 py-2 text-subtle hover:text-foreground',
              hydrationLoading && 'animate-pulse',
            )}
            onClick={handleClick}
            disabled={!onHydrate}
            aria-label={m.chat_imageBlock_loadFullImage_ariaLabel({ alt })}
            data-testid="chat-image-placeholder"
          >
            <IconDefinitionIcon icon={faImage} size={14} />
            <span className="type-caption">
              {hydrationLoading
                ? m.chat_imageBlock_loadingImage_label()
                : m.chat_imageBlock_loadImage_label()}
            </span>
          </Button>
        ) : null}
      </div>
      {imageUrl && !imageUnavailable && (
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          imageUrl={imageUrl}
          imageName={alt}
          openerElement={openerElement}
          showActionsMenu={hasOriginal && showActionsMenu}
        />
      )}
    </>
  );
}

export default ChatImageBlock;
