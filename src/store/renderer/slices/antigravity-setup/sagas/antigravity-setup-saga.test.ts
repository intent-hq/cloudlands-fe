import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { antigravitySetupSaga, antigravitySetupWorker } from './antigravity-setup-saga';
import {
  antigravitySetupReducer,
  antigravitySetupRequested,
  initialState,
  type AntigravitySetupState,
  type SetupCommand,
} from '../antigravity-setup-slice';
import { setProviderEnabled } from '../../provider-settings/provider-settings-slice';
import type { AntigravitySetupResult } from '$shared/types/antigravity-setup';

const mocks = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn(), models: vi.fn() }));
vi.mock('$features/antigravity/antigravity-setup.client', () => ({
  requestAntigravitySetup: mocks.request,
  closeAntigravitySetup: mocks.close,
}));
vi.mock('../../model/model-utils', () => ({ getModelsForProviderForLoadingState: mocks.models }));

const connected: AntigravitySetupResult = {
  ok: true,
  status: {
    operationId: 'one',
    supported: true,
    cliDetected: true,
    runtimeInstalled: true,
    phase: 'connected',
    modelCount: 1,
  },
};
const modelRows = { models: [{ value: 'gemini-test', label: 'Gemini test' }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue(connected);
  mocks.models.mockResolvedValue(modelRows);
});

async function worker(
  command: SetupCommand = 'start',
  generation = 1,
  stateGeneration = generation,
) {
  const dispatch = vi.fn();
  await runSaga(
    {
      dispatch,
      getState: () => ({
        antigravitySetup: { ...initialState, generation: stateGeneration, result: connected },
        providerModels: { clearEpoch: 0 },
      }),
    },
    antigravitySetupWorker,
    command,
    generation,
  ).toPromise();
  return dispatch.mock.calls.map(([action]) => action);
}

describe('guided setup saga', () => {
  it('refreshes Antigravity models, publishes readiness, and only enables Antigravity', async () => {
    const actions = await worker();
    expect(mocks.models).toHaveBeenCalledExactlyOnceWith('antigravity', { forceRefresh: true });
    expect(actions.filter((a) => a.type === setProviderEnabled.type)).toEqual([
      setProviderEnabled({ providerId: 'antigravity', enabled: true }),
    ]);
    expect(
      actions.some(
        (a) => a.type === 'providerModels/providerModelsLoaded' && a.payload[0] === 'antigravity',
      ),
    ).toBe(true);
    expect(
      actions.some((a) => /setActiveProvider|setAtomicDefaultModel|setModel/.test(a.type)),
    ).toBe(false);
  });
  it('never enables a provider during a passive status read', async () => {
    const actions = await worker('status');
    expect(mocks.models).not.toHaveBeenCalled();
    expect(actions.some((a) => a.type === setProviderEnabled.type)).toBe(false);
  });
  it.each(['signInRequired', 'cancelled', 'failed'] as const)(
    'does not enable after %s',
    async (phase) => {
      mocks.request.mockResolvedValue({
        ...connected,
        status: {
          ...(connected.ok ? connected.status : {}),
          phase,
          ...(phase === 'failed' ? { code: 'downloadFailed' } : {}),
        },
      });
      expect((await worker()).some((a) => a.type === setProviderEnabled.type)).toBe(false);
      expect(mocks.models).not.toHaveBeenCalled();
    },
  );
  it.each([
    { models: [] },
    { ...modelRows, stale: true },
    { ...modelRows, warning: 'fixture warning' },
  ])('rejects empty or degraded refreshed models: %j', async (models) => {
    mocks.models.mockResolvedValue(models);
    const actions = await worker();
    expect(actions.some((a) => a.type === setProviderEnabled.type)).toBe(false);
    expect(actions.at(-1).payload[1].status.code).toBe('modelsUnavailable');
  });
  it('rejects backend changes and superseded UI requests before enabling', async () => {
    mocks.request
      .mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ ok: false, code: 'backendChanged' });
    expect((await worker()).some((a) => a.type === setProviderEnabled.type)).toBe(false);
    mocks.request.mockResolvedValue(connected);
    expect((await worker('start', 1, 2)).some((a) => a.type === setProviderEnabled.type)).toBe(
      false,
    );
  });
  it('closes the private connection on cancel even before an operation ID arrives', async () => {
    const actions = await worker('cancel');
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(actions.some((a) => a.type === setProviderEnabled.type)).toBe(false);
  });
  function startSaga(dispatch = vi.fn()) {
    let state: AntigravitySetupState = initialState;
    const channel = stdChannel();
    const listeners = new Set<() => void>();
    const reduxStore = {
      getState: () => ({ antigravitySetup: state }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const task = runSaga(
      { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
      antigravitySetupSaga,
    );
    const send = (command: SetupCommand) => {
      const action = antigravitySetupRequested(command);
      state = antigravitySetupReducer(state, action);
      channel.put(action);
      for (const listener of listeners) listener();
    };
    return { task, send };
  }
  it('does not touch the private connection until something is requested', async () => {
    const { task } = startSaga();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('coalesces rapid clicks and cancels unfinished work on close', async () => {
    const dispatch = vi.fn();
    let finish!: (value: AntigravitySetupResult) => void;
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { task, send } = startSaga(dispatch);
    send('start');
    await Promise.resolve();
    await Promise.resolve();
    send('start');
    expect(mocks.request).toHaveBeenCalledOnce();
    send('close');
    await Promise.resolve();
    await Promise.resolve();
    finish(connected);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch.mock.calls.some(([a]) => a.type === setProviderEnabled.type)).toBe(false);
    task.cancel();
    await task.toPromise();
  });
});
