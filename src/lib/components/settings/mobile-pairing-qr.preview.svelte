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
  import type { AppSettingChange, SettingDefinitionWithValue } from '$lib/client';
  import { store as appStore } from '$store/renderer/store';
  import {
    getServerPairingInfoRequested,
    listSettingsRequested,
    rotateServerTokenRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import WebSocketApiSettings from './WebSocketApiSettings.svelte';

  let writes = $state<AppSettingChange[]>([]);
  const definitions = [
    { path: 'server.wsApi.enabled', value: true, type: 'boolean' },
    { path: 'server.wsApi.port', value: 5181, type: 'number' },
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'server',
    ...entry,
  })) as SettingDefinitionWithValue[];
  const pairingInfo = {
    token: 'preview-not-a-real-token',
    certFingerprint: 'AA:BB:CC',
    port: 5181,
    path: '/ws',
    localIps: ['192.0.2.10'],
    hostname: 'preview-device',
  };
  const originalDispatch = appStore.dispatch;
  Object.defineProperty(appStore, 'dispatch', {
    configurable: true,
    value: (action: Parameters<typeof originalDispatch>[0]) => {
      const result = originalDispatch(action);
      if (action.type === listSettingsRequested.type) {
        const request = action as ReturnType<typeof listSettingsRequested>;
        originalDispatch(request.success(definitions));
      } else if (action.type === updateSettingsRequested.type) {
        const request = action as ReturnType<typeof updateSettingsRequested>;
        const changes = request.payload[0];
        writes = [...writes, ...changes];
        originalDispatch(request.success(changes));
      } else if (action.type === getServerPairingInfoRequested.type) {
        const request = action as ReturnType<typeof getServerPairingInfoRequested>;
        originalDispatch(request.success(pairingInfo));
      } else if (action.type === rotateServerTokenRequested.type) {
        const request = action as ReturnType<typeof rotateServerTokenRequested>;
        originalDispatch(request.success({ token: 'preview-rotated-not-a-real-token' }));
      }
      return result;
    },
  });
  onDestroy(() => {
    Object.defineProperty(appStore, 'dispatch', { configurable: true, value: originalDispatch });
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground" data-testid="mobile-pairing-qr">
  <WebSocketApiSettings />
  <output data-testid="settings-writes" class="sr-only">{JSON.stringify(writes)}</output>
</div>
