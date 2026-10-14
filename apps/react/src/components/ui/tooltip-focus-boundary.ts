import { useCallback, useEffectEvent, useLayoutEffect, useRef, type FocusEvent } from 'react';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';

/** A tooltip's trigger and portaled content share one focus boundary. */
export function useTooltipFocusBoundary(open: boolean, onOpenChange: (open: boolean) => void) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeOnEscape = useEffectEvent(() => onOpenChange(false));
  useLayoutEffect(() => {
    if (!open) return;
    return pushEscapeLayer(() => closeOnEscape());
  }, [open]);
  const onContentBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      if (
        !open ||
        event.currentTarget.contains(event.relatedTarget) ||
        triggerRef.current?.contains(event.relatedTarget)
      ) {
        return;
      }
      onOpenChange(false);
    },
    [open, onOpenChange],
  );

  return { triggerRef, contentRef, onContentBlur };
}
