import { Fragment } from 'react';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import * as Menu from '@/components/ui/menu';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
import {
  BROWSER_VIEWPORT_PRESETS,
  rotateBrowserViewport,
  type BrowserViewportPresetCategory,
} from '$lib/components/browser/browser-viewport-presets';

export interface BrowserViewportItemsProps {
  viewport: BrowserTabViewport;
  onViewportChange: (viewport: BrowserTabViewport) => void;
  onCustom: () => void;
}

const categories: readonly BrowserViewportPresetCategory[] = ['phone', 'tablet', 'desktop'];

export function BrowserViewportItems({
  viewport,
  onViewportChange,
  onCustom,
}: BrowserViewportItemsProps) {
  const selected =
    viewport.mode === 'fit' ? 'fit' : viewport.mode === 'preset' ? viewport.presetId : 'custom';

  function selectViewport(value: string) {
    if (value === 'fit') return onViewportChange({ mode: 'fit' });
    const preset = BROWSER_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (preset)
      onViewportChange({
        mode: 'preset',
        presetId: preset.id,
        width: preset.width,
        height: preset.height,
      });
  }

  return (
    <>
      <Menu.RadioGroup value={selected} onValueChange={selectViewport}>
        <Menu.RadioItem value="fit">{m.browser_viewport_fitPanel_label()}</Menu.RadioItem>
        {categories.map((category) => (
          <Fragment key={category}>
            <Menu.Separator />
            <Menu.Label>
              {category === 'phone'
                ? m.browser_viewport_phoneGroup_label()
                : category === 'tablet'
                  ? m.browser_viewport_tabletGroup_label()
                  : m.browser_viewport_desktopGroup_label()}
            </Menu.Label>
            {BROWSER_VIEWPORT_PRESETS.filter((preset) => preset.category === category).map(
              (preset) => (
                <Menu.RadioItem key={preset.id} value={preset.id}>
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <span className="type-caption ml-3 text-muted-foreground">
                    {m.browser_viewport_dimensions_label({
                      width: formatInteger(preset.width),
                      height: formatInteger(preset.height),
                    })}
                  </span>
                </Menu.RadioItem>
              ),
            )}
          </Fragment>
        ))}
        {viewport.mode === 'custom' && (
          <>
            <Menu.Separator />
            <Menu.RadioItem value="custom" onSelect={onCustom}>
              <span className="min-w-0 flex-1">{m.browser_viewport_custom_label()}</span>
              <span className="type-caption text-muted-foreground">
                {m.browser_viewport_dimensions_label({
                  width: formatInteger(viewport.width),
                  height: formatInteger(viewport.height),
                })}
              </span>
            </Menu.RadioItem>
          </>
        )}
      </Menu.RadioGroup>
      {viewport.mode !== 'custom' && (
        <>
          <Menu.Separator />
          <Menu.Item onSelect={onCustom}>{m.browser_viewport_custom_label()}</Menu.Item>
        </>
      )}
      {viewport.mode !== 'fit' && (
        <>
          <Menu.Separator />
          <Menu.CommandItem
            icon={ArrowClockwiseIcon}
            label={m.browser_viewport_rotate_label()}
            onSelect={() => onViewportChange(rotateBrowserViewport(viewport))}
          />
        </>
      )}
    </>
  );
}
