/**
 * Synchronous Browser access helpers for the settings section. Main owns the
 * setting and server; requests go through the browser-access saga
 * (`browser-access-ipc.ts`). Without a preload bridge (web build) the section
 * is hidden.
 */

/** Whether this window can manage Browser access (desktop app only). */
export function canManageBrowserAccess(): boolean {
  return Boolean((globalThis as { electronAPI?: unknown }).electronAPI);
}
