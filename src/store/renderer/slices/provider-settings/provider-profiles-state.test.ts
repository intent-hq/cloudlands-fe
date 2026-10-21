import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ProviderProfile } from '$shared/provider-profiles';
import {
  initialState,
  providerProfileMutationFailed,
  providerProfileReorderRequested,
  providerProfileReorderSucceeded,
  providerProfilesLoaded,
  providerSettingsReducer,
  type ProviderSettingsState,
} from './provider-settings-slice';

function profile(id: string, base = 'codex', backup = false): ProviderProfile {
  return {
    id,
    providerRef: `${base}@${id}`,
    baseProviderId: base,
    name: id,
    env: [],
    settingsFingerprint: `fp-${id}`,
    createdAt: '2026-10-17T10:00:00Z',
    updatedAt: '2026-10-17T10:00:00Z',
    backup,
  };
}

const ids = (state: ProviderSettingsState) => getItems(state.profiles.items).map((item) => item.id);

function loaded() {
  return providerSettingsReducer(
    initialState,
    providerProfilesLoaded(
      [profile('a'), profile('x', 'claude-code'), profile('b'), profile('c')],
      5,
    ),
  );
}

describe('provider profile reorder (§5.54)', () => {
  it("applies the new order optimistically within the base provider's slots", () => {
    const state = providerSettingsReducer(
      loaded(),
      providerProfileReorderRequested({
        requestId: 'r1',
        baseProviderId: 'codex',
        profileIds: ['c', 'a', 'b'],
      }),
    );
    expect(ids(state)).toEqual(['c', 'x', 'a', 'b']);
    expect(getItem(state.profiles.mutations, 'r1')).toMatchObject({
      kind: 'reorder',
      status: 'pending',
      previousOrder: ['a', 'b', 'c'],
    });
    expect(state.profiles.revision).toBe(5);
  });

  it("adopts the daemon's rows and revision on success", () => {
    let state = providerSettingsReducer(
      loaded(),
      providerProfileReorderRequested({
        requestId: 'r1',
        baseProviderId: 'codex',
        profileIds: ['c', 'a', 'b'],
      }),
    );
    state = providerSettingsReducer(
      state,
      providerProfileReorderSucceeded(
        'r1',
        [profile('c', 'codex', true), profile('a'), profile('b')],
        6,
      ),
    );
    expect(ids(state)).toEqual(['c', 'x', 'a', 'b']);
    expect(getItems(state.profiles.items)[0].backup).toBe(true);
    expect(state.profiles.revision).toBe(6);
  });

  it('rolls back to the previous order when the daemon rejects the reorder', () => {
    let state = providerSettingsReducer(
      loaded(),
      providerProfileReorderRequested({
        requestId: 'r1',
        baseProviderId: 'codex',
        profileIds: ['b', 'c', 'a'],
      }),
    );
    expect(ids(state)).toEqual(['b', 'x', 'c', 'a']);
    state = providerSettingsReducer(state, providerProfileMutationFailed('r1', { kind: 'other' }));
    expect(ids(state)).toEqual(['a', 'x', 'b', 'c']);
    expect(state.profiles.revision).toBe(5);
  });

  it('ignores an older reorder result than the list already shown', () => {
    let state = providerSettingsReducer(
      loaded(),
      providerProfileReorderRequested({
        requestId: 'r1',
        baseProviderId: 'codex',
        profileIds: ['c', 'a', 'b'],
      }),
    );
    state = providerSettingsReducer(
      state,
      providerProfilesLoaded(
        [profile('b'), profile('x', 'claude-code'), profile('a'), profile('c')],
        9,
      ),
    );
    state = providerSettingsReducer(
      state,
      providerProfileReorderSucceeded('r1', [profile('c'), profile('a'), profile('b')], 6),
    );
    expect(ids(state)).toEqual(['b', 'x', 'a', 'c']);
    expect(state.profiles.revision).toBe(9);
  });
});
