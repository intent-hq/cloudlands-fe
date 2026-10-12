import type { IpcMainInvokeEvent } from 'electron';
import type { CommandResponse, Result, Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import type { Logger } from '../../../shared/logger';

/** One canonical validated OPEN body, shared by the legacy and captured routes. */
export function createWorkspaceOpenHandler({
  getWorkspace,
  logger,
  resultToCommandResponse,
}: {
  getWorkspace(id: string): Promise<Workspace | null>;
  logger: Pick<Logger, 'info'>;
  resultToCommandResponse<T>(result: Result<T, string>): CommandResponse<T>;
}) {
  return async (_event: IpcMainInvokeEvent, validated: { id: string }) => {
    const id = validated.id;
    const startTime = Date.now();
    logger.info('[WorkspaceIPC] Opening workspace', { workspaceId: id });

    // Get workspace - protocol adapter now returns data directly for MCP compatibility
    const getWorkspaceStart = Date.now();
    const workspace = await getWorkspace(id);
    logger.info('[WorkspaceIPC] Got workspace', {
      workspaceId: id,
      hasWorkspace: !!workspace,
      worktreePath: workspace?.worktreePath,
      repositoryPath: workspace?.repositoryPath,
      durationMs: Date.now() - getWorkspaceStart,
    });

    // Check if workspace exists (not null)
    if (workspace) {
      // Attribution is owned by the daemon (§17.4 / §5.19); no FE-side
      // agent-writes cache to warm here.

      // Metadata watcher retired alongside the workspace disk-read path;
      // workspace metadata is served by the daemon (`workspace.get`).

      // System prompts are assembled by the daemon harness; the FE no
      // longer pre-warms a prompt cache on workspace open.

      // Spec-note seeding is owned by the daemon (`workspace.create` runs
      // `ensure_spec_note`); the FE no longer performs FS-level orphan
      // recovery on open.

      logger.info('[WorkspaceIPC] Workspace open returning immediately', {
        workspaceId: id,
        totalDurationMs: Date.now() - startTime,
      });

      // Return in Result format for the frontend
      return resultToCommandResponse({ ok: true, data: workspace });
    } else {
      // Workspace not found or error
      return resultToCommandResponse({
        ok: false,
        error: m.workspaceIpc_workspaceNotFound_error(),
      });
    }
  };
}
