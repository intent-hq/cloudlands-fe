// Source: src/lib/components/chat/ChatVideoBlock.svelte.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MediaUnavailable, type MediaUnavailableProps } from '@/components/ui/media-unavailable';
import { VideoActionsMenu } from '@/components/ui/video-actions-menu';
import { VideoLightbox } from '@/components/ui/video-lightbox';
import { parseWorkspaceFileImageUrl } from '$lib/utils/image-actions';
import { canLoadMediaUrl } from '$lib/utils/media-provenance';
import { m } from '$shared/paraglide/messages.js';
import type { VideoSource } from '$shared/types/video-source';

export interface ChatVideoBlockProps {
  source: VideoSource;
  name?: string;
  poster?: string;
  /** Read-only hosts omit copy/download actions. */
  showActionsMenu?: boolean;
  allowFileMedia?: boolean;
  canLoadMedia?: (url: string) => boolean;
  canOpenFile?: () => boolean;
  /** The host supplies real workspace file navigation for unavailable media. */
  onOpenLink: MediaUnavailableProps['onOpenLink'];
}

export function ChatVideoBlock({
  source,
  name = m.chat_videoBlock_fromAgent_label(),
  poster,
  showActionsMenu = true,
  allowFileMedia = true,
  canLoadMedia,
  canOpenFile,
  onOpenLink,
}: ChatVideoBlockProps) {
  // The source retains these states across source changes, including a failed frame.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [frameUnavailable, setFrameUnavailable] = useState(false);
  const [triggerRef, setTriggerRef] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);

  const videoUrl =
    source.kind === 'inline' ? `data:${source.mimeType};base64,${source.data}` : source.url;
  function canUseMedia(url: string) {
    return (
      canLoadMediaUrl(url, allowFileMedia && canOpenFile?.() !== false) &&
      canLoadMedia?.(url) !== false
    );
  }
  const blocked = !canUseMedia(videoUrl);
  const workspaceFile = parseWorkspaceFileImageUrl(videoUrl);
  const safePoster = (() => {
    if (!poster || !canUseMedia(poster)) return undefined;
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
  })();

  function markFrameReady(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    // Audio-only decoding must not advertise an available video frame.
    const ready = video.videoWidth > 0 && video.videoHeight > 0;
    setFrameReady(ready);
    setFrameUnavailable(!ready);
  }

  return (
    <>
      <div className="my-2 min-w-0 max-w-2xl" data-chat-video="">
        {blocked ? (
          <MediaUnavailable
            name={name}
            reason={canLoadMedia?.(videoUrl) === false ? 'unsupported' : 'load-failed'}
            onOpenLink={onOpenLink}
          />
        ) : frameUnavailable ? (
          <div className="flex items-center gap-2">
            <MediaUnavailable
              name={name}
              reason="load-failed"
              path={workspaceFile?.path}
              workspaceId={workspaceFile?.workspaceId}
              onOpenLink={onOpenLink}
            />
            {showActionsMenu && (
              <VideoActionsMenu
                videoUrl={videoUrl}
                videoName={name}
                sourceKind={source.kind}
                mimeType={source.mimeType}
              />
            )}
          </div>
        ) : (
          <div
            className="group relative aspect-video w-full max-h-40 max-w-2xl"
            style={{ width: 'min(100%, calc(10rem * 16 / 9))' }}
          >
            <Button
              ref={setTriggerRef}
              type="button"
              variant="ghost"
              size="default"
              wrapContent={false}
              className="relative block size-full cursor-pointer overflow-hidden rounded-lg border border-border bg-muted/40 p-0 shadow-(--elevation-raised) focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 forced-colors:border"
              aria-label={m.chat_videoBlock_play_ariaLabel({ name })}
              data-testid="chat-video-snapshot"
              onClick={() => {
                if (canUseMedia(videoUrl)) setLightboxOpen(true);
              }}
            >
              <div
                className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="size-10" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" />
                  <path d="m10 9 5 3-5 3V9Z" fill="currentColor" />
                </svg>
              </div>
              <video
                src={videoUrl}
                poster={safePoster}
                preload="metadata"
                muted
                playsInline
                tabIndex={-1}
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 size-full object-contain transition-opacity motion-reduce:transition-none ${
                  safePoster || (frameReady && !frameUnavailable) ? 'opacity-100' : 'opacity-0'
                }`}
                onLoadedData={markFrameReady}
                onError={() => setFrameUnavailable(true)}
              />
              <span
                className="absolute inset-0 flex items-center justify-center bg-media-scrim/10 transition-colors group-hover:bg-media-scrim/20 motion-reduce:transition-none forced-colors:bg-transparent"
                aria-hidden="true"
              >
                <span className="flex size-11 items-center justify-center rounded-full border border-media-foreground/70 bg-media-scrim/60 text-media-foreground shadow-(--elevation-raised) forced-colors:border forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]">
                  <svg viewBox="0 0 20 20" className="ml-0.5 size-5" fill="currentColor">
                    <path d="m7 5 7 5-7 5V5Z" />
                  </svg>
                </span>
              </span>
            </Button>
            {showActionsMenu && (
              <VideoActionsMenu
                videoUrl={videoUrl}
                videoName={name}
                sourceKind={source.kind}
                mimeType={source.mimeType}
                triggerClass="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              />
            )}
          </div>
        )}
      </div>
      {!frameUnavailable && !blocked && (
        <VideoLightbox
          showActionsMenu={showActionsMenu}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          videoUrl={videoUrl}
          videoName={name}
          poster={safePoster}
          sourceKind={source.kind}
          mimeType={source.mimeType}
          openerElement={triggerRef}
        />
      )}
    </>
  );
}
