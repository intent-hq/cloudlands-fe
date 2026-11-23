<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import ColorThemeSettings from '$lib/components/settings/ColorThemeSettings.svelte';
  import ChatAppearanceSettings from '$lib/components/settings/ChatAppearanceSettings.svelte';
  import MenuBarAutoHideSettings from '$lib/components/settings/MenuBarAutoHideSettings.svelte';
  import MachineRailSettings from '$lib/components/settings/MachineRailSettings.svelte';
  import { keepToggleSelected } from '$lib/components/settings/utils/keep-toggle-selected';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { selectThemePreference } from '$store/renderer/slices/theme/theme-selectors';
  import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemePreference } from '$store/renderer/slices/theme/theme-types';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  /** `show` picks the rows to render; the settings page passes `isAvailable`-filtered ids. */
  let { show }: { show: (row: string) => boolean } = $props();

  const themePreference = selectThemePreference();
  let colorThemeSettingsRef: ColorThemeSettings | undefined = $state();

  const themeOptions = [
    { value: 'light', label: m.settings_theme_light() },
    { value: 'dark', label: m.settings_theme_dark() },
    { value: 'system', label: m.settings_theme_system() },
  ];

  function handleThemeChange(newTheme: string | string[]) {
    appStore.dispatch(requestThemePreferenceChange(newTheme as ThemePreference));
  }

  export function clearTheme() {
    colorThemeSettingsRef?.clearTheme();
  }
</script>

<div id="theme" data-highlight-id="appearance" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">
    {m.settings_section_appearance()}
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    {#if show('theme-preference')}
      <section data-slot="settings-section-body" class="px-6 py-4">
        <SettingsFieldRow id="settings-theme-label-field" label={m.settings_theme_label()}>
          <ToggleGroup.Root
            variant="outline"
            type="single"
            bind:value={() => $themePreference, handleThemeChange}
            size="sm"
            aria-label={m.settings_theme_label()}
            class="ml-4 shrink-0"
          >
            {#each themeOptions as option (option.value)}
              <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                {option.label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
        </SettingsFieldRow>
      </section>
    {/if}
    {#if show('color-theme')}
      <section
        id="color-theme"
        data-highlight-id="color-theme"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <ColorThemeSettings bind:this={colorThemeSettingsRef} />
      </section>
    {/if}
    {#if show('chat-appearance')}
      <ChatAppearanceSettings />
    {/if}
    {#if show('menu-bar-auto-hide')}
      <section
        id="menu-bar-auto-hide"
        data-highlight-id="menu-bar-auto-hide"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <MenuBarAutoHideSettings />
      </section>
    {/if}
    {#if show('machine-rail')}
      <section
        id="machine-rail"
        data-highlight-id="machine-rail"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <MachineRailSettings />
      </section>
    {/if}
  </div>
</div>
