import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { WorkspaceWindowTarget } from '$shared/workspace-window-target';
import { m } from '$shared/paraglide/messages.js';

interface DockWorkspaceOpenResult {
  success?: boolean;
  windowId?: number;
  reused?: boolean;
  error?: string;
}

/** Focus an open normal workspace tab, or create a normal window without navigating the dock. */
export async function openDockWorkspace(workspaceId: string, agentId?: string): Promise<void> {
  const result = await invoke<DockWorkspaceOpenResult>(IPC_CHANNELS.WINDOW.OPEN_NEW, {
    route: `/workspace/${encodeURIComponent(workspaceId)}`,
    reuseExistingWorkspace: true,
    ...(agentId ? { agentId } : {}),
  });
  if (result?.success === false) throw new Error(result.error ?? 'Failed to open workspace');
}

/** Open Assistant in a normal window while keeping the dock on its own route. */
export async function openDockAssistant(agentId?: string): Promise<void> {
  const result = await invoke<DockWorkspaceOpenResult>(IPC_CHANNELS.WINDOW.OPEN_NEW, {
    route: '/',
    reuseExistingWorkspace: true,
    ...(agentId ? { agentId } : {}),
  });
  if (result?.success === false) throw new Error(result.error ?? 'Failed to open Assistant');
}

/** Preserve the selected agent when handing a compact conversation to the full app. */
export async function openDockConversation(
  workspaceId: string,
  agentId: string | null,
): Promise<void> {
  if (workspaceId === CHIEF_WORKSPACE_ID) return openDockAssistant(agentId ?? undefined);
  return openDockWorkspace(workspaceId, agentId ?? undefined);
}

/** Shared chat controls must hand navigation to a visible normal renderer. */
export function isDockRenderer(): boolean {
  return typeof window !== 'undefined' && /^\/dock(?:\/|$)/.test(window.location.pathname);
}

export async function openDockMessageTarget(
  workspaceId: string,
  agentId?: string,
  workspaceTarget?: WorkspaceWindowTarget,
): Promise<void> {
  try {
    const result = await invoke<DockWorkspaceOpenResult>(IPC_CHANNELS.WINDOW.OPEN_NEW, {
      route:
        workspaceId === CHIEF_WORKSPACE_ID ? '/' : `/workspace/${encodeURIComponent(workspaceId)}`,
      reuseExistingWorkspace: true,
      ...(agentId ? { agentId } : {}),
      ...(workspaceTarget ? { workspaceTarget } : {}),
    });
    if (result?.success === false) throw new Error(result.error ?? 'Failed to open workspace');
  } catch {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(m.dock_openFailed_error());
  }
}
