/**
 * requestDockLabEnabled acknowledgement contract: it resolves `true` only when main
 * confirms the requested state, so callers (the dock intro's "Turn off") never
 * claim a change that did not happen. Rejected and mismatched saves show the
 * shared save error and resolve `false`; with no bridge nothing changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.error } }));

import { requestDockLabEnabled, setDockLabEnabled } from './dock-lab';

function installBridge(invoke: (channel: string, payload: unknown) => Promise<unknown>) {
  (globalThis as { electronAPI?: unknown }).electronAPI = {
    invoke: vi.fn(invoke),
    on: vi.fn(() => 'listener'),
    offById: vi.fn(),
  };
  return (globalThis as unknown as { electronAPI: { invoke: ReturnType<typeof vi.fn> } })
    .electronAPI.invoke;
}

afterEach(() => {
  delete (globalThis as { electronAPI?: unknown }).electronAPI;
  mocks.error.mockClear();
});

describe('requestDockLabEnabled', () => {
  it('resolves true when main confirms the requested state', async () => {
    const invoke = installBridge(async () => ({ enabled: false }));
    await expect(requestDockLabEnabled(false)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(WINDOW_CHANNELS.SET_DOCK_LAB, { enabled: false });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('resolves false with the save error when main reports a different state', async () => {
    installBridge(async () => ({ enabled: true }));
    await expect(requestDockLabEnabled(false)).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalledWith(m.settings_gitWorkspace_saveError());
  });

  it('resolves false with the save error when the request is rejected', async () => {
    installBridge(async () => {
      throw new Error('disk unavailable');
    });
    await expect(requestDockLabEnabled(false)).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalledWith(m.settings_gitWorkspace_saveError());
  });

  it('resolves false with the save error for a malformed response', async () => {
    installBridge(async () => undefined);
    await expect(requestDockLabEnabled(false)).resolves.toBe(false);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('resolves false and changes nothing without a bridge', async () => {
    await expect(requestDockLabEnabled(false)).resolves.toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe('setDockLabEnabled', () => {
  it('keeps its fire-and-forget contract for switches and commands', async () => {
    const invoke = installBridge(async () => ({ enabled: true }));
    await expect(setDockLabEnabled(true)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(WINDOW_CHANNELS.SET_DOCK_LAB, { enabled: true });
    installBridge(async () => {
      throw new Error('disk unavailable');
    });
    await expect(setDockLabEnabled(false)).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith(m.settings_gitWorkspace_saveError());
  });
});
