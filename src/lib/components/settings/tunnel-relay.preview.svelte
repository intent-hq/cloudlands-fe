<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupApiSettingsPreview } from '../../../test/api-rtk-settings-preview';
  import { setupUnavailablePublicationPreview } from '../../../test/connection-publication-preview';

  interface Props {
    relayUrl?: string | null;
  }

  function setup() {
    const stopPublication = setupUnavailablePublicationPreview();
    const stopApi = setupApiSettingsPreview();
    return () => {
      stopApi();
      stopPublication();
    };
  }
  const state = (relayUrl: string | null) => ({ props: { relayUrl }, setup });

  export const preview = definePreview<Props>({
    id: 'tunnel-relay',
    title: 'Tailcat tunnel relay (server.tunnel.derpUrl) in Advanced',
    defaultState: 'default-relays',
    states: {
      'default-relays': state(''),
      'self-hosted': state('https://relay.example.com/derpmap.json'),
      // A saved value the field would refuse: the error line under the field.
      invalid: state('relay.example.com'),
      // A daemon without the setting: no Relay field.
      unsupported: state(null),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { appClient, type SettingDefinitionWithValue } from '$lib/client';
  import WebSocketApiSettings from './WebSocketApiSettings.svelte';

  let { relayUrl = '' }: Props = $props();
  const previous = {
    list: appClient.settings.list,
    update: appClient.settings.update,
    pairingInfo: appClient.server.pairingInfo,
  };
  const relay = untrack(() => relayUrl);
  const definitions = [
    { path: 'server.wsApi.enabled', value: true, type: 'boolean' },
    { path: 'server.wsApi.port', value: 5181, type: 'number' },
    { path: 'server.bindAddress', value: ['127.0.0.1'], type: 'string' },
    { path: 'server.tunnel.enabled', value: true, type: 'boolean' },
    { path: 'server.tunnel.only', value: false, type: 'boolean' },
    ...(relay === null ? [] : [{ path: 'server.tunnel.derpUrl', value: relay, type: 'string' }]),
  ].map((entry) => ({
    label: entry.path,
    description: '',
    category: 'server',
    ...entry,
  })) as SettingDefinitionWithValue[];
  appClient.settings.list = async () => definitions;
  appClient.settings.update = async (changes) => {
    for (const change of changes) {
      const entry = definitions.find((entry) => entry.path === change.path);
      if (entry) entry.value = change.value;
    }
    return changes;
  };
  // Synthetic pairing data; this preview never reads a real machine's credentials.
  appClient.server.pairingInfo = async () => ({
    token: 'preview-not-a-real-token',
    certFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33',
    port: 5181,
    path: '/ws',
    localIps: ['192.0.2.10'],
    availableIps: ['192.0.2.10'],
    hostname: 'preview-device',
    tcAddress: 'preview-tailcat-address',
  });
  onDestroy(() => {
    appClient.settings.list = previous.list;
    appClient.settings.update = previous.update;
    appClient.server.pairingInfo = previous.pairingInfo;
  });
</script>

<div class="w-full min-w-0 bg-background p-6 text-foreground">
  <WebSocketApiSettings advancedOpen />
</div>
