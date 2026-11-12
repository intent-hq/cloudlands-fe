import { catalogNow } from '$lib/component-catalog/catalog-clock';
import { store } from '$store/renderer/store';
import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';

export function startOnPreviewMachine(
  id: string,
  name: string,
  state: RemoteMachineState,
  models: string[] = ['fixture-model'],
  codexStatus = 'ready',
): RemoteMachine {
  return {
    id,
    name,
    platform: { os: 'macos', arch: 'aarch64' },
    hosts: ['192.0.2.4'],
    port: 5179,
    fingerprint: `fp-${id}`,
    state,
    runningAgents: 0,
    capabilities: { providers: [{ id: 'codex', status: codexStatus, models }] },
    observedAt: new Date(catalogNow()).toISOString(),
    addedAt: '2026-11-01T00:00:00Z',
  };
}

/**
 * Labs on, a backend advertising remoteInitialAgent, and the scene's machines.
 * `remoteBackend` swaps the connection for a named remote backend; scenes that
 * need the preview's own admitted connection keep it.
 */
export function setupStartOnPreview(
  machines: RemoteMachine[],
  {
    remoteBackend = true,
    catalog = {},
  }: {
    remoteBackend?: boolean;
    /** Extra catalog fields (profiles, `defaultRemoteLaunch`). */
    catalog?: Partial<Parameters<typeof providerCatalogLoaded>[0]>;
  } = {},
) {
  const before = store.state;
  const previousLabs = before.userPreferences?.labsRemoteAgentsEnabled === true;
  const previousConnections = selectConnections.select(before);
  if (remoteBackend)
    store.dispatch(
      connectionsListReceived({
        connections: [
          {
            id: 'intent1',
            label: 'intent1',
            host: '192.0.2.1',
            port: 5179,
            fingerprint: 'AA:01',
            isLocal: false,
            status: 'connected',
            // The backend's own host.status platform: its row gets a subtitle too.
            hostOs: 'linux',
            hostArch: 'x86_64',
          },
        ],
        activeId: 'intent1',
        windowBackendId: 'intent1',
      }),
    );
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  // A catalog with remote-compatibility fields: the backend switches remote models.
  store.dispatch(
    providerCatalogLoaded({
      providers: selectProviderCatalogEntries.select(store.state),
      defaultRemoteIncompatibility: {},
      ...catalog,
    }),
  );
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      initialAgentPlacement: true,
      machines,
      localFingerprint: null,
      executorBackends: null,
    }),
  );
  return () => {
    store.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
    store.dispatch(backendReconnected());
    if (!remoteBackend) return;
    store.dispatch(
      connectionsListReceived({
        connections: previousConnections,
        activeId: before.connections.activeId,
        windowBackendId: before.connections.windowBackendId,
      }),
    );
  };
}
