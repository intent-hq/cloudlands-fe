/**
 * Live setup-scripts domain backed by the intentd daemon (PROTOCOL §5.25).
 *
 * The per-workspace worktree setup script lives on the daemon
 * (`workspace.getSetupScript` / `saveSetupScript` / `detectProjectType` /
 * `generateSetupScript`); this client forwards those RPCs verbatim.
 * `generate` maps the reference UI's `generateWithAgent`
 * (SetupScriptAgent.svelte) — the daemon returns an AI-assisted draft that is
 * NOT auto-saved; callers persist it via `save`.
 */
import type { SetupScriptsClient, WorkspaceSetupScript } from '../app-client';
import { backendRequest } from './backend-transport';

/** Unwrap the `{ setupScript }` envelope the §5.25 methods return. */
function unwrapSetupScript(result: unknown): WorkspaceSetupScript | null {
  if (!result || typeof result !== 'object') return null;
  const record = (result as { setupScript?: unknown }).setupScript;
  if (!record || typeof record !== 'object') return null;
  return record as WorkspaceSetupScript;
}

export class LiveSetupScriptsClient implements SetupScriptsClient {
  async get(workspaceId: string): Promise<WorkspaceSetupScript | null> {
    try {
      const result = await backendRequest('workspace.getSetupScript', { workspaceId });
      return unwrapSetupScript(result);
    } catch {
      return null;
    }
  }

  async save(workspaceId: string, script: string): Promise<WorkspaceSetupScript | null> {
    try {
      const result = await backendRequest('workspace.saveSetupScript', { workspaceId, script });
      return unwrapSetupScript(result);
    } catch {
      return null;
    }
  }

  async detectProjectType(workspaceId: string): Promise<string | null> {
    try {
      const result = await backendRequest<{ projectType?: unknown }>(
        'workspace.detectProjectType',
        { workspaceId },
      );
      return typeof result?.projectType === 'string' ? result.projectType : null;
    } catch {
      return null;
    }
  }

  async generate(workspaceId: string): Promise<WorkspaceSetupScript | null> {
    try {
      const result = await backendRequest('workspace.generateSetupScript', { workspaceId });
      return unwrapSetupScript(result);
    } catch {
      return null;
    }
  }
}
