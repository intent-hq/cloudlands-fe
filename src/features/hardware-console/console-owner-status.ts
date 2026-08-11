/**
 * Renderer side of the console-owner tracking IPC
 * (intent-hq/monorepo#1928): query this window's owner status via the
 * `hardware-console:get-owner-status` invoke channel and observe the
 * per-window `hardware-console:owner-changed` pushes. Talks to the preload
 * bridge (`window.electronAPI`) directly — like the clear-lighting listener
 * — because both channels are main-process-owned and must not route through
 * the mock IPC router. No bridge (web build / tests) means the single page
 * is always the owner; callers keep the slice default (`true`).
 *
 * Saga orchestration (hydration dispatch, push subscription lifetime) lives
 * in the device saga; this module holds the reusable bridge helpers.
 */

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import { Logger } from '../../shared/logger';

const logger = new Logger('HardwareConsoleOwnerStatus');

/** Minimal preload-bridge surface used here (window.electronAPI). */
export interface ConsoleOwnerIpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, handler: (...args: unknown[]) => void): string;
  offById(channel: string, listenerId: string): void;
}

/** The preload bridge, or null outside Electron (web build / tests). */
export function getConsoleOwnerBridge(): ConsoleOwnerIpcLike | null {
  return (globalThis as { electronAPI?: ConsoleOwnerIpcLike }).electronAPI ?? null;
}

/** Extract the `isOwner` flag from a `{ isOwner: boolean }` payload, else null. */
function parseIsOwner(payload: unknown): boolean | null {
  const isOwner = (payload as { isOwner?: unknown } | null | undefined)?.isOwner;
  return typeof isOwner === 'boolean' ? isOwner : null;
}

/**
 * Ask main whether this window owns the console. Returns null on an
 * unrecognized response or a failed invoke, so callers keep the default.
 */
export async function queryConsoleOwnerStatus(ipc: ConsoleOwnerIpcLike): Promise<boolean | null> {
  try {
    const response = await ipc.invoke(IPC_CHANNELS.HARDWARE_CONSOLE.GET_OWNER_STATUS);
    return parseIsOwner(response);
  } catch (error) {
    logger.warn('Owner-status query failed; keeping default', { error: String(error) });
    return null;
  }
}

/**
 * Listen for main's per-window `owner-changed` pushes. Unrecognized
 * payloads are ignored. Returns an unsubscribe function.
 */
export function installConsoleOwnerListener(
  ipc: ConsoleOwnerIpcLike,
  onChange: (isOwner: boolean) => void,
): () => void {
  const listenerId = ipc.on(IPC_CHANNELS.HARDWARE_CONSOLE.OWNER_CHANGED, (payload) => {
    const isOwner = parseIsOwner(payload);
    if (isOwner !== null) onChange(isOwner);
  });
  return () => ipc.offById(IPC_CHANNELS.HARDWARE_CONSOLE.OWNER_CHANGED, listenerId);
}
