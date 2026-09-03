<script lang="ts">
  import Fa from 'svelte-fa';
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
  } from '@fortawesome/free-solid-svg-icons';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
  import { BROWSER_VIEWPORT_PRESETS, rotateBrowserViewport } from './browser-viewport-presets';

  const MIN_VIEWPORT_PX = 320;
  const MAX_VIEWPORT_PX = 3840;
  const DEFAULT_CUSTOM_SIZE = { width: 1280, height: 800 };

  interface Props {
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

  let {
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
  }: Props = $props();

  const triggerLabel = $derived(
    errorCount > 0
      ? m.browser_overflow_triggerWithErrors_ariaLabel({ count: formatInteger(errorCount) })
      : m.browser_overflow_trigger_ariaLabel(),
  );
  const selectedViewport = $derived(
    viewport.mode === 'fit' ? 'fit' : viewport.mode === 'preset' ? viewport.presetId : 'custom',
  );
  const selectedPreset = $derived(
    viewport.mode === 'preset'
      ? BROWSER_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
      : undefined,
  );
  const viewportLabel = $derived(
    viewport.mode === 'fit'
      ? m.browser_viewport_fitPanel_label()
      : (selectedPreset?.name ??
          m.browser_viewport_dimensions_label({
            width: formatInteger(viewport.width),
            height: formatInteger(viewport.height),
          })),
  );
  let editingCustom = $state(false);
  let customWidth: number | null = $state(DEFAULT_CUSTOM_SIZE.width);
  let customHeight: number | null = $state(DEFAULT_CUSTOM_SIZE.height);
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

  function selectViewport(value: string): void {
    if (value === 'fit') {
      onViewportChange?.({ mode: 'fit' });
      return;
    }
    const preset = BROWSER_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
    if (!preset) return;
    onViewportChange?.({
      mode: 'preset',
      presetId: preset.id,
      width: preset.width,
      height: preset.height,
    });
  }

  function applyCustom(event: SubmitEvent): void {
    event.preventDefault();
    if (!customSizeValid || customWidth === null || customHeight === null) return;
    onViewportChange?.({ mode: 'custom', width: customWidth, height: customHeight });
    editingCustom = false;
  }
</script>

<Menu.Root>
  <Menu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost-light"
        size="icon-xs"
        class="relative"
        {disabled}
        tooltip={m.browser_overflow_trigger_tooltip()}
        tooltipSide="bottom"
        aria-label={triggerLabel}
        data-testid="browser-overflow-trigger"
      >
        <KebabIcon class="size-3.5" />
        {#if errorCount > 0}
          <Badge
            variant="destructive"
            class="absolute -right-1.5 -top-1.5 h-4 min-w-4 px-1 text-[10px] leading-none"
            data-testid="browser-console-error-badge"
          >
            {errorCount > 9 ? '9+' : formatInteger(errorCount)}
          </Badge>
        {/if}
      </Button>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content align="end" class="w-56">
    {#if collapsed}
      <Menu.Item disabled={!canGoBack} onSelect={onGoBack}>
        <Fa icon={faArrowLeft} size="xs" class="w-4 text-muted-foreground" />
        {m.browser_embedded_goBack_ariaLabel()}
      </Menu.Item>
      <Menu.Item disabled={!canGoForward} onSelect={onGoForward}>
        <Fa icon={faArrowRight} size="xs" class="w-4 text-muted-foreground" />
        {m.browser_embedded_goForward_ariaLabel()}
      </Menu.Item>
      <Menu.Item disabled={!canSelectElement} onSelect={() => void onToggleElementPicker?.()}>
        <Fa icon={faCrosshairs} size="xs" class="w-4 text-muted-foreground" />
        {selectingElement
          ? m.browser_embedded_cancelElementSelection_ariaLabel()
          : m.browser_embedded_selectElement_ariaLabel()}
      </Menu.Item>
      <Menu.Sub>
        <Menu.SubTrigger>
          <Fa icon={faDesktop} size="xs" class="w-4 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">
            {m.browser_viewport_trigger_ariaLabel({ mode: viewportLabel })}
          </span>
        </Menu.SubTrigger>
        <Menu.SubContent class="w-64">
          <Menu.RadioGroup value={selectedViewport} onValueChange={selectViewport}>
            <Menu.RadioItem value="fit">{m.browser_viewport_fitPanel_label()}</Menu.RadioItem>
            <Menu.Separator />
            {#each BROWSER_VIEWPORT_PRESETS as preset}
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
          </Menu.RadioGroup>
          <Menu.Separator />
          <Menu.Item closeOnSelect={false} onSelect={() => (editingCustom = true)}>
            {m.browser_viewport_custom_label()}
          </Menu.Item>
          {#if editingCustom}
            <form
              class="space-y-2 px-2 py-2"
              onsubmit={applyCustom}
              data-testid="overflow-viewport-custom-form"
            >
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
              <Button type="submit" size="xs" disabled={!customSizeValid}>
                {m.browser_viewport_apply_label()}
              </Button>
            </form>
          {/if}
          {#if viewport.mode !== 'fit'}
            <Menu.Separator />
            <Menu.Item onSelect={() => onViewportChange?.(rotateBrowserViewport(viewport))}>
              <Fa icon={faRotate} size="xs" class="w-4 text-muted-foreground" />
              {m.browser_viewport_rotate_label()}
            </Menu.Item>
          {/if}
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Separator />
    {/if}
    <Menu.Item onSelect={() => void onOpenExternal()}>
      <Fa icon={faArrowUpRightFromSquare} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_openExternal_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onCopyUrl()}>
      <Fa icon={faCopy} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_copyUrl_label()}
    </Menu.Item>
    <Menu.Separator />
    <Menu.Item onSelect={() => void onScreenshot()}>
      <Fa icon={faCamera} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_screenshot_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenConsole()}>
      <Fa icon={faTerminal} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_console_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenSource()}>
      <Fa icon={faCode} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_source_label()}
    </Menu.Item>
    <Menu.Item onSelect={() => void onOpenInspector()}>
      <Fa icon={faCrosshairs} size="xs" class="w-4 text-muted-foreground" />
      <span class="min-w-0 flex-1">{m.browser_overflow_inspector_label()}</span>
      <kbd class="type-caption ml-5 text-muted-foreground" aria-hidden="true">⌘⌥I</kbd>
    </Menu.Item>
    <Menu.Separator />
    <Menu.Item onSelect={() => void onReloadWithoutCache()}>
      <Fa icon={faRotate} size="xs" class="w-4 text-muted-foreground" />
      {m.browser_overflow_reloadWithoutCache_label()}
    </Menu.Item>
  </Menu.Content>
</Menu.Root>
