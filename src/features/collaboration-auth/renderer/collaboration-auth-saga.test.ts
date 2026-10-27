/**
 * @vitest-environment jsdom
 *
 * The renderer publishes its collaboration policy to main only once saved preferences are
 * hydrated. Main counts every later change as a policy revision, and a revision cancels a
 * cold-start invitation, so the default policy must never be published ahead of the hydrated
 * GitLab choice. Repeating an unchanged policy is harmless: main ignores it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import {
  setLabsGitLabEnabled,
  userPreferencesHydrated,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { collaborationAuthSaga } from './collaboration-auth-saga';
import { COLLABORATION_AUTH } from '../types';

const invoke = () => vi.mocked(window.electronAPI.invoke);
const policyPublishes = () =>
  invoke()
    .mock.calls.filter(([channel]) => channel === COLLABORATION_AUTH.POLICY)
    .map(([, policy]) => policy);
/** Consecutive distinct policies, i.e. what main sees as policy revisions. */
const policyRevisions = () =>
  policyPublishes().filter(
    (policy, index, all) =>
      index === 0 || JSON.stringify(policy) !== JSON.stringify(all[index - 1]),
  );

describe('collaborationAuthSaga', () => {
  let disposeStore: () => void;
  let stop: () => void;
  beforeEach(() => {
    disposeStore = store.init();
    invoke().mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    stop?.();
    disposeStore();
  });

  it('publishes nothing before hydration, then only the hydrated policy', async () => {
    stop = store.runSaga(collaborationAuthSaga);
    await Promise.resolve();
    expect(policyPublishes()).toEqual([]);

    store.dispatch(setLabsGitLabEnabled(true));
    store.dispatch(userPreferencesHydrated());
    await vi.waitFor(() => expect(policyPublishes().length).toBeGreaterThan(0));
    expect(policyRevisions()).toEqual([{ multiplayer: true, gitlab: true }]);
  });

  it('publishes immediately when preferences were already hydrated, and again on a later change', async () => {
    store.dispatch(userPreferencesHydrated());
    stop = store.runSaga(collaborationAuthSaga);
    await vi.waitFor(() =>
      expect(policyRevisions()).toEqual([{ multiplayer: true, gitlab: false }]),
    );
    store.dispatch(setLabsGitLabEnabled(true));
    await vi.waitFor(() =>
      expect(policyRevisions()).toEqual([
        { multiplayer: true, gitlab: false },
        { multiplayer: true, gitlab: true },
      ]),
    );
  });
});
