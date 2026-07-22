// Electron bridge to replace Tauri API calls
// This provides a compatibility layer for the Tauri API

import type { DynamicElectronEventName, ElectronEventName } from '$shared/ipc-registry';
import { invoke as ipcInvoke } from '$shared/generated/ipc-client';
import { addMockIpcListener, emitMockIpcEvent } from '$shared/ipc-mock-router';
import { Logger } from '$shared/logger';

const logger = new Logger('ElectronBridge');

type ElectronListenerEventName = ElectronEventName | DynamicElectronEventName;

/**
 * Extract event data from IPC events in a consistent way.
 *
 * IPC events can arrive in different formats depending on how they were emitted:
 *
 * 1. Direct IPC (flat data): `window.webContents.send('event', { field1, field2 })`
 *    - listenSync receives: `{ payload: { field1, field2 } }`
 *
 * 2. Redux event dispatch (wrapped): `dispatch(emitWorkspaceEvent({ type: 'event', data: { field1 } }))`
 *    - listenSync receives: `{ payload: { type: 'event', data: { field1 }, workspaceId, ... } }`
 *
 * This helper normalizes both formats to extract the actual data.
 *
 * @param event - The event object from listenSync handler
 * @param fieldName - Optional: extract a specific field from the data (e.g., 'agentId')
 * @returns The extracted data or field value
 *
 * @example
 * // For WorkspaceEvent with nested data:
 * listenSync('agent:deleted', (event) => {
 *   const agentId = extractEventData(event, 'agentId'); // extracts from event.payload.data.agentId
 * });
 *
 * @example
 * // For flat IPC data:
 * listenSync('agent:renamed', (event) => {
 *   const data = extractEventData(event); // returns event.payload directly
 * });
 */
export function extractEventData<T = any>(event: any, fieldName?: string): T {
  // Get the payload (listenSync wraps data in { payload: data })
  const payload = event?.payload ?? event;

  // Check if this is a WorkspaceEvent by looking for fields that ALL WorkspaceEvents have.
  // Previously only checked for 'type' and 'data', which matched stream events like
  // { type: 'content-blocks', data: blocks } — causing misidentification.
  // WorkspaceEvents always have { id, type, timestamp, data, ... } (see WorkspaceEventBase).
  // Checks for { id, type, timestamp, data } to distinguish from stream events.
  const isWorkspaceEvent =
    payload &&
    typeof payload === 'object' &&
    'type' in payload &&
    'data' in payload &&
    'id' in payload &&
    'timestamp' in payload;

  if (fieldName) {
    // Extract a specific field - check both nested (WorkspaceEvent) and flat formats
    if (isWorkspaceEvent) {
      // WorkspaceEvent format: payload.data.fieldName
      return payload.data?.[fieldName] ?? payload[fieldName];
    }
    // Flat format: payload.fieldName
    return payload?.[fieldName];
  }

  // Return the full data object
  if (isWorkspaceEvent) {
    // For WorkspaceEvents, return the data object (most handlers want this)
    return payload.data;
  }
  // For flat events, return the payload directly
  return payload;
}

/**
 * Type guard to check if an event payload is a WorkspaceEvent.
 * Checks for id + type + timestamp + data to avoid false positives from stream events
 * that also have 'type' and 'data' (e.g., { type: 'content-blocks', data: blocks }).
 * Checks for { id, type, timestamp, data } to distinguish from stream events.
 */
export function isWorkspaceEvent(
  payload: any,
): payload is { id: string; type: string; data: any; timestamp: string; workspaceId?: string } {
  return (
    payload &&
    typeof payload === 'object' &&
    'type' in payload &&
    'data' in payload &&
    'id' in payload &&
    'timestamp' in payload
  );
}

/**
 * Check if we're running in Electron environment
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

/**
 * Get the Electron IPC API for direct event listener registration.
 * Middleware that needs to subscribe to IPC events (e.g., BACKEND.STATUS)
 * can call electronAPI().on(...) directly.
 */
export function electronAPI() {
  if (typeof window === 'undefined' || !(window as any).electronAPI) {
    throw new Error('electronAPI is not available (not running in Electron environment)');
  }
  return (window as any).electronAPI;
}

/**
 * Invoke an IPC method.
 *
 * Routed through the mock IPC router (via the generated client) rather than the
 * real Electron bridge, so callers receive mock responses by channel.
 */
export async function invoke<T>(channel: string, data?: any): Promise<T> {
  return await ipcInvoke<T>(channel, data);
}

/**
 * Error thrown when an IPC call times out
 */
export class IpcTimeoutError extends Error {
  constructor(
    public readonly channel: string,
    public readonly timeoutMs: number,
  ) {
    super(`IPC call to '${channel}' timed out after ${timeoutMs}ms`);
    this.name = 'IpcTimeoutError';
  }
}

/**
 * Invoke an IPC method with a timeout
 *
 * This is useful for preventing the UI from hanging indefinitely if an IPC handler
 * in the main process hangs or takes too long.
 *
 * @param channel - The IPC channel to invoke
 * @param data - Optional data to send with the request
 * @param timeoutMs - Timeout in milliseconds (default: 30000ms = 30 seconds)
 * @throws IpcTimeoutError if the call times out
 *
 * @example
 * try {
 *   const result = await invokeWithTimeout('my-channel', { id: '123' }, 5000);
 * } catch (error) {
 *   if (error instanceof IpcTimeoutError) {
 *     console.error('IPC call timed out');
 *   }
 * }
 */
export async function invokeWithTimeout<T>(
  channel: string,
  data?: any,
  timeoutMs: number = 30000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new IpcTimeoutError(channel, timeoutMs));
      }
    }, timeoutMs);

    ipcInvoke<T>(channel, data)
      .then((result: T) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch((error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

/**
 * Subscribe to an IPC event (synchronous version - preferred for Svelte components)
 *
 * Use this in $effect() or onMount() to subscribe to events with proper cleanup.
 * Returns the cleanup function immediately, avoiding race conditions that can occur
 * with the async version when components unmount quickly.
 *
 * This function uses ID-based listener removal to work reliably with Electron's
 * context isolation, where callback reference equality (===) fails across the
 * context bridge.
 *
 * @example
 * // In a Svelte $effect:
 * $effect(() => {
 *   const cleanup = listenSync('my-event', (data) => { ... });
 *   return cleanup;
 * });
 *
 * // In onMount:
 * onMount(() => {
 *   const cleanup = listenSync('my-event', (data) => { ... });
 *   return cleanup;
 * });
 */
export function listenSync<T>(
  event: ElectronEventName,
  handler: (payload: { payload: T }) => void,
): () => void;
export function listenSync<T>(
  event: DynamicElectronEventName,
  handler: (payload: { payload: T }) => void,
): () => void;
export function listenSync<T>(
  event: ElectronListenerEventName,
  handler: (payload: { payload: T }) => void,
): () => void;
export function listenSync<T>(
  event: ElectronListenerEventName,
  handler: (payload: { payload: T }) => void,
): () => void {
  // Routed through the mock IPC router: register the listener and return its
  // disposer. Mock events are delivered via emitMockIpcEvent() by channel.
  return addMockIpcListener(event, (data) => {
    handler({ payload: data as T });
  });
}

/**
 * Subscribe to an IPC event (async version - for backward compatibility)
 *
 * @deprecated Prefer listenSync() for Svelte components to avoid race conditions
 * during component unmount. The async version can leave orphan listeners if the
 * component unmounts before the promise resolves.
 */
export async function listen<T>(
  event: ElectronListenerEventName,
  handler: (payload: { payload: T }) => void,
): Promise<() => void> {
  // Just call the sync version - no actual async work is needed
  return listenSync(event, handler);
}

export async function emit(event: string, payload?: any): Promise<void> {
  // Deliver to mock listeners registered on the channel.
  emitMockIpcEvent(event, payload);
}

let onListenerSequence = 0;

/**
 * Add event listener (direct access to electronAPI.on)
 *
 * @deprecated Use `listenSync()` instead for reliable cleanup with context isolation.
 *
 * Routed through the mock IPC router. Returns a unique listener ID; cleanup is
 * not supported via off() — prefer listenSync(), which returns its own disposer.
 */
export function on(event: string, handler: (...args: any[]) => void): string {
  addMockIpcListener(event, (payload) => handler(payload));
  return `mock-listener-${++onListenerSequence}`;
}

/**
 * Remove event listener (direct access to electronAPI.off)
 *
 * @deprecated Handler-based removal is not supported by the mock IPC router.
 * Prefer `listenSync()`, which returns its own disposer.
 */
export function off(event: string, _handler: (...args: any[]) => void): void {
  logger.warn(
    'off() is deprecated and is a no-op with the mock IPC router. Use listenSync() instead.',
    { event },
  );
}

// File dialog replacements
export const dialog = {
  async message(
    message: string,
    options?: {
      title?: string;
      type?: 'info' | 'warning' | 'error';
      buttons?: string[];
    },
  ): Promise<number> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await invoke<number>('dialog:message', {
        message,
        ...options,
      });
    }
    return 0;
  },
};

// Shell/opener replacements. Always routes through the shell:openExternal
// channel (host-bridge-seeder → openExternalUrl); the old window.electronAPI
// gate silently no-opped every external link when no preload bridge exists.
export const shell = {
  async open(url: string): Promise<void> {
    await invoke('shell:openExternal', { url });
  },
};

// Export as Tauri-compatible modules for easier migration
export const core = { invoke };
export const event = { listen, emit };
