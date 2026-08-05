<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { setLanguagePreference } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectLanguagePreference } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { getAvailableLocales, getLocaleEndonym } from '$lib/i18n/locale';
  import { SYSTEM_LANGUAGE_PREFERENCE } from '$shared/i18n/locale-matcher';

  const languagePreference = selectLanguagePreference();

  // Catalog-driven: options come straight from the compiled Paraglide locales,
  // so new catalogs added to messages/ appear here automatically. Each locale
  // is labeled with its endonym (its own name in that language).
  const options = [
    { value: SYSTEM_LANGUAGE_PREFERENCE, label: m.settings_language_system_option() },
    ...getAvailableLocales().map((locale) => ({
      value: locale as string,
      label: getLocaleEndonym(locale),
    })),
  ];

  const selectedLabel = $derived(
    options.find((option) => option.value === $languagePreference)?.label ??
      m.settings_language_system_option(),
  );

  function handleLanguageChange(value: string) {
    appStore.dispatch(setLanguagePreference(value));
  }
</script>

<div class="flex items-center justify-between">
  <div>
    <p class="text-sm font-medium text-foreground">{m.settings_language_label()}</p>
    <p class="text-xs text-subtle mt-0.5">
      {m.settings_language_description()}
    </p>
  </div>
  <div class="w-[180px] flex-shrink-0">
    <Select.Root value={$languagePreference} onchange={handleLanguageChange}>
      <Select.Trigger>
        <span class="truncate">{selectedLabel}</span>
      </Select.Trigger>
      <Select.Content portal class="max-h-[300px] w-[180px]">
        {#each options as option (option.value)}
          <Select.Item value={option.value}>
            <span class="truncate">{option.label}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
</div>
