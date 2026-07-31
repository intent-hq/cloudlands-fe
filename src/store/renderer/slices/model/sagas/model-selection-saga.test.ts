import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update: mocks.update } } }));

import { selectModel, setSelectedModel } from '../model-slice';
import {
  modelSelectionSaga,
  persistSelectedModelsWorker,
  handleSelectModel,
} from './model-selection-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state() {
  return {
    providerSettings: { activeProviderId: 'auggie' },
    providerCatalog: {
      providers: createCollection('id', [{ id: 'codex', canBeDisabled: true }]),
    },
    model: { providerModels: { auggie: 'sonnet4.5' } },
  };
}

describe('modelSelectionSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('switches a known compound provider before reload and selection', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('codex:gpt-5'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'providerSettings/setActiveProvider', payload: ['codex'] },
      { type: 'model/reloadModelsForProvider', payload: [] },
      {
        type: 'model/setSelectedModel',
        payload: [{ providerId: 'codex', model: 'codex:gpt-5' }],
      },
    ]);
  });

  it('does not switch for an unknown compound provider', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      handleSelectModel,
      selectModel('unknown:model'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'model/setSelectedModel',
        payload: [{ providerId: 'unknown', model: 'unknown:model' }],
      },
    ]);
  });

  it('persists the exact daemon settings path and current provider snapshot', async () => {
    mocks.update.mockResolvedValue([]);
    await runSaga({ dispatch: vi.fn(), getState: state }, persistSelectedModelsWorker).toPromise();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'sonnet4.5' } }]],
    ]);
  });

  it('serializes writes and retains only the latest queued snapshot', async () => {
    let release!: () => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const current = state();
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: () => current },
      modelSelectionSaga,
    );
    await settle();

    current.model.providerModels = { auggie: 'one' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'one' }));
    await settle();
    current.model.providerModels = { auggie: 'two' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'two' }));
    current.model.providerModels = { auggie: 'three' };
    channel.put(setSelectedModel({ providerId: 'auggie', model: 'three' }));
    release();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.providerDefaults', value: { auggie: 'one' } }]],
      [[{ path: 'model.providerDefaults', value: { auggie: 'three' } }]],
    ]);
    task.cancel();
    await task.toPromise();
  });
});
