<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { Select } from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import { isUpdateChannel } from '$features/auto-update/types';
  import { selectShareUpdateStatistics } from '$store/renderer/slices/auto-update/auto-update-selectors';
  import { setShareUpdateStatistics } from '$store/renderer/slices/auto-update/auto-update-slice';
  import { setUpdateChannel } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectUpdateChannel } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { show }: { show: (row: string) => boolean } = $props();

  const updateChannel$ = selectUpdateChannel();
  const shareUpdateStatistics$ = selectShareUpdateStatistics();

  const updateChannelOptions = [
    {
      value: 'stable',
      get label() {
        return m.settings_updateChannel_stable_label();
      },
    },
    {
      value: 'beta',
      get label() {
        return m.settings_updateChannel_beta_label();
      },
    },
    {
      value: 'alpha',
      get label() {
        return m.settings_updateChannel_alpha_label();
      },
    },
    {
      value: 'disabled',
      get label() {
        return m.settings_updateChannel_disabled_label();
      },
    },
  ];

  const updateChannelLabel = $derived(
    updateChannelOptions.find((option) => option.value === $updateChannel$)?.label ??
      m.settings_updateChannel_stable_label(),
  );

  function handleUpdateChannelChange(value: string) {
    if (!isUpdateChannel(value)) return;
    // Dispatch only: the update-channel persistence saga is the single
    // owner of the SET_CHANNEL write (persist + feed switch). A direct
    // setChannel call here would issue a duplicate write.
    appStore.dispatch(setUpdateChannel(value));
  }
</script>

<div id="updates" data-highlight-id="updates" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">
    {m.settings_section_updates()}
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    {#if show('update-channel')}
      <section data-slot="settings-section-body" class="px-6 py-4">
        <SettingsFieldRow
          id="settings-updateChannel-label-field"
          label={m.settings_updateChannel_label()}
          description={m.settings_updateChannel_description()}
        >
          <div class="w-45 flex-shrink-0">
            <Select.Root value={$updateChannel$} onchange={handleUpdateChannelChange}>
              <Select.Trigger aria-label={m.settings_updateChannel_ariaLabel()}>
                <span class="truncate">{updateChannelLabel}</span>
              </Select.Trigger>
              <Select.Content portal class="max-h-75 w-45">
                {#each updateChannelOptions as option (option.value)}
                  <Select.Item value={option.value}>
                    <span class="truncate">{option.label}</span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </SettingsFieldRow>
      </section>
    {/if}
    {#if show('share-update-statistics')}
      <section data-slot="settings-section-body" class="px-6 py-4">
        <SettingsFieldRow
          id="settings-shareUpdateStatistics-label-field"
          label={m.settings_shareUpdateStatistics_label()}
          description={m.settings_shareUpdateStatistics_description()}
          info={m.settings_shareUpdateStatistics_info()}
        >
          <Switch
            id="share-update-statistics-switch"
            size="sm"
            class="mb-auto"
            checked={$shareUpdateStatistics$}
            onCheckedChange={(enabled) => appStore.dispatch(setShareUpdateStatistics(enabled))}
            ariaLabel={m.settings_shareUpdateStatistics_label()}
          />
        </SettingsFieldRow>
      </section>
    {/if}
  </div>
</div>
