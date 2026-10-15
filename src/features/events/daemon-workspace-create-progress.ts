import type { WorkspaceEvent } from './types';
import {
  workspaceCreateProgressReceived,
  workspaceCreateProgressDone,
} from '../../store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';

/**
 * `git:clone:progress` / `git:clone:done` (§5.1 / §6.5) — provisioning
 * progress for an in-flight `workspace.create` that carried an FE-minted
 * `progressId`, echoed back on `data.progressId`. Correlation is by
 * progressId only (the envelope `workspaceId` is server-minted mid-create and
 * unknown to the FE until the RPC returns, and standalone `git.clone` frames
 * carry an empty one), so these route BEFORE the workspace-id gate. Frames
 * without a `progressId` (plain `git.clone`, older daemons) are left for the
 * requestId-correlated legacy consumers.
 */

export function handleCloneProgressEvent(
  event: WorkspaceEvent,
  type: string,
  dispatch: (action: { type: string }) => void,
): boolean {
  const data = (event as { data?: Record<string, unknown> }).data;
  const progressId = data?.progressId;
  if (typeof progressId !== 'string' || progressId.length === 0) return false;
  if (type === 'git:clone:progress') {
    const phase = data?.phase;
    const percent = data?.percent;
    if (typeof phase !== 'string' || typeof percent !== 'number') return true;
    dispatch(
      workspaceCreateProgressReceived(progressId, {
        phase,
        percent,
        message: typeof data?.message === 'string' ? data.message : undefined,
      }),
    );
    return true;
  }
  dispatch(
    workspaceCreateProgressDone(progressId, {
      ok: data?.ok === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
      errorCode: typeof data?.errorCode === 'string' ? data.errorCode : undefined,
    }),
  );
  return true;
}
