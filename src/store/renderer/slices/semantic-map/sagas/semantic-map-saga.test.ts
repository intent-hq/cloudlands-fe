import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), activity: vi.fn(), route: vi.fn() }));
vi.mock('$lib/components/visualization/semantic-map/core/client', () => ({
  SemanticMapClient: class {
    get = mocks.get;
    activity = mocks.activity;
    route = mocks.route;
  },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

import {
  SEMANTIC_MAP_FIXTURE_ACTIVITIES,
  SEMANTIC_MAP_FIXTURE_MANIFEST,
  SEMANTIC_MAP_FIXTURE_ROUTE,
} from '$lib/components/visualization/semantic-map/core/fixtures';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { applyNoteCreated } from '../../workspace-notes/workspace-notes-slice';
import {
  initialState,
  semanticMapReducer,
  semanticMapSelectedAgentChanged,
} from '../semantic-map-slice';
import { semanticMapSaga } from './semantic-map-saga';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function createHarness() {
  const channel = stdChannel();
  const actions: unknown[] = [];
  let semanticMap = initialState;
  const reduce = (action: unknown) => {
    semanticMap = semanticMapReducer(semanticMap, action as never);
  };
  const dispatch = (action: unknown) => {
    actions.push(action);
    reduce(action);
    channel.put(action as never);
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ semanticMap }) as never },
    semanticMapSaga,
  );
  return {
    dispatch,
    actions,
    state: () => semanticMap.byWorkspaceId['ws-1'],
    stop: async () => {
      task.cancel();
      await task.toPromise();
    },
  };
}

describe('semanticMapSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
    });
    mocks.activity.mockResolvedValue(SEMANTIC_MAP_FIXTURE_ACTIVITIES);
    mocks.route.mockResolvedValue(SEMANTIC_MAP_FIXTURE_ROUTE);
  });

  it('hydrates manifest and recent activity, then refreshes a tagged manifest', async () => {
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();

    expect(mocks.get).toHaveBeenCalledWith('ws-1');
    expect(mocks.activity).toHaveBeenCalledWith('ws-1', { minutesAgo: 60 });
    expect(harness.state()).toMatchObject({
      hydrationStatus: 'loaded',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'curated',
      activities: SEMANTIC_MAP_FIXTURE_ACTIVITIES,
    });

    harness.dispatch(applyNoteCreated('ws-1', { tags: ['semantic-map'] } as never));
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.activity).toHaveBeenCalledTimes(1);
    await harness.stop();
  });

  it('exposes a hydration error when the daemon request fails', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();

    expect(harness.state()?.hydrationStatus).toBe('error');
    expect(harness.actions.map((action) => (action as { type: string }).type)).toEqual(
      expect.arrayContaining(['semanticMap/loadStarted', 'semanticMap/loadFailed']),
    );
    expect(mocks.activity).not.toHaveBeenCalled();
    await harness.stop();
  });

  it('loads the daemon route for selection and clears state on unmount', async () => {
    const harness = createHarness();
    await settle();
    harness.dispatch(semanticMapSelectedAgentChanged('ws-1', 'agent-1'));
    await settle();

    expect(mocks.route).toHaveBeenCalledWith('ws-1', { agentId: 'agent-1' });
    expect(harness.state()?.route).toBe(SEMANTIC_MAP_FIXTURE_ROUTE);

    harness.dispatch(workspaceUnmounted('ws-1'));
    await settle();
    expect(harness.state()).toBeUndefined();
    await harness.stop();
  });
});
