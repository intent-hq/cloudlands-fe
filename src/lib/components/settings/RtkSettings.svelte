<script lang="ts">
  import { Button, IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
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

  import { onMount, tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormOperation,
    selectSettingsFormError,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { rtkSettingsRequested } from '$store/renderer/slices/rtk-settings/rtk-settings-slice';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';

  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const form$ = selectSettingsForm(identity);
  const save$ = selectSettingsFormOperation(identity, 'save');
  const probe$ = selectSettingsFormOperation(identity, 'probe');
  const error$ = selectSettingsFormError(identity);
  const rtkAvailable = $derived($form$?.values.available === true);
  let draftEnabled = $state<boolean | null>(null);
  const updating = $derived($save$?.status === 'pending');
  const rtkEnabled = $derived(draftEnabled ?? $form$?.values.enabled === true);
  const loaded = $derived($form$?.values.loaded === true);
  const settingKnown = $derived($form$?.values.settingKnown === true);
  const checking = $derived($probe$?.status === 'pending');
  const settingsError = $derived($error$);

  $effect(() => {
    if (!$save$ || $save$.status === 'pending' || draftEnabled === null) return;
    let active = true;
    // Show the controlled switch's optimistic frame even when a rejection is immediate.
    void tick().then(() => {
      if (active) draftEnabled = null;
    });
    return () => {
      active = false;
    };
  });

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'rtk'));
    appStore.dispatch(
      rtkSettingsRequested(
        { ...identity, resource: 'load', requestId: crypto.randomUUID() },
        { kind: 'load' },
      ),
    );
    return () => {
      appStore.dispatch(settingsFormClosed(identity));
    };
  });

  function recheckRtk() {
    if (checking) return;
    appStore.dispatch(
      rtkSettingsRequested(
        { ...identity, resource: 'probe', requestId: crypto.randomUUID() },
        { kind: 'probe' },
      ),
    );
  }

  function installRtk() {
    appStore.dispatch(
      rtkSettingsRequested(
        { ...identity, resource: 'install', requestId: crypto.randomUUID() },
        { kind: 'install' },
      ),
    );
  }

  function handleToggle(checked: boolean) {
    if (selectSettingsFormOperation.select(appStore.state, identity, 'save')?.status === 'pending')
      return;
    draftEnabled = checked;
    appStore.dispatch(
      rtkSettingsRequested(
        { ...identity, resource: 'save', requestId: crypto.randomUUID() },
        { kind: 'toggle', enabled: checked },
      ),
    );
  }

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'rtk',
          title: m.settings_rtk_label(),
          entries: [
            loaded && settingKnown
              ? {
                  kind: 'switch',
                  id: 'rtk-enabled',
                  label: m.settings_rtk_label(),
                  get: () => rtkEnabled,
                  set: handleToggle,
                  error: () => settingsError || undefined,
                  disabled: () => !rtkAvailable || updating,
                }
              : {
                  kind: 'custom',
                  id: 'rtk-enabled',
                  label: m.settings_rtk_label(),
                  busy: !loaded,
                  error: () => settingsError || undefined,
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
      {rtkAvailable ? m.settings_rtk_enabledDescription() : m.settings_rtk_notInstalled()}
      {#if !rtkAvailable}
        <Button
          variant="link"
          size="sm"
          type="button"
          class="h-auto px-0"
          onclick={recheckRtk}
          disabled={checking}
          >{checking ? m.settings_rtk_checking() : m.settings_rtk_checkAgain()}</Button
        >
      {/if}
    </span>
    {#if !rtkAvailable}
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
