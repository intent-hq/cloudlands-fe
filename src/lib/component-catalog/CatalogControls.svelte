<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { themePresets } from '$lib/utils/theme-presets';
  import {
    catalogColorThemes,
    type CatalogColorTheme,
    type CatalogTheme,
  } from './catalog-preferences';

  interface Props {
    theme?: CatalogTheme;
    colorTheme?: CatalogColorTheme;
    resolvedTheme?: 'light' | 'dark';
    reducedMotion?: boolean;
    width?: number;
    density?: 'default' | 'compact';
    radius?: 'rounded' | 'square';
  }

  let {
    theme = $bindable('system'),
    colorTheme = $bindable('default'),
    resolvedTheme = 'light',
    reducedMotion = $bindable(false),
    width = $bindable(undefined),
    density = $bindable('default'),
    radius = $bindable('rounded'),
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
  const widthOptions = $derived([
    { value: 'auto', label: 'Responsive' },
    ...(!width || [320, 420, 680, 960].includes(width)
      ? []
      : [{ value: String(width), label: `${width}px` }]),
    ...[320, 420, 680, 960].map((value) => ({ value: String(value), label: `${value}px` })),
  ]);

  function handleColorThemeChange(value: string) {
    if (catalogColorThemes.includes(value as CatalogColorTheme)) {
      colorTheme = value as CatalogColorTheme;
    }
  }

  function handleWidthChange(value: string) {
    width = value === 'auto' ? undefined : Number(value);
  }
</script>

<div class="catalog-controls" aria-label="Catalog display controls">
  <h2>Make them yours</h2>
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

  <label class="motion-control" data-testid="catalog-motion-control">
    <Switch bind:checked={reducedMotion} size="sm" ariaLabel="Reduce motion" />
    <span>Reduce motion</span>
  </label>

  <div class="control-set">
    <span id="catalog-size-label" class="control-label">Size</span>
    <ToggleGroup.Root
      type="single"
      bind:value={density}
      size="sm"
      aria-labelledby="catalog-size-label"
      data-catalog-control="size"
    >
      <ToggleGroup.Item value="default" class="control-choice">Default</ToggleGroup.Item>
      <ToggleGroup.Item value="compact" class="control-choice">Compact</ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>

  <div class="control-set">
    <span id="catalog-radius-label" class="control-label">Radius</span>
    <ToggleGroup.Root
      type="single"
      bind:value={radius}
      size="sm"
      aria-labelledby="catalog-radius-label"
      data-catalog-control="radius"
    >
      <ToggleGroup.Item value="rounded" class="control-choice">Rounded</ToggleGroup.Item>
      <ToggleGroup.Item value="square" class="control-choice">Square</ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>

  <div class="control-set">
    <span id="catalog-width-label" class="control-label">Preview</span>
    <div class="color-theme-dropdown">
      <Select.Root
        value={width ? String(width) : 'auto'}
        items={widthOptions}
        onchange={handleWidthChange}
      >
        <Select.Trigger aria-labelledby="catalog-width-label" data-catalog-control="width">
          <Select.Value placeholder="Responsive" />
        </Select.Trigger>
        <Select.Content portal>
          {#each widthOptions as option (option.value)}
            <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </div>
</div>

<style>
  .catalog-controls {
    display: grid;
    min-width: 0;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
  }

  h2 {
    margin-bottom: 0.25rem;
    font-size: var(--text-body-size);
    font-weight: var(--text-body-strong-weight);
  }

  .control-set {
    display: grid;
    min-width: 0;
    gap: 0.375rem;
  }

  .motion-control {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--control-height-compact) / 4);
  }

  .control-label,
  .motion-control {
    font-size: var(--text-caption-size);
    color: hsl(var(--muted-foreground));
  }

  :global(.control-choice) {
    width: auto;
    padding-inline: calc(var(--control-height-compact) / 3);
  }

  .color-theme-dropdown {
    width: 100%;
    min-width: 0;
  }

  :global(.color-theme-select) {
    height: var(--control-height-small);
  }
</style>
