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
  const reorder = (requestId: string, baseProviderId: string, profileIds: string[]) =>
    providerProfileReorderRequested({ requestId, baseProviderId, profileIds });
  const apply = (
    state: ProviderSettingsState,
    ...actions: Parameters<typeof providerSettingsReducer>[1][]
  ) => actions.reduce(providerSettingsReducer, state);

  it("applies the new order optimistically within the base provider's slots", () => {
    const state = apply(loaded(), reorder('r1', 'codex', ['c', 'a', 'b']));
    expect(ids(state)).toEqual(['c', 'x', 'a', 'b']);
    expect(getItem(state.profiles.mutations, 'r1')).toMatchObject({
      kind: 'reorder',
      status: 'pending',
      baseProviderId: 'codex',
    });
    expect(state.profiles.revision).toBe(5);
  });

  it('ignores a second reorder of the same base provider while one is pending', () => {
    const state = apply(
      loaded(),
      reorder('r1', 'codex', ['c', 'a', 'b']),
      reorder('r2', 'codex', ['b', 'c', 'a']),
      reorder('r3', 'claude-code', ['x']),
    );
    expect(ids(state)).toEqual(['c', 'x', 'a', 'b']);
    expect(getItem(state.profiles.mutations, 'r2')).toBeUndefined();
    expect(getItem(state.profiles.mutations, 'r3')?.status).toBe('pending');
  });

  it("adopts the daemon's rows and revision on success", () => {
    const state = apply(
      loaded(),
      reorder('r1', 'codex', ['c', 'a', 'b']),
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

  it('keeps no client snapshot on rejection: the daemon list read afterwards wins', () => {
    let state = apply(loaded(), reorder('r1', 'codex', ['b', 'c', 'a']));
    state = apply(state, providerProfileMutationFailed('r1', { kind: 'other' }));
    expect(getItem(state.profiles.mutations, 'r1')?.status).toBe('failure');
    state = apply(
      state,
      providerProfilesLoaded(
        [profile('a'), profile('x', 'claude-code'), profile('b'), profile('c')],
        5,
      ),
    );
    expect(ids(state)).toEqual(['a', 'x', 'b', 'c']);
  });

  // Verifier sequence 1: a newer daemon list arrives before the rejection.
  it('keeps a newer daemon order when an earlier reorder is rejected', () => {
    const state = apply(
      loaded(),
      reorder('r1', 'codex', ['c', 'a', 'b']),
      providerProfilesLoaded(
        [profile('b'), profile('x', 'claude-code'), profile('a'), profile('c')],
        9,
      ),
      providerProfileMutationFailed('r1', { kind: 'other' }),
    );
    expect(ids(state)).toEqual(['b', 'x', 'a', 'c']);
    expect(state.profiles.revision).toBe(9);
  });

  // Verifier sequence 2: requests for two base providers, one saved, one rejected.
  it("shows the daemon's order after a cross-provider save and rejection", () => {
    const pair = apply(
      initialState,
      providerProfilesLoaded(
        [profile('a'), profile('b'), profile('x', 'claude-code'), profile('y', 'claude-code')],
        5,
      ),
    );
    const state = apply(
      pair,
      reorder('r1', 'codex', ['b', 'a']),
      reorder('r2', 'claude-code', ['y', 'x']),
      providerProfileReorderSucceeded('r1', [profile('b'), profile('a')], 6),
      providerProfileMutationFailed('r2', { kind: 'other' }),
      // The saga's re-read after the rejection.
      providerProfilesLoaded(
        [profile('b'), profile('a'), profile('x', 'claude-code'), profile('y', 'claude-code')],
        6,
      ),
    );
    expect(ids(state)).toEqual(['b', 'a', 'x', 'y']);
  });

  // Verifier sequence 3: an in-flight list read lands between a request and its save.
  it('ends on the saved order when a list read lands while a reorder is pending', () => {
    const three = () => [profile('a'), profile('b'), profile('c')];
    const state = apply(
      apply(initialState, providerProfilesLoaded(three(), 5)),
      reorder('r1', 'codex', ['b', 'a', 'c']),
      reorder('r2', 'codex', ['c', 'b', 'a']),
      providerProfilesLoaded(three(), 5),
      providerProfileReorderSucceeded('r1', [profile('b'), profile('a'), profile('c')], 6),
    );
    expect(ids(state)).toEqual(['b', 'a', 'c']);
    expect(state.profiles.revision).toBe(6);
    expect(getItem(state.profiles.mutations, 'r2')).toBeUndefined();
  });

  it('ignores an older reorder result than the list already shown', () => {
    const state = apply(
      loaded(),
      reorder('r1', 'codex', ['c', 'a', 'b']),
      providerProfilesLoaded(
        [profile('b'), profile('x', 'claude-code'), profile('a'), profile('c')],
        9,
      ),
      providerProfileReorderSucceeded('r1', [profile('c'), profile('a'), profile('b')], 6),
    );
    expect(ids(state)).toEqual(['b', 'x', 'a', 'c']);
    expect(state.profiles.revision).toBe(9);
  });
});
