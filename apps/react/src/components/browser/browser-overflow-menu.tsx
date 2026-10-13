import { useState } from 'react';
import {
  faArrowLeft,
  faArrowRight,
  faArrowUpRightFromSquare,
  faCamera,
  faCode,
  faCopy,
  faCrosshairs,
  faDesktop,
  faRotate,
  faTerminal,
} from '$lib/icons/phosphor-icon-definitions';
import { KebabIcon } from '@/components/icons/kebab-icon';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import { BROWSER_VIEWPORT_PRESETS } from '$lib/components/browser/browser-viewport-presets';
import { BrowserViewportItems } from './browser-viewport-items';
import { BrowserViewportDialog } from './browser-viewport-dialog';

export interface BrowserOverflowMenuProps {
  errorCount?: number;
  disabled?: boolean;
  collapsed?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  canSelectElement?: boolean;
  selectingElement?: boolean;
  viewport?: BrowserTabViewport;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onToggleElementPicker?: () => void | Promise<void>;
  onViewportChange?: (viewport: BrowserTabViewport) => void;
  onOpenExternal: () => void | Promise<void>;
  onCopyUrl: () => void | Promise<void>;
  onScreenshot: () => void | Promise<void>;
  onOpenConsole: () => void | Promise<void>;
  onOpenSource: () => void | Promise<void>;
  onOpenInspector: () => void | Promise<void>;
  onReloadWithoutCache: () => void | Promise<void>;
}

export function BrowserOverflowMenu({
  errorCount = 0,
  disabled = false,
  collapsed = false,
  canGoBack = false,
  canGoForward = false,
  canSelectElement = false,
  selectingElement = false,
  viewport = { mode: 'fit' },
  onGoBack,
  onGoForward,
  onToggleElementPicker,
  onViewportChange,
  onOpenExternal,
  onCopyUrl,
  onScreenshot,
  onOpenConsole,
  onOpenSource,
  onOpenInspector,
  onReloadWithoutCache,
}: BrowserOverflowMenuProps) {
  const triggerLabel =
    errorCount > 0
      ? m.browser_overflow_triggerWithErrors_ariaLabel({ count: formatInteger(errorCount) })
      : m.browser_overflow_trigger_ariaLabel();
  const selectedPreset =
    viewport.mode === 'preset'
      ? BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
      : undefined;
  const viewportLabel =
    viewport.mode === 'fit'
      ? m.browser_viewport_fitPanel_label()
      : (selectedPreset?.name ??
        m.browser_viewport_dimensions_label({
          width: formatInteger(viewport.width),
          height: formatInteger(viewport.height),
        }));
  const [editingCustom, setEditingCustom] = useState(false);
  const [triggerRef, setTriggerRef] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const [open, setOpen] = useState(false);
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
            size="icon-xs"
            className="relative"
            disabled={disabled}
            tooltip={m.browser_overflow_trigger_tooltip()}
            tooltipSide="bottom"
            aria-label={triggerLabel}
            data-testid="browser-overflow-trigger"
          >
            <KebabIcon className="size-3.5" />
            {errorCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1.5 -top-1.5 h-4 min-w-4 px-1 text-xs leading-none"
                data-testid="browser-console-error-badge"
              >
                {errorCount > 9 ? '9+' : formatInteger(errorCount)}
              </Badge>
            )}
          </Button>
        </Menu.Trigger>
        <Menu.Content
          align="end"
          className="w-56"
          onCloseAutoFocus={(event) => {
            if (editingCustom) event.preventDefault();
          }}
        >
          {collapsed && (
            <>
              <Menu.Item disabled={!canGoBack} onSelect={onGoBack}>
                <IconDefinitionIcon
                  icon={faArrowLeft}
                  size="0.75em"
                  className="w-4 text-muted-foreground"
                />
                {m.browser_embedded_goBack_ariaLabel()}
              </Menu.Item>
              <Menu.Item disabled={!canGoForward} onSelect={onGoForward}>
                <IconDefinitionIcon
                  icon={faArrowRight}
                  size="0.75em"
                  className="w-4 text-muted-foreground"
                />
                {m.browser_embedded_goForward_ariaLabel()}
              </Menu.Item>
              <Menu.Item
                disabled={!canSelectElement}
                onSelect={() => void onToggleElementPicker?.()}
              >
                <IconDefinitionIcon
                  icon={faCrosshairs}
                  size="0.75em"
                  className="w-4 text-muted-foreground"
                />
                {selectingElement
                  ? m.browser_embedded_cancelElementSelection_ariaLabel()
                  : m.browser_embedded_selectElement_ariaLabel()}
              </Menu.Item>
              <Menu.Sub>
                <Menu.SubTrigger disabled={!onViewportChange}>
                  <IconDefinitionIcon
                    icon={faDesktop}
                    size="0.75em"
                    className="w-4 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {m.browser_viewport_trigger_ariaLabel({ mode: viewportLabel })}
                  </span>
                </Menu.SubTrigger>
                <Menu.SubContent className="w-64">
                  <BrowserViewportItems
                    viewport={viewport}
                    onViewportChange={(value) => onViewportChange?.(value)}
                    onCustom={showCustomEditor}
                  />
                </Menu.SubContent>
              </Menu.Sub>
              <Menu.Separator />
            </>
          )}
          <Menu.Item onSelect={() => void onOpenExternal()}>
            <IconDefinitionIcon
              icon={faArrowUpRightFromSquare}
              size="0.75em"
              className="w-4 text-muted-foreground"
            />
            {m.browser_overflow_openExternal_label()}
          </Menu.Item>
          <Menu.Item onSelect={() => void onCopyUrl()}>
            <IconDefinitionIcon icon={faCopy} size="0.75em" className="w-4 text-muted-foreground" />
            {m.browser_overflow_copyUrl_label()}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={() => void onScreenshot()}>
            <IconDefinitionIcon
              icon={faCamera}
              size="0.75em"
              className="w-4 text-muted-foreground"
            />
            {m.browser_overflow_screenshot_label()}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={() => void onOpenConsole()}>
            <IconDefinitionIcon
              icon={faTerminal}
              size="0.75em"
              className="w-4 text-muted-foreground"
            />
            {m.browser_overflow_console_label()}
          </Menu.Item>
          <Menu.Item onSelect={() => void onOpenSource()}>
            <IconDefinitionIcon icon={faCode} size="0.75em" className="w-4 text-muted-foreground" />
            {m.browser_overflow_source_label()}
          </Menu.Item>
          <Menu.Item onSelect={() => void onOpenInspector()}>
            <IconDefinitionIcon
              icon={faCrosshairs}
              size="0.75em"
              className="w-4 text-muted-foreground"
            />
            <span className="min-w-0 flex-1">{m.browser_overflow_inspector_label()}</span>
            <kbd className="type-caption ml-5 text-muted-foreground" aria-hidden="true">
              ⌘⌥I
            </kbd>
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={() => void onReloadWithoutCache()}>
            <IconDefinitionIcon
              icon={faRotate}
              size="0.75em"
              className="w-4 text-muted-foreground"
            />
            {m.browser_overflow_reloadWithoutCache_label()}
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <BrowserViewportDialog
        open={editingCustom}
        onOpenChange={setEditingCustom}
        viewport={viewport}
        onViewportChange={(value) => onViewportChange?.(value)}
        returnFocus={triggerRef}
      />
    </>
  );
}
