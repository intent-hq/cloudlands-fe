/**
 * Renderer client for the owner-side sharing RPCs (PROTOCOL §5.1 membership,
 * intent-hq/intentd#1868 / #1872): `workspace.members.list` / `.remove` and
 * `workspace.invite.create` / `.list` / `.revoke`. Reads return the daemon
 * payload verbatim; mutations fold transport/daemon errors into the shared
 * `MutationResult` contract so callers never catch.
 */
import type { MutationResult } from '$lib/client/app-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { mutationErrorMessage } from '$lib/client/live/live-support';
import type {
  InviteErrorCode,
  WorkspaceInvite,
  WorkspaceInviteCreateResult,
  WorkspaceMember,
} from './types';

/**
 * The daemon's machine-readable invite error code (`error.data.code`) when the
 * failure is an `Error::Invite`; `undefined` for every other error.
 */
export function inviteErrorCode(error: unknown): InviteErrorCode | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? (code as InviteErrorCode) : undefined;
}

export type InviteCreateOutcome =
  | { success: true; result: WorkspaceInviteCreateResult }
  | { success: false; error: string; code?: InviteErrorCode };

export const workspaceSharingClient = {
  /** `workspace.members.list` — Member+ may read; the daemon filters non-members (-32602). */
  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const result = await backendRequest<{ members?: WorkspaceMember[] }>('workspace.members.list', {
      workspaceId,
    });
    return Array.isArray(result?.members) ? result.members : [];
  },

  /** `workspace.members.remove` — owner only; the owner row itself is `-32602`. */
  async removeMember(workspaceId: string, principalId: string): Promise<MutationResult> {
    try {
      await backendRequest('workspace.members.remove', { workspaceId, principalId });
      return { success: true };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  },

  /**
   * `workspace.invite.create` — owner only. `pinLogin` restricts redemption to
   * one GitHub account; the daemon resolves it to a user id and echoes the
   * canonical login on `invite.pinLogin`. The `secret` / `url` come back once.
   */
  async createInvite(
    workspaceId: string,
    options: { pinLogin?: string } = {},
  ): Promise<InviteCreateOutcome> {
    const pinLogin = options.pinLogin?.trim();
    const params: { workspaceId: string; pinLogin?: string } = { workspaceId };
    if (pinLogin) params.pinLogin = pinLogin;
    try {
      const result = await backendRequest<WorkspaceInviteCreateResult>(
        'workspace.invite.create',
        params,
      );
      return { success: true, result };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error), code: inviteErrorCode(error) };
    }
  },

  /** `workspace.invite.list` — open (unredeemed, unrevoked, unexpired) invites; never the secret. */
  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    const result = await backendRequest<{ invites?: WorkspaceInvite[] }>('workspace.invite.list', {
      workspaceId,
    });
    return Array.isArray(result?.invites) ? result.invites : [];
  },

  /** `workspace.invite.revoke` — owner only. */
  async revokeInvite(workspaceId: string, inviteId: string): Promise<MutationResult> {
    try {
      await backendRequest('workspace.invite.revoke', { workspaceId, inviteId });
      return { success: true };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  },
};
