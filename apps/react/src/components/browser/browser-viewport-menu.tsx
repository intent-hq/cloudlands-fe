import { useState } from 'react';
import { faChevronDown } from '$lib/icons/phosphor-icon-definitions';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import { BROWSER_VIEWPORT_PRESETS } from '$lib/components/browser/browser-viewport-presets';
import { BrowserViewportItems } from './browser-viewport-items';
import { BrowserViewportDialog } from './browser-viewport-dialog';

export interface BrowserViewportMenuProps {
  viewport: BrowserTabViewport;
  onViewportChange: (viewport: BrowserTabViewport) => void;
}

export function BrowserViewportMenu({ viewport, onViewportChange }: BrowserViewportMenuProps) {
  const [open, setOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const [triggerRef, setTriggerRef] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const selectedPreset =
    viewport.mode === 'preset'
      ? BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
      : undefined;
  const dimensionsLabel =
    viewport.mode === 'fit'
      ? ''
      : m.browser_viewport_dimensions_label({
          width: formatInteger(viewport.width),
          height: formatInteger(viewport.height),
        });
  const triggerLabel =
    viewport.mode === 'fit'
      ? m.browser_viewport_fit_short_label()
      : viewport.mode === 'preset' && selectedPreset
        ? selectedPreset.name
        : dimensionsLabel;
  const triggerAriaLabel =
    viewport.mode === 'fit' ? m.browser_viewport_fitPanel_label() : triggerLabel;

  function showCustomEditor() {
    setOpen(false);
    setEditingCustom(true);
  }

  return (
    <>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger asChild>
          <Button
            ref={setTriggerRef}
            variant="ghost-light"
            size="xs"
            className="h-6 max-w-36 gap-1 rounded-full bg-muted px-2 text-xs hover:bg-muted/80"
            aria-label={m.browser_viewport_trigger_ariaLabel({ mode: triggerAriaLabel })}
            data-testid="browser-viewport-trigger"
          >
            <span className="truncate">{triggerLabel}</span>
            <IconDefinitionIcon icon={faChevronDown} size="0.75em" className="shrink-0" />
          </Button>
        </Menu.Trigger>
        <Menu.Content
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => {
            if (editingCustom) event.preventDefault();
          }}
        >
          <BrowserViewportItems
            viewport={viewport}
            onViewportChange={onViewportChange}
            onCustom={showCustomEditor}
          />
        </Menu.Content>
      </Menu.Root>
      <BrowserViewportDialog
        open={editingCustom}
        onOpenChange={setEditingCustom}
        viewport={viewport}
        onViewportChange={onViewportChange}
        returnFocus={triggerRef}
      />
    </>
  );
}
