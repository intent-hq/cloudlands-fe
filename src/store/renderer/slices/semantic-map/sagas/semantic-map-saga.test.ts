import { runSaga, stdChannel } from 'redux-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
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
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesSucceeded,
} from '../../workspace-notes/workspace-notes-slice';
import {
  initialState,
  semanticMapActivityReceived,
  semanticMapReducer,
  semanticMapSelectedAgentChanged,
  semanticMapSelectedRegionChanged,
} from '../semantic-map-slice';
import { semanticMapSaga } from './semantic-map-saga';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
    });
    expect(getItems(harness.state().activities)).toEqual(SEMANTIC_MAP_FIXTURE_ACTIVITIES);

    harness.dispatch(applyNoteCreated('ws-1', { tags: ['semantic-map'] } as never));
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.activity).toHaveBeenCalledTimes(2);
    await harness.stop();
  });

  it('preserves a live activity received while replay hydration is unresolved', async () => {
    const pendingActivity = deferred<typeof SEMANTIC_MAP_FIXTURE_ACTIVITIES>();
    const liveActivity = {
      ...SEMANTIC_MAP_FIXTURE_ACTIVITIES[0],
      id: 'activity-live',
      ts: '2026-09-06T02:10:00.000Z',
    };
    mocks.activity.mockReturnValueOnce(pendingActivity.promise);
    const harness = createHarness();
    await settle();

    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(mocks.activity).toHaveBeenCalledOnce();
    harness.dispatch(semanticMapActivityReceived('ws-1', liveActivity));
    pendingActivity.resolve(SEMANTIC_MAP_FIXTURE_ACTIVITIES);
    await settle();

    expect(getItems(harness.state().activities)).toEqual([
      ...SEMANTIC_MAP_FIXTURE_ACTIVITIES,
      liveActivity,
    ]);
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

  it('cancels hydration on unmount so a late response cannot resurrect state', async () => {
    const pendingGet = deferred<{
      manifest: typeof SEMANTIC_MAP_FIXTURE_MANIFEST;
      source: 'curated';
    }>();
    mocks.get.mockReturnValueOnce(pendingGet.promise);
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    expect(harness.state()?.hydrationStatus).toBe('loading');

    harness.dispatch(workspaceUnmounted('ws-1'));
    await settle();
    pendingGet.resolve({ manifest: SEMANTIC_MAP_FIXTURE_MANIFEST, source: 'curated' });
    await settle();

    expect(harness.state()).toBeUndefined();
    expect(mocks.activity).not.toHaveBeenCalled();
    await harness.stop();
  });

  it('keeps only the newer generation after a rapid unmount and remount', async () => {
    const oldGet = deferred<{
      manifest: typeof SEMANTIC_MAP_FIXTURE_MANIFEST;
      source: 'curated';
    }>();
    const nextManifest = {
      ...SEMANTIC_MAP_FIXTURE_MANIFEST,
      regions: SEMANTIC_MAP_FIXTURE_MANIFEST.regions.slice(0, 1),
    };
    const newGet = deferred<{ manifest: typeof nextManifest; source: 'structural' }>();
    mocks.get.mockReset();
    mocks.get.mockReturnValueOnce(oldGet.promise).mockReturnValueOnce(newGet.promise);
    const harness = createHarness();
    await settle();

    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(workspaceUnmounted('ws-1'));
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    newGet.resolve({ manifest: nextManifest, source: 'structural' });
    await settle();
    oldGet.resolve({ manifest: SEMANTIC_MAP_FIXTURE_MANIFEST, source: 'curated' });
    await settle();

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(harness.state()).toMatchObject({
      hydrationStatus: 'loaded',
      manifest: nextManifest,
      source: 'structural',
    });
    await harness.stop();
  });

  it('reconciles selection and activity together after a tagged manifest refresh', async () => {
    const nextManifest = {
      ...SEMANTIC_MAP_FIXTURE_MANIFEST,
      regions: SEMANTIC_MAP_FIXTURE_MANIFEST.regions.filter(
        (region) => region.id !== 'agent-execution',
      ),
    };
    const reclassified = {
      ...SEMANTIC_MAP_FIXTURE_ACTIVITIES[0],
      regionId: 'renderer-state',
    };
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(semanticMapSelectedRegionChanged('ws-1', 'agent-execution'));
    mocks.get.mockResolvedValueOnce({ manifest: nextManifest, source: 'curated' });
    mocks.activity.mockResolvedValueOnce([reclassified]);

    harness.dispatch(applyNoteCreated('ws-1', { tags: ['semantic-map'] } as never));
    await settle();

    expect(harness.state().selectedRegionId).toBeNull();
    expect(getItems(harness.state().activities)).toEqual([reclassified]);
    await harness.stop();
  });

  it('refreshes the selected route after manifest hydration', async () => {
    const refreshedRoute = { visits: ['renderer-state'], transitions: [] };
    mocks.route
      .mockResolvedValueOnce(SEMANTIC_MAP_FIXTURE_ROUTE)
      .mockResolvedValueOnce(refreshedRoute);
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(semanticMapSelectedAgentChanged('ws-1', 'agent-1'));
    await settle();

    harness.dispatch(applyNoteCreated('ws-1', { id: 'manifest', tags: ['semantic-map'] } as never));
    await settle();

    expect(mocks.route).toHaveBeenNthCalledWith(2, 'ws-1', { agentId: 'agent-1' });
    expect(harness.state().route).toEqual(refreshedRoute);
    await harness.stop();
  });

  it('refreshes when a manifest is untagged or deleted without refreshing unrelated notes', async () => {
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(
      loadWorkspaceNotesSucceeded(['ws-1'], {
        'ws-1': [
          { id: 'manifest-1', tags: ['semantic-map'] } as never,
          { id: 'manifest-2', tags: ['semantic-map'] } as never,
          { id: 'ordinary', tags: [] } as never,
        ],
      }),
    );
    harness.dispatch(applyNoteUpdated('ws-1', 'ordinary', { id: 'ordinary', tags: [] } as never));
    harness.dispatch(applyNoteDeleted('ws-1', 'ordinary'));
    await settle();
    expect(mocks.get).toHaveBeenCalledOnce();

    harness.dispatch(
      applyNoteUpdated('ws-1', 'manifest-1', { id: 'manifest-1', tags: [] } as never),
    );
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(2);

    harness.dispatch(applyNoteDeleted('ws-1', 'manifest-2'));
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(3);
    await harness.stop();
  });

  it('binds route results to the requested subject and mount generation', async () => {
    const firstRoute = deferred<typeof SEMANTIC_MAP_FIXTURE_ROUTE>();
    const secondRoute = {
      visits: ['renderer-state'],
      transitions: [],
    };
    mocks.route.mockReset();
    mocks.route.mockReturnValueOnce(firstRoute.promise).mockResolvedValueOnce(secondRoute);
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(semanticMapSelectedAgentChanged('ws-1', 'agent-1'));
    await settle();
    harness.dispatch(semanticMapSelectedAgentChanged('ws-1', 'agent-2'));
    await settle();

    expect(mocks.route).toHaveBeenCalledWith('ws-1', { agentId: 'agent-1' });
    expect(harness.state()?.route).toBeNull();
    firstRoute.resolve(SEMANTIC_MAP_FIXTURE_ROUTE);
    await settle();

    expect(mocks.route).toHaveBeenNthCalledWith(2, 'ws-1', { agentId: 'agent-2' });
    expect(harness.state()?.route).toEqual(secondRoute);
    await harness.stop();
  });

  it('cancels an in-flight route when its workspace unmounts', async () => {
    const pendingRoute = deferred<typeof SEMANTIC_MAP_FIXTURE_ROUTE>();
    mocks.route.mockReturnValueOnce(pendingRoute.promise);
    const harness = createHarness();
    await settle();
    harness.dispatch(workspaceMounted('ws-1'));
    await settle();
    harness.dispatch(semanticMapSelectedAgentChanged('ws-1', 'agent-1'));
    await settle();

    harness.dispatch(workspaceUnmounted('ws-1'));
    await settle();
    pendingRoute.resolve(SEMANTIC_MAP_FIXTURE_ROUTE);
    await settle();
    expect(harness.state()).toBeUndefined();
    await harness.stop();
  });
});
