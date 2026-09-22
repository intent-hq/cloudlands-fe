import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');

import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { FEATURE_CODES_CHANNELS } from '$shared/ipc/channels';
import {
  activateFeatureCodeRequested,
  deactivateFeatureRequested,
  featureCodesReducer,
  initialState,
  loadActiveFeaturesRequested,
  restartForFeatureCodesRequested,
  type FeatureCodesState,
} from '../feature-codes-slice';
import { featureCodesSaga } from './feature-codes-saga';

type Request = { channel: string; args: unknown[] };

const refreshedFeatures = ['remote-search', 'streaming-ui'];

function startSaga(seed: FeatureCodesState = initialState) {
  const channel = stdChannel();
  const requests: Request[] = [];
  let state: FeatureCodesState = seed;
  const taskDispatch = (action: { type: string; payload?: unknown }) => {
    state = featureCodesReducer(state, action as never);
    channel.put(action);
    return action;
  };
  const task = runSaga(
    {
      channel,
      dispatch: taskDispatch,
    },
    featureCodesSaga,
  );

  return { channel, requests, dispatch: taskDispatch, getState: () => state, task };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function stop(task: Task): Promise<void> {
  if (task.isRunning()) {
    task.cancel();
    await task.toPromise();
  }
}

function recordHandler<T>(
  requests: Request[],
  channel: string,
  response: T | (() => T | Promise<T>),
): void {
  registerMockIpcHandler(channel, (...args) => {
    requests.push({ channel, args });
    return typeof response === 'function' ? (response as () => T | Promise<T>)() : response;
  });
}

describe('featureCodesSaga production IPC paths', () => {
  beforeEach(() => resetMockIpcRouter());
  afterEach(() => resetMockIpcRouter());

  it('loads active features through get-active and applies the shaped response', async () => {
    const { requests, dispatch, getState, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.GET_ACTIVE, { features: refreshedFeatures });

    await settle();
    const action = loadActiveFeaturesRequested();
    dispatch(action);
    await settle();
    expect(requests).toEqual([{ channel: FEATURE_CODES_CHANNELS.GET_ACTIVE, args: [] }]);
    expect(getState().activeFeatures).toEqual(refreshedFeatures);
    expect(getState().operation).toMatchObject({ status: 'success', kind: 'load', result: null });
    await stop(task);
  });

  it('activates with the exact payload, refreshes, and records the protocol result', async () => {
    const code = 'feature-code-from-user';
    const { requests, dispatch, getState, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.ACTIVATE, { status: 'activated' });
    recordHandler(requests, FEATURE_CODES_CHANNELS.GET_ACTIVE, { features: refreshedFeatures });

    await settle();
    dispatch(activateFeatureCodeRequested(code));
    await settle();

    expect(requests).toEqual([
      { channel: FEATURE_CODES_CHANNELS.ACTIVATE, args: [{ code }] },
      { channel: FEATURE_CODES_CHANNELS.GET_ACTIVE, args: [] },
    ]);
    expect(getState().activeFeatures).toEqual(refreshedFeatures);
    expect(getState().operation).toMatchObject({
      status: 'success',
      kind: 'activate',
      result: 'activated',
    });
    await stop(task);
  });

  it('deactivates with the exact payload, refreshes, and applies the response', async () => {
    const featureId = 'feature-to-remove';
    const { requests, dispatch, getState, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.DEACTIVATE, { success: true });
    recordHandler(requests, FEATURE_CODES_CHANNELS.GET_ACTIVE, { features: refreshedFeatures });

    await settle();
    dispatch(deactivateFeatureRequested(featureId));
    await settle();

    expect(requests).toEqual([
      { channel: FEATURE_CODES_CHANNELS.DEACTIVATE, args: [{ featureId }] },
      { channel: FEATURE_CODES_CHANNELS.GET_ACTIVE, args: [] },
    ]);
    expect(getState().activeFeatures).toEqual(refreshedFeatures);
    expect(getState().operation).toMatchObject({
      status: 'success',
      kind: 'deactivate',
      result: 'deactivated',
    });
    await stop(task);
  });

  it('restarts through restart-app without inventing a response envelope', async () => {
    const { channel, requests, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.RESTART_APP, undefined);

    await settle();
    channel.put(restartForFeatureCodesRequested());
    await settle();

    expect(requests).toEqual([{ channel: FEATURE_CODES_CHANNELS.RESTART_APP, args: [] }]);
    await stop(task);
  });

  it('preserves active features when get-active rejects', async () => {
    const existingFeatures = ['already-enabled'];
    const { requests, dispatch, getState, task } = startSaga({
      ...initialState,
      activeFeatures: existingFeatures,
      initialized: true,
    });
    recordHandler(requests, FEATURE_CODES_CHANNELS.GET_ACTIVE, () => {
      throw new Error('daemon unavailable');
    });

    await settle();
    dispatch(loadActiveFeaturesRequested());
    await settle();

    expect(requests).toEqual([{ channel: FEATURE_CODES_CHANNELS.GET_ACTIVE, args: [] }]);
    expect(getState().activeFeatures).toEqual(existingFeatures);
    expect(getState().operation).toMatchObject({ status: 'success', kind: 'load' });
    await stop(task);
  });

  it('surfaces activation failure and does not refresh after the failed request', async () => {
    const { requests, dispatch, getState, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.ACTIVATE, () => {
      throw new Error('activation rejected');
    });

    await settle();
    dispatch(activateFeatureCodeRequested('bad-code'));
    await settle();

    expect(requests).toEqual([
      { channel: FEATURE_CODES_CHANNELS.ACTIVATE, args: [{ code: 'bad-code' }] },
    ]);
    expect(getState().operation).toMatchObject({
      status: 'error',
      kind: 'activate',
      error: 'activation rejected',
    });
    await stop(task);
  });

  it('surfaces an unsuccessful deactivation response and does not refresh', async () => {
    const { requests, dispatch, getState, task } = startSaga();
    recordHandler(requests, FEATURE_CODES_CHANNELS.DEACTIVATE, { success: false });

    await settle();
    dispatch(deactivateFeatureRequested('feature-that-cannot-be-removed'));
    await settle();

    expect(requests).toEqual([
      {
        channel: FEATURE_CODES_CHANNELS.DEACTIVATE,
        args: [{ featureId: 'feature-that-cannot-be-removed' }],
      },
    ]);
    expect(getState().operation.status).toBe('error');
    expect(getState().operation.kind).toBe('deactivate');
    expect(getState().operation.error).toEqual(expect.any(String));
    await stop(task);
  });

  it('reports restart failures through the saga task instead of masking the rejection', async () => {
    const errors: unknown[] = [];
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: (action: unknown) => {
          channel.put(action);
          return action;
        },
        onError: (error) => errors.push(error),
      },
      featureCodesSaga,
    );
    const requests: Request[] = [];
    recordHandler(requests, FEATURE_CODES_CHANNELS.RESTART_APP, () => {
      throw new Error('restart unavailable');
    });

    await settle();
    channel.put(restartForFeatureCodesRequested());
    await expect(task.toPromise()).rejects.toThrow('restart unavailable');
    expect(requests).toEqual([{ channel: FEATURE_CODES_CHANNELS.RESTART_APP, args: [] }]);
    expect(errors).toEqual([expect.objectContaining({ message: 'restart unavailable' })]);
  });
});
