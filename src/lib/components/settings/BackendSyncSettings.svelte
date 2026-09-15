<script lang="ts">
  /**
   * Backend Sync Settings (T4)
   *
   * Opt-in toggle for syncing remote backend connections via iCloud Keychain,
   * plus the current availability status. macOS-only: elsewhere the toggle
   * renders disabled with a short explanation (`supported` comes from main —
   * the renderer never sniffs the platform itself).
   *
   * The pref is per-machine (local prefs, default OFF). Disabling stops
   * push/pull but never removes existing keychain items. Availability is
   * refreshed live by the `connections:sync-status-changed` push, which the
   * connections saga folds into the store.
   */

  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import { store as appStore } from '$store/renderer/store';
  import { selectKeychainSyncState } from '$store/renderer/slices/connections/connections-selectors';
  import {
    loadKeychainSyncStateRequested,
    setKeychainSyncEnabledRequested,
  } from '$store/renderer/slices/connections/connections-slice';

  const syncState$ = selectKeychainSyncState();

  // Bound to the Switch rather than derived: the Switch owns its own checked
  // state once clicked, so a rejected write must be pushed back into it
  // explicitly or the toggle would sit in a state main never accepted.
  let toggleOn = $state(false);
  let writing = $state(false);
  let loadFailed = $state(false);
  let saveFailed = $state(false);

  const supported = $derived($syncState$?.supported ?? false);
  const enabled = $derived($syncState$?.enabled ?? false);
  const status = $derived($syncState$?.status ?? null);
  const loaded = $derived($syncState$ !== null);

  // Follow the store-acknowledged pref while no write is in flight (covers
  // hydration and settled writes; a failed write also lands back here).
  $effect(() => {
    if (!writing) toggleOn = enabled;
  });

  onMount(async () => {
    try {
      await appStore.dispatch(loadKeychainSyncStateRequested()).promise;
      loadFailed = false;
    } catch {
      loadFailed = true;
    }
  });

  async function handleToggle(checked: boolean) {
    writing = true;
    saveFailed = false;
    try {
      await appStore.dispatch(setKeychainSyncEnabledRequested(checked)).promise;
    } catch {
      saveFailed = true;
    } finally {
      writing = false;
      toggleOn = selectKeychainSyncState.select(appStore.state)?.enabled ?? false;
    }
  }

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'backend-sync',
          title: m.settings_backendSync_toggle_label(),
          entries: [
            {
              kind: 'switch',
              id: 'backend-sync',
              label: m.settings_backendSync_toggle_label(),
              get: () => toggleOn,
              set: handleToggle,
              error: () =>
                loadFailed
                  ? m.settings_backendSync_loadError()
                  : saveFailed
                    ? m.settings_backendSync_saveError()
                    : undefined,
              disabled: () => !supported || !loaded || writing,
              class: 'py-0 first:pt-0 last:pb-0',
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet syncDescription()}
  <span class="block">{m.settings_backendSync_toggle_description()}</span>
  {#if !supported && loaded}
    <span class="block">{m.settings_backendSync_unsupported_description()}</span>
  {/if}
  {#if supported && enabled}
    {#if status === null}
      <span class="block">{m.settings_backendSync_status_checking()}</span>
    {:else if status.state === 'active'}
      <span class="block text-success">{m.settings_backendSync_status_active()}</span>
      {#if status.errorCount}
        <span class="block text-warning-ink">{m.settings_backendSync_status_degraded()}</span>
      {/if}
    {:else}
      <span class="block text-warning-ink">{m.settings_backendSync_status_unavailable()}</span>
      {#if status.message}
        <!-- Helper-reported diagnostic detail; wire content, not translated. -->
        <!-- i18n-ignore (main-process diagnostic message) -->
        <span class="block">{status.message}</span>
      {/if}
    {/if}
  {/if}
{/snippet}

<SettingsForm {schema} embedded descriptions={{ 'backend-sync': syncDescription }} />
