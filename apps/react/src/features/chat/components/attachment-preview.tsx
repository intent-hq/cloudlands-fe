// Source: src/lib/components/chat/AttachmentPreview.svelte.
import { useEffect, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { crispOut, springIn, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { formatNumber } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

export interface AttachmentPreviewProps {
  id: string;
  name: string;
  type?: string;
  size?: number;
  file?: File;
  imageData?: string;
  imageMimeType?: string;
  onRemove?: (id: string) => void;
  /** Overrides the source `class` alias, including when explicitly empty. */
  className?: string;
  class?: string;
  variant?: 'chip' | 'thumbnail';
  placementStatus?: 'placing' | 'failed' | 'placed';
  placementProgress?: number;
  placementError?: string;
  onRetry?: (id: string) => void;
  /** A presence-owning list retains this component until its source outro finishes. */
  present?: boolean;
  onExit?: () => void;
}

const transition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in'
      ? springIn(node, { tier: 'moderate', y: 0, scale: 0.9 })
      : crispOut(node, { tier: 'fast' });
const noop = () => {};

export function AttachmentPreview({
  id,
  name,
  type = '',
  file,
  imageData,
  imageMimeType,
  onRemove,
  className,
  class: sourceClass = '',
  variant = 'chip',
  placementStatus,
  placementProgress,
  placementError,
  onRetry,
  present = true,
  onExit = noop,
}: AttachmentPreviewProps) {
  const root = useRef<HTMLDivElement>(null);
  const [thumbnailButton, setThumbnailButton] = useState<
    HTMLButtonElement | HTMLAnchorElement | null
  >(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState<{ file: File; url: string } | null>(null);
  const inlineUrl = imageData && imageMimeType ? `data:${imageMimeType};base64,${imageData}` : null;
  const usesFile = !inlineUrl && Boolean(file) && type.startsWith('image/');
  useEffect(() => {
    if (!usesFile || !file) return;
    const url = URL.createObjectURL(file);
    // oxlint-disable-next-line react/set-state-in-effect -- Native object URLs are acquired after mount and released by this effect.
    setObjectUrl({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, usesFile]);
  const thumbnailUrl = inlineUrl ?? (usesFile && objectUrl?.file === file ? objectUrl?.url : null);
  usePresenceTransition(root, present, onExit, transition);

  const mimeType = type || imageMimeType || '';
  const Icon =
    type === 'folder'
      ? FolderIcon
      : mimeType.startsWith('image')
        ? ImageIcon
        : ['javascript', 'typescript', 'json'].some((part) => mimeType.includes(part))
          ? FileCodeIcon
          : mimeType.includes('text') || mimeType.includes('markdown')
            ? FileTextIcon
            : FileIcon;
  const isImage = type.startsWith('image/') || Boolean(imageMimeType?.startsWith('image'));
  const failedTitle = m.chat_attachmentPreview_placementFailed_tooltip({ name });
  const chipTitle =
    placementStatus === 'failed'
      ? placementError
        ? `${failedTitle} — ${placementError}`
        : failedTitle
      : undefined;
  const progressLabel =
    placementStatus === 'placing' && placementProgress !== undefined
      ? formatNumber(Math.max(0, Math.min(1, placementProgress)), {
          style: 'percent',
          maximumFractionDigits: 0,
        })
      : undefined;

  if (variant === 'thumbnail' && isImage && thumbnailUrl) {
    return (
      <>
        <div
          ref={root}
          inert={!present}
          aria-hidden={!present || undefined}
          className={`relative group shrink-0 ${className ?? sourceClass}`}
        >
          <Button
            ref={setThumbnailButton}
            variant="plain"
            type="button"
            className="w-16 h-16 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setLightboxOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setLightboxOpen(true);
              }
            }}
            aria-label={m.chat_attachmentPreview_viewFullSize_ariaLabel({ name })}
            title={name}
          >
            <img src={thumbnailUrl} alt={name} className="w-full h-full object-cover" />
          </Button>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none bg-background/80 hover:bg-background shadow-sm"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(id);
              }}
              aria-label={m.chat_attachmentPreview_remove_ariaLabel({ name })}
            >
              <XIcon size={10} />
            </Button>
          )}
        </div>
        <ImageLightbox
          open={present && lightboxOpen}
          onOpenChange={setLightboxOpen}
          imageUrl={thumbnailUrl}
          imageName={name}
          openerElement={thumbnailButton}
        />
      </>
    );
  }

  return (
    <>
      <div
        ref={root}
        inert={!present}
        aria-hidden={!present || undefined}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs whitespace-nowrap group shrink-0 ${
          placementStatus === 'failed'
            ? 'bg-danger-background/10 text-danger border border-danger/40'
            : 'bg-muted/70 text-subtle'
        } ${className ?? sourceClass}`}
        data-placement-status={placementStatus}
        title={chipTitle}
      >
        {placementStatus === 'placing' ? (
          <>
            <IntentMarkLoader size={15} className="opacity-50 shrink-0" />
            {progressLabel !== undefined && (
              <span
                className="tabular-nums opacity-70 shrink-0"
                data-testid="attachment-upload-progress"
              >
                {progressLabel}
              </span>
            )}
          </>
        ) : placementStatus === 'failed' ? (
          <WarningCircleIcon size={15} className="shrink-0" />
        ) : isImage && thumbnailUrl ? (
          <div className="w-4 h-4 rounded overflow-hidden shrink-0">
            <img src={thumbnailUrl} alt={name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <Icon size={15} className="opacity-30 shrink-0" />
        )}
        <span className="font-medium truncate max-w-30">{name}</span>
        {placementStatus === 'failed' && onRetry && (
          <Button
            variant="ghost-light"
            size="icon-xs"
            className="shrink-0 -my-1"
            onClick={(event) => {
              event.stopPropagation();
              onRetry(id);
            }}
            aria-label={m.chat_attachmentPreview_retryPlacement_ariaLabel({ name })}
            data-testid="attachment-retry"
          >
            <ArrowClockwiseIcon size={10} />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost-light"
            size="icon-xs"
            className={cn(
              'shrink-0 transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none -my-1 -mr-1',
              placementStatus !== 'failed' &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            onClick={() => onRemove(id)}
            aria-label={m.chat_attachmentPreview_removeAttachment_ariaLabel()}
          >
            <XIcon size={10} />
          </Button>
        )}
      </div>
    </>
  );
}

export default AttachmentPreview;
