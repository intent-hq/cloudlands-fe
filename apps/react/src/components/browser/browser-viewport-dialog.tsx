import { useRef, useState } from 'react';
import { FormDialog } from '@/components/patterns/confirm';
import { Input } from '@/components/ui/input';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';

export interface BrowserViewportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  viewport: BrowserTabViewport;
  onViewportChange: (viewport: BrowserTabViewport) => void;
  returnFocus?: HTMLElement | null;
}

export function BrowserViewportDialog({
  open = false,
  onOpenChange,
  viewport,
  onViewportChange,
  returnFocus,
}: BrowserViewportDialogProps) {
  const [visibility, setVisibility] = useState({ prop: open, local: open });
  const isOpen = visibility.prop === open ? visibility.local : open;
  if (visibility.prop !== open) setVisibility({ prop: open, local: open });
  const min = 320;
  const max = 3840;
  const [dimensions, setDimensions] = useState<{ width: number | null; height: number | null }>({
    width: 1280,
    height: 800,
  });
  const { width, height } = dimensions;
  const widthRef = useRef<HTMLInputElement>(null);
  if (!isOpen) {
    const nextWidth = viewport.mode === 'fit' ? 1280 : viewport.width;
    const nextHeight = viewport.mode === 'fit' ? 800 : viewport.height;
    if (width !== nextWidth || height !== nextHeight)
      setDimensions({ width: nextWidth, height: nextHeight });
  }
  function validDimension(value: number | null) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  }
  const valid = validDimension(width) && validDimension(height);
  function changeOpen(next: boolean) {
    setVisibility({ prop: open, local: next });
    onOpenChange?.(next);
  }
  function apply() {
    if (!valid || width === null || height === null) return;
    onViewportChange({ mode: 'custom', width, height });
    changeOpen(false);
  }
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={changeOpen}
      title={m.browser_viewport_custom_label()}
      description={m.browser_viewport_sizeRange_description({
        min: formatInteger(min),
        max: formatInteger(max),
      })}
      submitLabel={m.browser_viewport_apply_label()}
      canSubmit={valid}
      onSubmit={apply}
      initialFocus={widthRef}
      onCloseAutoFocus={(event) => {
        if (!returnFocus?.isConnected) return;
        event.preventDefault();
        returnFocus.focus();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 type-caption">
          <span>{m.browser_viewport_width_label()}</span>
          <Input
            type="number"
            min={min}
            max={max}
            step="1"
            ref={widthRef}
            value={width ?? ''}
            onChange={(event) => {
              const value =
                event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber;
              setDimensions((previous) => ({ ...previous, width: value }));
            }}
            aria-invalid={!validDimension(width)}
          />
        </label>
        <label className="space-y-1 type-caption">
          <span>{m.browser_viewport_height_label()}</span>
          <Input
            type="number"
            min={min}
            max={max}
            step="1"
            value={height ?? ''}
            onChange={(event) => {
              const value =
                event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber;
              setDimensions((previous) => ({ ...previous, height: value }));
            }}
            aria-invalid={!validDimension(height)}
          />
        </label>
      </div>
    </FormDialog>
  );
}
