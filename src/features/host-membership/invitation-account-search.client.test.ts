import { expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: request }));
import { searchInvitationAccounts } from './invitation-account-search.client';
it.each(['github', 'gitlab'] as const)(
  'sends the exact %s selected-host account search wire request',
  async (provider) => {
    const host = provider === 'github' ? 'github.com' : 'forge.example:8443';
    const user = {
      identity: { provider, host, externalUserId: '42' },
      login: 'sam',
      name: 'Sam',
      avatarUrl: null,
    };
    request.mockResolvedValueOnce({ users: [user] });
    expect(await searchInvitationAccounts({ provider, host, query: 'sa' })).toEqual({
      users: [user],
    });
    expect(request).toHaveBeenLastCalledWith('host.invite.searchAccounts', {
      provider,
      host,
      query: 'sa',
      limit: 8,
    });
  },
);
