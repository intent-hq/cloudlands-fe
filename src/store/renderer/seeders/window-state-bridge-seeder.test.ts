/**
 * Regression tests for the window workspace-state bridge seeder.
 *
 * Root cause of the dead desktop-notification pipeline: the generated
 * `invoke()` routes ALL legacy renderer invokes through the mock router in
 * every build, and `window:set-in-workspace` / `window:set-open-workspace-tabs`
 * were UNBRIDGED_INVOKE_ALLOWLIST absences. The ipcMain handlers in
 * features/system/main/system.ipc.ts therefore never ran even in the packaged
 * app, the `windowWorkspaceIds` / `windowOpenWorkspaceTabs` maps stayed empty,
 * and every consumer of window-workspace tracking broke: the Window menu,
 * `sendToWorkspaceWindows` (dropped `notification:show`), focus gating, and
 * the `window-workspace-state-changed`-driven NotificationService lifecycle.
 *
 * The bridge seeder forwards these channels to `window.electronAPI.invoke`
 * when the preload bridge is present, and resolves undefined when it is
 * absent (browser dev build) — matching the former allowlist disposition for
 * these fire-and-forget callers.
 *
 * `window:set-theme` regression (intent-hq/monorepo#2746): theme-saga's
 * `syncWindowTheme` invokes it saga-style, it was never bridged, so the
 * main-process nativeTheme handler never ran and startup logged
 * `UnbridgedMockIpcChannelError: window:set-theme`.
 *
 * `window:set-title` / `window:set-browser-focused` / `app:get-version`
 * regression (intent-hq/monorepo#2927): the same stale-allowlist defect class
 * — live main-process handlers in system.ipc.ts silently suppressed by
 * allowlisted absences, so the native window title never updated and main
 * never learned browser-panel focus in the packaged app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { addMockIpcListener, mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  registerAppVersionBridge,
  registerWindowFullScreenBridge,
  registerWindowFullScreenEventRelay,
  registerWindowStateBridge,
  registerWindowThemeBridge,
} from './window-state-bridge-seeder';

const INVOKE_CHANNELS = [
  IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE,
  IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS,
  IPC_CHANNELS.WINDOW.SET_THEME,
  IPC_CHANNELS.WINDOW.SET_TITLE,
  IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED,
  IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION,
];

const originalElectronAPI = (window as any).electronAPI;

describe('window-state-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards all window-state invoke channels to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({ success: true, forwarded: channel }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerWindowStateBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; forwarded: string }>(channel, {
        probe: channel,
      });
      expect(result.success).toBe(true);
      expect(result.forwarded).toBe(channel);
      expect(invokeSpy).toHaveBeenCalledWith(channel, { probe: channel });
    }
    expect(invokeSpy).toHaveBeenCalledTimes(INVOKE_CHANNELS.length);
  });

  it('forwards the exact caller payload shapes for each channel', async () => {
    const invokeSpy = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerWindowStateBridge();

    await mockInvoke(IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE, {
      inWorkspace: true,
      workspaceId: 'ws-1',
    });
    await mockInvoke(IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS, {
      workspaceIds: ['ws-1', 'ws-2'],
    });
    await mockInvoke(IPC_CHANNELS.WINDOW.SET_THEME, { theme: 'dark' });
    await mockInvoke(IPC_CHANNELS.WINDOW.SET_TITLE, { title: 'Workspace — Intent' });
    await mockInvoke(IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, {
      browserFocused: true,
      focusOwnerId: 'owner-1',
    });
    await mockInvoke(IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION, { active: true });

    expect(invokeSpy).toHaveBeenNthCalledWith(1, IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE, {
      inWorkspace: true,
      workspaceId: 'ws-1',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(2, IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS, {
      workspaceIds: ['ws-1', 'ws-2'],
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(3, IPC_CHANNELS.WINDOW.SET_THEME, {
      theme: 'dark',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(4, IPC_CHANNELS.WINDOW.SET_TITLE, {
      title: 'Workspace — Intent',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(5, IPC_CHANNELS.WINDOW.SET_BROWSER_FOCUSED, {
      browserFocused: true,
      focusOwnerId: 'owner-1',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(6, IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION, {
      active: true,
    });
  });

  it('returns safe browser fallbacks when no preload bridge exists', async () => {
    (window as any).electronAPI = undefined;
    registerWindowStateBridge();

    for (const channel of INVOKE_CHANNELS.slice(0, -1)) {
      await expect(mockInvoke(channel, { probe: channel })).resolves.toBeUndefined();
    }
    await expect(
      mockInvoke(IPC_CHANNELS.WINDOW.SET_DOCK_POINTER_REGION, { active: true }),
    ).resolves.toEqual({ success: false, supported: false });
  });

  it('forwards only the window theme channel and its exact payload to preload', async () => {
    const invokeSpy = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerWindowThemeBridge();

    await mockInvoke(IPC_CHANNELS.WINDOW.SET_THEME, { theme: 'dark' });

    expect(invokeSpy).toHaveBeenCalledOnce();
    expect(invokeSpy).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.SET_THEME, { theme: 'dark' });
  });
});

describe('app version bridge', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards app:get-version to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async () => '1.2.3');
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerAppVersionBridge();

    const version = await mockInvoke<string>(IPC_CHANNELS.APP.GET_VERSION);

    expect(version).toBe('1.2.3');
    expect(invokeSpy).toHaveBeenCalledOnce();
    expect(invokeSpy).toHaveBeenCalledWith(IPC_CHANNELS.APP.GET_VERSION, undefined);
  });

  it('resolves undefined when no preload bridge exists (browser dev build)', async () => {
    (window as any).electronAPI = undefined;
    registerAppVersionBridge();

    await expect(mockInvoke(IPC_CHANNELS.APP.GET_VERSION)).resolves.toBeUndefined();
  });
});

describe('window full-screen bridge (HUD)', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards set/get full-screen to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({
      success: true,
      fullScreen: true,
      forwarded: channel,
    }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerWindowFullScreenBridge();

    const setResult = await mockInvoke<{ success: boolean; forwarded: string }>(
      IPC_CHANNELS.WINDOW.SET_FULL_SCREEN,
      { fullScreen: true },
    );
    expect(setResult.success).toBe(true);
    expect(invokeSpy).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.SET_FULL_SCREEN, {
      fullScreen: true,
    });

    const getResult = await mockInvoke<{ success: boolean; forwarded: string }>(
      IPC_CHANNELS.WINDOW.GET_FULL_SCREEN,
      {},
    );
    expect(getResult.forwarded).toBe(IPC_CHANNELS.WINDOW.GET_FULL_SCREEN);
  });

  it('falls back to the DOM Fullscreen API when no preload bridge exists', async () => {
    (window as any).electronAPI = undefined;
    const requestSpy = vi.fn(async () => {});
    (document.documentElement as any).requestFullscreen = requestSpy;
    registerWindowFullScreenBridge();

    const setResult = await mockInvoke<{ success: boolean; fullScreen: boolean }>(
      IPC_CHANNELS.WINDOW.SET_FULL_SCREEN,
      { fullScreen: true },
    );
    expect(requestSpy).toHaveBeenCalled();
    expect(setResult.success).toBe(true);

    const getResult = await mockInvoke<{ success: boolean; fullScreen: boolean }>(
      IPC_CHANNELS.WINDOW.GET_FULL_SCREEN,
      {},
    );
    expect(getResult.success).toBe(true);
    expect(getResult.fullScreen).toBe(false);
  });

  it('relays main-process window:fullscreen events onto the mock event channel', () => {
    let bridgeListener: ((fullScreen: boolean) => void) | undefined;
    (window as any).electronAPI = {
      ...(originalElectronAPI || {}),
      on: vi.fn((channel: string, cb: (fullScreen: boolean) => void) => {
        if (channel === 'window:fullscreen') bridgeListener = cb;
        return 'listener-1';
      }),
    };
    registerWindowFullScreenEventRelay();
    expect(bridgeListener).toBeDefined();

    const received: boolean[] = [];
    const dispose = addMockIpcListener('window:fullscreen', (payload) => {
      received.push(payload as boolean);
    });
    bridgeListener!(true);
    bridgeListener!(false);
    expect(received).toEqual([true, false]);
    dispose();
  });
});
