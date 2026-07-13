/**
 * Shared broadcast helpers for domain event sagas.
 *
 * Extracted from domain-events-saga.ts so each domain-specific slice
 * can reuse the same IPC + STDIO broadcast logic.
 */

import type { DomainEvent } from "../../../features/events/types";
import { Logger } from "../../../shared/logger";

const logger = new Logger("DomainEventBroadcast");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract workspaceId from the domain event payload data.
 * Most domain event payloads have a workspaceId field.
 */
export function getWorkspaceId(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null && "workspaceId" in data) {
    return (data as Record<string, unknown>).workspaceId as string | undefined;
  }
  return undefined;
}

/**
 * Broadcast a domain event to renderer windows via IPC.
 *
 * - Global events → sendToWorkspaceWindows(undefined, ...) → all windows
 * - Workspace events → sendToWorkspaceWindows(workspaceId, ...) → scoped windows
 */
export async function broadcastDomainEvent(
  ipcChannel: DomainEvent,
  data: unknown,
  isGlobalEvent: boolean,
): Promise<void> {
  try {
    const { sendToWorkspaceWindows } = await import(
      "../../../features/system/main/system.ipc"
    );

    const safeData = data !== undefined ? data : {};

    if (isGlobalEvent) {
      // Global events go to ALL windows (workspace sidebar updates, etc.)
      sendToWorkspaceWindows(undefined, ipcChannel, safeData);
    } else {
      // Workspace-scoped: send to windows viewing this workspace
      const workspaceId = getWorkspaceId(data);
      sendToWorkspaceWindows(workspaceId, ipcChannel, safeData);
    }
  } catch (err) {
    logger.error(`Failed to broadcast domain event ${ipcChannel}:`, err);
  }
}

/**
 * Broadcast a domain event to the STDIO connection for MCP clients.
 * Uses the stdioConnection from stdio-connection (set via setStdioConnection).
 */
export async function broadcastDomainEventToStdio(
  ipcChannel: DomainEvent,
  data: unknown,
): Promise<void> {
  try {
    const { getStdioConnection } = await import(
      "../../../features/events/main/stdio-connection"
    );
    const stdio = getStdioConnection();
    if (stdio && !stdio.destroyed) {
      const message = `${JSON.stringify({
        type: "event",
        event: ipcChannel,
        data: data !== undefined ? data : {},
      })}\n`;
      stdio.write(message);
    }
  } catch {
    // STDIO may not be available — ignore silently
  }
}

