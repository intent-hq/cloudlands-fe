<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import { formatGuestSessionLabel } from '$lib/utils/connection-label';
  import { selectWindowGuestSession } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import { selectCurrentConnection } from '$store/renderer/slices/connections/connections-selectors';
  import {
    selectPrincipalSnapshot,
    selectCollaborationCapabilities,
  } from '$store/renderer/slices/principal/principal-selectors';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import { selectSettingsFormOperationById } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { registerWebsocketCredentials } from '$features/settings/websocket-api-credentials';
  import type { HostRole } from '$shared/types/principal';
  import { selectPersonalDevices } from './personal-devices-selectors';
  import {
    personalPairingRequested,
    personalDevicesRefreshRequested,
  } from './personal-devices-slice';

  let { context }: { context: string } = $props();
  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const principal$ = selectPrincipalSnapshot();
  const connection$ = selectCurrentConnection();
  const invited$ = selectWindowGuestSession();
  const capabilities$ = selectCollaborationCapabilities();
  const clients$ = selectPersonalDevices();
  const pair$ = selectSettingsFormOperationById(identity.formId, 'pair');
  const copy$ = selectSettingsFormOperationById(identity.formId, 'copy');
  const roster$ = selectSettingsFormOperationById(identity.formId, 'roster');
  let qrDataUrl = $state('');
  let pairingUri = $state('');
  let open = $state(false);
  const principal = $derived($principal$?.principal);
  const person = $derived(principal?.displayName ?? principal?.login ?? principal?.id ?? '');
  const host = $derived(
    ($invited$
      ? formatGuestSessionLabel($invited$)
      : ($connection$?.label ?? $connection$?.host)) ?? '',
  );
  function roleLabel(role?: HostRole) {
    return role === 'owner'
      ? m.settings_personalDevices_owner_label()
      : role === 'member'
        ? m.settings_personalDevices_member_label()
        : m.settings_personalDevices_guest_label();
  }
  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous mount-scoped secret receiver; no API calls or asynchronous work.
    const unregister = registerWebsocketCredentials(
      identity.formId,
      identity.sessionId,
      (value) => {
        qrDataUrl = value.qrDataUrl;
        pairingUri = value.pairingUri ?? '';
      },
    );
    store.dispatch(settingsFormOpened(identity, 'personal-devices'));
    return () => {
      unregister();
      store.dispatch(settingsFormClosed(identity));
    };
  });
  function request(kind: 'pair' | 'copy') {
    store.dispatch(
      personalPairingRequested(
        { ...identity, resource: kind, requestId: crypto.randomUUID() },
        context,
        kind,
      ),
    );
  }
  function showPairing() {
    open = true;
    if (!pairingUri) request('pair');
  }
</script>

<section
  data-personal-devices-ready={$roster$?.status === 'succeeded'}
  class="space-y-4"
  aria-label={m.settings_personalDevices_title()}
>
  <SettingsFieldRow
    id={identity.formId}
    label={m.settings_personalDevices_title()}
    description={m.settings_personalDevices_identity_description({
      host,
      person,
      role: roleLabel(principal?.hostRole),
    })}
  >
    {#snippet control()}
      {#if $capabilities$.personalPairing}<Button onclick={showPairing}
          >{m.settings_personalDevices_pair_label()}</Button
        >{/if}
    {/snippet}
  </SettingsFieldRow>
  {#if $capabilities$.authenticatedDevices}
    <ListView
      items={$clients$}
      getKey={(client) => client.deviceKey}
      getText={(client) => client.prettyHostname ?? client.name ?? client.clientId}
      virtualize={false}
      ariaLabel={m.settings_personalDevices_roster_label()}
    >
      {#snippet row({ item })}
        <ListRow>
          {#snippet title()}{item.prettyHostname ??
              item.hostname ??
              item.name ??
              item.clientId}{/snippet}
          {#snippet description()}{item.displayName ?? item.login ?? item.principalId} · {roleLabel(
              item.hostRole,
            )} · {m.settings_personalDevices_connected_label()}{/snippet}
        </ListRow>
      {/snippet}
      {#snippet empty()}<p class="type-body text-muted-foreground">
          {m.settings_personalDevices_empty_label()}
        </p>{/snippet}
    </ListView>
    {#if $roster$?.error}<p role="alert" class="type-body text-danger">{$roster$.error}</p>{/if}
    <Button
      variant="ghost"
      disabled={$roster$?.status === 'pending'}
      onclick={() => store.dispatch(personalDevicesRefreshRequested())}
      >{m.settings_devices_retry_label()}</Button
    >
  {/if}
</section>

{#if open}
  <ContentDialog
    open
    title={m.settings_personalDevices_pair_label()}
    description={m.settings_personalDevices_identity_description({
      host,
      person,
      role: roleLabel(principal?.hostRole),
    })}
    closeLabel={m.settings_wsApi_close()}
    onClose={() => (open = false)}
    size="sm"
  >
    <p class="type-body text-muted-foreground">
      {m.settings_personalDevices_reusable_description()}
    </p>
    {#if qrDataUrl}<img
        src={qrDataUrl}
        alt={m.settings_wsApi_qrImageAlt()}
        width="544"
        height="544"
        class="h-auto w-full rounded-lg"
      />{/if}
    {#if $pair$?.error || $copy$?.error}<p role="alert" class="type-body text-danger">
        {$pair$?.error ?? $copy$?.error}
      </p>{/if}
    {#if $pair$?.status === 'pending'}<p role="status">{m.settings_devices_loading_label()}</p>{/if}
    {#snippet footer()}
      {#if !pairingUri}<Button
          disabled={$pair$?.status === 'pending'}
          onclick={() => request('pair')}>{m.settings_devices_retry_label()}</Button
        >{/if}
      <Button disabled={!pairingUri || $copy$?.status === 'pending'} onclick={() => request('copy')}
        >{$copy$?.status === 'succeeded'
          ? m.settings_personalDevices_copied_label()
          : m.settings_personalDevices_copy_label()}</Button
      >
      <Button variant="ghost" onclick={() => (open = false)}>{m.settings_wsApi_close()}</Button>
    {/snippet}
  </ContentDialog>
{/if}
