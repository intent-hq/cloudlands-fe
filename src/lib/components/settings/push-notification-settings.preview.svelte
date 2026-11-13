<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    setupApiSettingsPreview,
    setupPushSettingsPreview,
  } from '../../../test/api-rtk-settings-preview';
  import { setupUnavailablePublicationPreview } from '../../../test/connection-publication-preview';

  type Scenario =
    'off' | 'sending' | 'not-linked' | 'paused' | 'error' | 'save-error' | 'saving' | 'page';

  function setupPage() {
    const stops = [
      setupUnavailablePublicationPreview(),
      setupApiSettingsPreview(),
      setupPushSettingsPreview(),
    ];
    return () => stops.forEach((stop) => stop());
  }

  const previewState = (scenario: Scenario) => ({
    props: { scenario },
    setup: scenario === 'page' ? setupPage : setupPushSettingsPreview,
  });

  export const preview = definePreview<{ scenario?: Scenario }>({
    id: 'push-notification-settings',
    title: 'Push notification settings',
    defaultState: 'sending',
    states: {
      off: previewState('off'),
      sending: previewState('sending'),
      'not-linked': previewState('not-linked'),
      paused: previewState('paused'),
      error: previewState('error'),
      'save-error': previewState('save-error'),
      saving: previewState('saving'),
      page: previewState('page'),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import {
    appClient,
    type AppSettingChange,
    type PushStatus,
    type SettingDefinitionWithValue,
  } from '$lib/client';
  import PushNotificationSettings from './PushNotificationSettings.svelte';
  import WebSocketApiSettings from './WebSocketApiSettings.svelte';

  let { scenario = 'sending' }: { scenario?: Scenario } = $props();
  const initial = untrack(() => scenario);
  let writes = $state<AppSettingChange[]>([]);
  const off: PushStatus = {
    enabled: false,
    relayUrl: 'https://relay.example.invalid',
    daemonId: null,
    linked: false,
    linkedDevices: null,
    publishing: false,
  };
  const statuses: Record<Scenario, PushStatus> = {
    off,
    'save-error': off,
    saving: off,
    sending: {
      ...off,
      enabled: true,
      daemonId: 'preview',
      linked: true,
      linkedDevices: 2,
      publishing: true,
    },
    page: {
      ...off,
      enabled: true,
      daemonId: 'preview',
      linked: true,
      linkedDevices: 2,
      publishing: true,
    },
    'not-linked': { ...off, enabled: true, daemonId: 'preview' },
    paused: { ...off, enabled: true, daemonId: 'preview', linked: true, linkedDevices: 0 },
    error: off,
  };
  const previous = {
    status: appClient.push.status,
    list: appClient.settings.list,
    update: appClient.settings.update,
    pairingInfo: appClient.server.pairingInfo,
  };
  appClient.push.status = async () => {
    if (initial === 'error') throw new Error('preview');
    return statuses[initial];
  };
  appClient.settings.list = async () =>
    [
      { path: 'server.wsApi.enabled', value: true, type: 'boolean' },
      { path: 'server.wsApi.port', value: 5181, type: 'number' },
    ].map((entry) => ({
      label: entry.path,
      description: '',
      category: 'server',
      ...entry,
    })) as SettingDefinitionWithValue[];
  appClient.settings.update = async (changes) => {
    writes = [...writes, ...changes];
    if (initial === 'saving') await new Promise(() => {});
    if (initial === 'save-error') throw new Error('preview');
    return changes;
  };
  // Synthetic, non-authenticating pairing data only.
  appClient.server.pairingInfo = async () => ({
    token: 'preview-not-a-real-token',
    certFingerprint: 'AA:BB:CC',
    port: 5181,
    path: '/ws',
    localIps: ['192.0.2.10'],
    hostname: 'preview-device',
  });
  let root: HTMLDivElement;
  onMount(async () => {
    if (initial !== 'saving' && initial !== 'save-error') return;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const toggle = root.querySelector<HTMLButtonElement>(
        '[data-push-settings] [role="switch"]:not([disabled])',
      );
      if (toggle) return toggle.click();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  onDestroy(() => {
    appClient.push.status = previous.status;
    appClient.settings.list = previous.list;
    appClient.settings.update = previous.update;
    appClient.server.pairingInfo = previous.pairingInfo;
  });
</script>

<div
  bind:this={root}
  class="w-full min-w-0 space-y-6 bg-background p-6 text-foreground"
  data-testid="push-notification-settings"
>
  {#if initial === 'page'}<WebSocketApiSettings />{/if}
  <PushNotificationSettings />
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
