import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appClient, type PushStatus } from '$lib/client';
import { store } from '$store/renderer/store';
import {
  settingsChanged,
  settingsFormClosed,
  settingsFormOpened,
} from '../../settings-events/settings-events-slice';
import { selectSettingsForm } from '../../settings-events/settings-events-selectors';
import { backendReconnected } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { pushSettingsRequested } from '../push-settings-slice';
import { PUSH_STATUS_REFRESH_MS, pushSettingsSaga } from './push-settings-saga';

const identity = { formId: 'push-refresh', sessionId: 'session' };
const status: PushStatus = {
  enabled: true,
  relayUrl: 'https://relay.example.invalid',
  daemonId: 'daemon',
  linked: true,
  linkedDevices: 0,
  publishing: false,
};
const original = appClient.push.status;
let calls: ReturnType<typeof vi.fn>;
let stop: () => void;
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  calls = vi.fn(async () => status);
  appClient.push.status = calls;
  dispose = store.init();
  stop = store.runSaga(pushSettingsSaga);
  store.dispatch(settingsFormOpened(identity, 'push'));
  store.dispatch(
    pushSettingsRequested({ ...identity, resource: 'load', requestId: 'first' }, { kind: 'load' }),
  );
});

afterEach(() => {
  store.dispatch(settingsFormClosed(identity));
  stop();
  dispose();
  appClient.push.status = original;
  vi.useRealTimers();
});

describe('push status while Settings → Mobile is open', () => {
  it('reloads on a timer, a relay setting change and a reconnect, then stops when the form closes', async () => {
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));

    status.linkedDevices = 2;
    status.publishing = true;
    await vi.advanceTimersByTimeAsync(PUSH_STATUS_REFRESH_MS);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(selectSettingsForm.select(store.state, identity)?.values.linkedDevices).toBe(2),
    );

    store.dispatch(settingsChanged([{ path: 'other.setting', value: true }]));
    store.dispatch(settingsChanged([{ path: 'push.relayEnabled', value: false }]));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(3));

    store.dispatch(backendReconnected());
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(4));

    store.dispatch(settingsFormClosed(identity));
    store.dispatch(settingsChanged([{ path: 'push.relayEnabled', value: true }]));
    await vi.advanceTimersByTimeAsync(PUSH_STATUS_REFRESH_MS * 2);
    expect(calls).toHaveBeenCalledTimes(4);
  });
});
