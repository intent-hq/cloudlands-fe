import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  setEnabled: vi.fn(),
  setService: vi.fn(),
  setModel: vi.fn(),
  saveKey: vi.fn(),
  clearKey: vi.fn(),
}));

vi.mock('$features/autocomplete/autocomplete-settings-service', () => ({
  loadAutocompleteSettings: mocks.load,
  setAutocompleteEnabled: mocks.setEnabled,
  setAutocompleteService: mocks.setService,
  setAutocompleteModel: mocks.setModel,
  saveAutocompleteApiKey: mocks.saveKey,
  clearAutocompleteApiKey: mocks.clearKey,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

import type { StoreState } from '../../../types';
import {
  autocompleteSettingsReducer,
  changeAutocompleteEnabled,
  changeAutocompleteModel,
  changeAutocompleteService,
  clearAutocompleteKey,
  initialState,
  saveAutocompleteKey,
} from '../autocomplete-settings-slice';
import { autocompleteSettingsSaga } from './autocomplete-settings-saga';

const snapshot = {
  available: true,
  enabled: false,
  service: 'kilo' as const,
  model: 'nvidia/nemotron-3.5-lightning' as const,
  keyConfigured: { kilo: false, openrouter: false },
};

function createHarness() {
  let state = { autocompleteSettings: structuredClone(initialState) } as StoreState;
  const input = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: Parameters<typeof autocompleteSettingsReducer>[1]) => {
    state = {
      ...state,
      autocompleteSettings: autocompleteSettingsReducer(state.autocompleteSettings, action),
    };
    input.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel: input, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    autocompleteSettingsSaga,
  );
  return { dispatch, getState: () => state.autocompleteSettings, task };
}

async function ready() {
  const harness = createHarness();
  await vi.waitFor(() => expect(harness.getState().isLoading).toBe(false));
  return harness;
}

describe('autocompleteSettingsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(snapshot);
    for (const fn of [mocks.setEnabled, mocks.setService, mocks.setModel, mocks.saveKey]) {
      fn.mockResolvedValue(undefined);
    }
    mocks.clearKey.mockResolvedValue(undefined);
  });

  it('hydrates from the daemon', async () => {
    const { getState, task } = await ready();
    expect(getState()).toMatchObject({ available: true, enabled: false, service: 'kilo' });
    task.cancel();
  });

  it('hides the section when the catalog cannot be read', async () => {
    mocks.load.mockRejectedValue(new Error('boom'));
    const { getState, task } = await ready();
    expect(getState()).toMatchObject({ available: false, enabled: false });
    task.cancel();
  });

  it('persists enabled and rolls back with an error on failure', async () => {
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteEnabled(true, true));
    await vi.waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
    expect(getState().enabled).toBe(true);

    mocks.setEnabled.mockRejectedValueOnce(new Error('nope'));
    dispatch(changeAutocompleteEnabled(false));
    await vi.waitFor(() => expect(getState().error).not.toBeNull());
    expect(getState().enabled).toBe(true);
    task.cancel();
  });

  it('persists service and model changes', async () => {
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteService('openrouter'));
    dispatch(changeAutocompleteModel('particle-ai/particle-1'));
    await vi.waitFor(() => expect(mocks.setModel).toHaveBeenCalledWith('particle-ai/particle-1'));
    expect(mocks.setService).toHaveBeenCalledWith('openrouter');
    expect(getState()).toMatchObject({ service: 'openrouter', model: 'particle-ai/particle-1' });
    task.cancel();
  });

  it('saves a key and enables only after the key is stored', async () => {
    mocks.load.mockResolvedValue({ ...snapshot, service: 'openrouter' });
    const { dispatch, getState, task } = await ready();
    dispatch(saveAutocompleteKey('openrouter', 'sk-or-1', true));
    await vi.waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
    expect(mocks.saveKey).toHaveBeenCalledWith('openrouter', 'sk-or-1');
    expect(mocks.saveKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setEnabled.mock.invocationCallOrder[0],
    );
    expect(getState()).toMatchObject({
      enabled: true,
      busyService: null,
      keyConfigured: { kilo: false, openrouter: true },
    });
    task.cancel();
  });

  it('does not enable when the key save fails', async () => {
    mocks.saveKey.mockRejectedValueOnce(new Error('nope'));
    const { dispatch, getState, task } = await ready();
    dispatch(saveAutocompleteKey('openrouter', 'sk-or-1', true));
    await vi.waitFor(() => expect(getState().error).not.toBeNull());
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(getState().enabled).toBe(false);
    task.cancel();
  });

  it('clears a key and turns off when asked', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: true,
      service: 'openrouter',
      keyConfigured: { kilo: false, openrouter: true },
    });
    const { dispatch, getState, task } = await ready();
    dispatch(clearAutocompleteKey('openrouter', true));
    await vi.waitFor(() => expect(getState().keyConfigured.openrouter).toBe(false));
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
    expect(getState()).toMatchObject({
      enabled: false,
      keyConfigured: { kilo: false, openrouter: false },
    });
    task.cancel();
  });

  it('turns autocomplete off before removing the active key, so no keyless request slips in', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: true,
      keyConfigured: { kilo: true, openrouter: false },
    });
    const { dispatch, getState, task } = await ready();
    dispatch(clearAutocompleteKey('kilo', true));
    await vi.waitFor(() => expect(mocks.clearKey).toHaveBeenCalledWith('kilo'));
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
    expect(mocks.setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearKey.mock.invocationCallOrder[0],
    );
    expect(getState()).toMatchObject({ enabled: false, keyConfigured: { kilo: false } });
    task.cancel();
  });

  it('keeps the key when turning off fails', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: true,
      keyConfigured: { kilo: true, openrouter: false },
    });
    mocks.setEnabled.mockRejectedValueOnce(new Error('nope'));
    const { dispatch, getState, task } = await ready();
    dispatch(clearAutocompleteKey('kilo', true));
    await vi.waitFor(() => expect(getState().error).not.toBeNull());
    expect(mocks.clearKey).not.toHaveBeenCalled();
    expect(getState()).toMatchObject({ enabled: true, keyConfigured: { kilo: true } });
    task.cancel();
  });

  it('turns off before switching to keyless Kilo', async () => {
    mocks.load.mockResolvedValue({ ...snapshot, enabled: true, service: 'openrouter' });
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteService('kilo'));
    await vi.waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('kilo'));
    expect(mocks.setEnabled).toHaveBeenCalledWith(false);
    expect(mocks.setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setService.mock.invocationCallOrder[0],
    );
    expect(getState()).toMatchObject({ enabled: false, service: 'kilo' });
    task.cancel();
  });

  it('keeps the old service when turning off fails', async () => {
    mocks.load.mockResolvedValue({ ...snapshot, enabled: true, service: 'openrouter' });
    mocks.setEnabled.mockRejectedValueOnce(new Error('nope'));
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteService('kilo'));
    await vi.waitFor(() => expect(getState().error).not.toBeNull());
    expect(mocks.setService).not.toHaveBeenCalled();
    expect(getState()).toMatchObject({ enabled: true, service: 'openrouter' });
    task.cancel();
  });

  it('never leaves keyless Kilo on when a failed switch-off overlaps a service change', async () => {
    mocks.load.mockResolvedValue({ ...snapshot, enabled: true, service: 'openrouter' });
    let rejectFirstOff: (error: Error) => void = () => {};
    mocks.setEnabled.mockImplementationOnce(
      () => new Promise<void>((_, reject) => (rejectFirstOff = reject)),
    );
    const { dispatch, getState, task } = await ready();
    const seen: Array<{ enabled: boolean; service: string }> = [];
    dispatch(changeAutocompleteEnabled(false));
    dispatch(changeAutocompleteService('kilo'));
    rejectFirstOff(new Error('nope'));
    await vi.waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('kilo'));
    seen.push(getState());
    expect(mocks.setEnabled).toHaveBeenCalledTimes(2);
    expect(mocks.setEnabled.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.setService.mock.invocationCallOrder[0],
    );
    expect(seen.every((s) => !(s.enabled && s.service === 'kilo'))).toBe(true);
    expect(getState()).toMatchObject({ enabled: false, service: 'kilo' });
    task.cancel();
  });

  it('switches to Kilo without turning off when a Kilo key is saved', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: true,
      service: 'openrouter',
      keyConfigured: { kilo: true, openrouter: true },
    });
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteService('kilo'));
    await vi.waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('kilo'));
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(getState()).toMatchObject({ enabled: true, service: 'kilo' });
    task.cancel();
  });

  it('refuses a queued enable once the service turned keyless without consent', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: false,
      service: 'openrouter',
      keyConfigured: { kilo: false, openrouter: true },
    });
    let finishSave: () => void = () => {};
    mocks.saveKey.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    const { dispatch, getState, task } = await ready();
    dispatch(saveAutocompleteKey('openrouter', 'sk-or-2', false));
    dispatch(changeAutocompleteService('kilo'));
    dispatch(changeAutocompleteEnabled(true));
    finishSave();
    await vi.waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('kilo'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.setEnabled).not.toHaveBeenCalledWith(true);
    expect(getState()).toMatchObject({ enabled: false, service: 'kilo' });
    task.cancel();
  });

  it('enables keyless Kilo only with explicit consent', async () => {
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteEnabled(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    dispatch(changeAutocompleteEnabled(true, true));
    await vi.waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
    expect(getState().enabled).toBe(true);
    task.cancel();
  });

  it('turns off before removing the active key even when removal was queued while off', async () => {
    mocks.load.mockResolvedValue({
      ...snapshot,
      enabled: false,
      service: 'openrouter',
      keyConfigured: { kilo: true, openrouter: true },
    });
    let finishService: () => void = () => {};
    mocks.setService.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishService = resolve)),
    );
    const { dispatch, getState, task } = await ready();
    dispatch(changeAutocompleteService('kilo'));
    dispatch(changeAutocompleteEnabled(true));
    dispatch(clearAutocompleteKey('kilo', false));
    finishService();
    await vi.waitFor(() => expect(mocks.clearKey).toHaveBeenCalledWith('kilo'));
    const enableCalls = mocks.setEnabled.mock.calls.map(([v]) => v);
    expect(enableCalls).toEqual([true, false]);
    expect(mocks.setEnabled.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.clearKey.mock.invocationCallOrder[0],
    );
    expect(getState()).toMatchObject({
      enabled: false,
      service: 'kilo',
      keyConfigured: { kilo: false },
    });
    task.cancel();
  });
});
