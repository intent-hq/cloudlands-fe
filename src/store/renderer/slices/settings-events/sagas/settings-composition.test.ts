import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { settingsHydrationSaga } from './settings-hydration-saga';
import {
  settingsFormOpened,
  settingsFormLoadRequested,
  settingsFormSaveRequested,
} from '../settings-events-slice';
import { selectSettingsForm, selectSettingsFormOperation } from '../settings-events-selectors';
import { websocketApiRequested } from '../../websocket-api/websocket-api-slice';
import { rtkSettingsRequested } from '../../rtk-settings/rtk-settings-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), probe: vi.fn() }));
vi.mock('$lib/client', () => {
  const client = { settings: { list: mocks.list, get: mocks.get, update: mocks.update } };
  return { appClient: client, localMachineClient: client };
});
vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.probe }));
vi.mock('$features/settings/settings-hydration-service', () => ({ applySettingsChanges: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

let stop: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([
    { path: 'server.wsApi.enabled', value: false },
    { path: 'server.wsApi.port', value: 5179 },
    { path: 'workspaceApi.toonOutput', value: true },
  ]);
  mocks.get.mockResolvedValue({ path: 'rtk.enabled', value: false });
  mocks.probe.mockResolvedValue({ data: { available: true } });
  mocks.update.mockImplementation(async (changes) => changes);
  store.init();
  stop = store.runSaga(settingsHydrationSaga);
});
afterEach(() => {
  stop();
  store.dispose();
});

it('composes one generic, API, and RTK owner with correlated selector outcomes', async () => {
  const api = { formId: 'api', sessionId: 'one' };
  const rtk = { formId: 'rtk', sessionId: 'one' };
  const form = { formId: 'workspace-api', sessionId: 'one' };
  const request = (identity: typeof api, resource: string) => ({
    ...identity,
    resource,
    requestId: resource,
  });
  store.dispatch(settingsFormOpened(api, 'websocket-api'));
  store.dispatch(settingsFormOpened(rtk, 'rtk'));
  store.dispatch(settingsFormOpened(form, 'workspace-api'));
  store.dispatch(
    websocketApiRequested(request(api, 'load'), {
      kind: 'load',
      connectionId: LOCAL_CONNECTION_ID,
    }),
  );
  store.dispatch(rtkSettingsRequested(request(rtk, 'load'), { kind: 'load' }));
  store.dispatch(settingsFormLoadRequested(request(form, 'load')));
  await vi.waitFor(() => {
    for (const identity of [api, rtk, form]) {
      expect(selectSettingsFormOperation.select(store.state, identity, 'load')?.status).toBe(
        'succeeded',
      );
    }
  });
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('rtk.enabled');
  expect(selectSettingsForm.select(store.state, rtk)?.values).toMatchObject({
    available: true,
    enabled: false,
  });
  store.dispatch(
    websocketApiRequested(request(api, 'save'), {
      kind: 'port',
      port: 6200,
      connectionId: LOCAL_CONNECTION_ID,
    }),
  );
  store.dispatch(rtkSettingsRequested(request(rtk, 'save'), { kind: 'toggle', enabled: true }));
  store.dispatch(
    settingsFormSaveRequested(request(form, 'workspaceApi.toonOutput'), [
      { path: 'workspaceApi.toonOutput', value: false },
    ]),
  );
  await vi.waitFor(() => {
    expect(selectSettingsFormOperation.select(store.state, api, 'save')?.status).toBe('succeeded');
    expect(selectSettingsFormOperation.select(store.state, rtk, 'save')?.status).toBe('succeeded');
    expect(
      selectSettingsFormOperation.select(store.state, form, 'workspaceApi.toonOutput')?.status,
    ).toBe('succeeded');
  });
  expect(mocks.update.mock.calls).toEqual([
    [[{ path: 'server.wsApi.port', value: 6200 }]],
    [[{ path: 'rtk.enabled', value: true }]],
    [[{ path: 'workspaceApi.toonOutput', value: false }]],
  ]);
  expect(selectSettingsForm.select(store.state, api)?.values.persistedPort).toBe(6200);
  expect(selectSettingsForm.select(store.state, rtk)?.values.enabled).toBe(true);
});
