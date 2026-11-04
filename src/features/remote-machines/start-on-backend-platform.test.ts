import { afterEach, beforeEach, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import { remoteMachinesLoaded } from './remote-machines-slice';
import { selectStartOnOptions } from './remote-machines-selectors';
import { START_ON_BACKEND } from './start-on';

const backend: ConnectionRecord = {
  id: 'intent1',
  label: 'intent1',
  host: '192.0.2.1',
  port: 5179,
  fingerprint: 'AA:01',
  isLocal: false,
  status: 'connected',
};

function seed(connection: ConnectionRecord) {
  store.dispatch(
    connectionsListReceived({
      connections: [connection],
      activeId: connection.id,
      windowBackendId: connection.id,
    }),
  );
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      initialAgentPlacement: true,
      localFingerprint: null,
      executorBackends: null,
      machines: [
        {
          id: 'd-mac',
          name: 'Mac Studio',
          platform: { os: 'macos', arch: 'aarch64' },
          hosts: [],
          port: 5179,
          fingerprint: 'BB:02',
          state: 'connected',
          runningAgents: 0,
          addedAt: '2026-11-01T00:00:00Z',
        },
      ],
    }),
  );
}

const backendRow = () =>
  selectStartOnOptions.select(store.state).find((option) => option.id === START_ON_BACKEND);

beforeEach(() => store.init());
afterEach(() => store.dispose());

it('subtitles the connected backend with its own host platform from the Machines capture', () => {
  seed({ ...backend, hostOs: 'linux', hostArch: 'x86_64' });
  expect(backendRow()).toMatchObject({ label: 'intent1', platform: 'Linux x86_64' });
});

it('shows no backend subtitle while its platform is unknown', () => {
  seed(backend);
  expect(backendRow()?.platform).toBeNull();
});
