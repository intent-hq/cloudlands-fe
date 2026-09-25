<script lang="ts">
  import { faRotate } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
  import {
    BROWSER_VIEWPORT_PRESETS,
    rotateBrowserViewport,
    type BrowserViewportPresetCategory,
  } from './browser-viewport-presets';

  let {
    viewport,
    onViewportChange,
    onCustom,
  }: {
    viewport: BrowserTabViewport;
    onViewportChange: (viewport: BrowserTabViewport) => void;
    onCustom: () => void;
  } = $props();
  const categories: readonly BrowserViewportPresetCategory[] = ['phone', 'tablet', 'desktop'];
  const selected = $derived(
    viewport.mode === 'fit' ? 'fit' : viewport.mode === 'preset' ? viewport.presetId : 'custom',
  );

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
</script>

<Menu.RadioGroup value={selected} onValueChange={selectViewport}>
  <Menu.RadioItem value="fit">{m.browser_viewport_fitPanel_label()}</Menu.RadioItem>
  {#each categories as category}
    <Menu.Separator />
    <Menu.Label
      >{category === 'phone'
        ? m.browser_viewport_phoneGroup_label()
        : category === 'tablet'
          ? m.browser_viewport_tabletGroup_label()
          : m.browser_viewport_desktopGroup_label()}</Menu.Label
    >
    {#each BROWSER_VIEWPORT_PRESETS.filter((preset) => preset.category === category) as preset (preset.id)}
      <Menu.RadioItem value={preset.id}>
        <span class="min-w-0 flex-1 truncate">{preset.name}</span>
        <span class="type-caption ml-3 text-muted-foreground"
          >{m.browser_viewport_dimensions_label({
            width: formatInteger(preset.width),
            height: formatInteger(preset.height),
          })}</span
        >
      </Menu.RadioItem>
    {/each}
  {/each}
  {#if viewport.mode === 'custom'}
    <Menu.Separator />
    <Menu.RadioItem value="custom" onSelect={onCustom}>
      <span class="min-w-0 flex-1">{m.browser_viewport_custom_label()}</span>
      <span class="type-caption text-muted-foreground"
        >{m.browser_viewport_dimensions_label({
          width: formatInteger(viewport.width),
          height: formatInteger(viewport.height),
        })}</span
      >
    </Menu.RadioItem>
  {/if}
</Menu.RadioGroup>
{#if viewport.mode !== 'custom'}
  <Menu.Separator />
  <Menu.Item onSelect={onCustom}>{m.browser_viewport_custom_label()}</Menu.Item>
{/if}
{#if viewport.mode !== 'fit'}
  <Menu.Separator />
  <Menu.CommandItem
    icon={faRotate}
    label={m.browser_viewport_rotate_label()}
    onSelect={() => onViewportChange(rotateBrowserViewport(viewport))}
  />
{/if}
