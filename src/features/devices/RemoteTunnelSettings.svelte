<script lang="ts">
  import { untrack } from 'svelte';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Button, Switch } from '$lib/components/patterns/settings/custom-controls';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { connectionTunnelRequested } from '$store/renderer/slices/connections/connections-slice';
  import {
    settingsFormOpened,
    settingsFormClosed,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsFormById,
    selectSettingsFormOperationById,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

  let {
    deviceId,
    connected,
    disabled = false,
    onConnect,
  }: {
    deviceId: string;
    connected: boolean;
    disabled?: boolean;
    onConnect: () => void;
  } = $props();

  const formId = $props.id();
  let identity = { formId, sessionId: '' };
  const form$ = selectSettingsFormById(formId);
  const load$ = selectSettingsFormOperationById(formId, 'load');
  const save$ = selectSettingsFormOperationById(formId, 'save');
  const loading = $derived(connected && (!$load$ || $load$.status === 'pending'));
  const saving = $derived($save$?.status === 'pending');
  const supported = $derived($form$?.values.supported === true);
  const enabled = $derived($form$?.values.enabled === true);
  let checked = $state(false);
  const error = $derived($save$?.error ?? $load$?.error ?? undefined);
  const unavailable = $derived(disabled || !connected || loading || saving || !supported);

  $effect(() => {
    if ($save$?.status !== 'pending') checked = enabled;
  });

  function load() {
    appStore.dispatch(
      connectionTunnelRequested(
        { ...identity, requestId: crypto.randomUUID(), resource: 'load' },
        { kind: 'load', id: deviceId },
      ),
    );
  }

  $effect(() => {
    const id = deviceId;
    if (!connected) return;
    const session = { formId, sessionId: crypto.randomUUID() };
    identity = session;
    appStore.dispatch(settingsFormOpened(session, 'connection-tunnel'));
    untrack(() => {
      appStore.dispatch(
        connectionTunnelRequested(
          { ...session, requestId: crypto.randomUUID(), resource: 'load' },
          { kind: 'load', id },
        ),
      );
    });
    return () => appStore.dispatch(settingsFormClosed(session));
  });

  function setEnabled(next: boolean) {
    if (unavailable) return;
    appStore.dispatch(
      connectionTunnelRequested(
        { ...identity, requestId: crypto.randomUUID(), resource: 'save' },
        { kind: 'set', id: deviceId, enabled: next },
      ),
    );
  }
</script>

{#if !connected || loading || error || supported}
  <SettingsFieldRow
    id={`device-${deviceId}-tunnel-field`}
    compact
    label={m.settings_tunnel_enable_label()}
    description={m.settings_tunnel_enable_description()}
    busy={loading || saving}
    {error}
    status={!connected
      ? m.settings_devices_statusDisconnected_label()
      : loading
        ? m.ui_spinner_loading_ariaLabel()
        : saving
          ? m.settings_wsApi_port_saving()
          : $save$?.status === 'succeeded'
            ? m.settings_listenTargets_saved()
            : undefined}
  >
    {#snippet control({ labelId, descriptionId, errorId })}
      <div class="flex items-center gap-3">
        <Switch
          size="sm"
          bind:checked
          onCheckedChange={setEnabled}
          disabled={unavailable}
          ariaLabelledby={labelId}
          ariaDescribedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        />
        {#if !connected}
          <Button type="button" variant="ghost" size="sm" {disabled} onclick={onConnect}>
            {m.settings_devices_connect_label()}
          </Button>
        {:else if $load$?.status === 'failed'}
          <Button type="button" variant="ghost" size="sm" {disabled} onclick={load}>
            {m.settings_devices_retry_label()}
          </Button>
        {/if}
      </div>
    {/snippet}
  </SettingsFieldRow>
{/if}
