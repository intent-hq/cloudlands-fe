import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { update: mocks.update } } }));

import {
  hydrateSettings,
  setDefaultModel,
  setTypeOverride,
  backgroundSettingsHydrationRequested,
  backgroundAgentSettingsReducer,
  initialState,
  BG_MODEL_MIGRATION_MARKER_KEY,
} from '../background-agent-settings-slice';
import { backgroundAgentSettingsSaga } from './background-agent-settings-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state() {
  return {
    backgroundAgentSettings: {
      defaultModel: 'sonnet4.5',
      typeOverrides: { commit: '', pr: '', review: '', fast: '' },
    },
  };
}

describe('backgroundAgentSettingsSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders migration behind an active user write without replacing a newer queued pick', async () => {
    let release!: () => void;
    let state = { backgroundAgentSettings: initialState };
    const channel = stdChannel();
    const dispatch = (action: { type: string }) => {
      state = {
        backgroundAgentSettings: backgroundAgentSettingsReducer(
          state.backgroundAgentSettings,
          action as never,
        ),
      };
      channel.put(action);
    };
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    mocks.update
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const task = runSaga({ channel, dispatch, getState: () => state }, backgroundAgentSettingsSaga);
    dispatch(setDefaultModel('first'));
    dispatch(setDefaultModel('newest'));
    dispatch(
      backgroundSettingsHydrationRequested({
        defaultModel: 'haiku4.5',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    expect(state.backgroundAgentSettings.defaultModel).toBe('newest');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith(BG_MODEL_MIGRATION_MARKER_KEY, '1');
    release();
    await settle();
    expect(mocks.update.mock.calls.map(([changes]) => changes[0])).toEqual([
      { path: 'quickActions.defaultModel', value: 'first' },
      { path: 'quickActions.defaultModel', value: 'newest' },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('atomically serializes current snapshots and retains only the latest queued write', async () => {
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
      backgroundAgentSettingsSaga,
    );
    current.backgroundAgentSettings.defaultModel = 'opus4.7';
    channel.put(setDefaultModel('opus4.7'));
    await settle();
    current.backgroundAgentSettings.typeOverrides.commit = 'haiku4.5';
    channel.put(setTypeOverride({ type: 'commit', model: 'haiku4.5' }));
    current.backgroundAgentSettings.typeOverrides.fast = 'gpt-5';
    channel.put(setTypeOverride({ type: 'fast', model: 'gpt-5' }));
    release();
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [
        [
          { path: 'quickActions.defaultModel', value: 'opus4.7' },
          {
            path: 'quickActions.typeOverrides',
            value: { commit: '', pr: '', review: '', fast: '' },
          },
        ],
      ],
      [
        [
          { path: 'quickActions.defaultModel', value: 'opus4.7' },
          {
            path: 'quickActions.typeOverrides',
            value: { commit: 'haiku4.5', pr: '', review: '', fast: 'gpt-5' },
          },
        ],
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not echo hydration snapshots back to settings.update', async () => {
    const channel = stdChannel();
    const task = runSaga(
      { channel, dispatch: vi.fn(), getState: state },
      backgroundAgentSettingsSaga,
    );
    channel.put(
      hydrateSettings({
        defaultModel: 'hydrated',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});
