<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { themePresets } from '$lib/utils/theme-presets';
  import { m } from '$shared/paraglide/messages.js';
  import {
    catalogColorThemes,
    type CatalogMotion,
    type CatalogColorTheme,
    type CatalogTheme,
  } from './catalog-preferences';

  interface Props {
    theme?: CatalogTheme;
    colorTheme?: CatalogColorTheme;
    resolvedTheme?: 'light' | 'dark';
    motion?: CatalogMotion;
  }

  let {
    theme = $bindable('system'),
    colorTheme = $bindable('default'),
    resolvedTheme = 'light',
    motion = $bindable('system'),
  }: Props = $props();

  const themeOptions = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ] satisfies Array<{ value: CatalogTheme; label: string }>;

  const colorThemeOptions = [
    { value: 'default', label: 'Default' },
    ...themePresets.map(({ id, label }) => ({ value: id, label })),
  ];
  const selectedColorTheme = $derived(
    colorThemeOptions.find((option) => option.value === colorTheme) ?? colorThemeOptions[0],
  );

  function handleColorThemeChange(value: string) {
    if (catalogColorThemes.includes(value as CatalogColorTheme)) {
      colorTheme = value as CatalogColorTheme;
    }
  }
</script>

<div class="catalog-controls" aria-label="Catalog display controls">
  <div class="control-set">
    <span id="catalog-color-theme-label" class="control-label">Color theme</span>
    <div class="color-theme-dropdown">
      <Select.Root value={colorTheme} items={colorThemeOptions} onchange={handleColorThemeChange}>
        <Select.Trigger
          aria-labelledby="catalog-color-theme-label"
          data-testid="catalog-color-theme-control"
          data-catalog-control="color-theme"
          class="color-theme-select"
        >
          <span class="truncate">{selectedColorTheme.label}</span>
        </Select.Trigger>
        <Select.Content portal>
          {#each colorThemeOptions as option (option.value)}
            <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>

  <div class="control-set">
    <span id="catalog-theme-label" class="control-label">Theme</span>
    <ToggleGroup.Root
      type="single"
      bind:value={theme}
      size="sm"
      aria-labelledby="catalog-theme-label"
      aria-describedby="catalog-theme-status"
      data-testid="catalog-theme-control"
      data-catalog-control="theme"
    >
      {#each themeOptions as option (option.value)}
        <ToggleGroup.Item value={option.value} class="control-choice">
          {option.label}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    <output id="catalog-theme-status" class="sr-only" aria-live="polite">
      {theme === 'system'
        ? `System theme selected, currently ${resolvedTheme}`
        : `${theme === 'light' ? 'Light' : 'Dark'} theme selected`}
    </output>
  </div>

  <div class="control-set" data-testid="catalog-motion-control">
    <span id="catalog-motion-label" class="control-label">{m.sandbox_catalog_motion_label()}</span>
    <ToggleGroup.Root
      type="single"
      bind:value={motion}
      size="sm"
      aria-labelledby="catalog-motion-label"
      data-catalog-control="motion"
    >
      <ToggleGroup.Item value="system" class="control-choice">
        {m.sandbox_catalog_motionSystem_label()}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="full" class="control-choice">
        {m.sandbox_catalog_motionFull_label()}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="reduced" class="control-choice">
        {m.sandbox_catalog_motionReduced_label()}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
</div>

<style>
  .catalog-controls {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: calc(var(--control-height-compact) / 2);
  }

  .control-set {
    display: flex;
    flex: none;
    align-items: center;
    gap: calc(var(--control-height-compact) / 4);
  }

  .control-label {
    font-size: var(--text-caption-size);
    color: hsl(var(--muted-foreground));
  }

  :global(.control-choice) {
    width: auto;
    padding-inline: calc(var(--control-height-compact) / 3);
  }

  .color-theme-dropdown {
    width: calc(var(--control-height-medium) * 4.25);
  }

  :global(.color-theme-select) {
    height: var(--control-height-small);
  }

  @media (max-width: 767px) {
    .catalog-controls {
      width: 100%;
      justify-content: flex-start;
      overflow-x: auto;
      padding-bottom: calc(var(--control-height-compact) / 6);
      scrollbar-width: thin;
    }

    .control-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }
  }
</style>
