<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'mobile-pairing-qr',
    title: 'Mobile app pairing QR',
    defaultState: 'ready',
    states: { ready: { props: {} } },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { appClient, type AppSettingChange, type SettingDefinitionWithValue } from '$lib/client';
  import WebSocketApiSettings from './WebSocketApiSettings.svelte';

  let writes = $state<AppSettingChange[]>([]);
  const previous = {
    list: appClient.settings.list,
    update: appClient.settings.update,
    pairingInfo: appClient.server.pairingInfo,
    rotateToken: appClient.server.rotateToken,
  };
  const definitions = [
    { path: 'server.wsApi.enabled', value: true, type: 'boolean' },
    { path: 'server.wsApi.port', value: 5181, type: 'number' },
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'server',
    ...entry,
  })) as SettingDefinitionWithValue[];
  appClient.settings.list = async () => definitions;
  appClient.settings.update = async (changes) => {
    writes = [...writes, ...changes];
    return changes;
  };
  // Synthetic, non-authenticating pairing data only. No daemon or real tokens.
  appClient.server.pairingInfo = async () => ({
    token: 'preview-not-a-real-token',
    certFingerprint: 'AA:BB:CC',
    port: 5181,
    path: '/ws',
    localIps: ['192.0.2.10'],
    hostname: 'preview-device',
  });
  appClient.server.rotateToken = async () => ({ token: 'preview-rotated-not-a-real-token' });
  onDestroy(() => {
    appClient.settings.list = previous.list;
    appClient.settings.update = previous.update;
    appClient.server.pairingInfo = previous.pairingInfo;
    appClient.server.rotateToken = previous.rotateToken;
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-testid="mobile-pairing-qr">
  <WebSocketApiSettings />
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
