// Source: src/lib/components/ui/ImageLightbox.svelte.
import { useRef, useState, type MouseEvent } from 'react';
import { MediaLightbox } from '@/components/ui/media-lightbox';
import { ImageActionsMenu, type ImageActionsMenuHandle } from '@/components/ui/image-actions-menu';
import { ZoomPanViewport, type ZoomPanViewportHandle } from '@/components/ui/zoom-pan-viewport';
import { m } from '$shared/paraglide/messages.js';
import { supportsImageActions } from '$lib/utils/image-actions';

export interface ImageLightboxProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  imageUrl: string;
  imageName?: string;
  onClose?: () => void;
  openerElement?: HTMLElement | null;
  showActionsMenu?: boolean;
}

export function ImageLightbox({
  open: openProp = false,
  onOpenChange,
  imageUrl,
  imageName = m.ui_imageLightbox_image_alt(),
  onClose,
  openerElement = null,
  showActionsMenu = false,
}: ImageLightboxProps) {
  const [visibility, setVisibility] = useState({ prop: openProp, open: openProp });
  if (visibility.prop !== openProp) setVisibility({ prop: openProp, open: openProp });
  const open = visibility.prop !== openProp ? openProp : visibility.open;
  const viewport = useRef<ZoomPanViewportHandle>(null);
  const actions = useRef<ImageActionsMenuHandle>(null);
  const [actionsState, setActionsState] = useState({ lightboxOpen: open, menuOpen: false });
  if (actionsState.lightboxOpen !== open) {
    setActionsState({ lightboxOpen: open, menuOpen: open && actionsState.menuOpen });
  }
  const actionsOpen = open && actionsState.menuOpen;
  function setActionsOpen(menuOpen: boolean) {
    setActionsState({ lightboxOpen: open, menuOpen });
  }

  function handleCopy(event: KeyboardEvent | ClipboardEvent) {
    if (open && showActionsMenu) actions.current?.handleCopy(event);
  }
  function handleKeydown(event: KeyboardEvent) {
    handleCopy(event);
    if (!event.defaultPrevented) viewport.current?.handleKeydown(event);
  }
  function handleContextMenu(event: MouseEvent<HTMLImageElement>) {
    if (!showActionsMenu || !supportsImageActions(imageUrl)) return;
    event.preventDefault();
    event.stopPropagation();
    setActionsOpen(true);
  }

  return (
    <MediaLightbox
      open={open}
      onOpenChange={(value) => {
        setVisibility({ prop: openProp, open: value });
        if (!value) setActionsOpen(false);
        onOpenChange?.(value);
      }}
      ariaLabel={m.ui_imageLightbox_preview_ariaLabel()}
      closeLabel={m.ui_imageLightbox_close_ariaLabel()}
      onClose={onClose}
      openerElement={openerElement}
      onKeydown={handleKeydown}
      onCopy={handleCopy}
      actions={
        showActionsMenu && (
          <ImageActionsMenu
            ref={actions}
            imageUrl={imageUrl}
            imageName={imageName}
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            triggerClass="h-9 w-9 bg-white/0 hover:bg-white/20"
            contentClass="z-[1003]"
          />
        )
      }
    >
      <ZoomPanViewport key={imageUrl} ref={viewport}>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Context menu supplements the keyboard-accessible actions trigger, as in the source. */}
        <img
          src={imageUrl}
          alt={imageName}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          draggable={false}
          data-media-lightbox-content=""
          onContextMenu={handleContextMenu}
        />
      </ZoomPanViewport>
    </MediaLightbox>
  );
}

export default ImageLightbox;
