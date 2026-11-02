const STORAGE_KEY = 'dock:lastAgentByWorkspace';

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The agent last chosen in the dock for this backend's workspace, if any. */
export function readDockLastAgent(scope: string, workspaceId: string): string | null {
  const value = read()[JSON.stringify([scope, workspaceId])];
  return typeof value === 'string' ? value : null;
}

export function rememberDockLastAgent(scope: string, workspaceId: string, agentId: string): void {
  try {
    const all = read();
    all[JSON.stringify([scope, workspaceId])] = agentId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage is a convenience; selection still works without it.
  }
}
