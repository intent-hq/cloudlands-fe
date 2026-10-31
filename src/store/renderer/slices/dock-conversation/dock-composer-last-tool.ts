import { DOCK_MARK_TOOLS, type DockMarkTool } from '$shared/dock-evidence';

const STORAGE_KEY = 'dock:lastToolByWorkspace';

function read(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The annotate tool last chosen in the dock for this backend's workspace, if any. */
export function readDockLastTool(scope: string, workspaceId: string): DockMarkTool | null {
  const value = read()[JSON.stringify([scope, workspaceId])];
  return (DOCK_MARK_TOOLS as readonly unknown[]).includes(value) ? (value as DockMarkTool) : null;
}

export function rememberDockLastTool(scope: string, workspaceId: string, tool: DockMarkTool): void {
  try {
    const all = read();
    all[JSON.stringify([scope, workspaceId])] = tool;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage is a convenience; the tool still works for this app session.
  }
}
