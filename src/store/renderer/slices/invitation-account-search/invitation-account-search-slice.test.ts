import { expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  invitationAccountSearchReducer as reduce,
  initialState,
  accountSearchConfigured,
  accountSearchRequested,
  accountSearchSettled,
  accountSearchClosed,
} from './invitation-account-search-slice';
const request = { provider: 'github' as const, host: 'github.com', query: 'sa' };
const user = {
  identity: { provider: 'github' as const, host: 'github.com', externalUserId: '42' },
  login: 'sam',
  name: null,
  avatarUrl: null,
};
it('clears rows immediately and fences replies by the complete request generation', () => {
  expect(reduce(undefined, { type: 'init' })).toEqual(initialState);
  let state = reduce(initialState, accountSearchConfigured('dialog', 'owner-context', true));
  state = reduce(state, accountSearchRequested('dialog', request));
  const revision = state.revision;
  state = reduce(state, accountSearchSettled('dialog', revision, [user], null));
  expect(getItems(state.results)).toEqual([user]);
  state = reduce(
    state,
    accountSearchRequested('dialog', { ...request, provider: 'gitlab', host: 'forge.example' }),
  );
  expect(getItems(state.results)).toEqual([]);
  expect(reduce(state, accountSearchSettled('dialog', revision, [user], null))).toBe(state);
  const pending = state.revision;
  state = reduce(state, accountSearchConfigured('dialog', null, true));
  expect(reduce(state, accountSearchSettled('dialog', pending, [user], null))).toBe(state);
  state = reduce(state, accountSearchConfigured('dialog', 'new-owner-context', true));
  state = reduce(state, accountSearchClosed('dialog'));
  expect(state.session).toBeNull();
  expect(reduce(state, accountSearchSettled('dialog', pending, [user], null))).toBe(state);
});
it('rejects foreign sessions and retains manual fallback after a method-not-found response', () => {
  let state = reduce(initialState, accountSearchConfigured('dialog', 'owner', true));
  expect(reduce(state, accountSearchRequested('other', request))).toBe(state);
  expect(reduce(state, accountSearchClosed('other'))).toBe(state);
  state = reduce(state, accountSearchRequested('dialog', request));
  state = reduce(state, accountSearchSettled('dialog', state.revision, [], 'manual', true));
  expect(state.status).toBe('unsupported');
  expect(reduce(state, accountSearchRequested('dialog', request))).toBe(state);
});
