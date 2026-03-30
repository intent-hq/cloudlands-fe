/**
 * Shared electron-bridge mock for tests.
 *
 * Usage:
 *   vi.mock('$lib/electron-bridge', async () =>
 *     await import('$lib/store/utils/test-helpers/electron-bridge-mock')
 *   );
 *
 * Covers the commonly-mocked exports from `$lib/electron-bridge`.
 * The full module has many more exports (see `src/lib/electron-bridge.ts`),
 * but tests typically only need the subset provided here.
 * Every function is a `vi.fn()` — tests that import named exports
 * (e.g. `invoke`) can use `vi.mocked(invoke)` to add per-test behaviour.
 */

import { vi } from 'vitest';

/** IPC invoke – resolves to `undefined` by default. */
export const invoke = vi.fn();

/** Synchronous event listener — returns an unsubscribe function. */
export const listenSync = vi.fn((_event: string, _handler: (payload: any) => void) => () => {});

/** Async event listener — resolves to an unsubscribe function. */
export const listen = vi.fn(async (_event: string, _handler: (payload: any) => void) => () => {});

/** Returns `false` by default — most tests don't run in Electron. */
export const isElectron = vi.fn(() => false);

/** Fire-and-forget event emitter. */
export const emit = vi.fn();

/** Deprecated event registration — returns a listener ID string. */
export const on = vi.fn(() => '');

/** Deprecated event un-registration. */
export const off = vi.fn();

/** IPC invoke with configurable timeout. */
export const invokeWithTimeout = vi.fn();

/** Extract the payload from an IPC event wrapper. */
export const extractEventData = vi.fn((event: any, fieldName?: string) => {
  const payload = event?.payload ?? event;

  // Check if this is a WorkspaceEvent (has id, type, timestamp, data)
  const isWsEvent =
    payload &&
    typeof payload === 'object' &&
    'type' in payload &&
    'data' in payload &&
    'id' in payload &&
    'timestamp' in payload;

  if (fieldName) {
    if (isWsEvent) {
      return payload.data?.[fieldName] ?? payload[fieldName];
    }
    return payload?.[fieldName];
  }

  if (isWsEvent) {
    return payload.data;
  }
  return payload;
});

/** Check whether a payload looks like a workspace event. */
export const isWorkspaceEvent = vi.fn(() => false);

/** Timeout error thrown by `invokeWithTimeout`. */
export class IpcTimeoutError extends Error {
  constructor(
    public readonly channel: string,
    public readonly timeoutMs: number,
  ) {
    super(`IPC call to '${channel}' timed out after ${timeoutMs}ms`);
    this.name = 'IpcTimeoutError';
  }
}

/** Dialog helpers (open / save / message). */
export const dialog = {
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
};

/** Shell helpers. */
export const shell = {
  open: vi.fn(),
};

/** Alias for `dialog.open`. */
export const open = dialog.open;

/** Tauri-compatible `core` shim. */
export const core = { invoke };

/** Tauri-compatible `event` shim. */
export const event = { listen, emit };

