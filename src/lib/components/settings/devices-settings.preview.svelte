<script module lang="ts">
  // protocol-version-ok-file: fixture versions exercise behind-pin rendering, not protocol capability gates.
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import type { ConnectionsListResult } from '$shared/types/connections';
  import { setupUnavailablePublicationPreview } from '../../../test/connection-publication-preview';
  import { setupApiSettingsPreview } from '../../../test/api-rtk-settings-preview';
  import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
  import { installMockElectronBridge } from '../../../test/ct-mock-electron-bridge';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';

  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  function setup(remote = false, multiplayer = false) {
    const previousApi = window.electronAPI;
    const previousMultiplayer = appStore.state.userPreferences.labsMultiplayerEnabled;
    const state = appStore.state.connections;
    const previous: ConnectionsListResult = {
      connections: selectConnections.select(appStore.state),
      activeId: state.activeId,
      windowBackendId: state.windowBackendId,
      pinnedVersion: state.pinnedVersion,
      connectedIds: state.connectedIds,
    };
    appStore.dispatch(
      connectionsListReceived({
        activeId: remote ? 'studio' : 'local',
        windowBackendId: remote ? 'studio' : 'local',
        pinnedVersion: '0.9.1',
        connectedIds: ['local', 'studio'],
        connections: [
          {
            id: 'local',
            label: 'Local',
            host: '',
            port: 0,
            fingerprint: '',
            accent: null,
            isLocal: true,
            status: 'connected',
            intentdVersion: '6.8.0',
          },
          {
            id: 'studio',
            label: 'Studio Mac',
            host: 'studio.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: 'indigo',
            isLocal: false,
            status: 'connected',
            intentdVersion: '6.7.0',
            daemonVersion: '0.9.0',
            updateSupported: true,
          },
          {
            id: 'offline',
            label: 'Offline Mac',
            host: 'offline.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: 'emerald',
            isLocal: false,
            status: 'disconnected',
            intentdVersion: '6.6.0',
            daemonVersion: '0.9.0',
          },
          {
            id: 'unknown',
            label: 'Unknown version',
            host: 'unknown.invalid',
            port: 5181,
            fingerprint: 'fixture',
            accent: null,
            isLocal: false,
            status: 'connected',
            daemonVersion: '0.9.0',
          },
        ],
      }),
    );
    if (remote) {
      admitLegacyPrincipal();
      const state = withHostPrincipal(appStore.state).principal;
      const principal = { ...state.snapshot!.principal, displayName: 'Alex' };
      appStore.dispatch(
        principalReceived(
          {
            context: state.context!,
            invalidation: appStore.state.principal.invalidation,
            presentationVersion: appStore.state.principal.presentationVersion,
          },
          { ...state.snapshot!, principal },
        ),
      );
      installMockElectronBridge({
        'pairing.getSelfInfo': () => ({
          version: 1,
          uri: 'intent://pair?v=1&host=192.0.2.8&port=5181&fp=AB&token=preview-not-a-real-credential',
          hosts: ['192.0.2.8'],
          port: 5181,
          fingerprint: 'AB',
          token: 'preview-not-a-real-credential',
          principal,
        }),
      });
    }
    if (multiplayer) {
      admitLegacyPrincipal();
      appStore.dispatch(setLabsMultiplayerEnabled(true));
      const { context, invalidation, presentationVersion } = appStore.state.principal;
      appStore.dispatch(
        principalReceived(
          { context: context!, invalidation, presentationVersion },
          withHostPrincipal(appStore.state).principal.snapshot!,
        ),
      );
    }
    const stopPublication = setupUnavailablePublicationPreview();
    const stopApi = setupApiSettingsPreview();
    return () => {
      if (multiplayer) {
        appStore.dispatch(setLabsMultiplayerEnabled(previousMultiplayer));
        appStore.dispatch(principalContextChanged(null));
      }
      stopApi();
      stopPublication();
      window.electronAPI = previousApi;
      appStore.dispatch(connectionsListReceived(previous));
      if (remote) appStore.dispatch(principalContextChanged(null));
    };
  }

  export const preview = definePreview({
    id: 'devices-settings',
    title: 'Device settings',
    defaultState: 'versions',
    states: {
      versions: { props: {}, setup: () => setup() },
      'multiplayer-enabled': { props: {}, setup: () => setup(false, true) },
      'local-expanded': { props: { expanded: true }, setup: () => setup() },
      'remote-window': { props: {}, setup: () => setup(true) },
      'remote-expanded': { props: { expanded: true }, setup: () => setup(true) },
      'remote-access-disabled': { props: { accessEnabled: false }, setup: () => setup(true) },
      'access-disabled': { props: { accessEnabled: false }, setup: () => setup() },
      mobile: { props: { mobilePage: true }, setup: () => setup() },
      'mobile-disabled': {
        props: { mobilePage: true, accessEnabled: false },
        setup: () => setup(),
      },
      'mobile-remote': { props: { mobilePage: true }, setup: () => setup(true) },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { appClient, localMachineClient, type SettingDefinitionWithValue } from '$lib/client';
  import DevicesSettings from './DevicesSettings.svelte';
  import MobileSettings from '$features/settings/MobileSettings.svelte';

  let {
    expanded = false,
    accessEnabled = true,
    mobilePage = false,
  }: { expanded?: boolean; accessEnabled?: boolean; mobilePage?: boolean } = $props();
  const previous = {
    list: appClient.settings.list,
    update: appClient.settings.update,
    pairingInfo: appClient.server.pairingInfo,
    localList: localMachineClient.settings.list,
    localUpdate: localMachineClient.settings.update,
    localPairingInfo: localMachineClient.server.pairingInfo,
  };
  const definitions = [
    { path: 'server.wsApi.enabled', value: untrack(() => accessEnabled), type: 'boolean' },
    { path: 'server.wsApi.port', value: 5181, type: 'number' },
    { path: 'server.bindAddress', value: ['0.0.0.0'], type: 'string' },
    { path: 'server.tunnel.enabled', value: true, type: 'boolean' },
    { path: 'server.tunnel.only', value: false, type: 'boolean' },
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
  localMachineClient.settings.list = appClient.settings.list;
  localMachineClient.settings.update = appClient.settings.update;
  localMachineClient.server.pairingInfo = appClient.server.pairingInfo;
  onDestroy(() => {
    appClient.settings.list = previous.list;
    appClient.settings.update = previous.update;
    appClient.server.pairingInfo = previous.pairingInfo;
    localMachineClient.settings.list = previous.localList;
    localMachineClient.settings.update = previous.localUpdate;
    localMachineClient.server.pairingInfo = previous.localPairingInfo;
  });
</script>

<div class="bg-background p-4">
  {#if mobilePage}<MobileSettings />
  {:else}<DevicesSettings initialEditedMachine={expanded ? 'local' : undefined} />{/if}
</div>
