<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ProviderCatalogEntry } from '$shared/provider-catalog';
  import {
    stageProviderToken,
    clearProviderTokenDrafts,
  } from '$features/settings/provider-token-drafts';
  import { store } from '$store/renderer/store';
  import {
    selectProviderAccessToken,
    selectProviderAccessTokenCapability,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    providerSettingsSessionOpened,
    providerSettingsSessionClosed,
    providerTokenReadRequested,
    providerTokenWriteRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import ProviderAccessTokenField from './ProviderAccessTokenField.svelte';

  let { provider }: { provider: ProviderCatalogEntry } = $props();
  const sessionId = crypto.randomUUID();
  const capability = $derived(selectProviderAccessTokenCapability(provider.id));
  const tokenState = $derived(selectProviderAccessToken(provider.id));
  onMount(() => {
    if (!$capability && provider.id !== 'claude-code' && provider.id !== 'codex') return;
    store.dispatch(providerSettingsSessionOpened(sessionId));
    store.dispatch(providerTokenReadRequested(provider.id));
    return () => store.dispatch(providerSettingsSessionClosed(sessionId));
  });
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous mount-owned secret cleanup, not domain I/O; drafts must stay outside Redux.
  onDestroy(() => clearProviderTokenDrafts(sessionId));

  function save(token: string) {
    const id = crypto.randomUUID();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- One-shot synchronous secret handoff to the saga; action history must not contain credentials.
    stageProviderToken(id, sessionId, token);
    store.dispatch(providerTokenWriteRequested(provider.id, 'save', { id, sessionId }));
  }
</script>

{#if $capability || provider.id === 'claude-code' || provider.id === 'codex'}
  <ProviderAccessTokenField
    providerId={provider.id}
    configured={$tokenState?.configured}
    status={$capability ? ($tokenState?.status ?? 'loading') : 'unavailable'}
    busy={$tokenState?.busy}
    failed={$tokenState?.failed}
    onSave={save}
    onRemove={() =>
      store.dispatch(
        providerTokenWriteRequested(provider.id, 'remove', { id: crypto.randomUUID(), sessionId }),
      )}
    onRetry={() => store.dispatch(providerTokenReadRequested(provider.id))}
  />
{/if}
