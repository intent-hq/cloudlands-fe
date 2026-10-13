import {
  readCollaboration,
  admitCollaborationCommand,
} from '$features/presence/collaboration-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { withRecoveryLifetime } from '../../../middlewares/event-recovery';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { all, call, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
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
import {
  selectPrincipalState,
  selectPrincipalConnectionContext,
} from '../../principal/principal-selectors';
import type { PrincipalState } from '../../principal/principal-types';
import { selectLabsGitLabEnabled } from '../../user-preferences/user-preferences-selectors';
import {
  selectHostMembershipContext,
  selectHostMembershipState,
} from '../host-membership-selectors';
import {
  hostMembershipOpened,
  hostMembershipRebound,
  hostMembershipListsChanged,
  hostMembershipClosed,
  hostMembershipRequested,
  hostMembershipDenied,
  hostMembershipStarted,
  hostMembershipLoaded,
  hostMembershipFailed,
  hostMembershipFinished,
  hostMembershipCreated,
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

/** Retain command outcomes only across a same-owner presentation revalidation. */
function* commandTarget(
  target: HostMembershipTarget,
  authority: PrincipalState,
): SagaGenerator<HostMembershipTarget | null> {
  while (true) {
    const state = yield* selectHostMembershipState.effect();
    const principal = yield* selectPrincipalState.effect();
    const previous = authority.snapshot?.principal;
    const next = principal.snapshot?.principal;
    if (
      !state.target ||
      state.target.session !== target.session ||
      state.withheld ||
      (yield* selectPrincipalConnectionContext.effect()) !== authority.context ||
      principal.boundPrincipalId !== authority.boundPrincipalId ||
      principal.presentationVersion !== authority.presentationVersion ||
      (next &&
        (next.id !== previous?.id ||
          next.hostRole !== 'owner' ||
          next.identity?.provider !== previous?.identity?.provider ||
          next.identity?.host !== previous?.identity?.host ||
          next.identity?.externalUserId !== previous?.identity?.externalUserId))
    )
      return null;
    if (yield* current(state.target)) return state.target;
    if (
      !next &&
      !(
        principal.status === 'loading' &&
        principal.minimumRevision > (previous?.hostMembershipRevision ?? 0)
      )
    )
      return null;
    // The presentation host either rebinds confirmed same-owner authority or
    // closes this session. Waiting here keeps a completed create from duplicating.
    yield* take([hostMembershipRebound, hostMembershipClosed, hostMembershipDenied]);
  }
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

let nextOperationId = 0;

function* execute(action: ReturnType<typeof hostMembershipRequested>): SagaGenerator<void> {
  let [target, command] = action.payload;
  if (!(yield* current(target)) || (yield* selectHostMembershipState.effect()).busy) return;
  const authority = yield* selectPrincipalState.effect();
  let commandReceipt = rendererEventRecovery.capture('host-membership');
  const operationId = ++nextOperationId;
  yield* put(hostMembershipStarted(target, command.kind === 'create', operationId));
  let refreshing = false;
  let created: { id: string; url: string } | undefined;
  try {
    if (command.kind === 'copy') {
      const url = readHostInviteLink(target.session, command.inviteId);
      if (!url) throw new Error('unavailable');
      yield* call(() => navigator.clipboard.writeText(url));
      const settled = yield* commandTarget(target, authority);
      if (settled) {
        target = settled;
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
      const settled = yield* commandTarget(target, authority);
      if (!settled) return;
      target = settled;
      const admitted = admitCollaborationCommand('host-membership', commandReceipt);
      if (!admitted) return;
      commandReceipt = admitted;
      created = { id: result.invite.id, url: result.url };
      retainHostInviteLink(target.session, created.id, created.url);
      yield* put(withRecoveryLifetime(hostMembershipCreated(target, created.id), commandReceipt));
    } else if (command.kind === 'remove') {
      const state = yield* selectHostMembershipState.effect();
      const member = getItem(state.members, command.principalId);
      if (!member || member.hostRole !== 'member') {
        yield* put(hostMembershipFailed(target, m.collaboration_host_forbidden_error()));
        return;
      }
      yield* call(hostMembershipClient.removeMember, command.principalId);
    } else if (command.kind === 'revoke') {
      const state = yield* selectHostMembershipState.effect();
      if (!getItem(state.invites, command.inviteId)) {
        yield* put(hostMembershipFailed(target, m.collaboration_host_request_error()));
        return;
      }
      yield* call(hostMembershipClient.revokeInvite, command.inviteId);
    }
    if (command.kind !== 'load') {
      const settled = yield* commandTarget(target, authority);
      if (!settled) return;
      target = settled;
    }
    if (!(yield* current(target))) return;
    if (command.kind === 'remove' || command.kind === 'revoke') {
      const admitted = admitCollaborationCommand('host-membership', commandReceipt);
      if (!admitted) return;
      commandReceipt = admitted;
    }
    refreshing = true;
    const receipt = rendererEventRecovery.capture('host-membership');
    const lists = yield* call(() =>
      readCollaboration('host-membership', async () => {
        const reads = [
          hostMembershipClient.listMembers(),
          hostMembershipClient.listInvites(),
        ] as const;
        const results = await Promise.allSettled(reads);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        const [roster, invitationList] = await Promise.all(reads);
        return { roster, invitationList };
      }),
    );
    if (!lists || !(yield* current(target)) || !receipt.commit(() => undefined)) return;
    const { roster, invitationList } = lists;
    const retained = invitationList.invites.map((invite) => ({
      id: invite.id,
      url: invite.url ?? readHostInviteLink(target.session, invite.id),
    }));
    clearHostInviteLinks(target.session);
    for (const invite of retained) {
      if (invite.url) retainHostInviteLink(target.session, invite.id, invite.url);
      else if (created && created.id === invite.id)
        retainHostInviteLink(target.session, invite.id, created.url);
    }
    yield* put(
      withRecoveryLifetime(
        hostMembershipLoaded(
          target,
          roster.members,
          invitationList.invites.map(safeInvite),
          roster.revision,
        ),
        receipt,
      ),
    );
  } catch (error) {
    if (!refreshing) {
      const settled = yield* commandTarget(target, authority);
      if (!settled) return;
      target = settled;
    }
    if (!(yield* current(target)) || !commandReceipt.commit(() => undefined)) return;
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
    } else yield* put(hostMembershipFailed(target, message, refreshing));
  } finally {
    const state = yield* selectHostMembershipState.effect();
    // A same-owner revision rebind keeps this flight busy until it settles.
    // Never settle a response into another presentation session.
    if (state.target?.session === target.session && state.operationId === operationId) {
      yield* put(hostMembershipFinished(state.target, operationId));
      if (state.reloadPending && (yield* current(state.target)))
        yield* put(hostMembershipRequested(state.target, { kind: 'load' }));
    }
  }
}

function* opened(action: ReturnType<typeof hostMembershipOpened>): SagaGenerator<void> {
  yield* call(clearHostInviteLinks, action.payload[0].session);
  yield* put(hostMembershipRequested(action.payload[0], { kind: 'load' }));
}
function* closed(action: ReturnType<typeof hostMembershipClosed>): SagaGenerator<void> {
  yield* call(clearHostInviteLinks, action.payload[0].session);
}
function* refreshLists(): SagaGenerator<void> {
  const state = yield* selectHostMembershipState.effect();
  if (state.target && !state.busy && (yield* current(state.target)))
    yield* put(hostMembershipRequested(state.target, { kind: 'load' }));
}
export function* hostMembershipSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(hostMembershipOpened, opened),
    takeEvery([hostMembershipListsChanged, hostMembershipRebound], refreshLists),
    takeEvery(hostMembershipClosed, closed),
    takeEvery(hostMembershipRequested, execute),
  ]);
}
