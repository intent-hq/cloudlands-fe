// Source: src/lib/components/ui/VideoLightbox.svelte.
import { useState } from 'react';
import { MediaLightbox } from '@/components/ui/media-lightbox';
import { VideoActionsMenu } from '@/components/ui/video-actions-menu';
import type { VideoSource } from '$shared/types/video-source';
import { m } from '$shared/paraglide/messages.js';
import { sizeVideoFromMetadata } from '$lib/actions/size-video-from-metadata';

export interface VideoLightboxProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  videoUrl: string;
  videoName?: string;
  poster?: string;
  sourceKind?: VideoSource['kind'];
  mimeType?: string;
  openerElement?: HTMLElement | null;
  onClose?: () => void;
}

export function VideoLightbox({
  open: openProp = false,
  onOpenChange,
  videoUrl,
  videoName = m.chat_videoBlock_fromAgent_label(),
  poster,
  sourceKind,
  mimeType,
  openerElement = null,
  onClose,
}: VideoLightboxProps) {
  const [visibility, setVisibility] = useState({ prop: openProp, open: openProp });
  if (visibility.prop !== openProp) setVisibility({ prop: openProp, open: openProp });
  const open = visibility.prop !== openProp ? openProp : visibility.open;
  const [playback, setPlayback] = useState({ open, videoUrl, unavailable: false });
  if (playback.open !== open || playback.videoUrl !== videoUrl) {
    setPlayback({ open, videoUrl, unavailable: open && videoUrl ? false : playback.unavailable });
  }

  return (
    <MediaLightbox
      open={open}
      onOpenChange={(value) => {
        setVisibility({ prop: openProp, open: value });
        onOpenChange?.(value);
      }}
      ariaLabel={m.chat_videoBlock_dialog_title({ name: videoName })}
      closeLabel={m.chat_videoBlock_close_ariaLabel()}
      openerElement={openerElement}
      onClose={onClose}
      actions={
        <VideoActionsMenu
          videoUrl={videoUrl}
          videoName={videoName}
          sourceKind={sourceKind}
          mimeType={mimeType}
          triggerClass="h-9 w-9 bg-white/0 hover:bg-white/20"
          contentClass="z-[1003]"
        />
      }
    >
      <div
        data-media-lightbox-content=""
        data-video-lightbox-root=""
        className="flex max-h-[90vh] max-w-[90vw] cursor-default flex-col items-center gap-3"
      >
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Agent output has no captions field, matching the source. */}
        <video
          ref={sizeVideoFromMetadata}
          src={videoUrl}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          className="max-h-[85vh] max-w-[90vw] rounded-lg bg-black object-contain shadow-(--elevation-overlay)"
          aria-label={videoName}
          onError={() => setPlayback({ open, videoUrl, unavailable: true })}
          data-testid="chat-video-player"
        >
          {m.chat_videoBlock_unsupported_description()}
        </video>
        {playback.unavailable && (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source block status paragraph; this is not a form output.
          <p className="type-body text-white/80" role="status">
            {m.chat_videoBlock_unavailable_description()}
          </p>
        )}
      </div>
    </MediaLightbox>
  );
}

export default VideoLightbox;
