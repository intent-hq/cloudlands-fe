import { useEffect, useRef, useState, type RefObject } from 'react';

export type DialogFocusTarget = HTMLElement | RefObject<HTMLElement | null> | null;

export function focusDialogTarget(event: Event, target?: DialogFocusTarget) {
  const element = target && ('current' in target ? target.current : target);
  if (!element) return;
  element.focus();
  // Disabled or hidden targets leave focus selection to the shared dialog primitive.
  if (element.ownerDocument.activeElement === element) event.preventDefault();
}

export function useDialogLifecycle(
  open: boolean,
  onOpenChange?: (open: boolean) => void,
  onClose?: () => void,
) {
  const [closed, setClosed] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(open);
  const handled = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setClosed(false);
  }
  useEffect(() => {
    if (open) handled.current = false;
  }, [open]);

  function close() {
    if (handled.current) return;
    handled.current = true;
    setClosed(true);
    onOpenChange?.(false);
    onClose?.();
  }

  function captureFocus() {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function restoreFocus(event: Event) {
    if (event.defaultPrevented || !returnFocus.current?.isConnected) return;
    event.preventDefault();
    returnFocus.current.focus({ preventScroll: true });
  }

  return { open: open && !closed, close, captureFocus, restoreFocus };
}
