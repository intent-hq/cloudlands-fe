<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import { themeManager } from '$lib/utils/theme';
  import { stripJSONC } from '$lib/utils/vscode-theme-parser';
  import { themePresets } from '$lib/utils/theme-presets';
  import { track } from '$lib/services/analytics';
  import Fa from 'svelte-fa';
  import { faUpload } from '@fortawesome/free-solid-svg-icons';

  let fileInput: HTMLInputElement | undefined = $state();
  let errorMessage = $state('');
  let activePresetId = $state(themeManager.getActivePresetId());
  let hasCustom = $state(themeManager.hasCustomTheme());
  let customThemeName = $state(themeManager.getCustomThemeName());

  /** True when a user-imported file is active (not a preset) */
  let isUserImported = $derived(hasCustom && !activePresetId);

  const defaultPreviewColors = {
    dark: ['#1b1b22', '#f7f7f7', '#009960', '#009960'] as const,
    light: ['#ffffff', '#171717', '#009960', '#009960'] as const,
  };

  function selectPreset(presetId: string) {
    errorMessage = '';
    const preset = themePresets.find((p) => p.id === presetId);
    if (!preset) return;

    const previousPreset = activePresetId ? themePresets.find((p) => p.id === activePresetId) : null;
    const previousTheme = previousPreset?.label ?? (hasCustom ? customThemeName : 'Default');
    themeManager.setPresetTheme(presetId, preset.dark, preset.light);
    activePresetId = presetId;
    hasCustom = true;
    customThemeName = preset.label;
    track('Changed Theme', {
      theme: preset.label,
      previous_theme: previousTheme ?? undefined,
      source: 'preset',
    });
  }

  function selectDefault() {
    errorMessage = '';
    const previousPreset = activePresetId ? themePresets.find((p) => p.id === activePresetId) : null;
    const previousTheme = previousPreset?.label ?? (hasCustom ? customThemeName : 'Default');
    themeManager.clearCustomTheme();
    activePresetId = null;
    hasCustom = false;
    customThemeName = null;
    track('Changed Theme', {
      theme: 'Default',
      previous_theme: previousTheme ?? undefined,
      source: 'reset',
    });
  }

  function handleImportClick() {
    errorMessage = '';
    fileInput?.click();
  }

  async function handleFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(stripJSONC(text));
      themeManager.setCustomTheme(json);
      customThemeName = themeManager.getCustomThemeName();
      activePresetId = null;
      hasCustom = true;
      errorMessage = '';
    } catch (err) {
      if (err instanceof SyntaxError) {
        errorMessage = 'Invalid JSON file. Please select a valid VS Code theme file.';
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = 'Failed to load theme file.';
      }
    }

    input.value = '';
  }

  export function clearTheme() {
    selectDefault();
  }
</script>

<div class="flex flex-col gap-3">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <p class="text-sm font-medium text-foreground">Color Theme</p>
    <Button variant="outline" size="sm" onclick={handleImportClick}>
      <Fa icon={faUpload} size="12" />
      Import…
    </Button>
  </div>

  <!-- Theme grid -->
  <div class="grid grid-cols-[repeat(auto-fit,_minmax(100px,_1fr))] gap-2 -mx-2">
    <!-- Default (built-in) -->
    <button
      class="group relative flex flex-col items-start gap-1.5 p-2 text-left cursor-pointer
        {!hasCustom
        ? 'bg-sidebar'
        : ''}"
      onclick={selectDefault}
    >
      <!-- Swatch row -->
      <div class="flex w-full">
        {#each themeManager.isDark() ? defaultPreviewColors.dark : defaultPreviewColors.light as color, i (i)}
          <div class="h-4 flex-1" style="background-color: {color}"></div>
        {/each}
      </div>
      <span class="text-ui leading-tight text-foreground truncate w-full {!hasCustom ? 'font-semibold' : ''}">Default</span>
    </button>

    <!-- Presets -->
    {#each themePresets as preset (preset.id)}
      {@const isActive = activePresetId === preset.id}
      {@const colors = themeManager.isDark() ? preset.previewColors.dark : preset.previewColors.light}
      <button
        class="group relative flex flex-col items-start gap-1.5 p-2 text-left cursor-pointer
          {isActive
          ? 'bg-sidebar'
          : ''}"
        onclick={() => selectPreset(preset.id)}
      >
        <div class="flex w-full">
          {#each colors as color, i (i)}
            <div
              class="h-4 flex-1"
              style="background-color: {color}"
            ></div>
          {/each}
        </div>
        <span class="text-ui leading-tight text-foreground truncate w-full {isActive ? 'font-semibold' : ''}">{preset.label}</span>
      </button>
    {/each}
  </div>

  <!-- Imported theme indicator -->
  {#if isUserImported}
    <div class="flex items-center justify-between">
      <p class="text-xs text-subtle">
        Imported: <span class="text-foreground font-medium">{customThemeName}</span>
      </p>
      <button
        class="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
        onclick={selectDefault}
      >
        Clear
      </button>
    </div>
  {/if}

  {#if errorMessage}
    <p class="text-xs text-destructive-foreground">{errorMessage}</p>
  {/if}
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".json"
  class="hidden"
  onchange={handleFileSelected}
/>
