import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  InvitationAccount,
  InvitationAccountQuery,
  InvitationAccountSuggestions,
} from '$features/host-membership/invitation-account-search-types';

export const initialState = {
  session: null as string | null,
  context: null as string | null,
  supported: false,
  request: null as InvitationAccountQuery | null,
  revision: 0,
  results: createCollection<InvitationAccount, 'login'>('login'),
  status: 'idle' as InvitationAccountSuggestions['status'],
  error: null as string | null,
};
export const accountSearchConfigured = createAction<
  [session: string, context: string | null, supported: boolean]
>('invitationAccountSearch/configured');
export const accountSearchRequested = createAction<
  [session: string, request: InvitationAccountQuery | null]
>('invitationAccountSearch/requested');
export const accountSearchClosed = createAction<[session: string]>(
  'invitationAccountSearch/closed',
);
export const accountSearchSettled = createAction<
  [
    session: string,
    revision: number,
    users: InvitationAccount[],
    error: string | null,
    unsupported?: boolean,
  ]
>('invitationAccountSearch/settled');
export const invitationAccountSearchReducer = createReducer(initialState);
invitationAccountSearchReducer.with(
  accountSearchConfigured,
  (state, { payload: [session, context, supported] }) => ({
    ...initialState,
    session,
    context,
    supported,
    revision: state.revision + 1,
  }),
);
invitationAccountSearchReducer.with(
  accountSearchRequested,
  (state, { payload: [session, request] }) => {
    if (
      session !== state.session ||
      !state.context ||
      !state.supported ||
      state.status === 'unsupported'
    )
      return state;
    return {
      ...state,
      request,
      revision: state.revision + 1,
      results: initialState.results,
      error: null,
      status: request && request.query.length >= 2 ? 'loading' : 'idle',
    };
  },
);
invitationAccountSearchReducer.with(accountSearchClosed, (state, { payload: [session] }) =>
  session === state.session ? { ...initialState, revision: state.revision + 1 } : state,
);
invitationAccountSearchReducer.with(
  accountSearchSettled,
  (state, { payload: [session, revision, users, error, unsupported] }) =>
    session !== state.session || revision !== state.revision
      ? state
      : {
          ...state,
          results: createCollection<InvitationAccount, 'login'>('login', users),
          error,
          status: unsupported ? 'unsupported' : error ? 'error' : 'ready',
        },
);
