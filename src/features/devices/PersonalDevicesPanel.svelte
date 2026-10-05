<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { SettingsForm, defineSettings } from '$lib/components/patterns/settings';
  import Fa from 'svelte-fa';
  import { faCopy, faQrcode } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { store } from '$store/renderer/store';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import { selectSettingsFormOperationById } from '$store/renderer/slices/settings-events/settings-events-selectors';
  import { registerWebsocketCredentials } from '$features/settings/websocket-api-credentials';
  import { personalPairingRequested } from './personal-devices-slice';

  let { context }: { context: string } = $props();
  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const pair$ = selectSettingsFormOperationById(identity.formId, 'pair');
  const copy$ = selectSettingsFormOperationById(identity.formId, 'copy');
  let qrDataUrl = $state('');
  let open = $state(false);
  const busy = $derived($pair$?.status === 'pending' || $copy$?.status === 'pending');
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'intent-mobile',
          title: m.settings_devices_mobile_title(),
          description: m.settings_personalDevices_mobile_description(),
          entries: [
            {
              kind: 'custom',
              id: 'personal-pairing',
              label: m.settings_devices_mobile_title(),
              layout: 'full-width',
            },
          ],
        },
      ],
    }),
  );
  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous mount-scoped secret receiver; no API calls or asynchronous work.
    const unregister = registerWebsocketCredentials(
      identity.formId,
      identity.sessionId,
      (value) => {
        qrDataUrl = value.qrDataUrl;
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
    if (!qrDataUrl) request('pair');
  }
</script>

<div data-personal-devices-ready="true">
  <SettingsForm {schema} compact={false} custom={{ 'personal-pairing': pairingControls }} />
</div>

{#snippet pairingControls()}
  <div class="space-y-3">
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" disabled={busy} onclick={showPairing}>
        <Fa icon={faQrcode} size="sm" />{m.settings_wsApi_showQrCode()}
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onclick={() => request('copy')}>
        <Fa icon={faCopy} size="sm" />{$copy$?.status === 'succeeded'
          ? m.settings_personalDevices_copied_label()
          : m.settings_personalDevices_copy_label()}
      </Button>
    </div>
    {#if $copy$?.error}<p role="alert" class="type-body text-danger">{$copy$.error}</p>{/if}
    {#if $copy$?.status === 'pending'}<p role="status">{m.settings_devices_loading_label()}</p>{/if}
  </div>
{/snippet}

{#if open}
  <ContentDialog
    open
    title={m.settings_devices_mobile_title()}
    description={m.settings_personalDevices_mobile_description()}
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
    {#if $pair$?.error}<p role="alert" class="type-body text-danger">
        {$pair$.error}
      </p>{/if}
    {#if $pair$?.status === 'pending'}<p role="status">{m.settings_devices_loading_label()}</p>{/if}
    {#snippet footer()}
      {#if !qrDataUrl}<Button
          disabled={$pair$?.status === 'pending'}
          onclick={() => request('pair')}>{m.settings_devices_retry_label()}</Button
        >{/if}
      <Button variant="ghost" onclick={() => (open = false)}>{m.settings_wsApi_close()}</Button>
    {/snippet}
  </ContentDialog>
{/if}
