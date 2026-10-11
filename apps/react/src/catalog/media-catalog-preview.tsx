// Source media branches of diagnostics-audit.preview.svelte and ShimmerOverlayHost.svelte.
// i18n-ignore (reference catalog fixture and internal interaction content)
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MediaLightbox } from '@/components/ui/media-lightbox';
import { ZoomPanViewport, type ZoomPanViewportHandle } from '@/components/ui/zoom-pan-viewport';
import { ShimmerOverlay } from '@/components/ui/shimmer-overlay';

const sampleImage =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/><rect x="80" y="70" width="640" height="360" rx="24" fill="#555"/></svg>',
  );
export function MediaCatalogPreview({ long = false }: { long?: boolean }) {
  return (
    <MediaLightbox
      open
      ariaLabel="Audit media preview"
      closeLabel="Close preview"
      caption={
        long
          ? 'A long attachment caption that should remain readable without covering the image or hiding the close action on a narrow screen.'
          : 'Workspace screenshot'
      }
    >
      <img
        src={sampleImage}
        alt="Neutral geometry fixture"
        className="max-h-full max-w-full object-contain"
      />
    </MediaLightbox>
  );
}
// Source MediaLightbox.test-harness.svelte interaction, using the shared trigger control.
// Open audit appearance states stay on diagnostics-audit so a page never stacks both dialogs.
export function MediaHostExample() {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={setTrigger} onClick={() => setOpen(true)}>
        Open media
      </Button>
      <MediaLightbox
        open={open}
        onOpenChange={setOpen}
        ariaLabel="Media preview"
        closeLabel="Close media"
        openerElement={trigger}
      >
        <div data-media-lightbox-content>Media content</div>
      </MediaLightbox>
    </>
  );
}
export function ShimmerCatalogPreview() {
  return (
    <div>
      <div data-testid="shimmer-text">
        <ShimmerOverlay>Processing</ShimmerOverlay>
      </div>
      <div data-testid="shimmer-overlay" style={{ position: 'relative', width: 100, height: 20 }}>
        <ShimmerOverlay />
      </div>
    </div>
  );
}
// Additional zoom caller: real image, native lightbox key forwarding, and real pointer/wheel events.
export function ZoomMediaExample() {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const zoom = useRef<ZoomPanViewportHandle>(null);
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [copies, setCopies] = useState(0);
  return (
    <section className="grid gap-4" data-functional-example="zoom-media">
      <p>Additional interaction example; no reference zoom catalog scene.</p>
      <Button ref={setOpener} onClick={() => setOpen(true)}>
        Open zoom media
      </Button>
      <MediaLightbox
        open={open}
        onOpenChange={setOpen}
        ariaLabel="Zoom media preview"
        closeLabel="Close zoom media"
        openerElement={opener}
        onKeydown={(event) => {
          zoom.current?.handleKeydown(event);
        }}
        onCopy={() => setCopies((n) => n + 1)}
        caption="Workspace screenshot"
      >
        <ZoomPanViewport ref={zoom} onScaleChange={setScale}>
          <img src={sampleImage} alt="Neutral geometry fixture" />
        </ZoomPanViewport>
      </MediaLightbox>
      <output aria-label="Media zoom scale">{scale}</output>
      <output aria-label="Media copy events">{copies}</output>
    </section>
  );
}
