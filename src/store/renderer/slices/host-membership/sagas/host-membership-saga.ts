import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { hostMembershipClient } from '$features/host-membership/host-membership.client';
import {
  clearHostInviteLinks,
  retainHostInviteLink,
  readHostInviteLink,
} from '$features/host-membership/invite-links';
import type { HostInvite, HostInviteRow } from '$features/host-membership/types';
import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
import { selectLabsGitLabEnabled } from '../../user-preferences/user-preferences-selectors';
import {
  selectHostMembershipContext,
  selectHostMembershipState,
} from '../host-membership-selectors';
import {
  hostMembershipOpened,
  hostMembershipClosed,
  hostMembershipRequested,
  hostMembershipDenied,
  hostMembershipStarted,
  hostMembershipLoaded,
  hostMembershipFailed,
  hostMembershipFinished,
  type HostMembershipTarget,
} from '../host-membership-slice';

function* current(target: HostMembershipTarget): SagaGenerator<boolean> {
  const state = yield* selectHostMembershipState.effect();
  return (
    !state.withheld &&
    state.target?.session === target.session &&
    state.target.context === target.context &&
    (yield* selectHostMembershipContext.effect()) === target.context
  );
}

/** Explicit projection: never spread an invitation envelope into an action. */
function safeInvite(row: HostInviteRow): HostInvite {
  return {
    id: row.id,
    scope: row.scope,
    role: row.role,
    createdByPrincipalId: row.createdByPrincipalId,
    pinLogin: row.pinLogin,
    pinIdentity: row.pinIdentity,
    reusable: row.reusable,
    redemptionCount: row.redemptionCount,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.pinGithubUserId === undefined ? {} : { pinGithubUserId: row.pinGithubUserId }),
  };
}

function* execute(action: ReturnType<typeof hostMembershipRequested>): SagaGenerator<void> {
  const [target, command] = action.payload;
  if (!(yield* current(target)) || (yield* selectHostMembershipState.effect()).busy) return;
  yield* put(hostMembershipStarted(target));
  let created: { id: string; url: string } | undefined;
  try {
    if (command.kind === 'copy') {
      const url = readHostInviteLink(target.session, command.inviteId);
      if (!url) throw new Error('unavailable');
      yield* call(() => navigator.clipboard.writeText(url));
      if (yield* current(target)) {
        yield* put(hostMembershipFinished(target));
        yield* call(notify.success, m.workspace_share_linkCopied_toast());
      }
      return;
    }
    if (command.kind === 'create') {
      const host = canonicalInviteHost(command.input.pinProvider, command.input.pinHost ?? '');
      if (
        !command.input.pinLogin.trim() ||
        !host ||
        (command.input.pinProvider === 'gitlab' && !(yield* selectLabsGitLabEnabled.effect()))
      ) {
        yield* put(hostMembershipFailed(target, m.collaboration_pin_invalid_error()));
        return;
      }
      const result = yield* call(hostMembershipClient.createInvite, {
        pinLogin: command.input.pinLogin.trim(),
        pinProvider: command.input.pinProvider,
        pinHost: host,
      });
      if (!(yield* current(target))) return;
      created = { id: result.invite.id, url: result.url };
    } else if (command.kind === 'remove') {
      const state = yield* selectHostMembershipState.effect();
      const member = getItem(state.members, command.principalId);
      if (!member || member.hostRole !== 'member') {
        yield* put(hostMembershipFailed(target, m.collaboration_host_forbidden_error()));
        return;
      }
      yield* call(hostMembershipClient.removeMember, command.principalId);
    } else if (command.kind === 'revoke') {
      yield* call(hostMembershipClient.revokeInvite, command.inviteId);
    }
    if (!(yield* current(target))) return;
    const { roster, invitationList } = yield* all({
      roster: call(hostMembershipClient.listMembers),
      invitationList: call(hostMembershipClient.listInvites),
    });
    if (!(yield* current(target))) return;
    clearHostInviteLinks(target.session);
    for (const invite of invitationList.invites) {
      if (invite.url) retainHostInviteLink(target.session, invite.id, invite.url);
      else if (created && created.id === invite.id)
        retainHostInviteLink(target.session, invite.id, created.url);
    }
    yield* put(
      hostMembershipLoaded(
        target,
        roster.members,
        invitationList.invites.map(safeInvite),
        roster.revision,
      ),
    );
  } catch (error) {
    if (!(yield* current(target))) return;
    const code =
      error &&
      typeof error === 'object' &&
      'data' in error &&
      error.data &&
      typeof error.data === 'object' &&
      'code' in error.data
        ? error.data.code
        : null;
    const message = isForbiddenErrorResponse(error)
      ? m.collaboration_host_forbidden_error()
      : code === 'invite-pin-unknown'
        ? m.workspace_share_pinUnknown_error({
            login: command.kind === 'create' ? command.input.pinLogin : '',
          })
        : code === 'identity-unverifiable'
          ? describeInviteFailureReason('identity-unverifiable', {
              identityHost: command.kind === 'create' ? command.input.pinHost : undefined,
            })
          : code === 'listener-down'
            ? m.workspace_share_listenerDown_error()
            : code === 'tunnel-down'
              ? m.workspace_share_tunnelDown_error()
              : m.collaboration_host_request_error();
    if (isForbiddenErrorResponse(error)) {
      clearHostInviteLinks(target.session);
      yield* put(hostMembershipDenied(target, message));
    } else yield* put(hostMembershipFailed(target, message));
  }
}

function* opened(action: ReturnType<typeof hostMembershipOpened>): SagaGenerator<void> {
  yield* call(clearHostInviteLinks, action.payload[0].session);
  yield* put(hostMembershipRequested(action.payload[0], { kind: 'load' }));
}
function* closed(action: ReturnType<typeof hostMembershipClosed>): SagaGenerator<void> {
  yield* call(clearHostInviteLinks, action.payload[0].session);
}
export function* hostMembershipSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(hostMembershipOpened, opened),
    takeEvery(hostMembershipClosed, closed),
    takeEvery(hostMembershipRequested, execute),
  ]);
}
