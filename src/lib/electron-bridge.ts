// Electron bridge to replace Tauri API calls
// This provides a compatibility layer for the Tauri API

import type { DynamicElectronEventName, ElectronEventName } from '$shared/ipc-registry';
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
 * Invoke an IPC method
 * @throws Error if not in Electron environment
 */
export async function invoke<T>(channel: string, data?: any): Promise<T> {
  if (isElectron()) {
    return await (window as any).electronAPI.invoke(channel, data);
  }
  throw new Error('Electron IPC not available - are you running in the Electron app?');
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
 * @throws Error if not in Electron environment
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
  if (!isElectron()) {
    throw new Error('Electron IPC not available - are you running in the Electron app?');
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new IpcTimeoutError(channel, timeoutMs));
      }
    }, timeoutMs);

    (window as any).electronAPI
      .invoke(channel, data)
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
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    // Register the listener
    // Note: window.electronAPI.on passes data directly, not as second parameter
    const listener = (data: T) => {
      handler({ payload: data });
    };

    // on() returns a unique listener ID for reliable removal with context isolation
    const listenerId = (window as any).electronAPI.on(event, listener);

    // Return unsubscribe function immediately using the listener ID
    return () => {
      if (listenerId) {
        (window as any).electronAPI.offById(event, listenerId);
      }
    };
  }

  // Return no-op unsubscribe if not in Electron
  logger.warn('Electron not available for event', { event });
  return () => {};
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
  if (typeof window !== 'undefined' && window.electronAPI) {
    (window.electronAPI as any).emit?.(event, payload);
  }
}

/**
 * Add event listener (direct access to electronAPI.on)
 *
 * @deprecated Use `listenSync()` instead for reliable cleanup with context isolation.
 * The on/off pattern fails because Electron's context isolation creates new function
 * proxies each time a function crosses the context bridge, breaking === comparison.
 *
 * If you need to use on() directly (e.g., for singleton listeners that never get
 * cleaned up), be aware that off() will not work reliably. Use window.electronAPI.on()
 * directly and capture the returned listener ID for cleanup with offById().
 */
export function on(event: string, handler: (...args: any[]) => void): string {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI.on(event, handler);
  }
  return '';
}

/**
 * Remove event listener (direct access to electronAPI.off)
 *
 * @deprecated This function does NOT work reliably with Electron's context isolation!
 * Use `listenSync()` instead, which handles cleanup correctly using ID-based removal.
 *
 * The issue: When functions cross the context bridge, they get wrapped in proxies.
 * Each crossing creates a NEW proxy, so off() can't find the original handler.
 */
export function off(event: string, handler: (...args: any[]) => void): void {
  if (typeof window !== 'undefined' && window.electronAPI) {
    logger.warn(
      'off() is deprecated and may not work with context isolation. Use listenSync() or offById() instead.',
      { event },
    );
    window.electronAPI.off(event, handler);
  }
}

// File dialog replacements
export const dialog = {
  async open(options?: {
    directory?: boolean;
    multiple?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
    title?: string;
  }): Promise<string | string[] | null> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      logger.debug('Invoking dialog:open with options', { hasOptions: !!options });
      const response = await window.electronAPI.invoke('dialog:open', options || {});
      logger.debug('Response received from dialog:open');
      // Handle both wrapped response format and raw file paths
      if (response && typeof response === 'object' && 'data' in response) {
        // Response is wrapped: { success: true, data: { canceled, filePaths } }
        if (response.data?.canceled) {
          logger.debug('Dialog was canceled');
          return null;
        }
        const filePaths = response.data?.filePaths;
        if (!filePaths || filePaths.length === 0) {
          logger.debug('No file paths returned');
          return null;
        }
        // Return single path if not multiple, array if multiple
        const result = options?.multiple ? filePaths : filePaths[0];
        logger.debug('Returning result from dialog:open', { isArray: Array.isArray(result) });
        return result;
      }
      // Response is raw file paths (backward compatibility)
      logger.debug('Returning raw response from dialog:open');
      return response;
    }
    logger.warn('electronAPI not available for dialog:open');
    return null;
  },

  async save(options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
    title?: string;
  }): Promise<string | null> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const response = await window.electronAPI.invoke('dialog:save', options || {});
      // Handle both wrapped response format and raw file path
      if (response && typeof response === 'object' && 'data' in response) {
        // Response is wrapped: { success: true, data: { canceled, filePath } }
        if (response.data?.canceled) {
          return null;
        }
        return response.data?.filePath || null;
      }
      // Response is raw file path (backward compatibility)
      return response;
    }
    return null;
  },

  async message(
    message: string,
    options?: {
      title?: string;
      type?: 'info' | 'warning' | 'error';
      buttons?: string[];
    },
  ): Promise<number> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return await window.electronAPI.invoke('dialog:message', {
        message,
        ...options,
      });
    }
    return 0;
  },
};

// Shell/opener replacements
export const shell = {
  async open(url: string): Promise<void> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.invoke('shell:openExternal', { url });
    }
  },
};

// File dialog open function for compatibility
export const open = dialog.open;

// Export as Tauri-compatible modules for easier migration
export const core = { invoke };
export const event = { listen, emit };
