<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
  import { setupApiSettingsPreview } from '../../../test/api-rtk-settings-preview';
  import { setupUnavailablePublicationPreview } from '../../../test/connection-publication-preview';

  interface Props {
    relayUrl?: string | null;
  }

  /** A connected (remote) backend this caller owns. */
  function connectRemote() {
    const state = appStore.state.connections;
    const previous = {
      connections: selectConnections.select(appStore.state),
      activeId: state.activeId,
      windowBackendId: state.windowBackendId,
    };
    appStore.dispatch(
      connectionsListReceived({
        activeId: 'studio',
        windowBackendId: 'studio',
        connections: [
          {
            id: 'local',
            label: 'Local',
            host: null,
            port: null,
            fingerprint: null,
            isLocal: true,
            status: 'connected',
          },
          {
            id: 'studio',
            label: 'Studio Mac',
            host: 'studio.invalid',
            port: 5181,
            fingerprint: 'fixture',
            isLocal: false,
            status: 'connected',
          },
        ],
      }),
    );
    admitLegacyPrincipal();
    const principal = withHostPrincipal(appStore.state).principal;
    appStore.dispatch(principalContextChanged(principal.context));
    appStore.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: appStore.state.principal.invalidation,
          presentationVersion: appStore.state.principal.presentationVersion,
        },
        principal.snapshot!,
      ),
    );
    return () => appStore.dispatch(connectionsListReceived(previous));
  }

  function setup(options: { remote?: boolean; linked?: boolean } = {}) {
    return () => {
      const stopPublication = setupUnavailablePublicationPreview();
      const stopApi = setupApiSettingsPreview();
      const stopRemote = options.remote ? connectRemote() : () => {};
      const hash = window.location.hash;
      if (options.linked) window.location.hash = '#tunnel-relay';
      return () => {
        if (options.linked) window.location.hash = hash;
        stopRemote();
        stopApi();
        stopPublication();
      };
    };
  }
  const state = (relayUrl: string | null, options?: { remote?: boolean; linked?: boolean }) => ({
    props: { relayUrl },
    setup: setup(options),
  });
  const RELAY = 'https://relay.example.com/derpmap.json';

  export const preview = definePreview<Props>({
    id: 'tunnel-relay',
    title: 'Relay (server.tunnel.derpUrl) in Settings → Advanced',
    defaultState: 'default-relays',
    states: {
      'default-relays': state(''),
      'self-hosted': state(RELAY),
      // A saved value the field would refuse: the error line under the field.
      invalid: state('relay.example.com'),
      // A daemon without the setting: no section.
      unsupported: state(null),
      // The connected backend's own relay; its cloud sandboxes use it.
      remote: state(RELAY, { remote: true }),
      // Opened the way the relay-unreachable card links to it: the field has focus.
      linked: state(RELAY, { linked: true }),
      'remote-linked': state(RELAY, { remote: true, linked: true }),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { appClient, type SettingDefinitionWithValue } from '$lib/client';
  import TunnelRelaySettings from './TunnelRelaySettings.svelte';

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
  <TunnelRelaySettings />
</div>
