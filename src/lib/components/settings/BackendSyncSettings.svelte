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
  import { Toggle } from '$lib/components/ui/toggle';
  import { store as appStore } from '$store/renderer/store';
  import { selectKeychainSyncState } from '$store/renderer/slices/connections/connections-selectors';
  import {
    loadKeychainSyncStateRequested,
    setKeychainSyncEnabledRequested,
  } from '$store/renderer/slices/connections/connections-slice';

  const syncState$ = selectKeychainSyncState();

  // Bound to the Toggle rather than derived: the Toggle owns its own pressed
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
</script>

<div class="flex items-start justify-between gap-4">
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground">
      {m.settings_backendSync_toggle_label()}
    </p>
    <p class="text-xs text-subtle mt-0.5">
      {m.settings_backendSync_toggle_description()}
    </p>
    {#if !supported && loaded}
      <p class="text-xs text-subtle mt-0.5">
        {m.settings_backendSync_unsupported_description()}
      </p>
    {/if}
    {#if loadFailed}
      <p class="text-xs text-destructive mt-0.5">{m.settings_backendSync_loadError()}</p>
    {:else if saveFailed}
      <p class="text-xs text-destructive mt-0.5">{m.settings_backendSync_saveError()}</p>
    {/if}
    {#if supported && enabled}
      {#if status === null}
        <p class="text-xs text-subtle mt-1">{m.settings_backendSync_status_checking()}</p>
      {:else if status.state === 'active'}
        <p class="text-xs text-success mt-1">{m.settings_backendSync_status_active()}</p>
        {#if status.errorCount}
          <p class="text-xs text-warning mt-0.5">{m.settings_backendSync_status_degraded()}</p>
        {/if}
      {:else}
        <p class="text-xs text-warning mt-1">
          {m.settings_backendSync_status_unavailable()}
        </p>
        {#if status.message}
          <!-- Helper-reported diagnostic detail; wire content, not translated. -->
          <!-- i18n-ignore (main-process diagnostic message) -->
          <p class="text-xs text-subtle mt-0.5">{status.message}</p>
        {/if}
      {/if}
    {/if}
  </div>
  <div class="shrink-0">
    <Toggle
      bind:pressed={toggleOn}
      onChange={(pressed) => handleToggle(pressed === true)}
      disabled={!supported || !loaded || writing}
      size="xs"
      ariaLabel={m.settings_backendSync_toggle_label()}
    />
  </div>
</div>
