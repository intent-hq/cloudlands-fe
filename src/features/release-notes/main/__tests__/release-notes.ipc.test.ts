/** Main-owned release notes: one startup claim and visible-renderer manual routing. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, data: unknown) => Promise<any>>();
let windows: ReturnType<typeof fakeWindow>[] = [];
let focused: ReturnType<typeof fakeWindow> | null = null;
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) },
  BrowserWindow: { getAllWindows: () => windows, getFocusedWindow: () => focused },
}));
vi.mock('../../../../main/ipc-validation-middleware', () => ({
  createSafeValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));
vi.mock('../../../../main/window-backend', () => ({
  getWindowForWebContents: (sender: unknown) =>
    windows.find((w) => w.renderers.includes(sender as any)) ?? null,
  getShownRendererWebContents: (window: ReturnType<typeof fakeWindow>) => window.shown,
  getRendererWebContents: (window: ReturnType<typeof fakeWindow>) => window.renderers,
  // A frame page is never its window's shown renderer.
  isShownRenderer: (window: ReturnType<typeof fakeWindow>, sender: unknown) =>
    window.shown === sender && sender !== window.webContents,
}));
vi.mock('../../../../main/frames', () => ({
  mostRecentFrame: () =>
    (focused && !focused.isDestroyed() ? focused : null) ??
    windows.find((w) => !w.isDestroyed()) ??
    null,
}));
const NOTES = { version: '2.1.0', notes: '## What changed', url: 'https://example.com/v2.1.0' };
vi.mock('../release-notes.service', () => ({
  getCurrentReleaseNotes: vi.fn(async () => NOTES),
  checkForReleaseNotesOnStartup: vi.fn(async (show: (notes: typeof NOTES) => void) => show(NOTES)),
}));
import { RELEASE_NOTES_CHANNELS as C } from '../../types';
import {
  __resetPendingReleaseNotesForTests,
  initializeReleaseNotesOnStartup,
  sendShowReleaseNotes,
  setupReleaseNotesIPC,
} from '../release-notes.ipc';
import { checkForReleaseNotesOnStartup } from '../release-notes.service';

function renderer() {
  return { send: vi.fn(), isDestroyed: () => false };
}
/** A frame: its page (`webContents`, backdrop only) holds two machine views and shows `child`. */
function fakeWindow() {
  const framePage = renderer();
  const home = renderer();
  const child = renderer();
  return {
    isDestroyed: () => false,
    webContents: framePage,
    renderers: [home, child],
    shown: child,
  };
}
function invoke(name: string, sender = windows[0]?.shown) {
  return handlers.get(name)!({ sender }, undefined);
}
function push(window: ReturnType<typeof fakeWindow>) {
  sendShowReleaseNotes(window as unknown as Electron.BrowserWindow, { notes: null });
}

describe('release-notes ownership', () => {
  beforeEach(() => {
    handlers.clear();
    windows = [fakeWindow(), fakeWindow()];
    focused = windows[0];
    __resetPendingReleaseNotesForTests();
    setupReleaseNotesIPC();
  });
  it('pushes startup to the shown renderer of only the focused window', async () => {
    await initializeReleaseNotesOnStartup();
    expect(windows[0].shown.send).toHaveBeenCalledWith(C.SHOW, { notes: NOTES });
    expect(windows[0].webContents.send).not.toHaveBeenCalled();
    expect(windows[1].shown.send).not.toHaveBeenCalled();
  });
  it('reserves the pending startup read for the pushed renderer and consumes it once', async () => {
    await initializeReleaseNotesOnStartup();
    expect((await invoke(C.GET_PENDING, windows[0].webContents)).data).toBeNull();
    expect((await invoke(C.GET_PENDING, windows[1].shown)).data).toBeNull();
    expect((await invoke(C.GET_PENDING)).data).toEqual(NOTES);
    expect((await invoke(C.GET_PENDING)).data).toBeNull();
  });
  it('keeps notes for a later visible renderer when no window existed', async () => {
    windows = [];
    focused = null;
    await initializeReleaseNotesOnStartup();
    windows = [fakeWindow()];
    expect((await invoke(C.GET_PENDING, windows[0].webContents)).data).toBeNull();
    expect((await invoke(C.GET_PENDING)).data).toEqual(NOTES);
  });
  it('allows a surviving shown renderer to claim if the reserved owner was destroyed', async () => {
    await initializeReleaseNotesOnStartup();
    windows[0].shown.isDestroyed = () => true;
    expect((await invoke(C.GET_PENDING, windows[1].shown)).data).toEqual(NOTES);
  });
  it('clears startup and closes every machine view on dismissal', async () => {
    await initializeReleaseNotesOnStartup();
    await invoke(C.DISMISS);
    for (const w of windows)
      for (const r of w.renderers) expect(r.send).toHaveBeenCalledWith(C.CLOSE, undefined);
    expect((await invoke(C.GET_PENDING)).data).toBeNull();
  });
  it('routes manual Help to the shown renderer and closes every other renderer', () => {
    push(windows[0]);
    expect(windows[0].shown.send).toHaveBeenCalledWith(C.SHOW, { notes: null });
    for (const w of windows)
      for (const r of w.renderers)
        if (r !== windows[0].shown) expect(r.send).toHaveBeenCalledWith(C.CLOSE, undefined);
    expect(windows[0].shown.send).not.toHaveBeenCalledWith(C.CLOSE, undefined);
  });
  it('settings manual fetch also closes hidden notes and clears pending startup', async () => {
    await initializeReleaseNotesOnStartup();
    expect((await invoke(C.GET, windows[1].shown)).data).toEqual(NOTES);
    expect(windows[0].shown.send).toHaveBeenCalledWith(C.CLOSE, undefined);
    expect((await invoke(C.GET_PENDING)).data).toBeNull();
  });
  it('does not reopen startup after manual interaction during a delayed startup check', async () => {
    vi.mocked(checkForReleaseNotesOnStartup).mockImplementationOnce(async (show) => {
      await invoke(C.DISMISS);
      show(NOTES);
    });
    await initializeReleaseNotesOnStartup();
    expect(windows[0].shown.send).not.toHaveBeenCalledWith(C.SHOW, { notes: NOTES });
    expect((await invoke(C.GET_PENDING)).data).toBeNull();
  });
  it('drops manual pushes to destroyed windows', () => {
    windows[0].isDestroyed = () => true;
    push(windows[0]);
    expect(windows[0].shown.send).not.toHaveBeenCalled();
  });
});
