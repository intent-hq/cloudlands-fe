import { backend } from '@/features/backend/backend-transport';
import { store } from '@/store';
import { selectTerminalContext } from '@/store/terminals/terminals-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { createBackendInteractiveTerminalsClient } from '$lib/client/live/backend-interactive-terminals-client';
import { m } from '$shared/paraglide/messages.js';

/** Capture a physical primary-root admission before any asynchronous request. */
export function createWorkspaceTerminalClient(workspaceId: string, active: () => boolean) {
  const context = selectTerminalContext.select(store.state, workspaceId);
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  const check = () => {
    const currentWorkspace = selectWorkspaceById.select(store.state, workspaceId);
    if (
      !active() ||
      !context ||
      !root ||
      selectTerminalContext.select(store.state, workspaceId) !== context ||
      (currentWorkspace?.worktreePath || currentWorkspace?.repositoryPath) !== root
    )
      throw new Error(m.workspace_client_accessChanged_error());
  };
  return createBackendInteractiveTerminalsClient(
    {
      ...backend,
      backendRequest: (method, params, options) => {
        check();
        const requested = params as { workspaceId?: string; cwd?: string } | undefined;
        if (
          requested?.workspaceId !== workspaceId ||
          (method === 'terminal.create' && requested.cwd !== root)
        )
          return Promise.reject(new Error(m.workspace_client_accessChanged_error()));
        return backend.backendRequest(method, params, options);
      },
    },
    { strict: true, guard: check },
  );
}
