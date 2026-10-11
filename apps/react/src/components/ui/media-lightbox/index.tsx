// Source: src/lib/components/ui/MediaLightbox.svelte.
/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/prefer-tag-over-role -- Preserve the source custom portaled dialog and backdrop; native key listeners below own focus trapping and Escape belongs to the shared layer stack. */
import {
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Portal } from '@/components/ui/portal';
import { fade, usePresence, usePresenceTransition } from '@/lib/motion';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';

export interface MediaLightboxProps {
  open?: boolean;
  /** React counterpart of bind:open; dismissal also closes the local view. */
  onOpenChange?: (open: boolean) => void;
  ariaLabel: string;
  closeLabel: string;
  onClose?: () => void;
  openerElement?: HTMLElement | null;
  children: ReactNode;
  actions?: ReactNode;
  caption?: string;
  onKeydown?: (event: KeyboardEvent) => void;
  onCopy?: (event: ClipboardEvent) => void;
}

const transition = (node: HTMLElement) => fade(node, { tier: 'moderate' }, { direction: 'both' });

export function MediaLightbox({
  open = false,
  onOpenChange,
  onClose,
  ...props
}: MediaLightboxProps) {
  // Svelte's bindable prop is locally writable even without a parent binding.
  const [visibility, setVisibility] = useState({ prop: open, open });
  if (visibility.prop !== open) setVisibility({ prop: open, open });
  const visible = visibility.prop !== open ? open : visibility.open;
  const items = useMemo(() => (visible ? ['lightbox'] : []), [visible]);
  const presence = usePresence(items, (key) => key);

  function close() {
    setVisibility({ prop: open, open: false });
    onOpenChange?.(false);
    onClose?.();
    if (props.openerElement?.isConnected) props.openerElement.focus({ preventScroll: true });
  }

  return presence.entries.map(({ key, present }) => (
    <Portal key={key} target="body" zIndex={1000}>
      <LightboxSurface
        {...props}
        present={present}
        close={close}
        onExit={() => presence.remove(key)}
      />
    </Portal>
  ));
}

function LightboxSurface({
  ariaLabel,
  closeLabel,
  children,
  actions,
  caption,
  onKeydown,
  onCopy,
  present,
  close,
  onExit,
}: Omit<MediaLightboxProps, 'open' | 'onOpenChange' | 'onClose'> & {
  present: boolean;
  close: () => void;
  onExit: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const closeCurrent = useEffectEvent(close);
  const handleKeydown = useEffectEvent((event: KeyboardEvent) => {
    onKeydown?.(event);
    if (event.defaultPrevented || event.key !== 'Tab' || !dialog.current) return;

    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  const handleCopy = useEffectEvent((event: ClipboardEvent) => onCopy?.(event));

  usePresenceTransition(dialog, present, onExit, transition);
  useLayoutEffect(() => {
    if (!present) return;
    return pushEscapeLayer(() => closeCurrent());
  }, [present]);
  useLayoutEffect(() => {
    if (!present) return;
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [present]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Keep the native event, currentTarget and child-to-parent listener order.
    element.addEventListener('keydown', handleKeydown);
    element.addEventListener('copy', handleCopy);
    return () => {
      element.removeEventListener('keydown', handleKeydown);
      element.removeEventListener('copy', handleCopy);
    };
  }, []);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    // React portals bubble through the component tree; only DOM descendants are backdrop clicks.
    if (!target || !event.currentTarget.contains(target)) return;
    if (target.closest('[data-media-lightbox-content], [role="toolbar"], button, input')) return;
    close();
  }

  return (
    <div
      ref={dialog}
      data-media-lightbox-root=""
      data-image-lightbox-root=""
      className="fixed inset-0 z-[1000] flex cursor-zoom-out flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      style={{ pointerEvents: 'auto' }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      <div className="absolute right-4 top-4 z-[1002] flex items-center gap-1">
        {actions}
        <Button
          ref={closeButton}
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={close}
          aria-label={closeLabel}
        >
          <XIcon size="1.333em" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">{children}</div>
      {caption && (
        <p className="mt-2 max-w-[90vw] rounded-md bg-black/60 px-3 py-1.5 text-center text-sm text-white">
          {caption}
        </p>
      )}
    </div>
  );
}

export default MediaLightbox;
