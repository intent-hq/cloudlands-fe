<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { FileInput } from '$lib/components/ui/file-input';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { stripJSONC } from '$lib/utils/vscode-theme-parser';
  import { themePresets } from '$lib/utils/theme-presets';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectActiveThemePresetId,
    selectCustomThemeName,
    selectHasCustomTheme,
    selectIsDarkTheme,
    selectThemeError,
  } from '$store/renderer/slices/theme/theme-selectors';
  import {
    clearThemeCustomization,
    importCustomTheme,
    selectThemePreset,
    setThemeError,
  } from '$store/renderer/slices/theme/theme-slice';
  import { store as appStore } from '$store/renderer/store';

  let selectedFiles: FileList | undefined = $state();
  let errorMessage = $state('');

  const isDarkTheme = selectIsDarkTheme();
  const activePresetId = selectActiveThemePresetId();
  const hasCustomTheme = selectHasCustomTheme();
  const customThemeName = selectCustomThemeName();
  const themeError = selectThemeError();

  /** True when a user-imported file is active (not a preset) */
  const isUserImported = $derived($hasCustomTheme && !$activePresetId);
  const activeChoice = $derived($activePresetId ?? (!$hasCustomTheme ? 'default' : ''));
  const displayErrorMessage = $derived(errorMessage || $themeError || undefined);

  const defaultPreviewColors = {
    dark: ['#1b1b22', '#f7f7f7', '#009960', '#009960'] as const,
    light: ['#ffffff', '#171717', '#009960', '#009960'] as const,
  };

  function clearThemeErrorMessage() {
    errorMessage = '';
    appStore.dispatch(setThemeError(null));
  }

  function selectPreset(presetId: string) {
    clearThemeErrorMessage();
    const preset = themePresets.find((p) => p.id === presetId);
    if (!preset) return;

    appStore.dispatch(selectThemePreset(presetId));
  }

  function selectDefault() {
    clearThemeErrorMessage();
    appStore.dispatch(clearThemeCustomization());
  }

  function handleThemeChoiceChange(value: string) {
    if (!value) return;
    if (value === 'default') {
      selectDefault();
      return;
    }
    selectPreset(value);
  }

  async function handleFilesChange(files: FileList | undefined) {
    const file = files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(stripJSONC(text));
      appStore.dispatch(setThemeError(null));
      appStore.dispatch(importCustomTheme(json));
      errorMessage = '';
    } catch (err) {
      if (err instanceof SyntaxError) {
        errorMessage = m.settings_colorTheme_invalidJsonError();
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else {
        errorMessage = m.settings_colorTheme_loadFileError();
      }
    }

    selectedFiles = undefined;
  }

  export function clearTheme() {
    selectDefault();
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <p class="text-sm font-medium text-foreground">{m.settings_colorTheme_title()}</p>
    <FileInput
      id="color-theme-file"
      label={m.settings_colorTheme_importButton()}
      emptyText="JSON files only"
      accept=".json"
      bind:files={selectedFiles}
      onFilesChange={handleFilesChange}
      invalid={Boolean(displayErrorMessage)}
      error={displayErrorMessage}
      variant="flat"
      class="w-full sm:w-auto sm:max-w-md"
    />
  </div>

  <ToggleGroup.Root
    type="single"
    value={activeChoice}
    onValueChange={handleThemeChoiceChange}
    aria-label={m.settings_colorTheme_title()}
    variant="flat"
    class="grid w-full grid-cols-[repeat(auto-fit,minmax(min(8rem,100%),1fr))] gap-2 bg-transparent p-0"
  >
    <ToggleGroup.Item
      value="default"
      class="h-auto w-auto min-w-0 flex-col items-start gap-1.5 p-2 text-left"
    >
      <span class="flex w-full" aria-hidden="true">
        {#each $isDarkTheme ? defaultPreviewColors.dark : defaultPreviewColors.light as color, i (i)}
          <span class="h-4 flex-1" style="background-color: {color}"></span>
        {/each}
      </span>
      <span class="w-full truncate text-ui leading-tight text-foreground">
        {m.settings_colorTheme_defaultOption()}
      </span>
    </ToggleGroup.Item>

    {#each themePresets as preset (preset.id)}
      {@const colors = $isDarkTheme ? preset.previewColors.dark : preset.previewColors.light}
      <ToggleGroup.Item
        value={preset.id}
        class="h-auto w-auto min-w-0 flex-col items-start gap-1.5 p-2 text-left"
      >
        <span class="flex w-full" aria-hidden="true">
          {#each colors as color, i (i)}
            <span class="h-4 flex-1" style="background-color: {color}"></span>
          {/each}
        </span>
        <span class="w-full truncate text-ui leading-tight text-foreground">{preset.label}</span>
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>

  {#if isUserImported}
    <div class="flex min-w-0 items-center justify-between gap-3">
      <p class="min-w-0 truncate text-xs text-muted-foreground">
        {m.settings_colorTheme_importedLabel()}
        <span class="text-foreground font-medium">{$customThemeName}</span>
      </p>
      <Button variant="ghost" size="xs" onclick={selectDefault}>
        {m.settings_colorTheme_clearButton()}
      </Button>
    </div>
  {/if}
</div>
