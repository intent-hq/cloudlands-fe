import type { WorkspaceEvent } from './types';
import type { PrincipalIdentity } from '../workspace-sharing/types';
import { isHostMembershipChange } from '$shared/types/principal';
import {
  hostMembershipChanged,
  principalIdentityChanged,
} from '../../store/renderer/slices/principal/principal-slice';
import { hostExecutionInvalidated } from '../../store/renderer/slices/host-execution/host-execution-slice';
import {
  getPrincipalConnectionContext,
  type PrincipalProjectionState,
} from '../../store/renderer/slices/principal/principal-projections';

type AuthorityAction = ReturnType<
  typeof hostMembershipChanged | typeof principalIdentityChanged | typeof hostExecutionInvalidated
>;
export function routeAuthorityEvent(
  event: WorkspaceEvent,
  state: PrincipalProjectionState,
  dispatch: (action: AuthorityAction) => unknown,
  hooks?: {
    identityChanged?: (identity: PrincipalIdentity | null) => void;
    membershipListsChanged?: () => void;
  },
): boolean {
  const type = (event as { type: string }).type;
  if (type === 'principal:identity-changed') {
    routeIdentity(event, state, dispatch, hooks?.identityChanged);
    return true;
  }
  if (type === 'host:execution-context-changed') {
    dispatch(hostExecutionInvalidated());
    return true;
  }
  if (type === 'host:members-changed') {
    if (isHostMembershipChange(event.data)) {
      dispatch(hostMembershipChanged(event.data));
      hooks?.membershipListsChanged?.();
    }
    return true;
  }
  if (type === 'host:invites-changed') {
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return true;
    const { inviteId, action } = data as { inviteId?: unknown; action?: unknown };
    if (
      typeof inviteId === 'string' &&
      inviteId.trim().length > 0 &&
      typeof action === 'string' &&
      ['created', 'revoked', 'redeemed'].includes(action)
    )
      hooks?.membershipListsChanged?.();
    return true;
  }
  return false;
}
function routeIdentity(
  event: WorkspaceEvent,
  state: PrincipalProjectionState,
  dispatch: (action: AuthorityAction) => unknown,
  onIdentity?: (identity: PrincipalIdentity | null) => void,
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (typeof data?.principalId !== 'string' || !data.principalId.trim()) return;
  const identity = data?.identity;
  let triple: PrincipalIdentity | null = null;
  if (identity !== null) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return;
    const { provider, host, externalUserId } = identity as Record<string, unknown>;
    if (
      (provider !== 'github' && provider !== 'gitlab') ||
      typeof host !== 'string' ||
      !host.trim() ||
      typeof externalUserId !== 'string' ||
      !externalUserId.trim()
    )
      return;
    triple = { provider, host, externalUserId };
  }

  const principal = state.principal;
  if (
    principal?.context &&
    principal.context === getPrincipalConnectionContext(state) &&
    principal.boundPrincipalId === data.principalId
  )
    dispatch(principalIdentityChanged(data.principalId));
  onIdentity?.(triple);
}
