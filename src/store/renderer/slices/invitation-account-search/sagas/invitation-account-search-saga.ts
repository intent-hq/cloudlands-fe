import { call, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { searchInvitationAccounts } from '$features/host-membership/invitation-account-search.client';
import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';
import { m } from '$shared/paraglide/messages.js';
import { selectHostMembershipContext } from '../../host-membership/host-membership-selectors';
import { selectLabsGitLabEnabled } from '../../user-preferences/user-preferences-selectors';
import {
  selectInvitationAccountSearch,
  selectInvitationAccountSearchSupported,
} from '../invitation-account-search-selectors';
import {
  accountSearchConfigured,
  accountSearchRequested,
  accountSearchClosed,
  accountSearchSettled,
} from '../invitation-account-search-slice';

function* search(
  action: ReturnType<
    typeof accountSearchRequested | typeof accountSearchConfigured | typeof accountSearchClosed
  >,
): SagaGenerator<void> {
  if (action.type !== accountSearchRequested.type) return;
  const state = yield* selectInvitationAccountSearch.effect();
  const { session, context, revision, request } = state;
  if (
    !session ||
    action.payload[0] !== session ||
    !request ||
    request.query.length < 2 ||
    state.status !== 'loading'
  )
    return;
  function* current(): SagaGenerator<boolean> {
    const latest = yield* selectInvitationAccountSearch.effect();
    return (
      latest.session === session &&
      latest.revision === revision &&
      !!context &&
      (yield* selectHostMembershipContext.effect()) === context &&
      (yield* selectInvitationAccountSearchSupported.effect()) &&
      (request?.provider !== 'gitlab' || (yield* selectLabsGitLabEnabled.effect()))
    );
  }
  if (!(yield* current())) return;
  const validQuery =
    request.provider === 'github' ? /^[a-zA-Z0-9-]{2,39}$/ : /^[a-zA-Z0-9_.-]{2,255}$/;
  if (
    canonicalInviteHost(request.provider, request.host) !== request.host ||
    !validQuery.test(request.query)
  ) {
    yield* put(accountSearchSettled(session, revision, [], m.collaboration_accountSearch_failed()));
    return;
  }
  yield* delay(300);
  if (!(yield* current())) return;
  try {
    const response = yield* call(searchInvitationAccounts, request);
    if (!(yield* current())) return;
    // A malformed/misqualified response is a failure, never an empty successful directory.
    if (
      !Array.isArray(response?.users) ||
      response.users.some(
        (user) =>
          !user ||
          user.identity?.provider !== request.provider ||
          user.identity.host !== request.host ||
          typeof user.identity.externalUserId !== 'string' ||
          !user.identity.externalUserId.trim() ||
          typeof user.login !== 'string' ||
          !user.login.trim() ||
          !(user.name === null || typeof user.name === 'string') ||
          !(user.avatarUrl === null || typeof user.avatarUrl === 'string'),
      )
    )
      throw new Error('Invalid account search response');
    yield* put(accountSearchSettled(session, revision, response.users.slice(0, 8), null));
  } catch (error) {
    if (!(yield* current())) return;
    const unsupported =
      !!error && typeof error === 'object' && 'rpcCode' in error && error.rpcCode === -32601;
    yield* put(
      accountSearchSettled(
        session,
        revision,
        [],
        unsupported
          ? m.collaboration_accountSearch_manual()
          : m.collaboration_accountSearch_failed(),
        unsupported,
      ),
    );
  }
}
export function* invitationAccountSearchSaga(): SagaGenerator<void> {
  yield* takeLatest([accountSearchRequested, accountSearchConfigured, accountSearchClosed], search);
}
