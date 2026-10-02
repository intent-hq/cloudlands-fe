import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  hostMembershipReducer as reduce,
  initialState,
  hostMembershipOpened,
  hostMembershipClosed,
  hostMembershipStarted,
  hostMembershipLoaded,
  hostMembershipFailed,
  hostMembershipFinished,
  hostMembershipDenied,
} from './host-membership-slice';
const target = { session: 'one', context: 'owner-a' };
const other = { session: 'two', context: 'owner-b' };
const owner = {
  principalId: 'p',
  hostRole: 'owner' as const,
  login: null,
  displayName: null,
  avatarUrl: null,
  addedAt: '2026-09-30T00:00:00Z',
};
describe('hostMembershipReducer', () => {
  it('opens a fresh lifetime and carries only serializable safe rows', () => {
    expect(reduce(undefined, { type: 'init' })).toEqual(initialState);
    let state = reduce(initialState, hostMembershipOpened(target));
    state = reduce(state, hostMembershipStarted(target));
    expect(state.busy).toBe(true);
    state = reduce(state, hostMembershipLoaded(target, [owner], [], 4));
    expect(getItems(state.members)).toEqual([owner]);
    expect(state).toMatchObject({ revision: 4, loaded: true, busy: false, error: null });
    state = reduce(state, hostMembershipFailed(target, 'bounded'));
    expect(state.error).toBe('bounded');
    expect(getItems(state.members)).toEqual([owner]);
    state = reduce(state, hostMembershipFinished(target));
    expect(state).toMatchObject({ busy: false, error: null });
    expect(reduce(state, hostMembershipClosed(target))).toEqual(initialState);
  });
  it('rejects old-lifetime settlements and drops old rows on a new open or refusal', () => {
    let state = reduce(initialState, hostMembershipOpened(target));
    state = reduce(state, hostMembershipLoaded(target, [owner], [], 4));
    state = reduce(state, hostMembershipOpened(other));
    expect(getItems(state.members)).toEqual([]);
    for (const action of [
      hostMembershipStarted(target),
      hostMembershipLoaded(target, [owner], [], 4),
      hostMembershipFailed(target, 'late'),
      hostMembershipFinished(target),
      hostMembershipClosed(target),
      hostMembershipDenied(target, 'late'),
    ])
      expect(reduce(state, action)).toBe(state);
    state = reduce(state, hostMembershipDenied(other, 'refused'));
    expect(state).toMatchObject({ withheld: true, busy: false, loaded: false, error: 'refused' });
  });
});
