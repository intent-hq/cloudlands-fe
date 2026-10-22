import { backendRequest } from '$lib/client/live/backend-transport';
import type { InvitationAccount, InvitationAccountQuery } from './invitation-account-search-types';

/** Owner invitation suggestions; workspace Share keeps its existing search transport. */
export const searchInvitationAccounts = (request: InvitationAccountQuery) =>
  backendRequest<{ users: InvitationAccount[] }>('host.invite.searchAccounts', {
    ...request,
    limit: 8,
  });
