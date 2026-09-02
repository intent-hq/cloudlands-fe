<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown, faRotate } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
  import {
    BROWSER_VIEWPORT_PRESETS,
    rotateBrowserViewport,
    type BrowserViewportPresetCategory,
  } from './browser-viewport-presets';

  const MIN_VIEWPORT_PX = 320;
  const MAX_VIEWPORT_PX = 3840;
  const DEFAULT_CUSTOM_SIZE = { width: 1280, height: 800 };
  const CATEGORIES: readonly BrowserViewportPresetCategory[] = ['phone', 'tablet', 'desktop'];

  interface Props {
    viewport: BrowserTabViewport;
    onViewportChange: (viewport: BrowserTabViewport) => void;
  }

  let { viewport, onViewportChange }: Props = $props();
  let open = $state(false);
  let editingCustom = $state(false);
  let customWidth: number | null = $state(DEFAULT_CUSTOM_SIZE.width);
  let customHeight: number | null = $state(DEFAULT_CUSTOM_SIZE.height);

  const selectedValue = $derived(
    viewport.mode === 'fit' ? 'fit' : viewport.mode === 'preset' ? viewport.presetId : 'custom',
  );
  const selectedPreset = $derived(
    viewport.mode === 'preset'
      ? BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
      : undefined,
  );
  const dimensionsLabel = $derived(
    viewport.mode === 'fit'
      ? ''
      : m.browser_viewport_dimensions_label({
          width: formatInteger(viewport.width),
          height: formatInteger(viewport.height),
        }),
  );
  const triggerLabel = $derived(
    viewport.mode === 'fit'
      ? m.browser_viewport_fitPanel_label()
      : viewport.mode === 'preset' && selectedPreset
        ? selectedPreset.name
        : dimensionsLabel,
  );
  const customSizeValid = $derived(
    typeof customWidth === 'number' &&
      Number.isInteger(customWidth) &&
      customWidth >= MIN_VIEWPORT_PX &&
      customWidth <= MAX_VIEWPORT_PX &&
      typeof customHeight === 'number' &&
      Number.isInteger(customHeight) &&
      customHeight >= MIN_VIEWPORT_PX &&
      customHeight <= MAX_VIEWPORT_PX,
  );

  $effect(() => {
    if (editingCustom) return;
    const size = viewport.mode === 'fit' ? DEFAULT_CUSTOM_SIZE : viewport;
    customWidth = size.width;
    customHeight = size.height;
  });

  function categoryLabel(category: BrowserViewportPresetCategory): string {
    if (category === 'phone') return m.browser_viewport_phoneGroup_label();
    if (category === 'tablet') return m.browser_viewport_tabletGroup_label();
    return m.browser_viewport_desktopGroup_label();
  }

  function selectViewport(value: string): void {
    if (value === 'fit') {
      onViewportChange({ mode: 'fit' });
      return;
    }
    const preset = BROWSER_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    onViewportChange({
      mode: 'preset',
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
    });
  }

  function showCustomEditor(): void {
    editingCustom = true;
  }

  function applyCustom(event: SubmitEvent): void {
    event.preventDefault();
    if (!customSizeValid || customWidth === null || customHeight === null) return;
    onViewportChange({ mode: 'custom', width: customWidth, height: customHeight });
    editingCustom = false;
    open = false;
  }

  function rotate(): void {
    if (viewport.mode === 'fit') return;
    onViewportChange(rotateBrowserViewport(viewport));
  }
</script>

<Menu.Root bind:open>
  <Menu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost-light"
        size="xs"
        class="max-w-36 gap-1 px-2"
        aria-label={m.browser_viewport_trigger_ariaLabel({ mode: triggerLabel })}
        data-testid="browser-viewport-trigger"
      >
        <span class="truncate">{triggerLabel}</span>
        <Fa icon={faChevronDown} size="xs" class="shrink-0" />
      </Button>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content align="end" class="w-64">
    <Menu.RadioGroup value={selectedValue} onValueChange={selectViewport}>
      <Menu.RadioItem value="fit">{m.browser_viewport_fitPanel_label()}</Menu.RadioItem>
      <Menu.Separator />
      {#each CATEGORIES as category, index}
        {#if index > 0}<Menu.Separator />{/if}
        <div class="px-2 py-1 text-xs font-medium text-muted-foreground">
          {categoryLabel(category)}
        </div>
        {#each BROWSER_VIEWPORT_PRESETS.filter((preset) => preset.category === category) as preset}
          <Menu.RadioItem value={preset.id}>
            <span class="min-w-0 flex-1 truncate">{preset.name}</span>
            <span class="ml-3 text-xs text-muted-foreground">
              {m.browser_viewport_dimensions_label({
                width: formatInteger(preset.width),
                height: formatInteger(preset.height),
              })}
            </span>
          </Menu.RadioItem>
        {/each}
      {/each}
    </Menu.RadioGroup>
    <Menu.Separator />
    <Menu.Item closeOnSelect={false} onSelect={showCustomEditor}>
      {m.browser_viewport_custom_label()}
    </Menu.Item>
    {#if editingCustom}
      <form class="space-y-2 px-2 py-2" onsubmit={applyCustom} data-testid="viewport-custom-form">
        <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label class="space-y-1 text-xs text-muted-foreground">
            <span>{m.browser_viewport_width_label()}</span>
            <Input
              type="number"
              min={MIN_VIEWPORT_PX}
              max={MAX_VIEWPORT_PX}
              step="1"
              bind:value={customWidth}
              aria-invalid={!customSizeValid}
            />
          </label>
          <span class="pb-2 text-muted-foreground" aria-hidden="true">×</span>
          <label class="space-y-1 text-xs text-muted-foreground">
            <span>{m.browser_viewport_height_label()}</span>
            <Input
              type="number"
              min={MIN_VIEWPORT_PX}
              max={MAX_VIEWPORT_PX}
              step="1"
              bind:value={customHeight}
              aria-invalid={!customSizeValid}
            />
          </label>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">
            {m.browser_viewport_sizeRange_description({
              min: formatInteger(MIN_VIEWPORT_PX),
              max: formatInteger(MAX_VIEWPORT_PX),
            })}
          </span>
          <Button type="submit" size="xs" disabled={!customSizeValid}>
            {m.browser_viewport_apply_label()}
          </Button>
        </div>
      </form>
    {/if}
    {#if viewport.mode !== 'fit'}
      <Menu.Separator />
      <Menu.Item onSelect={rotate}>
        <Fa icon={faRotate} size="xs" class="w-4 text-muted-foreground" />
        {m.browser_viewport_rotate_label()}
      </Menu.Item>
    {/if}
  </Menu.Content>
</Menu.Root>
