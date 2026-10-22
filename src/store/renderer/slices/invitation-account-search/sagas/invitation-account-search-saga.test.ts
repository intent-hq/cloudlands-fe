import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import {
  admitLegacyPrincipal,
  withHostPrincipal,
} from '../../../../../test/fixtures/principal-state';
import {
  principalContextChanged,
  principalReceived,
  hostMembershipChanged,
} from '../../principal/principal-slice';
import { selectHostMembershipContext } from '../../host-membership/host-membership-selectors';
import {
  setLabsGitLabEnabled,
  setLabsMultiplayerEnabled,
} from '../../user-preferences/user-preferences-slice';
import {
  accountSearchConfigured,
  accountSearchRequested,
  accountSearchClosed,
} from '../invitation-account-search-slice';
import { invitationAccountSearchSaga } from './invitation-account-search-saga';
const wire = vi.mocked(backendRequest);
const query = { provider: 'github' as const, host: 'github.com', query: 'sa' };
const user = {
  identity: { provider: 'github' as const, host: 'github.com', externalUserId: '42' },
  login: 'sam',
  name: 'Sam',
  avatarUrl: null,
};
let stop: () => void;
let dispose: () => void;
function admit(supported = true, role: 'owner' | 'member' | 'guest' = 'owner') {
  admitLegacyPrincipal();
  const { principal } = withHostPrincipal(store.state, role);
  principal.snapshot!.capabilities.invitationAccountSearch = supported;
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      {
        context: principal.context!,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      principal.snapshot!,
    ),
  );
  store.dispatch(
    accountSearchConfigured('dialog', selectHostMembershipContext.select(store.state), supported),
  );
}
beforeAll(() => {
  dispose = store.init();
  stop = store.runSaga(invitationAccountSearchSaga);
});
afterAll(() => {
  stop();
  dispose();
});
beforeEach(() => {
  vi.useFakeTimers();
  wire.mockReset();
  wire.mockResolvedValue({ users: [] });
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(setLabsGitLabEnabled(true));
  admit();
});
afterEach(() => {
  store.dispatch(accountSearchClosed('dialog'));
  vi.useRealTimers();
});
it.each(['github', 'gitlab'] as const)(
  'debounces bounded %s requests through the real client and stores qualified wire users',
  async (provider) => {
    const host = provider === 'github' ? 'github.com' : 'forge.example:8443';
    const hit = { ...user, identity: { ...user.identity, provider, host } };
    wire.mockResolvedValue({ users: [hit] });
    store.dispatch(accountSearchRequested('dialog', { provider, host, query: 's' }));
    store.dispatch(accountSearchRequested('dialog', { provider, host, query: 'sa' }));
    store.dispatch(accountSearchRequested('dialog', { provider, host, query: 'sam' }));
    await vi.advanceTimersByTimeAsync(299);
    expect(wire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(wire).toHaveBeenCalledExactlyOnceWith('host.invite.searchAccounts', {
      provider,
      host,
      query: 'sam',
      limit: 8,
    });
    expect(getItems(store.state.invitationAccountSearch.results)).toEqual([hit]);
  },
);
it.each(['query', 'provider', 'host', 'close', 'authority'] as const)(
  'ignores late replies after %s changes',
  async (change) => {
    let settle!: (value: { users: (typeof user)[] }) => void;
    wire.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    store.dispatch(accountSearchRequested('dialog', query));
    await vi.advanceTimersByTimeAsync(300);
    if (change === 'close') {
      store.dispatch(accountSearchClosed('dialog'));
      admit();
    } else if (change === 'authority')
      store.dispatch(
        hostMembershipChanged({
          revision: 2,
          principalId: 'other',
          action: 'added',
          hostRole: 'member',
        }),
      );
    else
      store.dispatch(
        accountSearchRequested('dialog', {
          ...query,
          ...(change === 'query'
            ? { query: 'alex' }
            : change === 'provider'
              ? { provider: 'gitlab', host: 'gitlab.com' }
              : { host: 'other.example' }),
        }),
      );
    settle({ users: [user] });
    await vi.advanceTimersByTimeAsync(0);
    expect(getItems(store.state.invitationAccountSearch.results)).toEqual([]);
  },
);
it.each([false, 'member', 'guest'] as const)(
  'never calls owner-only search for unsupported or unauthorized context %s',
  async (value) => {
    admit(value !== false, value === false ? 'owner' : value);
    store.dispatch(accountSearchRequested('dialog', query));
    await vi.advanceTimersByTimeAsync(300);
    expect(wire).not.toHaveBeenCalled();
  },
);
it('does not require repository credentials and preserves manual fallback for method absence and provider refusal', async () => {
  wire.mockRejectedValueOnce({
    code: 'METHOD_NOT_FOUND',
    rpcCode: -32601,
    message: 'Method not found',
  });
  store.dispatch(accountSearchRequested('dialog', query));
  await vi.advanceTimersByTimeAsync(300);
  expect(store.state.invitationAccountSearch.status).toBe('unsupported');
  admit();
  wire.mockRejectedValueOnce({
    code: 'INTERNAL_ERROR',
    rpcCode: -32603,
    data: { code: 'identity-unverifiable' },
  });
  store.dispatch(accountSearchRequested('dialog', query));
  await vi.advanceTimersByTimeAsync(300);
  expect(store.state.invitationAccountSearch.status).toBe('error');
  expect(store.state.invitationAccountSearch.error).toContain('username');
});
it('rejects malformed queries, foreign-host results and disabled GitLab without showing an empty success', async () => {
  store.dispatch(accountSearchRequested('dialog', { ...query, query: 'sa/path' }));
  await vi.advanceTimersByTimeAsync(300);
  expect(wire).not.toHaveBeenCalled();
  wire.mockResolvedValueOnce({
    users: [{ ...user, identity: { ...user.identity, host: 'other.example' } }],
  });
  store.dispatch(accountSearchRequested('dialog', query));
  await vi.advanceTimersByTimeAsync(300);
  expect(getItems(store.state.invitationAccountSearch.results)).toEqual([]);
  expect(store.state.invitationAccountSearch.status).toBe('error');
  wire.mockClear();
  store.dispatch(setLabsGitLabEnabled(false));
  store.dispatch(
    accountSearchRequested('dialog', { ...query, provider: 'gitlab', host: 'gitlab.com' }),
  );
  await vi.advanceTimersByTimeAsync(300);
  expect(wire).not.toHaveBeenCalled();
});
