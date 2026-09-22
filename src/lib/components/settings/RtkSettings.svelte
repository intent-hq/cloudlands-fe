<script lang="ts">
  /**
   * RTK Settings Component
   *
   * Allows users to enable/disable rtk command prefixing for agents.
   * The toggle is disabled when rtk is not installed on the system.
   *
   * The rtk.enabled flag is now daemon-backed (PROTOCOL §5.12) after Wave 1
   * merged intentd PR #190. The component reads/writes via settings.get/update
   * like other daemon-backed settings (e.g., AgentBackendSettings.svelte).
   */

  import { Button, IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectRtkChecking,
    selectRtkEnabled,
    selectRtkError,
    selectRtkRequirement,
    selectRtkSettingsLoaded,
    selectRtkUpdating,
  } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import {
    checkRtkRequested,
    initializeRtkSettings,
    installRtkRequested,
    updateRtkEnabledRequested,
  } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';

  const rtk$ = selectRtkRequirement();
  const rtkEnabled$ = selectRtkEnabled();
  const settingsLoaded$ = selectRtkSettingsLoaded();
  const checking$ = selectRtkChecking();
  const updating$ = selectRtkUpdating();
  const settingsError$ = selectRtkError();
  const loaded = $derived($settingsLoaded$ && $rtk$.checked);

  onMount(() => appStore.dispatch(initializeRtkSettings()));

  const recheckRtk = () => appStore.dispatch(checkRtkRequested());
  const installRtk = () => appStore.dispatch(installRtkRequested());
  const handleToggle = (checked: boolean) => {
    appStore.dispatch(updateRtkEnabledRequested(checked));
  };

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'rtk',
          title: m.settings_rtk_label(),
          entries: [
            loaded
              ? {
                  kind: 'switch',
                  id: 'rtk-enabled',
                  label: m.settings_rtk_label(),
                  get: () => $rtkEnabled$,
                  set: handleToggle,
                  error: () => $settingsError$ ?? undefined,
                  disabled: () => !$rtk$.available || $updating$,
                }
              : {
                  kind: 'custom',
                  id: 'rtk-enabled',
                  label: m.settings_rtk_label(),
                  busy: true,
                  error: () => $settingsError$ ?? undefined,
                },
          ],
        },
      ],
    }),
  );
</script>

{#snippet rtkDescription()}
  {#if !loaded}
    {m.ui_spinner_loading_ariaLabel()}
  {:else}
    <span class="block">
      {$rtk$.available ? m.settings_rtk_enabledDescription() : m.settings_rtk_notInstalled()}
      {#if !$rtk$.available}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-auto px-0"
          onclick={recheckRtk}
          disabled={$checking$}
          >{$checking$ ? m.settings_rtk_checking() : m.settings_rtk_checkAgain()}</Button
        >
      {/if}
    </span>
    {#if !$rtk$.available}
      <span class="block">
        {m.settings_rtk_installHint_before()}
        <Button variant="link" size="sm" type="button" class="h-auto px-0" onclick={installRtk}
          ><!-- i18n-ignore (shell command) -->brew install rtk</Button
        >
        {m.settings_rtk_installHint_orVisit()}
        <Button
          variant="link"
          size="sm"
          href="https://github.com/rtk-ai/rtk"
          target="_blank"
          rel="noopener noreferrer"
          class="h-auto px-0"><!-- i18n-ignore (URL) -->github.com/rtk-ai/rtk</Button
        >.
      </span>
    {/if}
  {/if}
{/snippet}

{#snippet loadingControl()}
  {#if !loaded}<IntentMarkLoader size={20} />{/if}
{/snippet}

<div data-rtk-settings class="min-w-0 w-full">
  <SettingsForm
    {schema}
    embedded
    compact={false}
    custom={defineSettingsCustomControls({ 'rtk-enabled': loadingControl })}
    descriptions={{ 'rtk-enabled': rtkDescription }}
  />
</div>
