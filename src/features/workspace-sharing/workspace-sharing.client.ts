/**
 * Renderer client for the owner-side sharing RPCs (PROTOCOL §5.1 membership,
 * intent-hq/intentd#1868 / #1872): `workspace.members.list` / `.add` /
 * `.remove`, `workspace.invite.create` / `.list` / `.revoke`, and the
 * host-wide `principal.list` behind direct member add. Reads return the daemon
 * payload verbatim; mutations fold transport/daemon errors into a bounded
 * `ShareFailure` (code + numeric rpc code, never the raw message — a transport
 * or daemon string may echo invite material) so callers never catch.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import {
  INVITE_ERROR_CODES,
  type HostPrincipal,
  type InviteErrorCode,
  type InvitePin,
  type WorkspaceInviteCreateResult,
  type WorkspaceInviteRow,
  type WorkspaceMember,
  type WorkspaceMembersAddResult,
  type WorkspaceMembersList,
} from './types';

const inviteErrorCodes: ReadonlySet<string> = new Set<string>(INVITE_ERROR_CODES);

/**
 * The daemon's machine-readable invite error code (`error.data.code`) when the
 * failure is an `Error::Invite`; `undefined` for every other error. Allowlisted
 * against `INVITE_ERROR_CODES` — an arbitrary `data.code` string is not a code.
 */
export function inviteErrorCode(error: unknown): InviteErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && inviteErrorCodes.has(code)
    ? (code as InviteErrorCode)
    : undefined;
}

/**
 * `error.data.code` of the daemon's `Error::ListenerDown` (`-32603`): the
 * invite listener is off because Remote access is disabled. Not an
 * `InviteErrorCode` (it is a transport-side refusal), so detected separately.
 */
const LISTENER_DOWN_CODE = 'listener-down';

function isListenerDownError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  return (data as { code?: unknown }).code === LISTENER_DOWN_CODE;
}

/**
 * Bounded failure class of a sharing RPC: `forbidden` is the daemon's `-32003`
 * capability refusal (the caller is not the owner), an `InviteErrorCode` is a
 * machine-readable invite failure, `listener-down` means Remote access is off
 * so no invite can be served, and everything else is `unknown`.
 */
type ShareFailureCode = 'forbidden' | InviteErrorCode | typeof LISTENER_DOWN_CODE | 'unknown';

export interface ShareFailure {
  success: false;
  code: ShareFailureCode;
  /** Numeric JSON-RPC code when the daemon answered; absent on transport errors. */
  rpcCode?: number;
}

export type ShareMutationOutcome = { success: true } | ShareFailure;

export type InviteCreateOutcome =
  { success: true; result: WorkspaceInviteCreateResult } | ShareFailure;

export type MemberAddOutcome = { success: true; result: WorkspaceMembersAddResult } | ShareFailure;

/**
 * Fold any thrown error into a `ShareFailure`. Only bounded fields leave here —
 * this is also what log lines carry, so no raw error ever reaches a sink.
 */
function shareFailure(error: unknown): ShareFailure {
  const rpcCode =
    error &&
    typeof error === 'object' &&
    typeof (error as { rpcCode?: unknown }).rpcCode === 'number'
      ? (error as { rpcCode: number }).rpcCode
      : undefined;
  const code: ShareFailureCode = isForbiddenErrorResponse(error)
    ? 'forbidden'
    : isListenerDownError(error)
      ? LISTENER_DOWN_CODE
      : (inviteErrorCode(error) ?? 'unknown');
  const failure: ShareFailure = { success: false, code };
  if (rpcCode !== undefined) failure.rpcCode = rpcCode;
  return failure;
}

export const workspaceSharingClient = {
  /**
   * `workspace.members.list` — Member+ may read; the daemon filters
   * non-members (-32602). Returns the roster with the guest cap
   * (`guestCount` / `guestLimit`, `null` each when the daemon omits them).
   */
  async listMembers(workspaceId: string): Promise<WorkspaceMembersList> {
    const result = await backendRequest<{
      members?: WorkspaceMember[];
      guestCount?: unknown;
      guestLimit?: unknown;
    }>('workspace.members.list', { workspaceId });
    return {
      members: Array.isArray(result?.members) ? result.members : [],
      guestCount: typeof result?.guestCount === 'number' ? result.guestCount : null,
      guestLimit: typeof result?.guestLimit === 'number' ? result.guestLimit : null,
    };
  },

  /**
   * `principal.list` — owner only (`-32003` for a collaborator connection):
   * every guest already authed on this host with an active credential, in
   * creation order. No params.
   */
  async listPrincipals(): Promise<HostPrincipal[]> {
    const result = await backendRequest<{ principals?: HostPrincipal[] }>('principal.list', {});
    return Array.isArray(result?.principals) ? result.principals : [];
  },

  /**
   * `workspace.members.add` — owner only. Attaches a `principal.list` guest as
   * a collaborator; `added: false` when already a member. `-32602` for an
   * unknown / primary / uncredentialed principal, `guest-limit` at the cap.
   */
  async addMember(workspaceId: string, principalId: string): Promise<MemberAddOutcome> {
    try {
      const result = await backendRequest<WorkspaceMembersAddResult>('workspace.members.add', {
        workspaceId,
        principalId,
      });
      return { success: true, result };
    } catch (error) {
      return shareFailure(error);
    }
  },

  /** `workspace.members.remove` — owner only; the owner row itself is `-32602`. */
  async removeMember(workspaceId: string, principalId: string): Promise<ShareMutationOutcome> {
    try {
      await backendRequest('workspace.members.remove', { workspaceId, principalId });
      return { success: true };
    } catch (error) {
      return shareFailure(error);
    }
  },

  /**
   * `workspace.invite.create` — owner only. `pinLogin` restricts redemption to
   * one forge account; the daemon resolves it on `pin.provider` / `pin.host`
   * (its own identity forge when `pin` is absent) and echoes the canonical
   * login on `invite.pinLogin`. The raw `secret` comes back once; the `url`
   * is also listed on the open invite row afterwards.
   */
  async createInvite(
    workspaceId: string,
    options: { pinLogin?: string; pin?: InvitePin } = {},
  ): Promise<InviteCreateOutcome> {
    const pinLogin = options.pinLogin?.trim();
    const params: {
      workspaceId: string;
      pinLogin?: string;
      pinProvider?: InvitePin['provider'];
      pinHost?: string;
    } = { workspaceId };
    if (pinLogin) {
      params.pinLogin = pinLogin;
      if (options.pin) {
        params.pinProvider = options.pin.provider;
        if (options.pin.host) params.pinHost = options.pin.host;
      }
    }
    try {
      const result = await backendRequest<WorkspaceInviteCreateResult>(
        'workspace.invite.create',
        params,
      );
      return { success: true, result };
    } catch (error) {
      return shareFailure(error);
    }
  },

  /**
   * `workspace.invite.list` — open invites with their `url`: unrevoked,
   * unexpired, and — for a single-use invite — unredeemed; a reusable link
   * stays open across redemptions (`redemptionCount` counts them). The caller
   * vaults the links before any row enters the store.
   */
  async listInvites(workspaceId: string): Promise<WorkspaceInviteRow[]> {
    const result = await backendRequest<{ invites?: WorkspaceInviteRow[] }>(
      'workspace.invite.list',
      { workspaceId },
    );
    return Array.isArray(result?.invites) ? result.invites : [];
  },

  /** `workspace.invite.revoke` — owner only. */
  async revokeInvite(workspaceId: string, inviteId: string): Promise<ShareMutationOutcome> {
    try {
      await backendRequest('workspace.invite.revoke', { workspaceId, inviteId });
      return { success: true };
    } catch (error) {
      return shareFailure(error);
    }
  },
};
